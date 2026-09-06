import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import YAML from 'yaml';

import { createAdapterSafeIO } from './AdapterSafeIO.js';
import {
  detectStandardFenceOpen,
  isStandardFenceClose,
  parseStandardCalloutDelimiter
} from './StandardCalloutParser.js';

export const NOTE_IMPLEMENTATION = 'note-v1';
export const NOTE_CONTRACT_REVIEWED_AT = '2026-09-06';

const NOTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NOTE_HASHTAG = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9Ａ-Ｚａ-ｚ０-９_〇○ー]+$/u;
const NOTE_IMAGE_EXTENSIONS = new Set(['.gif', '.heic', '.jpeg', '.jpg', '.png']);
const NOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const NOTE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const SAFE_IO = createAdapterSafeIO({ adapterName: 'note', target: 'note' });

const SOURCE_MARKDOWN = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  maxNesting: 128
}).use(markdownItFootnote);

const HTML_FRAGMENT_MARKDOWN = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  maxNesting: 128
}).use(markdownItFootnote);

const defaultImageRenderer = HTML_FRAGMENT_MARKDOWN.renderer.rules.image || (
  (tokens, index, options, environment, renderer) =>
    renderer.renderToken(tokens, index, options)
);

HTML_FRAGMENT_MARKDOWN.renderer.rules.image = (
  tokens,
  index,
  options,
  environment,
  renderer
) => {
  const token = tokens[index];
  const source = token.attrGet('src') || '';
  const destination = environment.imageDestinations?.get(source);
  if (!destination) {
    const alt = renderer.renderInlineAsText(token.children || [], options, environment);
    return `<span class="note-image-manual">[画像を手動挿入: ${HTML_FRAGMENT_MARKDOWN.utils.escapeHtml(alt)}]</span>`;
  }
  token.attrSet('src', destination);
  return defaultImageRenderer(tokens, index, options, environment, renderer);
};

export class NoteAdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoteAdapterError';
  }
}

function flattenStructure(metadata) {
  return [
    ...metadata.structure.frontmatter.map((entry) => ({ ...entry, section: 'frontmatter' })),
    ...metadata.structure.chapters.map((entry) => ({ ...entry, section: 'chapters' })),
    ...metadata.structure.backmatter.map((entry) => ({ ...entry, section: 'backmatter' }))
  ];
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createUniqueLabel(existingLabels, prefix, index, normalize = (value) => value) {
  let suffix = index;
  let candidate;
  do {
    candidate = `${prefix}-${suffix}`;
    suffix += 1;
  } while (existingLabels.has(normalize(candidate)));
  existingLabels.add(normalize(candidate));
  return candidate;
}

function createDocumentLabelNamespace(source, documentId) {
  const environment = {};
  SOURCE_MARKDOWN.parse(String(source), environment);

  const referenceLabels = Object.keys(environment.references || {}).sort(compareCodeUnits);
  const existingReferences = new Set(referenceLabels);
  const references = new Map(referenceLabels.map((label, index) => [
    label,
    createUniqueLabel(
      existingReferences,
      `note-${documentId}-ref`,
      index + 1,
      SOURCE_MARKDOWN.utils.normalizeReference
    )
  ]));

  const footnoteLabels = Object.keys(environment.footnotes?.refs || {})
    .filter((label) => label.startsWith(':'))
    .map((label) => label.slice(1))
    .sort(compareCodeUnits);
  const existingFootnotes = new Set(footnoteLabels);
  const footnotes = new Map(footnoteLabels.map((label, index) => [
    label,
    createUniqueLabel(existingFootnotes, `note-${documentId}-fn`, index + 1)
  ]));

  return { references, footnotes };
}

function sourceLineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') offsets.push(index + 1);
  }
  offsets.push(source.length);
  return offsets;
}

