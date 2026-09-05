import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import { parseFragment } from 'parse5';
import YAML from 'yaml';

import {
  detectStandardFenceOpen,
  isStandardFenceClose,
  parseStandardCalloutDelimiter
} from './StandardCalloutParser.js';

export const ZENN_IMPLEMENTATION = 'zenn-v1';
export const ZENN_CONTRACT_REVIEWED_AT = '2026-09-06';

const ZENN_BOOK_SLUG = /^[0-9a-z_-]{12,50}$/u;
const ZENN_CHAPTER_SLUG = /^[0-9a-z_-]{1,50}$/u;
const ZENN_IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const ZENN_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const HTML_ENTITY = /&(?:#[xX][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);?/gu;
const SOURCE_AUDIT_MARKDOWN = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  maxNesting: 128
});
SOURCE_AUDIT_MARKDOWN.validateLink = () => true;
SOURCE_AUDIT_MARKDOWN.normalizeLink = (destination) => destination;

export class ZennAdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZennAdapterError';
  }
}

function flattenStructure(metadata) {
  return [
    ...metadata.structure.frontmatter.map((entry) => ({ ...entry, section: 'frontmatter' })),
    ...metadata.structure.chapters.map((entry) => ({ ...entry, section: 'chapters' })),
    ...metadata.structure.backmatter.map((entry) => ({ ...entry, section: 'backmatter' }))
  ];
}

function collectTokens(tokens, inheritedLine = 1) {
  const collected = [];
  for (const token of tokens) {
    const line = token.map ? token.map[0] + 1 : inheritedLine;
    collected.push({ token, line });
    if (token.children) collected.push(...collectTokens(token.children, line));
  }
  return collected;
}

function rejectSourceFrontMatter(source, sourcePath) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  if (!/^---[\t ]*$/u.test(lines[0] || '')) return;
  if (lines.slice(1).some((line) => /^(?:---|\.\.\.)[\t ]*$/u.test(line))) {
    throw new ZennAdapterError(
      `Source YAML Front Matter is not supported by the Zenn adapter: ${sourcePath}`
    );
  }
}

function removeCanonicalH1(source, sourcePath) {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (hadTrailingNewline) lines.pop();
  const h1Tokens = SOURCE_AUDIT_MARKDOWN.parse(normalized, {}).filter(
    (token) => token.type === 'heading_open' && token.tag === 'h1'
  );
  if (h1Tokens.length !== 1 || !h1Tokens[0].map) {
    throw new ZennAdapterError(
      `Zenn source must contain exactly one leading ATX h1: ${sourcePath}`
    );
  }
  const [startLine, endLine] = h1Tokens[0].map;
  if (
    lines.slice(0, startLine).some((line) => line.trim()) ||
    endLine !== startLine + 1 ||
    !/^#[\t ]+\S/u.test(lines[startLine] || '')
  ) {
    throw new ZennAdapterError(`Zenn source h1 must be the first content block: ${sourcePath}`);
  }
  lines.splice(startLine, endLine - startLine);
  return lines.join('\n') + (hadTrailingNewline ? '\n' : '');
}

function decodeHtmlEntities(source) {
  return String(source).replace(HTML_ENTITY, (entity) => {
    const fragment = parseFragment(entity);
    const text = fragment.childNodes?.find((node) => node.nodeName === '#text')?.value;
    return text || entity;
  });
}

function destinationScheme(source) {
  const decoded = decodeHtmlEntities(source)
    .trim()
    .replaceAll('\t', '')
    .replaceAll('\n', '')
    .replaceAll('\r', '');
  return decoded.match(/^([A-Za-z][A-Za-z0-9+.-]*):/u)?.[1]?.toLowerCase() || null;
}

