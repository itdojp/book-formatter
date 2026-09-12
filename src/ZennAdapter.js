import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import { parseFragment } from 'parse5';
import YAML from 'yaml';

import { createAdapterSafeIO } from './AdapterSafeIO.js';
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
}).use(markdownItFootnote);
SOURCE_AUDIT_MARKDOWN.validateLink = () => true;
SOURCE_AUDIT_MARKDOWN.normalizeLink = (destination) => destination;

export class ZennAdapterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZennAdapterError';
  }
}

const SAFE_IO = createAdapterSafeIO({ adapterName: 'Zenn', target: 'zenn' });

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

  const contents = await SAFE_IO.readFileFromHeldTree(
    assetRoot,
    assetRootIdentity,
    relativeToAssets,
    {
      maximumSize: ZENN_IMAGE_MAX_BYTES,
      pathLabel: 'Image',
      tooLargeMessage: `Zenn image exceeds 3MB: ${relativeToAssets}`
    }
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
  const metadataSpans = [
    ...standaloneInlineDestinationSpans(visibleScope),
    ...collectAutolinkSyntaxSpans(visibleScope)
  ];
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
    let quotedTitleDelimiter = null;
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
      if (quotedTitleDelimiter) {
        if (segment[cursor] === quotedTitleDelimiter) quotedTitleDelimiter = null;
        cursor += 1;
        continue;
      }
      if (angleDestination) {
        if (segment[cursor] === '>') angleDestination = false;
      } else {
        if (
          parenthesisDepth === 1 &&
          (segment[cursor] === '"' || segment[cursor] === '\'') &&
          cursor > destinationStart &&
          /\s/u.test(segment[cursor - 1])
        ) {
          quotedTitleDelimiter = segment[cursor];
          cursor += 1;
          continue;
        }
        if (segment[cursor] === '(') parenthesisDepth += 1;
        if (segment[cursor] === ')') parenthesisDepth -= 1;
      }
      cursor += 1;
    }
    if (parenthesisDepth !== 0 || angleDestination || quotedTitleDelimiter) {
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

function collectAutolinkSyntaxSpans(segment) {
  const spans = [];
  let opening = null;
  for (let cursor = 0; cursor < segment.length; cursor += 1) {
    if (segment[cursor] === '\\' && opening === null) {
      cursor += 1;
      continue;
    }
    if (segment[cursor] === '\n') {
      opening = null;
      continue;
    }
    if (segment[cursor] === '<') {
      opening = cursor;
      continue;
    }
    if (segment[cursor] !== '>' || opening === null) continue;
    const end = cursor + 1;
    const token = parsedRootLink(segment.slice(opening, end), {});
    if (token?.markup === 'autolink') spans.push({ start: opening, end });
    opening = null;
  }
  return spans;
}

function parsedInlineImages(source) {
  return collectTokens(
    SOURCE_AUDIT_MARKDOWN.parseInline(source, {}),
    1,
    { skipImageChildren: true }
  )
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
    [...standaloneImageSyntaxSpans(segment), ...collectAutolinkSyntaxSpans(segment)]
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

  const linkMetadataSpans = [
    ...selectParsedInlineLinkSyntaxes(
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
      })),
    ...collectAutolinkSyntaxSpans(segment)
  ];
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
    await SAFE_IO.readVisibilityBoundSource(
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
    const source = await SAFE_IO.readVisibilityBoundSource(
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

  await SAFE_IO.assertOwnedExistingOutput(outputDirectory);
  if (validateOnly) return;

  const parent = path.dirname(outputDirectory);
  await fs.ensureDir(parent);
  const parentIdentity = await SAFE_IO.pathObjectIdentity(parent);
  const stagingName = `.zenn-${process.pid}-${randomUUID()}.tmp`;
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
      'Zenn staging directory changed after exclusive creation'
    );
    const staging = SAFE_IO.createStagingTree(stagingDirectory, expectedStagingIdentity);
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