function isBackslashEscaped(source, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function mergeProtectedRanges(ranges) {
  const merged = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function collectProtectedMarkdownRanges(source) {
  const blockRanges = [];
  const lineOffsets = sourceLineOffsets(source);
  for (const token of SOURCE_MARKDOWN.parse(source, {})) {
    if (
      ['code_block', 'fence', 'html_block'].includes(token.type) &&
      token.map
    ) {
      blockRanges.push({
        start: lineOffsets[token.map[0]],
        end: lineOffsets[token.map[1]] ?? source.length
      });
    }
  }

  const ranges = mergeProtectedRanges(blockRanges);
  const inlineRanges = [];
  let cursor = 0;
  let rangeIndex = 0;
  while (cursor < source.length) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= cursor) {
      rangeIndex += 1;
    }
    const protectedRange = ranges[rangeIndex];
    if (protectedRange && cursor >= protectedRange.start && cursor < protectedRange.end) {
      cursor = protectedRange.end;
      continue;
    }
    if (source[cursor] === '<' && !isBackslashEscaped(source, cursor)) {
      const closing = source.indexOf('>', cursor + 1);
      const newline = source.indexOf('\n', cursor + 1);
      if (closing !== -1 && (newline === -1 || closing < newline)) {
        inlineRanges.push({ start: cursor, end: closing + 1 });
        cursor = closing + 1;
        continue;
      }
    }
    if (source[cursor] !== '`' || isBackslashEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }
    let openingEnd = cursor + 1;
    while (source[openingEnd] === '`') openingEnd += 1;
    const markerLength = openingEnd - cursor;
    let closing = source.indexOf('`', openingEnd);
    while (closing !== -1) {
      let closingEnd = closing + 1;
      while (source[closingEnd] === '`') closingEnd += 1;
      if (
        closingEnd - closing === markerLength &&
        !isBackslashEscaped(source, closing)
      ) break;
      closing = source.indexOf('`', closingEnd);
    }
    if (closing === -1) {
      cursor = openingEnd;
      continue;
    }
    inlineRanges.push({ start: cursor, end: closing + markerLength });
    cursor = closing + markerLength;
  }
  return mergeProtectedRanges([...ranges, ...inlineRanges]);
}

function findClosingBracket(source, opening) {
  let depth = 0;
  for (let cursor = opening; cursor < source.length; cursor += 1) {
    if (isBackslashEscaped(source, cursor)) continue;
    if (source[cursor] === '[') depth += 1;
    if (source[cursor] !== ']') continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function findInlineDestinationEnd(source, opening) {
  let depth = 1;
  let angleDestination = false;
  let quote = null;
  for (let cursor = opening + 1; cursor < source.length; cursor += 1) {
    if (isBackslashEscaped(source, cursor)) continue;
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (angleDestination) {
      if (character === '>') angleDestination = false;
      continue;
    }
    if (character === '<') {
      angleDestination = true;
      continue;
    }
    if ((character === '"' || character === '\'') && /\s/u.test(source[cursor - 1] || '')) {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    depth -= 1;
    if (depth === 0) return cursor + 1;
  }
  return -1;
}

function addLabelReplacement(replacements, source, start, end, replacement) {
  if (source.slice(start, end) === replacement) return;
  replacements.push({ start, end, replacement });
}

function isReferenceDefinitionStart(source, opening, closing) {
  if (source[closing + 1] !== ':') return false;
  const lineStart = source.lastIndexOf('\n', opening - 1) + 1;
  return /^ {0,3}$/u.test(source.slice(lineStart, opening));
}

function namespaceReferenceLabels(projection, namespace) {
  if (!projection.text || (namespace.references.size === 0 && namespace.footnotes.size === 0)) {
    return projection;
  }
  const source = projection.text;
  const protectedRanges = collectProtectedMarkdownRanges(source);
  const replacements = [];
  let protectedIndex = 0;
  let cursor = 0;

  while (cursor < source.length) {
    while (
      protectedIndex < protectedRanges.length &&
      protectedRanges[protectedIndex].end <= cursor
    ) protectedIndex += 1;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && cursor >= protectedRange.start && cursor < protectedRange.end) {
      cursor = protectedRange.end;
      continue;
    }
    if (
      source[cursor] !== '[' ||
      isBackslashEscaped(source, cursor) ||
      (cursor > 0 && source[cursor - 1] === '^' && !isBackslashEscaped(source, cursor - 1))
    ) {
      cursor += 1;
      continue;
    }

    const firstEnd = findClosingBracket(source, cursor);
    if (firstEnd === -1) {
      cursor += 1;
      continue;
    }
    const firstLabel = source.slice(cursor + 1, firstEnd);
    if (firstLabel.startsWith('^')) {
      const footnote = namespace.footnotes.get(firstLabel.slice(1));
      if (footnote) {
        addLabelReplacement(replacements, source, cursor + 2, firstEnd, footnote);
      }
      cursor = firstEnd + 1;
      continue;
    }

    const following = source[firstEnd + 1];
    if (following === '(') {
      const destinationEnd = findInlineDestinationEnd(source, firstEnd + 1);
      if (destinationEnd !== -1) {
        cursor = destinationEnd;
        continue;
      }
    }
    if (following === '[') {
      const secondEnd = findClosingBracket(source, firstEnd + 1);
      if (secondEnd === -1) {
        cursor = firstEnd + 1;
        continue;
      }
      const secondLabel = source.slice(firstEnd + 2, secondEnd);
      const effectiveLabel = secondLabel || firstLabel;
      const replacement = namespace.references.get(
        SOURCE_MARKDOWN.utils.normalizeReference(effectiveLabel)
      );
      if (replacement) {
        addLabelReplacement(replacements, source, firstEnd + 2, secondEnd, replacement);
      }
      cursor = secondEnd + 1;
      continue;
    }

    const replacement = namespace.references.get(
      SOURCE_MARKDOWN.utils.normalizeReference(firstLabel)
    );
    if (replacement) {
      if (isReferenceDefinitionStart(source, cursor, firstEnd)) {
        addLabelReplacement(replacements, source, cursor + 1, firstEnd, replacement);
      } else {
        addLabelReplacement(replacements, source, firstEnd + 1, firstEnd + 1, `[${replacement}]`);
      }
    }
    cursor = firstEnd + 1;
  }

  let text = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end);
  }
  return { text, sourceLines: projection.sourceLines };
}

