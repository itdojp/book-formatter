import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fileSystemConstants } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
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
const IDENTITY_BOUND_DIRECTORY_CLEANUP = `
import { lstat, readdir, rm } from 'node:fs/promises';
const [expectedDev, expectedIno] = process.argv.slice(1);
const current = await lstat('.');
if (String(current.dev) !== expectedDev || String(current.ino) !== expectedIno) {
  process.exit(73);
}
for (const entry of (await readdir('.')).sort()) {
  await rm(entry, { recursive: true, force: false, maxRetries: 0 });
}
if ((await readdir('.')).length !== 0) process.exit(74);
`;
const IDENTITY_BOUND_DIRECTORY_CREATE = `
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
await mkdir(name, { mode: 0o700 });
const handle = await open(
  name,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
);
let created;
try {
  created = await handle.stat();
  if (!created.isDirectory()) process.exit(74);
} finally {
  await handle.close();
}
process.stdout.write(JSON.stringify({ dev: String(created.dev), ino: String(created.ino) }));
`;
const IDENTITY_BOUND_EXCLUSIVE_WRITE = `
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const handle = await open(
  name,
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  0o600
);
let written;
try {
  await handle.writeFile(Buffer.concat(chunks));
  await handle.sync();
  written = await handle.stat();
  if (!written.isFile()) process.exit(74);
} finally {
  await handle.close();
}
process.stdout.write(JSON.stringify({
  dev: String(written.dev),
  ino: String(written.ino),
  size: String(written.size)
}));
`;
const IDENTITY_BOUND_DIRECTORY_INSPECT = `
import { lstat } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const child = await lstat(name);
if (!child.isDirectory() || child.isSymbolicLink()) process.exit(74);
process.stdout.write(JSON.stringify({ dev: String(child.dev), ino: String(child.ino) }));
`;
const IDENTITY_BOUND_FILE_READ = `
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name, maximumSize] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const pathStat = await lstat(name);
if (!pathStat.isFile() || pathStat.isSymbolicLink()) process.exit(74);
if (pathStat.size > Number(maximumSize)) process.exit(75);
const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
try {
  const opened = await handle.stat();
  if (
    !opened.isFile() ||
    opened.dev !== pathStat.dev ||
    opened.ino !== pathStat.ino ||
    opened.size !== pathStat.size
  ) process.exit(76);
  const contents = await handle.readFile();
  const completed = await handle.stat();
  const current = await lstat(name);
  if (
    completed.dev !== opened.dev ||
    completed.ino !== opened.ino ||
    completed.size !== opened.size ||
    completed.mtimeMs !== opened.mtimeMs ||
    completed.ctimeMs !== opened.ctimeMs ||
    current.isSymbolicLink() ||
    current.dev !== opened.dev ||
    current.ino !== opened.ino ||
    contents.length !== opened.size ||
    contents.length > Number(maximumSize)
  ) process.exit(76);
  process.stdout.write(contents);
} finally {
  await handle.close();
}
`;
const HTML_ENTITY = /&(?:#[xX][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]+);?/gu;
const SOURCE_AUDIT_MARKDOWN = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  maxNesting: 128
}).use(markdownItFootnote);
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

function collectTokens(tokens, inheritedLine = 1, { skipImageChildren = false } = {}) {
  const collected = [];
  let currentLine = inheritedLine;
  for (const token of tokens) {
    const line = token.map ? token.map[0] + 1 : currentLine;
    currentLine = line;
    collected.push({ token, line });
    if (token.children && !(skipImageChildren && token.type === 'image')) {
      collected.push(...collectTokens(token.children, line, { skipImageChildren }));
    }
    if (token.type === 'softbreak' || token.type === 'hardbreak') currentLine += 1;
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
    (token) => token.type === 'heading_open' && token.tag === 'h1' && token.level === 0
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
    !/^\s{0,3}#[\t ]+\S/u.test(lines[startLine] || '')
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

async function requireZennImage(
  bookRoot,
  assetRoot,
  assetRootIdentity,
  sourcePath,
  destination
) {
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

  const contents = await readFileFromHeldTree(
    assetRoot,
    assetRootIdentity,
    relativeToAssets
  );
  return { contents, relativeToAssets };
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

function addWarning(warnings, code, file, line) {
  warnings.push({ code, file, line });
}

function collectReaderVisibleScopes(blockTokens) {
  const codeLines = new Set();
  const readerVisibleScopes = new Map();
  for (const token of blockTokens) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) codeLines.add(line);
    }
    if ((token.type === 'inline' || token.type === 'tr_open') && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) {
        const existing = readerVisibleScopes.get(line);
        const candidate = { start: token.map[0], end: token.map[1] };
        if (!existing || candidate.end - candidate.start < existing.end - existing.start) {
          readerVisibleScopes.set(line, candidate);
        }
      }
    }
  }
  return { codeLines, readerVisibleScopes };
}

function sortedReaderVisibleScopes(readerVisibleScopes) {
  const unique = new Map();
  for (const scope of readerVisibleScopes.values()) {
    unique.set(`${scope.start}:${scope.end}`, scope);
  }
  const scopes = [...unique.values()].sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
  if (scopes.some((scope, index) => index > 0 && scope.start < scopes[index - 1].end)) {
    throw new ZennAdapterError('Reader-visible Markdown scopes overlap unexpectedly');
  }
  return scopes;
}

function parsedInlineCodeTokens(source) {
  return collectTokens(SOURCE_AUDIT_MARKDOWN.parseInline(source, {}))
    .map(({ token }) => token)
    .filter((token) => token.type === 'code_inline');
}

function inlineCodeTokenKey(token) {
  return JSON.stringify([token.markup, token.content]);
}