function applyVisibilityRegions(source, regions, sourcePath) {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (hadTrailingNewline) lines.pop();
  const omitted = new Set();

  for (const region of regions) {
    if (
      !Number.isInteger(region.startLine) ||
      !Number.isInteger(region.endLine) ||
      region.startLine < 1 ||
      region.endLine < region.startLine ||
      region.endLine > lines.length
    ) {
      throw new ZennAdapterError(
        `Invalid visibility line range in ${sourcePath}: ${region.startLine}-${region.endLine}`
      );
    }

    if (region.decision === 'exclude-block') {
      for (let line = region.startLine; line <= region.endLine; line += 1) omitted.add(line);
    } else if (region.decision === 'include') {
      omitted.add(region.startLine);
      omitted.add(region.endLine);
    } else {
      throw new ZennAdapterError(
        `Unsupported visibility decision in included document ${sourcePath}: ${region.decision}`
      );
    }
  }

  return lines
    .filter((_line, index) => !omitted.has(index + 1))
    .join('\n') + (hadTrailingNewline ? '\n' : '');
}

function convertStandardCallouts(source, sourcePath) {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (hadTrailingNewline) lines.pop();
  const output = [];
  let fence = null;
  let callout = null;

  for (const line of lines) {
    if (fence) {
      output.push(line);
      if (isStandardFenceClose(line, fence)) fence = null;
      continue;
    }
    const openedFence = detectStandardFenceOpen(line);
    if (openedFence) {
      fence = openedFence;
      output.push(line);
      continue;
    }

    const delimiter = parseStandardCalloutDelimiter(line);
    if (delimiter?.kind === 'open') {
      if (callout) throw new ZennAdapterError(`Nested callout is not supported in ${sourcePath}`);
      if (delimiter.type === 'note' || delimiter.type === 'tip') {
        output.push(':::message');
      } else if (delimiter.type === 'warning') {
        output.push(':::message alert');
      } else {
        throw new ZennAdapterError(
          `Visibility callout remained after projection in ${sourcePath}: ${delimiter.type}`
        );
      }
      callout = delimiter.type;
      continue;
    }
    if (delimiter?.kind === 'close') {
      if (!callout) throw new ZennAdapterError(`Orphan callout close delimiter in ${sourcePath}`);
      callout = null;
      output.push(':::');
      continue;
    }
    if (delimiter) {
      throw new ZennAdapterError(`Invalid callout delimiter in ${sourcePath}: ${line}`);
    }
    output.push(line);
  }

  if (fence) throw new ZennAdapterError(`Unclosed code fence in ${sourcePath}`);
  if (callout) throw new ZennAdapterError(`Unclosed callout in ${sourcePath}`);
  return output.join('\n') + (hadTrailingNewline ? '\n' : '');
}

function stripQueryAndFragment(destination) {
  const boundary = String(destination).search(/[?#]/u);
  return boundary === -1 ? String(destination) : String(destination).slice(0, boundary);
}

function decodeRelativeDestination(destination, sourcePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(stripQueryAndFragment(destination));
  } catch {
    throw new ZennAdapterError(`Invalid percent-encoded image in ${sourcePath}`);
  }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0')) {
    throw new ZennAdapterError(`Invalid relative image in ${sourcePath}`);
  }
  return decoded;
}