function escapedGeneratedTitle(title, context) {
  const prohibitedCodePoints = new Set([0x7f, 0x85, 0x2028, 0x2029]);
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    [...String(title)].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || prohibitedCodePoints.has(codePoint);
    })
  ) {
    throw new NoteAdapterError(`${context} must be a visible single-line string.`);
  }
  return title.replace(/[!-/:-@[-`{-~]/gu, '\\$&');
}

function normalizedLines(source) {
  const normalized = String(source).replace(/\r\n?/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function trimProjection(lines, sourceLines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return {
    text: lines.slice(start, end).join('\n'),
    sourceLines: sourceLines.slice(start, end)
  };
}

function visibleSourceLines(source, report, sourcePath) {
  if (report.decision !== 'include') return new Set();
  const { lines } = normalizedLines(source);
  const visible = new Set(lines.map((_line, index) => index + 1));

  for (const region of report.protectedRegions) {
    if (
      !Number.isInteger(region.startLine) ||
      !Number.isInteger(region.endLine) ||
      region.startLine < 1 ||
      region.endLine < region.startLine ||
      region.endLine > lines.length
    ) {
      throw new NoteAdapterError(
        `Invalid visibility line range in ${sourcePath}: ${region.startLine}-${region.endLine}`
      );
    }
    if (region.decision === 'exclude-block') {
      for (let line = region.startLine; line <= region.endLine; line += 1) {
        visible.delete(line);
      }
    } else if (region.decision === 'include') {
      visible.delete(region.startLine);
      visible.delete(region.endLine);
    } else {
      throw new NoteAdapterError(
        `Unsupported visibility decision in included document ${sourcePath}: ${region.decision}`
      );
    }
  }
  return visible;
}

function projectSourceLines(source, report, sourcePath, subtractReport = null) {
  const { lines } = normalizedLines(source);
  const included = visibleSourceLines(source, report, sourcePath);
  if (subtractReport) {
    for (const line of visibleSourceLines(source, subtractReport, sourcePath)) {
      included.delete(line);
    }
  }
  const projectedLines = [];
  const sourceLines = [];
  for (const [index, line] of lines.entries()) {
    if (!included.has(index + 1)) continue;
    projectedLines.push(line);
    sourceLines.push(index + 1);
  }
  return trimProjection(projectedLines, sourceLines);
}

function removeLeadingCanonicalH1(projection, sourcePath) {
  const normalized = String(projection.text).replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return { text: '', sourceLines: [] };
  const lines = normalized.split('\n');
  const topLevelH1 = SOURCE_MARKDOWN.parse(normalized, {}).filter(
    (token) => token.type === 'heading_open' && token.tag === 'h1' && token.level === 0
  );
  if (topLevelH1.length > 1) {
    throw new NoteAdapterError(
      `note fragment source must not contain multiple top-level h1 headings: ${sourcePath}`
    );
  }
  if (topLevelH1.length === 0) return { text: normalized, sourceLines: projection.sourceLines };
  const [startLine, endLine] = topLevelH1[0].map || [];
  if (
    startLine !== 0 ||
    endLine !== 1 ||
    !/^\s{0,3}#[\t ]+\S/u.test(lines[0] || '')
  ) {
    throw new NoteAdapterError(
      `note fragment h1 must be the first content block: ${sourcePath}`
    );
  }
  return trimProjection(lines.slice(1), projection.sourceLines.slice(1));
}

function addWarning(warnings, code, file, line) {
  warnings.push({ code, file, line });
}

function convertStandardCallouts(projection, sourcePath, warnings) {
  const { lines } = normalizedLines(projection.text);
  const output = [];
  const sourceLines = [];
  let fence = null;
  let callout = null;

  for (const [index, line] of lines.entries()) {
    const sourceLine = projection.sourceLines[index] ?? index + 1;
    if (fence) {
      output.push(callout ? `> ${line}`.trimEnd() : line);
      sourceLines.push(sourceLine);
      if (isStandardFenceClose(line, fence)) fence = null;
      continue;
    }
    const openedFence = detectStandardFenceOpen(line);
    if (openedFence) {
      fence = openedFence;
      output.push(callout ? `> ${line}` : line);
      sourceLines.push(sourceLine);
      continue;
    }

    const delimiter = parseStandardCalloutDelimiter(line);
    if (delimiter?.kind === 'open') {
      if (callout) {
        throw new NoteAdapterError(`Nested callout is not supported in ${sourcePath}`);
      }
      if (!['note', 'tip', 'warning'].includes(delimiter.type)) {
        throw new NoteAdapterError(
          `Visibility callout remained after note projection in ${sourcePath}: ${delimiter.type}`
        );
      }
      callout = delimiter.type;
      const label = delimiter.type === 'warning'
        ? 'WARNING'
        : delimiter.type.toUpperCase();
      output.push(`> **${label}**`);
      sourceLines.push(sourceLine);
      addWarning(warnings, 'callout_degraded_to_blockquote', sourcePath, sourceLine);
      continue;
    }
    if (delimiter?.kind === 'close') {
      if (!callout) {
        throw new NoteAdapterError(`Orphan callout close delimiter in ${sourcePath}`);
      }
      callout = null;
      output.push('');
      sourceLines.push(sourceLine);
      continue;
    }
    if (delimiter) {
      throw new NoteAdapterError(`Invalid callout delimiter in ${sourcePath}: ${line}`);
    }
    output.push(callout ? (line ? `> ${line}` : '>') : line);
    sourceLines.push(sourceLine);
  }

  if (fence) throw new NoteAdapterError(`Unclosed code fence in ${sourcePath}`);
  if (callout) throw new NoteAdapterError(`Unclosed callout in ${sourcePath}`);
  return trimProjection(output, sourceLines);
}

function collectTokens(tokens, inheritedLine = 1) {
  const output = [];
  let line = inheritedLine;
  for (const token of tokens) {
    const tokenLine = token.map ? token.map[0] + 1 : line;
    line = tokenLine;
    output.push({ token, line: tokenLine });
    if (token.children) output.push(...collectTokens(token.children, tokenLine));
    if (token.type === 'softbreak' || token.type === 'hardbreak') line += 1;
  }
  return output;
}

function destinationScheme(destination) {
  return String(destination).trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):/u)?.[1]?.toLowerCase() || null;
}

function stripQueryAndFragment(destination) {
  const boundary = String(destination).search(/[?#]/u);
  return boundary === -1 ? String(destination) : String(destination).slice(0, boundary);
}

function decodeRelativeDestination(destination, sourcePath, kind) {
  let decoded;
  try {
    decoded = decodeURIComponent(stripQueryAndFragment(destination));
  } catch {
    throw new NoteAdapterError(`Invalid percent-encoded ${kind} in ${sourcePath}`);
  }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0')) {
    throw new NoteAdapterError(`Invalid relative ${kind} in ${sourcePath}`);
  }
  return decoded;
}

function resolveAssetPath(bookRoot, assetRoot, sourcePath, destination, kind) {
  const decoded = decodeRelativeDestination(destination, sourcePath, kind);
  const relativeToBook = path.normalize(path.join(path.dirname(sourcePath), decoded));
  const resolved = path.resolve(bookRoot, relativeToBook);
  const relativeToAssets = path.relative(assetRoot, resolved);
  if (
    !relativeToAssets ||
    relativeToAssets === '..' ||
    relativeToAssets.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToAssets)
  ) {
    throw new NoteAdapterError(
      `${kind} must be below the declared assets directory: ${relativeToBook}`
    );
  }
  return relativeToAssets;
}

function inspectReaderVisibleMarkdown(projection, sourcePath, warnings) {
  const tokens = collectTokens(SOURCE_MARKDOWN.parse(projection.text, {}));
  for (const { token, line } of tokens) {
    const sourceLine = projection.sourceLines[line - 1] ?? line;
    if (token.type === 'html_block' || token.type === 'html_inline') {
      addWarning(warnings, 'raw_html_requires_manual_review', sourcePath, sourceLine);
    }
    if (token.type === 'link_open') {
      const destination = token.attrGet('href') || '';
      if (
        destination &&
        !destination.startsWith('#') &&
        !destination.startsWith('/') &&
        !destination.startsWith('//') &&
        !destinationScheme(destination)
      ) {
        addWarning(warnings, 'relative_link_requires_manual_review', sourcePath, sourceLine);
      }
    }
  }
  return tokens;
}

async function collectImageCandidates({
  projection,
  sourcePath,
  bookRoot,
  assetRoot,
  assetRootIdentity,
  warnings,
  copiedAssets,
  imageCandidates
}) {
  const tokens = inspectReaderVisibleMarkdown(projection, sourcePath, warnings);
  const destinations = new Map();
  for (const { token, line } of tokens) {
    if (token.type !== 'image') continue;
    const sourceLine = projection.sourceLines[line - 1] ?? line;
    const destination = token.attrGet('src') || '';
    if (
      !destination ||
      destination.startsWith('/') ||
      destination.startsWith('//') ||
      destinationScheme(destination)
    ) {
      addWarning(
        warnings,
        'external_or_root_image_requires_manual_upload',
        sourcePath,
        sourceLine
      );
      continue;
    }
    const relativeToAssets = resolveAssetPath(
      bookRoot,
      assetRoot,
      sourcePath,
      destination,
      'Image'
    );
    const extension = path.extname(relativeToAssets).toLowerCase();
    if (!NOTE_IMAGE_EXTENSIONS.has(extension)) {
      addWarning(
        warnings,
        'unsupported_image_requires_manual_conversion',
        sourcePath,
        sourceLine
      );
      continue;
    }
    const contents = await SAFE_IO.readFileFromHeldTree(
      assetRoot,
      assetRootIdentity,
      relativeToAssets,
      {
        maximumSize: NOTE_IMAGE_MAX_BYTES,
        pathLabel: 'Image',
        tooLargeMessage: `note image exceeds 20MB: ${relativeToAssets}`
      }
    );
    const outputPath = `assets/${relativeToAssets.split(path.sep).join('/')}`;
    const existing = copiedAssets.get(outputPath);
    if (existing && !existing.equals(contents)) {
      throw new NoteAdapterError(`Conflicting note asset destination: ${outputPath}`);
    }
    copiedAssets.set(outputPath, contents);
    destinations.set(destination, outputPath);
    const candidate = imageCandidates.get(outputPath) || {
      source: `${path.relative(bookRoot, assetRoot).split(path.sep).join('/')}/${relativeToAssets.split(path.sep).join('/')}`,
      destination: outputPath,
      documents: new Set()
    };
    candidate.documents.add(sourcePath);
    imageCandidates.set(outputPath, candidate);
    addWarning(warnings, 'image_requires_manual_upload', sourcePath, sourceLine);
  }
  return destinations;
}

function createFragment(sections) {
  return sections
    .filter((section) => section.body)
    .map((section) => `## ${section.title}\n\n${section.body}`)
    .join('\n\n---\n\n') + '\n';
}

function renderHtmlFragment(sections) {
  return sections
    .filter((section) => section.body)
    .map((section) => {
      const markdown = `## ${section.title}\n\n${section.body}\n`;
      return HTML_FRAGMENT_MARKDOWN.render(markdown, {
        imageDestinations: section.imageDestinations,
        docId: section.id
      }).trim();
    })
    .join('\n<hr>\n') + '\n';
}

function sortAndDeduplicateWarnings(warnings) {
  const seen = new Set();
  return warnings
    .sort((left, right) =>
      compareCodeUnits(left.file, right.file) ||
      left.line - right.line ||
      compareCodeUnits(left.code, right.code)
    )
    .filter((warning) => {
      const key = `${warning.file}\0${warning.line}\0${warning.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function validateNoteMetadata(metadata, edition) {
  const target = metadata.targets?.note;
  if (!target) {
    throw new NoteAdapterError('book.yaml must define targets.note for a note build.');
  }
  if (!NOTE_SLUG.test(target.slug) || target.slug.length < 2 || target.slug.length > 64) {
    throw new NoteAdapterError(
      'targets.note.slug must use 2-64 lowercase ASCII letters, digits, or single hyphens.'
    );
  }
  if (edition.visibility !== 'paid') {
    throw new NoteAdapterError('The note-v1 package requires a paid edition build.');
  }
  if (!Number.isInteger(target.price) || target.price < 100 || target.price > 50_000) {
    throw new NoteAdapterError(
      'targets.note.price must be an integer from 100 to 50000 JPY for the standard-account contract.'
    );
  }
  for (const hashtag of target.hashtags) {
    if (
      [...hashtag].length > 30 ||
      !NOTE_HASHTAG.test(hashtag) ||
      hashtag.includes('-')
    ) {
      throw new NoteAdapterError(
        'targets.note.hashtags must match the conservative current note character and 30-character contract.'
      );
    }
  }
  const sampleEdition = metadata.editions.find(
    (candidate) => candidate.id === target.free_sample_edition
  );
  if (!sampleEdition) {
    throw new NoteAdapterError(
      `targets.note.free_sample_edition does not exist: ${target.free_sample_edition}`
    );
  }
  if (
    sampleEdition.id === edition.id ||
    !['free', 'sample'].includes(sampleEdition.visibility) ||
    !sampleEdition.documents
  ) {
    throw new NoteAdapterError(
      'targets.note.free_sample_edition must reference a distinct free or sample visibility edition.'
    );
  }
  const paidDocuments = new Set(edition.documents || []);
  const missing = sampleEdition.documents.filter((documentId) => !paidDocuments.has(documentId));
  if (missing.length > 0) {
    throw new NoteAdapterError(
      `Free-sample documents must be included in the paid edition: ${missing.join(', ')}`
    );
  }
  const escapedBookTitle = escapedGeneratedTitle(metadata.title, 'book title');
  return { target, sampleEdition, escapedBookTitle };
}

async function collectAttachmentCandidates({
  target,
  standardBook,
  assetRoot,
  assetRootIdentity,
  copiedAssets
}) {
  const attachments = [];
  for (const sourcePath of target.attachment_candidates || []) {
    const absolutePath = path.resolve(standardBook.bookRoot, sourcePath);
    const relativeToAssets = path.relative(assetRoot, absolutePath);
    if (
      !relativeToAssets ||
      relativeToAssets === '..' ||
      relativeToAssets.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToAssets) ||
      path.extname(relativeToAssets).toLowerCase() !== '.pdf'
    ) {
      throw new NoteAdapterError(
        `note attachment candidate must be a PDF below the declared assets directory: ${sourcePath}`
      );
    }
    const contents = await SAFE_IO.readFileFromHeldTree(
      assetRoot,
      assetRootIdentity,
      relativeToAssets,
      {
        maximumSize: NOTE_ATTACHMENT_MAX_BYTES,
        pathLabel: 'Attachment',
        tooLargeMessage: `note attachment exceeds 50MB: ${relativeToAssets}`
      }
    );
    const destination = `assets/${relativeToAssets.split(path.sep).join('/')}`;
    const existing = copiedAssets.get(destination);
    if (existing && !existing.equals(contents)) {
      throw new NoteAdapterError(`Conflicting note asset destination: ${destination}`);
    }
    copiedAssets.set(destination, contents);
    attachments.push({ source: sourcePath, destination });
  }
  return attachments;
}

function createNoteManifest({
  standardBook,
  edition,
  sampleEdition,
  target,
  freeSections,
  paidSections,
  images,
  attachments,
  warnings
}) {
  return {
    contract_version: 1,
    kind: 'book-formatter.note-manual-package',
    implementation: NOTE_IMPLEMENTATION,
    contract_reviewed_at: NOTE_CONTRACT_REVIEWED_AT,
    manual_operation_required: true,
    book: {
      id: standardBook.metadata.id,
      title: standardBook.metadata.title,
      version: standardBook.metadata.version,
      language: standardBook.metadata.language
    },
    publication: {
      price_jpy: target.price,
      hashtags: target.hashtags,
      selected_edition: edition.id,
      free_sample_edition: sampleEdition.id
    },
    paid_line: {
      placement: 'between-paragraphs',
      after: '01-free-sample.md',
      before: '02-paid-body.md'
    },
    fragments: {
      free_sample: {
        markdown: '01-free-sample.md',
        html: '01-free-sample.html',
        document_ids: freeSections.map((section) => section.id)
      },
      paid_body: {
        markdown: '02-paid-body.md',
        html: '02-paid-body.html',
        document_ids: paidSections.map((section) => section.id)
      }
    },
    image_candidates: images,
    attachment_candidates: attachments,
    warnings
  };
}

function createPublishChecklist(noteManifest, escapedBookTitle) {
  const tags = noteManifest.publication.hashtags.map((tag) => `#${tag}`).join(' ');
  return `# note公開前チェックリスト

このpackageはnoteへ自動投稿しません。Markdownは正本照合用、HTMLは表示比較用です。noteの公式一括import形式ではないため、編集画面への転記と装飾確認を人間が行います。

- [ ] noteのタイトル欄へ「${escapedBookTitle}」を設定した
- [ ] \`01-free-sample.md\`の内容を無料範囲として転記した
- [ ] 無料範囲の末尾が段落境界であることを確認した
- [ ] その段落境界の直後へnote編集画面で有料ラインを設定した
- [ ] \`02-paid-body.md\`の内容を有料範囲として転記した
- [ ] 価格を${noteManifest.publication.price_jpy}円に設定した
- [ ] ハッシュタグを確認した: ${tags}
- [ ] manifestの画像候補を手動uploadし、ALTと配置を確認した
- [ ] manifestのPDF候補を必要な有料範囲へ手動添付し、権利・malware scan・50MB上限を確認した
- [ ] callout、relative link、raw HTMLに関するwarningを全件確認した
- [ ] \`01-free-sample.html\` / \`02-paid-body.html\`と編集画面の表示を比較した
- [ ] 下書きpreviewで見出し、list、引用、code、画像、linkを確認した
- [ ] 公開後に添付fileのdownloadが有効であることを確認した
- [ ] ログアウト状態またはシークレットモードで有料ラインと購入者表示を確認した
- [ ] internal本文、credential、個人情報が公開画面へ含まれないことを確認した

## 公式仕様（2026-09-06確認）

- 有料ライン: https://www.help-note.com/hc/ja/articles/360008882894
- 編集画面 / Markdown shortcut: https://www.help-note.com/hc/ja/articles/360012426133
- import形式: https://www.help-note.com/hc/ja/articles/16143759138329
- file upload: https://www.help-note.com/hc/ja/articles/360016349894
`;
}

export async function writeNotePackage({
  standardBook,
  edition,
  visibilityReport,
  outputDirectory,
  manifest,
  getVisibilityReport,
  revalidateOutputDestination,
  revalidateReplacementDirectory,
  verifyArtifact,
  validateOnly = false
}) {
  if (
    typeof getVisibilityReport !== 'function' ||
    typeof revalidateOutputDestination !== 'function' ||
    typeof revalidateReplacementDirectory !== 'function' ||
    typeof verifyArtifact !== 'function'
  ) {
    throw new NoteAdapterError(
      'note output requires fail-closed visibility, destination, and artifact callbacks.'
    );
  }
  const {
    target,
    sampleEdition,
    escapedBookTitle
  } = validateNoteMetadata(standardBook.metadata, edition);
  const sampleReport = await getVisibilityReport(sampleEdition.id);
  if (!sampleReport.summary.safe) {
    throw new NoteAdapterError(
      `Visibility check failed for free-sample edition ${sampleEdition.id}: ` +
        `${sampleReport.summary.findings} finding(s)`
    );
  }

  const revalidateMetadataSnapshot = async () => {
    await SAFE_IO.readVisibilityBoundSource(
      standardBook.bookRoot,
      path.relative(standardBook.bookRoot, standardBook.metadataPath),
      standardBook.metadataDigest
    );
  };
  await revalidateMetadataSnapshot();

  const entries = flattenStructure(standardBook.metadata);
  const paidReports = new Map(visibilityReport.documents.map((report) => [report.id, report]));
  const sampleReports = new Map(sampleReport.documents.map((report) => [report.id, report]));
  const warnings = [];
  const copiedAssets = new Map();
  const imageCandidates = new Map();
  const freeSections = [];
  const paidSections = [];
  const assetRoot = path.resolve(standardBook.bookRoot, standardBook.metadata.source.assets);
  const assetRootIdentity = await SAFE_IO.pathIdentity(assetRoot);
  let paidBoundaryStarted = false;

  for (const entry of entries) {
    const paidReport = paidReports.get(entry.id);
    const freeReport = sampleReports.get(entry.id);
    if (!paidReport || !freeReport) {
      throw new NoteAdapterError(`Missing visibility report for structure entry: ${entry.id}`);
    }
    if (paidReport.sourceDigest !== freeReport.sourceDigest) {
      throw new NoteAdapterError(`Visibility reports disagree on source digest: ${entry.path}`);
    }
    const source = await SAFE_IO.readVisibilityBoundSource(
      standardBook.bookRoot,
      entry.path,
      paidReport.sourceDigest
    );
    const labelNamespace = createDocumentLabelNamespace(source, entry.id);
    const paidVisibleLines = visibleSourceLines(source, paidReport, entry.path);
    const freeVisibleLines = visibleSourceLines(source, freeReport, entry.path);
    const { lines: sourceLines } = normalizedLines(source);
    for (const [index, line] of sourceLines.entries()) {
      const lineNumber = index + 1;
      if (!line.trim() || !paidVisibleLines.has(lineNumber)) continue;
      if (freeVisibleLines.has(lineNumber)) {
        if (paidBoundaryStarted) {
          throw new NoteAdapterError(
            `Free-sample content must be a single prefix before the note paid line: ${entry.path}:${lineNumber}`
          );
        }
      } else {
        paidBoundaryStarted = true;
      }
    }

    const freeProjected = projectSourceLines(source, freeReport, entry.path);
    if (freeProjected.text) {
      const body = convertStandardCallouts(
        namespaceReferenceLabels(
          removeLeadingCanonicalH1(freeProjected, entry.path),
          labelNamespace
        ),
        entry.path,
        warnings
      );
      const imageDestinations = await collectImageCandidates({
        projection: body,
        sourcePath: entry.path,
        bookRoot: standardBook.bookRoot,
        assetRoot,
        assetRootIdentity,
        warnings,
        copiedAssets,
        imageCandidates
      });
      if (body.text) {
        freeSections.push({
          id: entry.id,
          title: escapedGeneratedTitle(entry.title, `structure title ${entry.id}`),
          body: body.text,
          imageDestinations
        });
      }
    }

    const paidProjected = projectSourceLines(
      source,
      paidReport,
      entry.path,
      freeReport
    );
    if (paidProjected.text) {
      const body = convertStandardCallouts(
        namespaceReferenceLabels(
          removeLeadingCanonicalH1(paidProjected, entry.path),
          labelNamespace
        ),
        entry.path,
        warnings
      );
      const imageDestinations = await collectImageCandidates({
        projection: body,
        sourcePath: entry.path,
        bookRoot: standardBook.bookRoot,
        assetRoot,
        assetRootIdentity,
        warnings,
        copiedAssets,
        imageCandidates
      });
      if (body.text) {
        paidSections.push({
          id: entry.id,
          title: escapedGeneratedTitle(entry.title, `structure title ${entry.id}`),
          body: body.text,
          imageDestinations
        });
      }
    }
  }
  if (freeSections.length === 0) {
    throw new NoteAdapterError('note free-sample fragment must not be empty.');
  }
  if (paidSections.length === 0) {
    throw new NoteAdapterError('note paid-body fragment must not be empty.');
  }

  const attachments = await collectAttachmentCandidates({
    target,
    standardBook,
    assetRoot,
    assetRootIdentity,
    copiedAssets
  });
  const warningsNormalized = sortAndDeduplicateWarnings(warnings);
  const images = [...imageCandidates.values()]
    .sort((left, right) => compareCodeUnits(left.destination, right.destination))
    .map((candidate) => ({
      source: candidate.source,
      destination: candidate.destination,
      documents: [...candidate.documents].sort(compareCodeUnits)
    }));
  const noteManifest = createNoteManifest({
    standardBook,
    edition,
    sampleEdition,
    target,
    freeSections,
    paidSections,
    images,
    attachments,
    warnings: warningsNormalized
  });
  const freeMarkdown = createFragment(freeSections);
  const paidMarkdown = createFragment(paidSections);
  const freeHtml = renderHtmlFragment(freeSections);
  const paidHtml = renderHtmlFragment(paidSections);

  Object.assign(manifest.adapter, {
    implementation: NOTE_IMPLEMENTATION,
    project_format: 'note-manual-package',
    contract_reviewed_at: NOTE_CONTRACT_REVIEWED_AT,
    package_path: target.slug,
    manual_operation_required: true,
    warnings: warningsNormalized
  });

  await SAFE_IO.assertOwnedExistingOutput(outputDirectory);
  if (validateOnly) return;

  const parent = path.dirname(outputDirectory);
  await fs.ensureDir(parent);
  const parentIdentity = await SAFE_IO.pathObjectIdentity(parent);
  const stagingName = `.note-${process.pid}-${randomUUID()}.tmp`;
  const stagingDirectory = path.join(parent, stagingName);
  let expectedStagingIdentity;

  try {
    expectedStagingIdentity = await SAFE_IO.createDirectoryInHeldParent(
      parent,
      parentIdentity,
      stagingName
    );
    await SAFE_IO.assertPathObjectIdentity(
      stagingDirectory,
      expectedStagingIdentity,
      'note staging directory changed after exclusive creation'
    );
    const staging = SAFE_IO.createStagingTree(stagingDirectory, expectedStagingIdentity);
    const packagePrefix = target.slug;
    await staging.write(`${packagePrefix}/01-free-sample.md`, freeMarkdown);
    await staging.write(`${packagePrefix}/01-free-sample.html`, freeHtml);
    await staging.write(`${packagePrefix}/02-paid-body.md`, paidMarkdown);
    await staging.write(`${packagePrefix}/02-paid-body.html`, paidHtml);
    await staging.write(
      `${packagePrefix}/note-publish-manifest.yaml`,
      YAML.stringify(noteManifest, { lineWidth: 0 })
    );
    await staging.write(
      `${packagePrefix}/publish-checklist.md`,
      createPublishChecklist(noteManifest, escapedBookTitle)
    );
    for (const [destination, contents] of copiedAssets) {
      await staging.write(`${packagePrefix}/${destination}`, contents);
    }
    await staging.write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await staging.assertTreeUnchanged();

    for (const relativePath of ['01-free-sample.md', '01-free-sample.html']) {
      const freeArtifact = await verifyArtifact(
        sampleEdition.id,
        path.join(stagingDirectory, packagePrefix, relativePath)
      );
      if (!freeArtifact.summary.safe) {
        throw new NoteAdapterError(
          'Generated note free sample failed visibility verification: ' +
            `${freeArtifact.summary.findings} finding(s)`
        );
      }
    }
    const paidArtifact = await verifyArtifact(edition.id, stagingDirectory);
    if (!paidArtifact.summary.safe) {
      throw new NoteAdapterError(
        'Generated note package failed visibility verification: ' +
          `${paidArtifact.summary.findings} finding(s)`
      );
    }
    await staging.assertTreeUnchanged();

    await revalidateOutputDestination();
    const expectedOutputIdentity = await SAFE_IO.assertOwnedExistingOutput(outputDirectory);
    const protectedRoots = [
      standardBook.bookRoot,
      standardBook.metadataPath,
      ...Object.values(standardBook.metadata.source).map(
        (relativeSource) => path.resolve(standardBook.bookRoot, relativeSource)
      )
    ];
    await SAFE_IO.replaceOwnedDirectory({
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
        await SAFE_IO.removeDirectoryByExpectedIdentity(
          stagingDirectory,
          expectedStagingIdentity,
          'note staging identity changed before cleanup'
        );
      } catch (cleanupError) {
        throw new NoteAdapterError(
          `${error.message}; staging cleanup retained path: ${stagingDirectory}; ` +
            cleanupError.message
        );
      }
    }
    throw error;
  }
}