function indexBacktickRuns(segment) {
  const runs = [];
  let cursor = 0;
  while (cursor < segment.length) {
    const start = segment.indexOf('`', cursor);
    if (start === -1) break;
    let end = start + 1;
    while (segment[end] === '`') end += 1;
    runs.push({
      start,
      end,
      length: end - start,
      canOpen: !isBackslashEscaped(segment, start)
    });
    cursor = end;
  }

  const nextSameLength = Array(runs.length).fill(-1);
  const nearestByLength = new Map();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    nextSameLength[index] = nearestByLength.get(runs[index].length) ?? -1;
    nearestByLength.set(runs[index].length, index);
  }
  return { runs, nextSameLength };
}

function collectInlineCodeCandidates(segment, excludedSpans = []) {
  const candidates = [];
  const { runs, nextSameLength } = indexBacktickRuns(segment);
  const excludedRuns = new Set();
  let spanIndex = 0;
  const orderedSpans = [...excludedSpans].sort((left, right) => left.start - right.start);
  for (const [index, run] of runs.entries()) {
    while (spanIndex < orderedSpans.length && orderedSpans[spanIndex].end <= run.start) {
      spanIndex += 1;
    }
    const span = orderedSpans[spanIndex];
    if (span && run.start >= span.start && run.end <= span.end) excludedRuns.add(index);
  }
  let runIndex = 0;
  while (runIndex < runs.length) {
    const opening = runs[runIndex];
    if (!opening.canOpen || excludedRuns.has(runIndex)) {
      runIndex += 1;
      continue;
    }

    let closingIndex = nextSameLength[runIndex];
    let matched = false;
    while (closingIndex !== -1) {
      if (excludedRuns.has(closingIndex)) {
        closingIndex = nextSameLength[closingIndex];
        continue;
      }
      const closing = runs[closingIndex];
      const source = segment.slice(opening.start, closing.end);
      const inline = SOURCE_AUDIT_MARKDOWN.parseInline(source, {})[0];
      const children = inline?.children || [];
      if (children.length === 1 && children[0].type === 'code_inline') {
        candidates.push({
          start: opening.start,
          end: closing.end,
          source,
          key: inlineCodeTokenKey(children[0])
        });
        runIndex = closingIndex + 1;
        matched = true;
        break;
      }
      closingIndex = nextSameLength[closingIndex];
    }
    if (!matched) runIndex += 1;
  }
  return candidates;
}

function maskReaderVisibleScope(lines, scope, sourcePath) {
  const visibleScope = lines.slice(scope.start, scope.end).join('\n');
  const parsedKeys = parsedInlineCodeTokens(visibleScope).map(inlineCodeTokenKey);
  if (parsedKeys.length === 0) return visibleScope;
  const metadataSpans = standaloneInlineDestinationSpans(visibleScope);
  const spans = selectUniqueParsedCandidates(
    collectInlineCodeCandidates(visibleScope, metadataSpans),
    parsedKeys,
    sourcePath,
    'inline code'
  );
  const characters = visibleScope.split('');
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) {
      if (characters[index] !== '\n') characters[index] = ' ';
    }
  }
  return characters.join('');
}

async function addRelativeLinkWarnings(source, blockTokens, environment, sourcePath, warnings) {
  // markdown-it does not expose source offsets for inline children. Map parser
  // tokens back to a unique source candidate within each complete inline block.
  const { readerVisibleScopes } = collectReaderVisibleScopes(blockTokens);
  let detectedLinks = 0;
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  for (const scope of sortedReaderVisibleScopes(readerVisibleScopes)) {
    const visibleScope = maskReaderVisibleScope(lines, scope, sourcePath);
    for (const linkSyntax of selectParsedInlineLinks(visibleScope, environment, sourcePath)) {
      const preceding = visibleScope.slice(0, linkSyntax.start);
      const physicalLine = scope.start + 1 + (preceding.match(/\n/gu)?.length || 0);
      detectedLinks += 1;
      addWarning(warnings, 'relative_link_passthrough', sourcePath, physicalLine);
    }
  }
  return detectedLinks;
}

function indexBracketClosures(segment) {
  const openings = [];
  const closingByOpening = new Map();
  let cursor = 0;
  while (cursor < segment.length) {
    if (segment[cursor] === '\\') {
      cursor += Math.min(2, segment.length - cursor);
      continue;
    }
    if (segment[cursor] === '[') {
      openings.push(cursor);
    } else if (segment[cursor] === ']' && openings.length > 0) {
      closingByOpening.set(openings.pop(), cursor);
    }
    cursor += 1;
  }
  return closingByOpening;
}