async function requireZennImage(bookRoot, assetRoot, sourcePath, destination) {
  if (destination.startsWith('/') || destination.startsWith('#')) {
    throw new ZennAdapterError(`Zenn source image must be relative in ${sourcePath}`);
  }
  if (destinationScheme(destination)) {
    throw new ZennAdapterError(`External images are not supported by the Zenn adapter: ${sourcePath}`);
  }

  const decoded = decodeRelativeDestination(destination, sourcePath);
  const relative = path.normalize(path.join(path.dirname(sourcePath), decoded));
  const resolved = path.resolve(bookRoot, relative);
  const relativeToBook = path.relative(bookRoot, resolved);
  if (
    !relativeToBook ||
    relativeToBook === '..' ||
    relativeToBook.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToBook)
  ) {
    throw new ZennAdapterError(`Image resolves outside the book root: ${sourcePath}`);
  }

  let current = bookRoot;
  for (const component of relativeToBook.split(path.sep)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch {
      throw new ZennAdapterError(`Image does not exist: ${relativeToBook}`);
    }
    if (stat.isSymbolicLink()) {
      throw new ZennAdapterError(`Image path must not contain symbolic links: ${relativeToBook}`);
    }
  }

  const stat = await fs.lstat(resolved);
  if (!stat.isFile()) throw new ZennAdapterError(`Image must be a regular file: ${relativeToBook}`);
  if (stat.size > ZENN_IMAGE_MAX_BYTES) {
    throw new ZennAdapterError(`Zenn image exceeds 3MB: ${relativeToBook}`);
  }

  const relativeToAssets = path.relative(assetRoot, resolved);
  if (
    !relativeToAssets ||
    relativeToAssets === '..' ||
    relativeToAssets.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToAssets)
  ) {
    throw new ZennAdapterError(`Image must be below the declared assets directory: ${relativeToBook}`);
  }
  const extension = path.extname(relativeToAssets).toLowerCase();
  if (!ZENN_IMAGE_EXTENSIONS.has(extension)) {
    throw new ZennAdapterError(
      `Unsupported Zenn image extension ${extension || '(none)'}: ${relativeToBook}`
    );
  }
  return { source: resolved, relativeToAssets };
}