function collectInlineDestinations(segment, kind) {
  const destinations = [];
  const isImage = kind === 'image';
  const closingByOpening = indexBracketClosures(segment);
  let index = 0;

  while (index < segment.length - 1) {
    const hasOpening = isImage
      ? segment[index] === '!' && segment[index + 1] === '['
      : segment[index] === '[' && !(
        index > 0 &&
        segment[index - 1] === '!' &&
        !isBackslashEscaped(segment, index - 1)
      );
    if (!hasOpening || isBackslashEscaped(segment, index)) {
      index += 1;
      continue;
    }

    const openingBracket = index + (isImage ? 1 : 0);
    const labelEnd = closingByOpening.get(openingBracket);
    if (labelEnd === undefined) {
      index += isImage ? 2 : 1;
      continue;
    }

    const labelStart = openingBracket + 1;
    let cursor = labelEnd + 1;
    if (!isImage && segment[cursor] !== '(') {
      let candidateEnd = cursor;
      if (segment[cursor] === '[') {
        candidateEnd += 1;
        while (candidateEnd < segment.length && segment[candidateEnd] !== ']') {
          if (segment[candidateEnd] === '\\') {
            candidateEnd += Math.min(2, segment.length - candidateEnd);
          } else {
            candidateEnd += 1;
          }
        }
        if (segment[candidateEnd] !== ']') {
          index += 1;
          continue;
        }
        candidateEnd += 1;
      }
      destinations.push({
        start: index,
        end: candidateEnd,
        labelStart,
        labelEnd,
        source: segment.slice(index, candidateEnd)
      });
      index = candidateEnd;
      continue;
    }
    if (segment[cursor] !== '(') {
      index += 2;
      continue;
    }

    const destinationStart = cursor + 1;
    let parenthesisDepth = 1;
    cursor = destinationStart;
    let angleDestination = false;
    let firstDestinationCharacter = destinationStart;
    while (/\s/u.test(segment[firstDestinationCharacter] || '')) {
      firstDestinationCharacter += 1;
    }
    if (segment[firstDestinationCharacter] === '<') angleDestination = true;
    while (cursor < segment.length && parenthesisDepth > 0) {
      if (segment[cursor] === '\\') {
        cursor += Math.min(2, segment.length - cursor);
        continue;
      }
      if (angleDestination) {
        if (segment[cursor] === '>') angleDestination = false;
      } else {
        if (segment[cursor] === '(') parenthesisDepth += 1;
        if (segment[cursor] === ')') parenthesisDepth -= 1;
      }
      cursor += 1;
    }
    if (parenthesisDepth !== 0 || angleDestination) {
      index += isImage ? 2 : 1;
      continue;
    }

    destinations.push({
      start: index,
      end: cursor,
      labelStart,
      labelEnd,
      destinationStart,
      destinationEnd: cursor - 1,
      source: segment.slice(index, cursor)
    });
    index = cursor;
  }

  return destinations;
}

function collectInlineImages(segment) {
  return collectInlineDestinations(segment, 'image');
}

function collectInlineLinks(segment) {
  const candidates = [];
  const pending = [{ source: segment, offset: 0, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const candidate of collectInlineDestinations(current.source, 'link')) {
      const offsetCandidate = {
        ...candidate,
        start: candidate.start + current.offset,
        end: candidate.end + current.offset,
        labelStart: candidate.labelStart + current.offset,
        labelEnd: candidate.labelEnd + current.offset,
        ...(candidate.destinationStart === undefined
          ? {}
          : {
            destinationStart: candidate.destinationStart + current.offset,
            destinationEnd: candidate.destinationEnd + current.offset
          })
      };
      candidates.push(offsetCandidate);
      if (current.depth < 128 && candidate.labelEnd > candidate.labelStart) {
        pending.push({
          source: current.source.slice(candidate.labelStart, candidate.labelEnd),
          offset: current.offset + candidate.labelStart,
          depth: current.depth + 1
        });
      }
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    unique.set(`${candidate.start}:${candidate.end}`, candidate);
  }
  return [...unique.values()].sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
}

function parsedInlineImages(source) {
  return collectTokens(SOURCE_AUDIT_MARKDOWN.parseInline(source, {}))
    .map(({ token }) => token)
    .filter((token) => token.type === 'image');
}

function imageTokenKey(token) {
  return JSON.stringify([
    token.content,
    token.attrGet('src'),
    token.attrGet('title') || ''
  ]);
}

function selectUniqueParsedCandidates(candidates, parsedKeys, sourcePath, kind) {
  const earliest = [];
  let candidateIndex = 0;
  for (const parsedKey of parsedKeys) {
    while (
      candidateIndex < candidates.length &&
      candidates[candidateIndex].key !== parsedKey
    ) candidateIndex += 1;
    if (candidateIndex === candidates.length) {
      throw new ZennAdapterError(`Parsed ${kind} syntax could not be mapped in ${sourcePath}`);
    }
    earliest.push(candidateIndex);
    candidateIndex += 1;
  }

  const latest = Array(parsedKeys.length);
  candidateIndex = candidates.length - 1;
  for (let parsedIndex = parsedKeys.length - 1; parsedIndex >= 0; parsedIndex -= 1) {
    while (candidateIndex >= 0 && candidates[candidateIndex].key !== parsedKeys[parsedIndex]) {
      candidateIndex -= 1;
    }
    if (candidateIndex < 0) {
      throw new ZennAdapterError(`Parsed ${kind} syntax could not be mapped in ${sourcePath}`);
    }
    latest[parsedIndex] = candidateIndex;
    candidateIndex -= 1;
  }

  if (earliest.some((index, parsedIndex) => index !== latest[parsedIndex])) {
    throw new ZennAdapterError(
      `Parsed ${kind} syntax could not be mapped unambiguously in ${sourcePath}`
    );
  }
  return earliest.map((index) => candidates[index]);
}

function selectParsedInlineLinkSyntaxes(
  segment,
  environment,
  sourcePath,
  tokenPredicate,
  kind
) {
  const parsedKeys = parsedInlineLinks(segment, environment)
    .filter(tokenPredicate)
    .map(linkTokenKey);
  if (parsedKeys.length === 0) return [];

  const candidates = excludeCandidatesWithinSpans(
    collectInlineLinks(segment),
    standaloneImageSyntaxSpans(segment)
  ).map((candidate) => {
    const token = parsedRootLink(candidate.source, environment);
    return {
      ...candidate,
      key: token ? linkTokenKey(token) : null
    };
  });
  return selectUniqueParsedCandidates(candidates, parsedKeys, sourcePath, kind);
}

function selectParsedInlineImages(segment, sourcePath) {
  const parsedKeys = parsedInlineImages(segment).map(imageTokenKey);
  if (parsedKeys.length === 0) return [];

  const linkMetadataSpans = selectParsedInlineLinkSyntaxes(
    segment,
    {},
    sourcePath,
    (token) => token.markup !== 'autolink',
    'link metadata'
  )
    .filter((candidate) => candidate.destinationStart !== undefined)
    .map((candidate) => ({
      start: candidate.destinationStart,
      end: candidate.destinationEnd
    }));
  const candidates = excludeCandidatesWithinSpans(
    collectInlineImages(segment),
    linkMetadataSpans
  )
    .map((candidate) => {
      const tokens = parsedInlineImages(candidate.source);
      return {
        ...candidate,
        key: tokens.length === 1 ? imageTokenKey(tokens[0]) : null,
        parsedDestination: tokens.length === 1 ? tokens[0].attrGet('src') : null
      };
    });
  return selectUniqueParsedCandidates(candidates, parsedKeys, sourcePath, 'image');
}

function excludeCandidatesWithinSpans(candidates, spans) {
  const orderedSpans = [...spans].sort((left, right) =>
    left.start - right.start || left.end - right.end
  );
  const mergedSpans = [];
  for (const span of orderedSpans) {
    const previous = mergedSpans.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      mergedSpans.push({ ...span });
    }
  }

  const remaining = [];
  let spanIndex = 0;
  for (const candidate of candidates) {
    while (
      spanIndex < mergedSpans.length &&
      mergedSpans[spanIndex].end <= candidate.start
    ) spanIndex += 1;
    const span = mergedSpans[spanIndex];
    if (span && candidate.start >= span.start && candidate.end <= span.end) continue;
    remaining.push(candidate);
  }
  return remaining;
}

function standaloneInlineDestinationSpans(segment) {
  const links = collectInlineLinks(segment).filter((candidate) =>
    Boolean(parsedRootLink(candidate.source, {}))
  );
  const images = collectInlineImages(segment).filter((candidate) => {
    const children = SOURCE_AUDIT_MARKDOWN.parseInline(candidate.source, {})[0]?.children || [];
    return children.length === 1 && children[0].type === 'image';
  });
  return [...links, ...images]
    .filter((candidate) => candidate.destinationStart !== undefined)
    .map((candidate) => ({
      start: candidate.destinationStart,
      end: candidate.destinationEnd
    }));
}

function standaloneImageSyntaxSpans(segment) {
  return collectInlineImages(segment)
    .filter((candidate) => {
      const children = SOURCE_AUDIT_MARKDOWN.parseInline(candidate.source, {})[0]?.children || [];
      return children.length === 1 && children[0].type === 'image';
    })
    .map((candidate) => ({
      start: candidate.start,
      end: candidate.end
    }));
}

function parsedInlineLinks(source, environment) {
  return collectTokens(
    SOURCE_AUDIT_MARKDOWN.parseInline(source, environment),
    1,
    { skipImageChildren: true }
  )
    .map(({ token }) => token)
    .filter((token) => token.type === 'link_open');
}

function linkTokenKey(token) {
  return JSON.stringify([token.attrGet('href'), token.attrGet('title') || '']);
}

function parsedRootLink(source, environment) {
  const inline = SOURCE_AUDIT_MARKDOWN.parseInline(source, environment)[0];
  const children = inline?.children || [];
  const linkTokens = children.filter((token) => token.type === 'link_open');
  if (
    linkTokens.length !== 1 ||
    children[0]?.type !== 'link_open' ||
    children.at(-1)?.type !== 'link_close'
  ) return null;
  return linkTokens[0];
}

function isRelativeLinkDestination(destination) {
  return Boolean(
    destination &&
    !destinationScheme(destination) &&
    !destination.startsWith('#') &&
    !destination.startsWith('//')
  );
}