function isBackslashEscaped(source, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function encodeZennPathComponent(component) {
  return encodeURIComponent(component).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function transformOutsideInlineCode(line, state, transform) {
  let output = '';
  let cursor = 0;
  while (cursor < line.length) {
    if (state.inlineTicks) {
      let close = line.indexOf('`', cursor);
      while (close !== -1) {
        let length = 1;
        while (line[close + length] === '`') length += 1;
        if (length === state.inlineTicks) break;
        close = line.indexOf('`', close + length);
      }
      if (close === -1) return output + line.slice(cursor);
      output += line.slice(cursor, close + state.inlineTicks);
      cursor = close + state.inlineTicks;
      state.inlineTicks = 0;
      continue;
    }

    let opening = line.indexOf('`', cursor);
    while (opening !== -1 && isBackslashEscaped(line, opening)) {
      opening = line.indexOf('`', opening + 1);
    }
    if (opening === -1) return output + await transform(line.slice(cursor));
    output += await transform(line.slice(cursor, opening));
    let length = 1;
    while (line[opening + length] === '`') length += 1;
    output += '`'.repeat(length);
    cursor = opening + length;
    state.inlineTicks = length;
  }
  return output;
}

function addWarning(warnings, code, file, line) {
  warnings.push({ code, file, line });
}

async function convertImagesAndAudit(source, {
  bookRoot,
  metadata,
  sourcePath,
  zennSlug,
  warnings,
  copiedAssets
}) {
  const assetRoot = path.resolve(bookRoot, metadata.source.assets);
  const convertedImageDestinations = new Set();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const state = { fence: null, inlineTicks: 0 };
  const converted = [];

  async function rewriteImagesInSegment(segment) {
    let rebuilt = '';
    let cursor = 0;
    const imagePattern = /!\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/gu;
    for (const match of segment.matchAll(imagePattern)) {
      if (isBackslashEscaped(segment, match.index)) continue;
      rebuilt += segment.slice(cursor, match.index);
      const destination = match[2].trim();
      if (/\s/u.test(destination)) {
        throw new ZennAdapterError(`Image titles or whitespace paths are not supported in ${sourcePath}`);
      }
      const image = await requireZennImage(bookRoot, assetRoot, sourcePath, destination);
      const outputRelative = path.posix.join(
        'images',
        zennSlug,
        image.relativeToAssets.split(path.sep).join('/')
      );
      const outputUrl = [
        'images',
        zennSlug,
        ...image.relativeToAssets.split(path.sep)
      ].map(encodeZennPathComponent).join('/');
      copiedAssets.set(outputRelative, image.source);
      convertedImageDestinations.add(`/${outputUrl}`);
      rebuilt += `![${match[1]}](/${outputUrl})`;
      cursor = match.index + match[0].length;
    }
    return rebuilt + segment.slice(cursor);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (state.fence) {
      converted.push(line);
      if (isStandardFenceClose(line, state.fence)) state.fence = null;
      continue;
    }
    const openedFence = detectStandardFenceOpen(line);
    if (openedFence) {
      state.fence = openedFence;
      converted.push(line);
      continue;
    }

    converted.push(await transformOutsideInlineCode(line, state, rewriteImagesInSegment));
  }

  const result = converted.join('\n');
  const tokens = collectTokens(SOURCE_AUDIT_MARKDOWN.parse(result, {}));
  for (const { token, line } of tokens) {
    if (token.type === 'html_block' || token.type === 'html_inline') {
      throw new ZennAdapterError(
        `Reader-visible raw HTML is not supported by the Zenn adapter: ${sourcePath}:${line}`
      );
    }
    const destination = token.type === 'link_open'
      ? token.attrGet('href')
      : token.type === 'image'
        ? token.attrGet('src')
        : null;
    if (token.type === 'image' && !destination) {
      throw new ZennAdapterError(
        `Zenn source image must have a non-empty destination: ${sourcePath}:${line}`
      );
    }
    if (!destination) continue;
    const scheme = destinationScheme(destination);
    if (scheme && scheme !== 'https') {
      throw new ZennAdapterError(`Unsupported ${token.type === 'image' ? 'image' : 'link'} scheme in ${sourcePath}: ${scheme}:`);
    }
    if (token.type === 'image' && !convertedImageDestinations.has(destination)) {
      throw new ZennAdapterError(`Unsupported image syntax remained after Zenn conversion: ${sourcePath}`);
    }
    if (token.type === 'link_open' && destination.startsWith('//')) {
      throw new ZennAdapterError(`Protocol-relative links are not supported by the Zenn adapter: ${sourcePath}`);
    }
    if (token.type === 'link_open' && !scheme && !destination.startsWith('#')) {
      addWarning(warnings, 'relative_link_passthrough', sourcePath, line);
    }
  }
  return result;
}

function validateZennMetadata(metadata, edition, includedEntries) {
  const target = metadata.targets?.zenn;
  if (!target) throw new ZennAdapterError('book.yaml must define targets.zenn for a Zenn build.');
  if (!ZENN_BOOK_SLUG.test(target.slug)) {
    throw new ZennAdapterError('targets.zenn.slug must use 12-50 lowercase ASCII letters, digits, hyphens, or underscores.');
  }
  if (metadata.title.length > 70) {
    throw new ZennAdapterError('Zenn book title must be at most 70 UTF-16 code units.');
  }
  for (const topic of target.topics) {
    if (
      topic.length > 18 ||
      /[\u0020-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]/u.test(topic)
    ) {
      throw new ZennAdapterError(
        'targets.zenn.topics must match the current Zenn topic length and character contract.'
      );
    }
  }
  if (edition.visibility === 'internal') {
    throw new ZennAdapterError('The Zenn adapter does not emit internal editions.');
  }
  if (edition.visibility === 'paid' && !Number.isInteger(target.price)) {
    throw new ZennAdapterError('targets.zenn.price is required for a paid Zenn build.');
  }
  for (const entry of includedEntries) {
    if (!ZENN_CHAPTER_SLUG.test(entry.id)) {
      throw new ZennAdapterError(`Zenn chapter slug is invalid: ${entry.id}`);
    }
    if (entry.title.length > 70) {
      throw new ZennAdapterError(`Zenn chapter title must be at most 70 UTF-16 code units: ${entry.id}`);
    }
  }
  return target;
}

function createConfig(metadata, target, edition, chapterSlugs) {
  const paid = edition.visibility === 'paid';
  return YAML.stringify({
    title: metadata.title,
    summary: target.summary,
    topics: target.topics,
    published: false,
    price: paid ? target.price : 0,
    chapters: chapterSlugs
  }, { lineWidth: 0 });
}

function createChapter(entry, body, paidBook, containsPaidContent) {
  const frontMatter = { title: entry.title };
  if (paidBook) {
    frontMatter.free = !containsPaidContent && (
      entry.visibility === 'free' || entry.visibility === 'sample'
    );
  }
  return `---\n${YAML.stringify(frontMatter, { lineWidth: 0 })}---\n${body}`;
}

function sortAndDeduplicateWarnings(warnings) {
  const keys = new Set();
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  return warnings
    .sort((left, right) =>
      compare(left.file, right.file) ||
      left.line - right.line ||
      compare(left.code, right.code)
    )
    .filter((warning) => {
      const key = `${warning.file}\0${warning.line}\0${warning.code}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
}

async function assertOwnedExistingOutput(outputDirectory) {
  if (!(await fs.pathExists(outputDirectory))) return;
  const stat = await fs.lstat(outputDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ZennAdapterError(`Zenn output must be a real directory: ${outputDirectory}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8'));
  } catch {
    throw new ZennAdapterError(`Refusing to replace output without a valid adapter manifest: ${outputDirectory}`);
  }
  if (
    manifest.kind !== 'book-formatter.adapter-build' ||
    manifest.adapter?.target !== 'zenn'
  ) {
    throw new ZennAdapterError(`Refusing to replace output owned by another producer: ${outputDirectory}`);
  }
}

async function pathIdentity(candidate) {
  const stat = await fs.stat(candidate);
  return { dev: stat.dev, ino: stat.ino };
}

function samePathIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertProtectedRootsUnchanged(protectedRoots, expected) {
  for (const [index, protectedRoot] of protectedRoots.entries()) {
    let current;
    try {
      current = await pathIdentity(protectedRoot);
    } catch {
      throw new ZennAdapterError(`Protected book path became unavailable: ${protectedRoot}`);
    }
    if (!samePathIdentity(current, expected[index])) {
      throw new ZennAdapterError(`Protected book path changed during output replacement: ${protectedRoot}`);
    }
  }
}

async function replaceOwnedDirectory({
  stagingDirectory,
  outputDirectory,
  protectedRoots,
  revalidateReplacementDirectory
}) {
  const backupDirectory = `${outputDirectory}.backup-${process.pid}-${randomUUID()}`;
  const outputExists = await fs.pathExists(outputDirectory);
  const identities = await Promise.all(protectedRoots.map(pathIdentity));
  let outputMoved = false;
  let stagingInstalled = false;
  let committed = false;
  try {
    if (outputExists) {
      await fs.rename(outputDirectory, backupDirectory);
      outputMoved = true;
      await assertProtectedRootsUnchanged(protectedRoots, identities);
      await revalidateReplacementDirectory(backupDirectory);
    }
    await fs.rename(stagingDirectory, outputDirectory);
    stagingInstalled = true;
    await assertProtectedRootsUnchanged(protectedRoots, identities);
    if (outputMoved) await revalidateReplacementDirectory(backupDirectory);
    committed = true;
    if (outputMoved) {
      try {
        await fs.remove(backupDirectory);
      } catch (error) {
        throw new ZennAdapterError(
          'New Zenn output was installed, but backup cleanup failed; retained path: ' +
            `${backupDirectory}; ${error.message}`
        );
      }
    }
  } catch (error) {
    if (!committed) {
      if (stagingInstalled && await fs.pathExists(outputDirectory)) await fs.remove(outputDirectory);
      if (outputMoved && await fs.pathExists(backupDirectory)) {
        await fs.rename(backupDirectory, outputDirectory);
      }
    }
    throw error;
  } finally {
    await fs.remove(stagingDirectory);
  }
}

export async function writeZennProject({
  standardBook,
  edition,
  visibilityReport,
  outputDirectory,
  manifest,
  revalidateOutputDestination,
  revalidateReplacementDirectory,
  verifyArtifact,
  validateOnly = false
}) {
  if (
    typeof revalidateOutputDestination !== 'function' ||
    typeof revalidateReplacementDirectory !== 'function' ||
    typeof verifyArtifact !== 'function'
  ) {
    throw new ZennAdapterError('Zenn output requires fail-closed destination and artifact callbacks.');
  }

  const entries = flattenStructure(standardBook.metadata);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const includedReports = visibilityReport.documents.filter(
    (document) => document.decision === 'include'
  );
  const includedEntries = includedReports.map((document) => {
    const entry = entryById.get(document.id);
    if (!entry) throw new ZennAdapterError(`Missing structure entry: ${document.id}`);
    return entry;
  });
  const target = validateZennMetadata(standardBook.metadata, edition, includedEntries);
  const warnings = [];
  const copiedAssets = new Map();
  const convertedDocuments = [];

  for (const [index, entry] of includedEntries.entries()) {
    const source = await fs.readFile(path.join(standardBook.bookRoot, entry.path), 'utf8');
    rejectSourceFrontMatter(source, entry.path);
    const projected = applyVisibilityRegions(
      source,
      includedReports[index].protectedRegions,
      entry.path
    );
    const withoutCanonicalH1 = removeCanonicalH1(projected, entry.path);
    const callouts = convertStandardCallouts(withoutCanonicalH1, entry.path);
    const converted = await convertImagesAndAudit(callouts, {
      bookRoot: standardBook.bookRoot,
      metadata: standardBook.metadata,
      sourcePath: entry.path,
      zennSlug: target.slug,
      warnings,
      copiedAssets
    });
    convertedDocuments.push({
      entry,
      body: converted,
      containsPaidContent: includedReports[index].protectedRegions.some(
        (region) => region.visibility === 'paid' && region.decision === 'include'
      )
    });
  }

  const normalizedWarnings = sortAndDeduplicateWarnings(warnings);
  Object.assign(manifest.adapter, {
    implementation: ZENN_IMPLEMENTATION,
    project_format: 'zenn-book',
    contract_reviewed_at: ZENN_CONTRACT_REVIEWED_AT,
    config_path: `books/${target.slug}/config.yaml`,
    published: false,
    warnings: normalizedWarnings
  });

  await assertOwnedExistingOutput(outputDirectory);
  if (validateOnly) return;

  const parent = path.dirname(outputDirectory);
  await fs.ensureDir(parent);
  const stagingDirectory = path.join(parent, `.zenn-${process.pid}-${randomUUID()}.tmp`);
  const bookDirectory = path.join(stagingDirectory, 'books', target.slug);

  try {
    await fs.ensureDir(bookDirectory);
    for (const { entry, body, containsPaidContent } of convertedDocuments) {
      await fs.writeFile(
        path.join(bookDirectory, `${entry.id}.md`),
        createChapter(
          entry,
          body,
          edition.visibility === 'paid',
          containsPaidContent
        ),
        'utf8'
      );
    }
    for (const [destination, source] of copiedAssets) {
      const outputPath = path.join(stagingDirectory, ...destination.split('/'));
      await fs.ensureDir(path.dirname(outputPath));
      await fs.copyFile(source, outputPath);
    }
    await fs.writeFile(
      path.join(bookDirectory, 'config.yaml'),
      createConfig(standardBook.metadata, target, edition, includedEntries.map((entry) => entry.id)),
      'utf8'
    );
    await fs.writeFile(
      path.join(stagingDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );

    const artifactReport = await verifyArtifact(stagingDirectory);
    if (!artifactReport.summary.safe) {
      throw new ZennAdapterError(
        `Generated Zenn artifact failed visibility verification: ${artifactReport.summary.findings} finding(s)`
      );
    }

    await revalidateOutputDestination();
    await assertOwnedExistingOutput(outputDirectory);
    const protectedRoots = [
      standardBook.bookRoot,
      standardBook.metadataPath,
      ...Object.values(standardBook.metadata.source).map(
        (relativeSource) => path.resolve(standardBook.bookRoot, relativeSource)
      )
    ];
    await replaceOwnedDirectory({
      stagingDirectory,
      outputDirectory,
      protectedRoots,
      revalidateReplacementDirectory
    });
  } catch (error) {
    await fs.remove(stagingDirectory);
    throw error;
  }
}