function selectParsedInlineLinks(segment, environment, sourcePath) {
  return selectParsedInlineLinkSyntaxes(
    segment,
    environment,
    sourcePath,
    (token) => isRelativeLinkDestination(token.attrGet('href')),
    'relative link'
  );
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
  const assetRootStat = await fs.lstat(assetRoot);
  if (assetRootStat.isSymbolicLink() || !assetRootStat.isDirectory()) {
    throw new ZennAdapterError(`Zenn asset root must remain a real directory: ${assetRoot}`);
  }
  const assetRootIdentity = { dev: assetRootStat.dev, ino: assetRootStat.ino };
  const convertedImageDestinations = new Set();
  let convertedImageCount = 0;
  const resolvedImages = new Map();
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const sourceBlockTokens = SOURCE_AUDIT_MARKDOWN.parse(lines.join('\n'), {});
  const { readerVisibleScopes } = collectReaderVisibleScopes(sourceBlockTokens);
  const converted = [];

  async function rewriteImagesInSegment(segment, parsedSegment = segment) {
    let rebuilt = '';
    let cursor = 0;
    for (const imageSyntax of selectParsedInlineImages(parsedSegment, sourcePath)) {
      rebuilt += segment.slice(cursor, imageSyntax.start);
      const sourceDestination = segment
        .slice(imageSyntax.destinationStart, imageSyntax.destinationEnd)
        .trim();
      if (!sourceDestination || !imageSyntax.parsedDestination) {
        throw new ZennAdapterError(
          `Zenn source image must have a non-empty destination: ${sourcePath}`
        );
      }
      const angleDestination = /^<[^<>\r\n]*>$/u.test(sourceDestination);
      if (/\s/u.test(sourceDestination) && !angleDestination) {
        throw new ZennAdapterError(`Image titles or whitespace paths are not supported in ${sourcePath}`);
      }
      const destination = imageSyntax.parsedDestination;
      const imageKey = `${sourcePath}\0${destination}`;
      let image = resolvedImages.get(imageKey);
      if (!image) {
        image = await requireZennImage(
          bookRoot,
          assetRoot,
          assetRootIdentity,
          sourcePath,
          destination
        );
        resolvedImages.set(imageKey, image);
      }
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
      copiedAssets.set(outputRelative, image.contents);
      convertedImageDestinations.add(`/${outputUrl}`);
      convertedImageCount += 1;
      const alt = segment.slice(imageSyntax.labelStart, imageSyntax.labelEnd);
      rebuilt += `![${alt}](/${outputUrl})`;
      cursor = imageSyntax.end;
    }
    return rebuilt + segment.slice(cursor);
  }

  converted.push(...lines);
  for (const scope of sortedReaderVisibleScopes(readerVisibleScopes)) {
    const sourceLines = lines.slice(scope.start, scope.end);
    const maskedScope = maskReaderVisibleScope(lines, scope, sourcePath);
    const rewritten = await rewriteImagesInSegment(
      sourceLines.join('\n'),
      maskedScope
    );
    const rewrittenLines = rewritten.split('\n');
    if (rewrittenLines.length !== sourceLines.length) {
      throw new ZennAdapterError(`Image rewrite changed physical lines in ${sourcePath}`);
    }
    converted.splice(scope.start, sourceLines.length, ...rewrittenLines);
  }

  const result = converted.join('\n');
  const environment = {};
  const blockTokens = SOURCE_AUDIT_MARKDOWN.parse(result, environment);
  const tokens = collectTokens(blockTokens, 1, { skipImageChildren: true });
  let relativeLinks = 0;
  let auditedImages = 0;
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
    if (token.type === 'link_open' && destination === '') {
      throw new ZennAdapterError(
        `Zenn source link must have a non-empty destination: ${sourcePath}:${line}`
      );
    }
    if (destination === null) continue;
    const scheme = destinationScheme(destination);
    if (scheme && scheme !== 'https') {
      throw new ZennAdapterError(`Unsupported ${token.type === 'image' ? 'image' : 'link'} scheme in ${sourcePath}: ${scheme}:`);
    }
    if (token.type === 'image' && !convertedImageDestinations.has(destination)) {
      throw new ZennAdapterError(`Unsupported image syntax remained after Zenn conversion: ${sourcePath}`);
    }
    if (token.type === 'image') auditedImages += 1;
    if (token.type === 'link_open' && destination.startsWith('//')) {
      throw new ZennAdapterError(`Protocol-relative links are not supported by the Zenn adapter: ${sourcePath}`);
    }
    if (
      token.type === 'link_open' &&
      !scheme &&
      !destination.startsWith('#') &&
      !destination.startsWith('//')
    ) {
      relativeLinks += 1;
    }
  }
  if (auditedImages !== convertedImageCount) {
    throw new ZennAdapterError(`Unsupported image syntax remained after Zenn conversion: ${sourcePath}`);
  }
  const locatedRelativeLinks = await addRelativeLinkWarnings(
    result,
    blockTokens,
    environment,
    sourcePath,
    warnings
  );
  if (locatedRelativeLinks !== relativeLinks) {
    throw new ZennAdapterError(
      `Relative link syntax could not be mapped to a physical warning line: ${sourcePath}`
    );
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
  let stat;
  try {
    stat = await fs.lstat(outputDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ZennAdapterError(`Zenn output must be a real directory: ${outputDirectory}`);
  }
  const expectedIdentity = { dev: stat.dev, ino: stat.ino };
  let manifest;
  try {
    const manifestPath = path.join(outputDirectory, 'manifest.json');
    const manifestStat = await fs.lstat(manifestPath);
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('not a file');
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    throw new ZennAdapterError(`Refusing to replace output without a valid adapter manifest: ${outputDirectory}`);
  }
  if (
    manifest.kind !== 'book-formatter.adapter-build' ||
    manifest.adapter?.target !== 'zenn'
  ) {
    throw new ZennAdapterError(`Refusing to replace output owned by another producer: ${outputDirectory}`);
  }
  const currentIdentity = await pathObjectIdentity(outputDirectory);
  if (!samePathIdentity(currentIdentity, expectedIdentity)) {
    throw new ZennAdapterError(`Zenn output changed during ownership validation: ${outputDirectory}`);
  }
  return expectedIdentity;
}

async function pathIdentity(candidate) {
  const stat = await fs.stat(candidate);
  return { dev: stat.dev, ino: stat.ino };
}

async function pathObjectIdentity(candidate) {
  const stat = await fs.lstat(candidate);
  return { dev: stat.dev, ino: stat.ino };
}

async function pathObjectIdentityIfExists(candidate) {
  try {
    return await pathObjectIdentity(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function samePathIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function runIdentityBoundOperation({
  script,
  cwd,
  args,
  input,
  context,
  binaryOutput = false,
  codeMessages = {}
}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', script, ...args],
      {
        cwd,
        env: {},
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      }
    );
    const output = [];
    let settled = false;
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, output: Buffer.concat(output) });
    });
    child.stdin.end(input);
  });
  if (result.code !== 0) {
    throw new ZennAdapterError(
      codeMessages[result.code] || `${context} (${result.code ?? 'terminated'})`
    );
  }
  return binaryOutput ? result.output : result.output.toString('utf8');
}

async function createDirectoryInHeldParent(parent, parentIdentity, name) {
  const output = await runIdentityBoundOperation({
    script: IDENTITY_BOUND_DIRECTORY_CREATE,
    cwd: parent,
    args: [String(parentIdentity.dev), String(parentIdentity.ino), name],
    input: '',
    context: 'Zenn staging directory could not be created exclusively'
  });
  let identity;
  try {
    identity = JSON.parse(output);
  } catch {
    throw new ZennAdapterError('Zenn staging directory identity response was invalid');
  }
  if (!/^\d+$/u.test(identity?.dev || '') || !/^\d+$/u.test(identity?.ino || '')) {
    throw new ZennAdapterError('Zenn staging directory identity response was invalid');
  }
  return { dev: Number(identity.dev), ino: Number(identity.ino) };
}

async function inspectDirectoryInHeldParent(parent, parentIdentity, name, relativePath) {
  const output = await runIdentityBoundOperation({
    script: IDENTITY_BOUND_DIRECTORY_INSPECT,
    cwd: parent,
    args: [String(parentIdentity.dev), String(parentIdentity.ino), name],
    input: '',
    context: `Image path could not be traversed safely: ${relativePath}`,
    codeMessages: {
      74: `Image path must not contain symbolic links: ${relativePath}`
    }
  });
  let identity;
  try {
    identity = JSON.parse(output);
  } catch {
    throw new ZennAdapterError(`Image directory identity response was invalid: ${relativePath}`);
  }
  if (!/^\d+$/u.test(identity?.dev || '') || !/^\d+$/u.test(identity?.ino || '')) {
    throw new ZennAdapterError(`Image directory identity response was invalid: ${relativePath}`);
  }
  return { dev: Number(identity.dev), ino: Number(identity.ino) };
}

async function readFileInHeldDirectory(parent, parentIdentity, name, relativePath) {
  return runIdentityBoundOperation({
    script: IDENTITY_BOUND_FILE_READ,
    cwd: parent,
    args: [
      String(parentIdentity.dev),
      String(parentIdentity.ino),
      name,
      String(ZENN_IMAGE_MAX_BYTES)
    ],
    input: '',
    context: `Image could not be opened safely: ${relativePath}`,
    binaryOutput: true,
    codeMessages: {
      74: `Image path must not contain symbolic links: ${relativePath}`,
      75: `Zenn image exceeds 3MB: ${relativePath}`,
      76: `Image changed while being read: ${relativePath}`
    }
  });
}

async function readFileFromHeldTree(root, rootIdentity, relativePath) {
  const components = relativePath.split(path.sep);
  const name = components.pop();
  let current = { path: root, identity: rootIdentity };
  for (const component of components) {
    const identity = await inspectDirectoryInHeldParent(
      current.path,
      current.identity,
      component,
      relativePath
    );
    current = { path: path.join(current.path, component), identity };
  }
  return readFileInHeldDirectory(current.path, current.identity, name, relativePath);
}

async function writeFileInHeldDirectory(directory, directoryIdentity, name, contents) {
  const output = await runIdentityBoundOperation({
    script: IDENTITY_BOUND_EXCLUSIVE_WRITE,
    cwd: directory,
    args: [String(directoryIdentity.dev), String(directoryIdentity.ino), name],
    input: Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8'),
    context: 'Zenn staging file could not be created exclusively'
  });
  let identity;
  try {
    identity = JSON.parse(output);
  } catch {
    throw new ZennAdapterError('Zenn staging file identity response was invalid');
  }
  if (
    !/^\d+$/u.test(identity?.dev || '') ||
    !/^\d+$/u.test(identity?.ino || '') ||
    !/^\d+$/u.test(identity?.size || '')
  ) {
    throw new ZennAdapterError('Zenn staging file identity response was invalid');
  }
  return {
    dev: Number(identity.dev),
    ino: Number(identity.ino),
    size: Number(identity.size)
  };
}

function stagingPathComponents(relativePath) {
  const components = String(relativePath).split('/');
  if (
    components.length === 0 ||
    components.some((component) =>
      !component || component === '.' || component === '..' || /[\\/]/u.test(component)
    )
  ) {
    throw new ZennAdapterError(`Invalid Zenn staging path: ${relativePath}`);
  }
  return components;
}

function createStagingTree(stagingDirectory, expectedStagingIdentity) {
  const directories = new Map([
    ['', { path: stagingDirectory, identity: expectedStagingIdentity }]
  ]);
  const files = new Map();

  async function requireDirectory(relativePath) {
    const components = relativePath ? stagingPathComponents(relativePath) : [];
    let currentKey = '';
    let current = directories.get(currentKey);
    for (const component of components) {
      const nextKey = currentKey ? `${currentKey}/${component}` : component;
      let next = directories.get(nextKey);
      if (!next) {
        const identity = await createDirectoryInHeldParent(
          current.path,
          current.identity,
          component
        );
        next = { path: path.join(current.path, component), identity };
        directories.set(nextKey, next);
      }
      currentKey = nextKey;
      current = next;
    }
    return current;
  }

  async function write(relativePath, contents) {
    const components = stagingPathComponents(relativePath);
    const name = components.pop();
    const parent = await requireDirectory(components.join('/'));
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    const identity = await writeFileInHeldDirectory(parent.path, parent.identity, name, bytes);
    files.set(relativePath, {
      identity,
      digest: sha256(bytes)
    });
  }

  async function assertTreeUnchanged(rootDirectory = stagingDirectory) {
    const expectedEntries = new Map([...directories.keys()].map((key) => [key, new Set()]));
    for (const key of directories.keys()) {
      if (!key) continue;
      const parent = path.posix.dirname(key) === '.' ? '' : path.posix.dirname(key);
      expectedEntries.get(parent).add(path.posix.basename(key));
    }
    for (const relativePath of files.keys()) {
      const parent = path.posix.dirname(relativePath) === '.'
        ? ''
        : path.posix.dirname(relativePath);
      expectedEntries.get(parent).add(path.posix.basename(relativePath));
    }

    for (const [relativePath, directory] of directories) {
      const candidate = relativePath
        ? path.join(rootDirectory, ...relativePath.split('/'))
        : rootDirectory;
      await assertPathObjectIdentity(
        candidate,
        directory.identity,
        'Zenn staging directory changed after exclusive creation'
      );
      const actual = (await fs.readdir(candidate)).sort();
      const expected = [...expectedEntries.get(relativePath)].sort();
      if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
        throw new ZennAdapterError(`Zenn staging directory entries changed: ${candidate}`);
      }
    }

    for (const [relativePath, file] of files) {
      await assertFileContentsUnchanged(
        path.join(rootDirectory, ...relativePath.split('/')),
        file,
        'Zenn staging file changed after exclusive creation'
      );
    }
  }

  return { write, assertTreeUnchanged };
}

async function assertFileContentsUnchanged(candidate, expected, context) {
  let pathStat;
  try {
    pathStat = await fs.lstat(candidate);
    if (
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      !samePathIdentity(pathStat, expected.identity) ||
      pathStat.size !== expected.identity.size
    ) {
      throw new ZennAdapterError(`${context}: ${candidate}`);
    }
    const handle = await openFile(
      candidate,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        !samePathIdentity(opened, expected.identity) ||
        opened.size !== expected.identity.size
      ) {
        throw new ZennAdapterError(`${context}: ${candidate}`);
      }
      const contents = await handle.readFile();
      const completed = await handle.stat();
      const currentPath = await fs.lstat(candidate);
      if (
        !samePathIdentity(completed, expected.identity) ||
        completed.size !== expected.identity.size ||
        currentPath.isSymbolicLink() ||
        !currentPath.isFile() ||
        !samePathIdentity(currentPath, expected.identity) ||
        sha256(contents) !== expected.digest
      ) {
        throw new ZennAdapterError(`${context}: ${candidate}`);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ZennAdapterError) throw error;
    throw new ZennAdapterError(`${context}: ${candidate}`);
  }
}

async function assertPathObjectIdentity(candidate, expected, context) {
  const current = await pathObjectIdentityIfExists(candidate);
  if (!current || !samePathIdentity(current, expected)) {
    throw new ZennAdapterError(`${context}: ${candidate}`);
  }
}

async function emptyDirectoryByHeldIdentity(candidate, expected) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        IDENTITY_BOUND_DIRECTORY_CLEANUP,
        String(expected.dev),
        String(expected.ino)
      ],
      {
        cwd: candidate,
        env: {},
        stdio: 'ignore',
        windowsHide: true
      }
    );
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  if (exitCode !== 0) {
    throw new ZennAdapterError(
      `Zenn backup cleanup could not bind the validated directory identity (${exitCode})`
    );
  }
  // The recursive work was anchored to the child's held cwd. This final
  // pathname operation is intentionally non-recursive, so a replacement with
  // content is retained rather than deleted.
  await fs.rmdir(candidate);
}

async function removeDirectoryByExpectedIdentity(candidate, expected, context) {
  const current = await pathObjectIdentityIfExists(candidate);
  if (!current) return false;
  if (!samePathIdentity(current, expected)) {
    throw new ZennAdapterError(`${context}: ${candidate}`);
  }
  await emptyDirectoryByHeldIdentity(candidate, expected);
  return true;
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
  expectedStagingIdentity,
  expectedOutputIdentity,
  protectedRoots,
  revalidateReplacementDirectory,
  revalidateStagingTree,
  revalidateMetadataSnapshot
}) {
  const backupDirectory = `${outputDirectory}.backup-${process.pid}-${randomUUID()}`;
  const currentOutputIdentity = await pathObjectIdentityIfExists(outputDirectory);
  if (expectedOutputIdentity) {
    if (
      !currentOutputIdentity ||
      !samePathIdentity(currentOutputIdentity, expectedOutputIdentity)
    ) {
      throw new ZennAdapterError(
        `Zenn output changed after ownership validation: ${outputDirectory}`
      );
    }
  } else if (currentOutputIdentity) {
    throw new ZennAdapterError(
      `Zenn output appeared after ownership validation: ${outputDirectory}`
    );
  }
  const outputExists = Boolean(expectedOutputIdentity);
  const identities = await Promise.all(protectedRoots.map(pathIdentity));
  let outputMoved = false;
  let stagingInstalled = false;
  let committed = false;
  try {
    await revalidateMetadataSnapshot();
    if (outputExists) {
      await fs.rename(outputDirectory, backupDirectory);
      outputMoved = true;
      await assertPathObjectIdentity(
        backupDirectory,
        expectedOutputIdentity,
        'Zenn output identity changed across backup rename'
      );
      await assertProtectedRootsUnchanged(protectedRoots, identities);
      await revalidateMetadataSnapshot();
      await revalidateReplacementDirectory(backupDirectory);
    }
    await assertPathObjectIdentity(
      stagingDirectory,
      expectedStagingIdentity,
      'Zenn staging identity changed before install'
    );
    await revalidateStagingTree(stagingDirectory);
    await fs.rename(stagingDirectory, outputDirectory);
    stagingInstalled = true;
    await assertPathObjectIdentity(
      outputDirectory,
      expectedStagingIdentity,
      'Zenn staging identity changed across install rename'
    );
    await revalidateStagingTree(outputDirectory);
    await assertProtectedRootsUnchanged(protectedRoots, identities);
    await revalidateMetadataSnapshot();
    if (outputMoved) await revalidateReplacementDirectory(backupDirectory);
    committed = true;
    if (outputMoved) {
      try {
        await emptyDirectoryByHeldIdentity(backupDirectory, expectedOutputIdentity);
      } catch (error) {
        throw new ZennAdapterError(
          'New Zenn output was installed, but backup cleanup failed; retained path: ' +
            `${backupDirectory}; ${error.message}`
        );
      }
    }
  } catch (error) {
    if (!committed) {
      let rollbackError = null;
      if (stagingInstalled) {
        try {
          await removeDirectoryByExpectedIdentity(
            outputDirectory,
            expectedStagingIdentity,
            'Installed Zenn output changed before rollback'
          );
        } catch (cleanupError) {
          rollbackError = cleanupError;
        }
      }
      const currentOutput = await pathObjectIdentityIfExists(outputDirectory);
      if (outputMoved && !rollbackError && !currentOutput) {
        try {
          await assertPathObjectIdentity(
            backupDirectory,
            expectedOutputIdentity,
            'Zenn backup identity changed before rollback restore'
          );
          await fs.rename(backupDirectory, outputDirectory);
          await assertPathObjectIdentity(
            outputDirectory,
            expectedOutputIdentity,
            'Zenn backup identity changed across rollback restore'
          );
        } catch (restoreError) {
          rollbackError = restoreError;
        }
      }
      if (rollbackError) {
        throw new ZennAdapterError(
          'Zenn replacement failed and rollback retained paths for manual recovery: ' +
            `output=${outputDirectory}; backup=${backupDirectory}; ` +
            `${rollbackError.message}; original error: ${error.message}`
        );
      }
    }
    throw error;
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function readVisibilityBoundSource(bookRoot, sourcePath, expectedDigest) {
  if (!/^[0-9a-f]{64}$/u.test(expectedDigest || '')) {
    throw new ZennAdapterError(`Zenn source is missing its visibility digest: ${sourcePath}`);
  }
  const absolutePath = path.join(bookRoot, sourcePath);
  let pathStat;
  try {
    pathStat = await fs.lstat(absolutePath);
  } catch {
    throw new ZennAdapterError(`Zenn source became unavailable: ${sourcePath}`);
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new ZennAdapterError(`Zenn source must remain a regular non-symlink file: ${sourcePath}`);
  }

  let handle;
  try {
    handle = await openFile(
      absolutePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW
    );
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino ||
      openedStat.size !== pathStat.size
    ) {
      throw new ZennAdapterError(`Zenn source changed during safe open: ${sourcePath}`);
    }
    const contents = await handle.readFile();
    const completedStat = await handle.stat();
    if (
      completedStat.dev !== openedStat.dev ||
      completedStat.ino !== openedStat.ino ||
      completedStat.size !== openedStat.size ||
      completedStat.mtimeMs !== openedStat.mtimeMs ||
      completedStat.ctimeMs !== openedStat.ctimeMs ||
      contents.length !== openedStat.size
    ) {
      throw new ZennAdapterError(`Zenn source changed while being read: ${sourcePath}`);
    }
    const currentPathStat = await fs.lstat(absolutePath);
    if (
      currentPathStat.isSymbolicLink() ||
      currentPathStat.dev !== openedStat.dev ||
      currentPathStat.ino !== openedStat.ino
    ) {
      throw new ZennAdapterError(`Zenn source path changed during safe read: ${sourcePath}`);
    }
    if (sha256(contents) !== expectedDigest) {
      throw new ZennAdapterError(
        `Zenn source changed after visibility validation: ${sourcePath}`
      );
    }
    return contents.toString('utf8');
  } catch (error) {
    if (error instanceof ZennAdapterError) throw error;
    throw new ZennAdapterError(`Zenn source could not be opened safely: ${sourcePath}`);
  } finally {
    if (handle) await handle.close();
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

  const revalidateMetadataSnapshot = async () => {
    await readVisibilityBoundSource(
      standardBook.bookRoot,
      path.relative(standardBook.bookRoot, standardBook.metadataPath),
      standardBook.metadataDigest
    );
  };
  await revalidateMetadataSnapshot();

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
    const source = await readVisibilityBoundSource(
      standardBook.bookRoot,
      entry.path,
      includedReports[index].sourceDigest
    );
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
  const parentIdentity = await pathObjectIdentity(parent);
  const stagingName = `.zenn-${process.pid}-${randomUUID()}.tmp`;
  const stagingDirectory = path.join(parent, stagingName);
  let expectedStagingIdentity;

  try {
    expectedStagingIdentity = await createDirectoryInHeldParent(
      parent,
      parentIdentity,
      stagingName
    );
    await assertPathObjectIdentity(
      stagingDirectory,
      expectedStagingIdentity,
      'Zenn staging directory changed after exclusive creation'
    );
    const staging = createStagingTree(stagingDirectory, expectedStagingIdentity);
    for (const { entry, body, containsPaidContent } of convertedDocuments) {
      await staging.write(
        `books/${target.slug}/${entry.id}.md`,
        createChapter(
          entry,
          body,
          edition.visibility === 'paid',
          containsPaidContent
        )
      );
    }
    for (const [destination, contents] of copiedAssets) {
      await staging.write(destination, contents);
    }
    await staging.write(
      `books/${target.slug}/config.yaml`,
      createConfig(standardBook.metadata, target, edition, includedEntries.map((entry) => entry.id))
    );
    await staging.write(
      'manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await staging.assertTreeUnchanged();

    const artifactReport = await verifyArtifact(stagingDirectory);
    if (!artifactReport.summary.safe) {
      throw new ZennAdapterError(
        `Generated Zenn artifact failed visibility verification: ${artifactReport.summary.findings} finding(s)`
      );
    }
    await staging.assertTreeUnchanged();

    await revalidateOutputDestination();
    const expectedOutputIdentity = await assertOwnedExistingOutput(outputDirectory);
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
      expectedStagingIdentity,
      expectedOutputIdentity,
      protectedRoots,
      revalidateReplacementDirectory,
      revalidateStagingTree: staging.assertTreeUnchanged,
      revalidateMetadataSnapshot
    });
  } catch (error) {
    if (expectedStagingIdentity) {
      try {
        await removeDirectoryByExpectedIdentity(
          stagingDirectory,
          expectedStagingIdentity,
          'Zenn staging identity changed before cleanup'
        );
      } catch (cleanupError) {
        throw new ZennAdapterError(
          `${error.message}; staging cleanup retained path: ${stagingDirectory}; ` +
            cleanupError.message
        );
      }
    }
    throw error;
  }
}
