import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import markdownAutolinkRule from 'markdown-it/lib/rules_inline/autolink.mjs';
import markdownBackticksRule from 'markdown-it/lib/rules_inline/backticks.mjs';
import markdownHtmlInlineRule from 'markdown-it/lib/rules_inline/html_inline.mjs';
import markdownImageRule from 'markdown-it/lib/rules_inline/image.mjs';
import markdownLinkRule from 'markdown-it/lib/rules_inline/link.mjs';
import markdownReferenceRule from 'markdown-it/lib/rules_block/reference.mjs';
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
const REFERENCE_DEFINITION_RANGES = Symbol('note-reference-definition-ranges');
const FOOTNOTE_DEFINITION_RANGES = Symbol('note-footnote-definition-ranges');
const LABEL_RESERVATIONS = Symbol('note-label-reservations');
const PROTECTED_INLINE_SPANS = Symbol('note-protected-inline-spans');
const PROTECTED_BLOCK_TOKENS = Symbol('note-protected-block-tokens');

function failInlineSourceMap() {
  throw new NoteAdapterError(
    'note cannot uniquely map protected inline content to source lines; ' +
    'simplify the Markdown container or move the protected content to a separate paragraph.'
  );
}

// Observe consumed spans in parser-produced inline content, never container-
// prefixed physical lines. The original rules remain responsible for syntax.
function captureProtectedInlineSpans(markdown) {
  const parseInline = markdown.inline.parse;
  markdown.inline.parse = function (content, md, env, tokens) {
    const capture = env[PROTECTED_INLINE_SPANS];
    if (!capture || content.length === 0) return parseInline.call(this, content, md, env, tokens);
    const parent = capture.context;
    const firstRange = capture.ranges.length;
    // Plugins may parse a substring (inline footnotes/image labels). Preserve
    // its offset only when the parent-to-child mapping is also unambiguous.
    capture.context = { content };
    try {
      const result = parseInline.call(this, content, md, env, tokens);
      if (parent && capture.ranges.length > firstRange) {
        const offset = parent.content.indexOf(content);
        if (offset === -1 || parent.content.indexOf(content, offset + 1) !== -1) failInlineSourceMap();
        for (let index = firstRange; index < capture.ranges.length; index += 1) {
          capture.ranges[index].start += offset;
          capture.ranges[index].end += offset;
        }
      }
      return result;
    } finally {
      capture.context = parent;
    }
  };
  // Keep original block maps, including definitions later removed/moved by
  // footnote_tail. Generated footnote-tail inline tokens have no source map.
  markdown.core.ruler.before('inline', 'note_protection_blocks', (state) => {
    if (state.env[PROTECTED_BLOCK_TOKENS] === true) {
      state.env[PROTECTED_BLOCK_TOKENS] = state.tokens.slice();
    }
  });
  for (const [name, rule] of [
    ['backticks', markdownBackticksRule],
    ['autolink', markdownAutolinkRule],
    ['html_inline', markdownHtmlInlineRule],
    ['link', markdownLinkRule],
    ['image', markdownImageRule]
  ]) {
    markdown.inline.ruler.at(name, (state, silent) => {
      const start = state.pos;
      const accepted = rule(state, silent);
      const capture = state.env[PROTECTED_INLINE_SPANS];
      if (!accepted || silent || !capture || capture.context?.content !== state.src) return accepted;
      if (name === 'link' || name === 'image') {
        // The accepted parser rule owns label boundaries, including its
        // reference environment and nested-link restrictions. Only actual
        // inline destination/title metadata is protected from rewriting.
        const opening = name === 'image' ? start + 1 : start;
        const labelEnd = state.md.helpers.parseLinkLabel(state, opening, name === 'link');
        if (labelEnd < 0 || state.src[labelEnd + 1] !== '(' ||
          parsedInlineLinkEnd(state.src, opening, state.pos) !== state.pos) return accepted;
        // Skip the outer opener so it cannot become a shortcut reference,
        // but visit link labels and image ALT: both can contain references.
        capture.ranges.push({ start, end: opening + 1 }, { start: labelEnd, end: state.pos });
        return accepted;
      }
      capture.ranges.push({ start, end: state.pos });
      return accepted;
    });
  }
}

// Observe only parser-visited inline candidates. Code, escaped openers, HTML,
// autolinks and inline-link metadata are consumed by the existing parser rules.
// Never consume input or observe silent lookahead (parseLinkLabel uses it).
function captureLabelCandidates(markdown) {
  markdown.inline.ruler.before('link', 'note_label_candidates', (state, silent) => {
    const reservations = state.env[LABEL_RESERVATIONS];
    if (silent || !reservations) return false;
    const opening = state.src[state.pos] === '!' ? state.pos + 1 : state.pos;
    if (state.src[opening] !== '[') return false;
    const closing = state.md.helpers.parseLinkLabel(state, opening);
    if (closing < 0) return false;
    if (
      state.src[closing + 1] === '(' &&
      parsedInlineLinkEnd(state.src, opening, state.posMax) !== -1
    ) return false;

    const first = state.src.slice(opening + 1, closing);
    reservations.references.add(markdown.utils.normalizeReference(first));
    if (first.startsWith('^') && !/[ \n]/u.test(first)) {
      reservations.footnotes.add(first.slice(1));
    }
    if (state.src[closing + 1] === '[') {
      const secondEnd = state.md.helpers.parseLinkLabel(state, closing + 1);
      if (secondEnd >= 0) {
        reservations.references.add(markdown.utils.normalizeReference(
          state.src.slice(closing + 2, secondEnd) || first
        ));
      }
    }
    return false;
  });
}

function createLabelReservations() {
  return { references: new Set(), footnotes: new Set() };
}

function reserveFragmentLabels(projection, reservations) {
  const environment = { [LABEL_RESERVATIONS]: reservations };
  SOURCE_MARKDOWN.parse(projection.text, environment);
  for (const label of Object.keys(environment.references || {})) {
    reservations.references.add(label);
  }
  for (const label of Object.keys(environment.footnotes?.refs || {})) {
    if (label.startsWith(':')) reservations.footnotes.add(label.slice(1));
  }
}

function acceptedReferenceLabel(state, startLine, endLine) {
  let source = '';
  for (let line = startLine; line < endLine; line += 1) {
    if (source) source += '\n';
    source += state.src.slice(
      state.bMarks[line] + state.tShift[line],
      state.eMarks[line]
    );
  }
  if (source[0] !== '[') return null;
  for (let cursor = 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (source[cursor] === ']') {
      return state.md.utils.normalizeReference(source.slice(1, cursor));
    }
  }
  return null;
}

function captureReferenceDefinitionRanges(markdown) {
  markdown.block.ruler.at('reference', (state, startLine, endLine, silent) => {
    const accepted = markdownReferenceRule(state, startLine, endLine, silent);
    if (!accepted || silent) return accepted;
    const label = acceptedReferenceLabel(state, startLine, state.line);
    if (!label) return accepted;
    const ranges = state.env[REFERENCE_DEFINITION_RANGES] || new Map();
    state.env[REFERENCE_DEFINITION_RANGES] = ranges;
    const acceptedRanges = ranges.get(label) || [];
    acceptedRanges.push({ start: startLine, end: state.line });
    ranges.set(label, acceptedRanges);
    return accepted;
  });
}

// Observe the installed plugin rule, including unused/empty definitions.
// Its parser owns indentation, containers, labels and consumed line ranges.
function captureFootnoteDefinitionRanges(markdown) {
  const rule = markdown.block.ruler.getRules('').find((candidate) => candidate.name === 'footnote_def');
  if (!rule) throw new Error('note requires the pinned markdown-it-footnote definition rule');
  markdown.block.ruler.at('footnote_def', (state, startLine, endLine, silent) => {
    const firstToken = state.tokens.length;
    const accepted = rule(state, startLine, endLine, silent);
    if (!accepted || silent) return accepted;
    const token = state.tokens[firstToken];
    if (token?.type !== 'footnote_reference_open' || !token.meta?.label) {
      throw new Error('note cannot map the accepted footnote definition');
    }
    const ranges = state.env[FOOTNOTE_DEFINITION_RANGES] || new Map();
    state.env[FOOTNOTE_DEFINITION_RANGES] = ranges;
    const acceptedRanges = ranges.get(token.meta.label) || [];
    acceptedRanges.push({ start: startLine, end: state.line });
    ranges.set(token.meta.label, acceptedRanges);
    return accepted;
  }, { alt: ['paragraph', 'reference'] });
}

const INLINE_FOOTNOTE_POSITION = Symbol('note.inline-footnote-position');

function captureInlineFootnotePositions(markdown) {
  const rule = markdown.inline.ruler.getRules('').find((candidate) => candidate.name === 'footnote_inline');
  if (!rule) throw new Error('note requires the pinned inline footnote rule');
  markdown.inline.ruler.at('footnote_inline', (state, silent) => {
    const start = state.pos;
    const accepted = rule(state, silent);
    if (accepted && !silent) {
      // Observe consumed source only; the plugin still owns all syntax.
      state.tokens.at(-1)[INLINE_FOOTNOTE_POSITION] = {
        lineOffset: state.src.slice(0, start).split('\n').length - 1,
        consumedLines: state.src.slice(start, state.pos).split('\n').length - 1
      };
    }
    return accepted;
  });
}

const SOURCE_MARKDOWN = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  maxNesting: 128
}).use(markdownItFootnote).use(captureFootnoteDefinitionRanges)
  .use(captureReferenceDefinitionRanges).use(captureInlineFootnotePositions)
  .use(captureLabelCandidates).use(captureProtectedInlineSpans);

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

HTML_FRAGMENT_MARKDOWN.renderer.rules.footnote_anchor_name = (
  tokens,
  index,
  _options,
  environment
) => {
  const number = Number(
    tokens[index].meta.id + 1 + (environment.footnoteOffset || 0)
  ).toString();
  return `-${environment.docId}-${number}`;
};

HTML_FRAGMENT_MARKDOWN.renderer.rules.footnote_caption = (
  tokens,
  index,
  _options,
  environment
) => {
  let number = Number(
    tokens[index].meta.id + 1 + (environment.footnoteOffset || 0)
  ).toString();
  if (tokens[index].meta.subId > 0) number += `:${tokens[index].meta.subId}`;
  return `[${number}]`;
};

HTML_FRAGMENT_MARKDOWN.renderer.rules.footnote_block_open = (
  _tokens,
  _index,
  options,
  environment
) => {
  const separator = options.xhtmlOut
    ? '<hr class="footnotes-sep" />\n'
    : '<hr class="footnotes-sep">\n';
  const start = (environment.footnoteOffset || 0) + 1;
  const startAttribute = start > 1 ? ` start="${start}"` : '';
  return `${separator}<section class="footnotes">\n<ol class="footnotes-list"${startAttribute}>\n`;
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

function createDocumentLabelNamespace(source, documentId, reservations = createLabelReservations()) {
  const environment = {};
  const normalizedSource = String(source).replace(/\r\n?/g, '\n');
  const tokens = SOURCE_MARKDOWN.parse(normalizedSource, environment);

  const referenceLabels = Object.keys(environment.references || {}).sort(compareCodeUnits);
  const existingReferences = reservations.references;
  for (const label of referenceLabels) existingReferences.add(label);
  const references = new Map(referenceLabels.map((label, index) => [
    label,
    documentId === null ? label : createUniqueLabel(
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
  const existingFootnotes = reservations.footnotes;
  for (const label of footnoteLabels) existingFootnotes.add(label);
  const footnotes = new Map(footnoteLabels.map((label, index) => [
    label,
    documentId === null ? label : createUniqueLabel(existingFootnotes, `note-${documentId}-fn`, index + 1)
  ]));

  return {
    references,
    footnotes,
    parserReferences: environment.references || {},
    referenceDefinitions: collectReferenceDefinitions(
      normalizedSource,
      environment.references || {},
      references,
      environment[REFERENCE_DEFINITION_RANGES] || new Map()
    ),
    footnoteDefinitions: collectFootnoteDefinitions(
      normalizedSource, environment[FOOTNOTE_DEFINITION_RANGES] || new Map()
    ),
    nonRenderedHtmlLines: collectStandaloneHtmlCommentLines(normalizedSource, tokens)
  };
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

function mapProtectedInlineSpans(source, lineOffsets, content, map, spans) {
  if (spans.length === 0) return [];
  if (!map) failInlineSourceMap();
  const ranges = [];
  let contentOffset = 0;
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const intersections = spans.map((span) => ({
      start: Math.max(span.start, contentOffset),
      end: Math.min(span.end, contentOffset + line.length)
    })).filter((span) => span.start < span.end);
    if (intersections.length > 0) {
      const sourceLine = map[0] + index;
      if (sourceLine >= map[1]) failInlineSourceMap();
      const physical = source.slice(lineOffsets[sourceLine], lineOffsets[sourceLine + 1]);
      const column = physical.indexOf(line);
      // A unique literal match is the proof of the offset mapping. Do not
      // guess container prefixes, expand tabs, decode escapes or reformat it.
      if (column === -1 || physical.indexOf(line, column + 1) !== -1) failInlineSourceMap();
      for (const span of intersections) {
        ranges.push({
          start: lineOffsets[sourceLine] + column + span.start - contentOffset,
          end: lineOffsets[sourceLine] + column + span.end - contentOffset,
          contentStart: span.start
        });
      }
    }
    contentOffset += line.length + 1;
  }
  return ranges;
}

function collectProtectedMarkdownRanges(source, parserReferences) {
  const blockRanges = [];
  const inlineScopes = [];
  const inlineRanges = [];
  const inlineContents = [];
  const parentMaps = [];
  const lineOffsets = sourceLineOffsets(source);
  // Preserve parser acceptance even when a projected fragment needs a
  // definition appended later. Visibility is enforced by dependency closure,
  // not by silently reparsing with an empty/different reference environment.
  const environment = { [PROTECTED_BLOCK_TOKENS]: true, references: { ...parserReferences } };
  SOURCE_MARKDOWN.parse(source, environment);
  for (const token of environment[PROTECTED_BLOCK_TOKENS]) {
    if (token.nesting === 1) parentMaps.push(token.map || parentMaps.at(-1));
    if (token.nesting === -1) parentMaps.pop();
    if (
      ['code_block', 'fence', 'html_block'].includes(token.type) &&
      token.map
    ) {
      blockRanges.push({
        start: lineOffsets[token.map[0]],
        end: lineOffsets[token.map[1]] ?? source.length
      });
    }
    if (token.type === 'inline') {
      const map = token.map || parentMaps.at(-1);
      if (map) {
        inlineScopes.push({ start: lineOffsets[map[0]], end: lineOffsets[map[1]] ?? source.length });
        inlineContents.push({ content: token.content, map });
      }
      const capture = { content: token.content, ranges: [] };
      SOURCE_MARKDOWN.inline.parse(token.content, SOURCE_MARKDOWN, {
        [PROTECTED_INLINE_SPANS]: capture,
        references: environment.references
      }, []);
      inlineRanges.push(...mapProtectedInlineSpans(
        source, lineOffsets, token.content, map, capture.ranges
      ));
    }
  }

  const uniqueInlineScopes = [...new Map(
    inlineScopes.map((range) => [`${range.start}:${range.end}`, range])
  ).values()].sort((left, right) => left.start - right.start || left.end - right.end);
  return {
    protectedRanges: mergeProtectedRanges([...blockRanges, ...inlineRanges]),
    inlineScopes: uniqueInlineScopes,
    inlineContents
  };
}

function readInlineLabel(source, start, end, inlineContents, lineOffsets) {
  const raw = source.slice(start, end);
  if (!raw.includes('\n')) return raw;
  const labels = [];
  for (const { content, map } of inlineContents) {
    if (start < lineOffsets[map[0]] || end >= lineOffsets[map[1]]) continue;
    // Reuse the same literal source-map proof as protected metadata. Never
    // normalize a physical container prefix as part of a reference label.
    const ranges = mapProtectedInlineSpans(source, lineOffsets, content, map, [
      { start: 0, end: content.length }
    ]);
    const first = ranges.find((range) => start >= range.start && start <= range.end);
    const last = ranges.find((range) => end >= range.start && end <= range.end);
    if (first && last) {
      labels.push(content.slice(
        first.contentStart + start - first.start,
        last.contentStart + end - last.start
      ));
    }
  }
  if (labels.length !== 1) failInlineSourceMap();
  return labels[0];
}

function findClosingBracket(source, opening, end, protectedRanges, protectedIndex) {
  let depth = 0;
  for (let cursor = opening; cursor < end; cursor += 1) {
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].end <= cursor) {
      protectedIndex += 1;
    }
    const range = protectedRanges[protectedIndex];
    if (range && cursor >= range.start && cursor < range.end) {
      cursor = range.end - 1;
      continue;
    }
    if (isBackslashEscaped(source, cursor)) continue;
    if (source[cursor] === '[') depth += 1;
    if (source[cursor] !== ']') continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function parsedInlineLinkEnd(source, start, inlineScopeEnd) {
  const scopedSource = source.slice(start, inlineScopeEnd);
  const state = new SOURCE_MARKDOWN.inline.State(scopedSource, SOURCE_MARKDOWN, {}, []);
  if (
    markdownLinkRule(state, true) &&
    state.pos > 0 &&
    scopedSource[state.pos - 1] === ')'
  ) return start + state.pos;
  return -1;
}

function addLabelReplacement(replacements, source, start, end, replacement) {
  if (source.slice(start, end) === replacement) return;
  replacements.push({ start, end, replacement });
}

function escapedReferenceDestination(destination) {
  return String(destination)
    .replace(/</gu, '%3C')
    .replace(/>/gu, '%3E')
    .replace(/\\/gu, '%5C');
}

function escapedReferenceTitle(title) {
  return String(title).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\s+/gu, ' ');
}

function collectReferenceDefinitions(source, parsedReferences, referenceLabels, definitionRanges) {
  const definitions = new Map();
  for (const normalizedLabel of Object.keys(parsedReferences).sort(compareCodeUnits)) {
    const acceptedRanges = definitionRanges.get(normalizedLabel) || [];
    const range = acceptedRanges[0];
    if (!range) continue;
    const parsed = parsedReferences[normalizedLabel];
    const generatedLabel = referenceLabels.get(normalizedLabel);
    let text = `[${generatedLabel}]: <${escapedReferenceDestination(parsed.href)}>`;
    if (parsed.title) text += ` "${escapedReferenceTitle(parsed.title)}"`;
    definitions.set(normalizedLabel, {
      text,
      sourceLines: [range.start + 1],
      effectiveStartLine: range.start + 1,
      visibilityLines: Array.from(
        { length: range.end - range.start },
        (_value, offset) => range.start + offset + 1
      ),
      definitionStartLines: acceptedRanges.map((item) => item.start + 1),
      acceptedDefinitionRanges: acceptedRanges.map((item) => ({
        startLine: item.start + 1,
        endLine: item.end + 1
      })),
      acceptedDefinitionLines: acceptedRanges.flatMap((item) =>
        Array.from(
          { length: item.end - item.start },
          (_value, offset) => item.start + offset + 1
        )
      )
    });
  }
  return definitions;
}

function collectFootnoteDefinitions(source, definitionRanges) {
  const { lines } = normalizedLines(source);
  const definitions = new Map();
  for (const [label, ranges] of definitionRanges) {
    // The pinned plugin uses the last definition for a repeated label.
    const { start, end } = ranges.at(-1);
    const sourceLines = Array.from({ length: end - start }, (_value, offset) => start + offset + 1);
    definitions.set(label, {
      text: lines.slice(start, end).join('\n'),
      sourceLines,
      visibilityLines: sourceLines,
      effectiveStartLine: start + 1,
      definitionStartLines: ranges.map((range) => range.start + 1),
      acceptedDefinitionLines: ranges.flatMap((range) => Array.from(
        { length: range.end - range.start }, (_value, offset) => range.start + offset + 1
      ))
    });
  }
  return definitions;
}

function containsOnlyHtmlComments(source) {
  let remaining = source.trim();
  let found = false;
  while (remaining) {
    if (!remaining.startsWith('<!--')) return false;
    const closing = remaining.indexOf('-->', 4);
    if (closing === -1) return false;
    found = true;
    remaining = remaining.slice(closing + 3).trim();
  }
  return found;
}

function collectStandaloneHtmlCommentLines(source, tokens) {
  const { lines } = normalizedLines(source);
  const sourceLines = new Set();
  for (const token of tokens) {
    if (token.type !== 'html_block' || !token.map) continue;
    const blockSource = lines.slice(token.map[0], token.map[1]).join('\n');
    if (!containsOnlyHtmlComments(blockSource)) continue;
    for (let line = token.map[0] + 1; line <= token.map[1]; line += 1) {
      sourceLines.add(line);
    }
  }
  return sourceLines;
}

function emptyLabelState() {
  return {
    usedReferences: new Set(),
    definedReferences: new Set(),
    usedFootnotes: new Set(),
    definedFootnotes: new Set()
  };
}

function mergeLabelState(target, source) {
  for (const key of Object.keys(target)) {
    for (const label of source[key]) target[key].add(label);
  }
}

function projectedSourceLineAtOffset(offsets, sourceLines, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return sourceLines[low] ?? low + 1;
}

function isKnownDefinitionStart(
  source,
  projection,
  lineOffsets,
  namespace,
  opening,
  closing,
  kind,
  label
) {
  if (source[closing + 1] !== ':') return false;
  const definition = kind === 'footnote'
    ? namespace.footnoteDefinitions.get(label)
    : namespace.referenceDefinitions.get(label);
  if (!definition) return false;
  const sourceLine = projectedSourceLineAtOffset(
    lineOffsets,
    projection.sourceLines,
    opening
  );
  return (definition.definitionStartLines || definition.sourceLines).includes(sourceLine);
}

// Accepted duplicates stay parser definitions, but only a fully retained
// effective range can satisfy the original document's binding.
function retainsEffectiveDefinition(definition, projection, sourceLine) {
  return sourceLine === definition.effectiveStartLine &&
    definition.visibilityLines.every((line) => projection.sourceLines.includes(line));
}

function knownReferenceDefinitionRange(
  projection,
  lineOffsets,
  namespace,
  opening,
  label
) {
  const sourceLine = projectedSourceLineAtOffset(
    lineOffsets,
    projection.sourceLines,
    opening
  );
  return namespace.referenceDefinitions.get(label)?.acceptedDefinitionRanges
    ?.find((range) => range.startLine === sourceLine) || null;
}

function projectedOffsetAtSourceLine(projection, lineOffsets, sourceLine) {
  const projectedLine = projection.sourceLines.findIndex((line) => line >= sourceLine);
  return projectedLine === -1 ? projection.text.length : lineOffsets[projectedLine];
}

function namespaceReferenceLabels(projection, namespace) {
  const labelState = emptyLabelState();
  if (!projection.text || (namespace.references.size === 0 && namespace.footnotes.size === 0)) {
    return { ...projection, labelState };
  }
  const source = projection.text;
  const lineOffsets = sourceLineOffsets(source);
  const { protectedRanges, inlineScopes, inlineContents } = collectProtectedMarkdownRanges(
    source, namespace.parserReferences
  );
  const replacements = [];
  let protectedIndex = 0;
  let inlineScopeIndex = 0;
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

    while (
      inlineScopeIndex < inlineScopes.length &&
      inlineScopes[inlineScopeIndex].end <= cursor
    ) inlineScopeIndex += 1;
    const inlineScope = inlineScopes[inlineScopeIndex];
    const inlineScopeContainsCursor = inlineScope &&
      cursor >= inlineScope.start && cursor < inlineScope.end;
    const physicalLineEnd = source.indexOf('\n', cursor);
    const bracketSearchEnd = inlineScopeContainsCursor
      ? inlineScope.end
      : physicalLineEnd === -1 ? source.length : physicalLineEnd;
    const firstEnd = findClosingBracket(source, cursor, bracketSearchEnd, protectedRanges, protectedIndex);
    if (firstEnd === -1) {
      cursor += 1;
      continue;
    }
    const firstLabel = readInlineLabel(source, cursor + 1, firstEnd, inlineContents, lineOffsets);
    if (firstLabel.startsWith('^')) {
      const originalLabel = firstLabel.slice(1);
      const footnote = namespace.footnotes.get(originalLabel);
      if (footnote) {
        const isDefinition = isKnownDefinitionStart(
          source,
          projection,
          lineOffsets,
          namespace,
          cursor,
          firstEnd,
          'footnote',
          originalLabel
        );
        if (!isDefinition) {
          labelState.usedFootnotes.add(originalLabel);
        } else if (retainsEffectiveDefinition(
          namespace.footnoteDefinitions.get(originalLabel), projection,
          projectedSourceLineAtOffset(lineOffsets, projection.sourceLines, cursor)
        )) {
          labelState.definedFootnotes.add(originalLabel);
        }
        addLabelReplacement(replacements, source, cursor + 2, firstEnd, footnote);
      }
      cursor = footnote ? firstEnd + 1 : cursor + 1;
      continue;
    }

    const following = source[firstEnd + 1];
    if (following === '[') {
      const secondEnd = findClosingBracket(source, firstEnd + 1, bracketSearchEnd, protectedRanges, protectedIndex);
      if (secondEnd === -1) {
        cursor += 1;
        continue;
      }
      const secondLabel = readInlineLabel(source, firstEnd + 2, secondEnd, inlineContents, lineOffsets);
      const effectiveLabel = secondLabel || firstLabel;
      const replacement = namespace.references.get(
        SOURCE_MARKDOWN.utils.normalizeReference(effectiveLabel)
      );
      if (replacement) {
        // Collapsing this metadata would join physical lines (and their
        // ownership/warning provenance). Do not guess a container-preserving
        // rewrite. Multiline display labels can still use a single-line ID.
        if (source.slice(firstEnd + 2, secondEnd).includes('\n')) {
          throw new NoteAdapterError(
            'note cannot namespace a multiline explicit reference label without changing source-line ownership; ' +
            'write its reference ID on one physical line.'
          );
        }
        labelState.usedReferences.add(
          SOURCE_MARKDOWN.utils.normalizeReference(effectiveLabel)
        );
        addLabelReplacement(replacements, source, firstEnd + 2, secondEnd, replacement);
      }
      cursor = replacement ? secondEnd + 1 : cursor + 1;
      continue;
    }

    const replacement = namespace.references.get(
      SOURCE_MARKDOWN.utils.normalizeReference(firstLabel)
    );
    if (replacement) {
      const normalizedLabel = SOURCE_MARKDOWN.utils.normalizeReference(firstLabel);
      const definitionRange = knownReferenceDefinitionRange(
        projection,
        lineOffsets,
        namespace,
        cursor,
        normalizedLabel
      );
      if (definitionRange) {
        if (retainsEffectiveDefinition(
          namespace.referenceDefinitions.get(normalizedLabel), projection, definitionRange.startLine
        )) {
          labelState.definedReferences.add(normalizedLabel);
        }
        addLabelReplacement(replacements, source, cursor + 1, firstEnd, replacement);
        cursor = projectedOffsetAtSourceLine(
          projection,
          lineOffsets,
          definitionRange.endLine
        );
        continue;
      } else {
        labelState.usedReferences.add(
          normalizedLabel
        );
        addLabelReplacement(replacements, source, firstEnd + 1, firstEnd + 1, `[${replacement}]`);
      }
    }
    cursor = replacement ? firstEnd + 1 : cursor + 1;
  }

  let text = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, replacement.start) + replacement.replacement + text.slice(replacement.end);
  }
  return { text, sourceLines: projection.sourceLines, labelState };
}

function missingLabels(used, defined) {
  return [...used]
    .filter((label) => !defined.has(label))
    .sort(compareCodeUnits);
}

function assertDefinitionVisible(definition, allowedLines, sourcePath, fragmentName, kind, label) {
  if (!definition) {
    throw new NoteAdapterError(
      `note ${fragmentName} has an unresolved ${kind} definition dependency: ${sourcePath} [${label}]`
    );
  }
  if (definition.visibilityLines.some((line) => !allowedLines.has(line))) {
    throw new NoteAdapterError(
      `note ${fragmentName} ${kind} definition is outside its visible source: ${sourcePath} [${label}]`
    );
  }
}

function appendProjectionBlock(projection, block) {
  const separatorLine = block.sourceLines[0] ?? projection.sourceLines.at(-1) ?? 1;
  return {
    ...projection,
    text: projection.text ? `${projection.text}\n\n${block.text}` : block.text,
    sourceLines: projection.text
      ? [...projection.sourceLines, separatorLine, ...block.sourceLines]
      : [...block.sourceLines]
  };
}

function prependProjectionBlock(projection, block) {
  const combined = appendProjectionBlock(block, projection);
  return { ...projection, text: combined.text, sourceLines: combined.sourceLines };
}

function completeDocumentReferences(
  projection,
  namespace,
  allowedLines,
  sourcePath,
  fragmentName
) {
  let completed = namespaceReferenceLabels(projection, namespace);
  const labelState = completed.labelState;
  const appendedReferences = new Set();
  const appendedFootnotes = new Set();
  const maximumPasses = namespace.references.size + namespace.footnotes.size + 1;

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    // Even a retained definition must pass the global effective binding's
    // visibility gate; a visible duplicate is never an alternative authority.
    for (const [kind, used, definitions] of [
      ['reference', labelState.usedReferences, namespace.referenceDefinitions],
      ['footnote', labelState.usedFootnotes, namespace.footnoteDefinitions]
    ]) {
      for (const label of [...used].sort(compareCodeUnits)) {
        assertDefinitionVisible(definitions.get(label), allowedLines, sourcePath, fragmentName, kind, label);
      }
    }
    const references = missingLabels(
      labelState.usedReferences,
      labelState.definedReferences
    );
    const footnotes = missingLabels(labelState.usedFootnotes, labelState.definedFootnotes);
    if (references.length === 0 && footnotes.length === 0) return completed;

    let appended = false;
    for (const label of references) {
      const definition = namespace.referenceDefinitions.get(label);
      assertDefinitionVisible(
        definition,
        allowedLines,
        sourcePath,
        fragmentName,
        'reference',
        label
      );
      if (appendedReferences.has(label)) {
        throw new NoteAdapterError(
          `note ${fragmentName} has a cyclic reference definition dependency: ${sourcePath} [${label}]`
        );
      }
      // markdown-it references are first-wins. Prepend the effective binding
      // so a retained non-effective duplicate cannot capture this dependency.
      completed = prependProjectionBlock(completed, definition);
      labelState.definedReferences.add(label);
      appendedReferences.add(label);
      appended = true;
    }

    for (const label of footnotes) {
      const definition = namespace.footnoteDefinitions.get(label);
      assertDefinitionVisible(
        definition,
        allowedLines,
        sourcePath,
        fragmentName,
        'footnote',
        label
      );
      if (appendedFootnotes.has(label)) {
        throw new NoteAdapterError(
          `note ${fragmentName} has a cyclic footnote definition dependency: ${sourcePath} [${label}]`
        );
      }
      // Named footnotes are last-wins in the pinned plugin: append instead.
      const namespacedDefinition = namespaceReferenceLabels(definition, namespace);
      completed = appendProjectionBlock(completed, namespacedDefinition);
      mergeLabelState(labelState, namespacedDefinition.labelState);
      appendedFootnotes.add(label);
      appended = true;
    }

    if (!appended) break;
  }

  throw new NoteAdapterError(
    `note ${fragmentName} reference completion did not converge: ${sourcePath}`
  );
}

function definitionSourceLines(namespace) {
  const lines = new Set();
  for (const definitions of [namespace.referenceDefinitions, namespace.footnoteDefinitions]) {
    for (const definition of definitions.values()) {
      for (const line of definition.acceptedDefinitionLines || definition.visibilityLines) {
        lines.add(line);
      }
    }
  }
  return lines;
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
    !Number.isInteger(endLine) || endLine <= startLine || endLine > lines.length
  ) {
    throw new NoteAdapterError(
      `note fragment h1 must be the first content block: ${sourcePath}`
    );
  }
  return trimProjection(lines.slice(endLine), projection.sourceLines.slice(endLine));
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
      output.push(callout ? `> ${line}` : line);
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

function collectTokens(tokens, inheritedLine = 1, footnoteLines = new Map()) {
  const output = [];
  let line = inheritedLine;
  for (const token of tokens) {
    // Named definitions keep their block maps. Inline footnotes have a
    // generated tail without maps; bind it to the parser's original ref ID.
    const inlineFootnoteLine = token.type === 'footnote_open' && !token.meta?.label
      ? footnoteLines.get(token.meta?.id) : undefined;
    const position = token[INLINE_FOOTNOTE_POSITION];
    const tokenLine = token.map ? token.map[0] + 1
      : position ? inheritedLine + position.lineOffset : inlineFootnoteLine ?? line;
    if (token.type === 'footnote_ref' && !footnoteLines.has(token.meta.id)) {
      footnoteLines.set(token.meta.id, tokenLine);
    }
    line = tokenLine;
    output.push({ token, line: tokenLine });
    if (token.children) output.push(...collectTokens(token.children, tokenLine, footnoteLines));
    if (token.type === 'softbreak' || token.type === 'hardbreak') line += 1;
    if (position) line += position.consumedLines;
  }
  return output;
}

function destinationScheme(destination) {
  return String(destination).trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):/u)?.[1]?.toLowerCase() || null;
}

function encodeLocalUrlPath(relativePath) {
  return String(relativePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
      `%${character.codePointAt(0).toString(16).toUpperCase()}`
    ))
    .join('/');
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
    destinations.set(destination, encodeLocalUrlPath(outputPath));
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
    .map((section) => section.includeTitle === false
      ? section.body
      : `## ${section.title}\n\n${section.body}`)
    .join('\n\n---\n\n') + '\n';
}

function renderHtmlFragment(sections, initialFootnoteOffset = 0) {
  let footnoteOffset = initialFootnoteOffset;
  const html = sections
    .filter((section) => section.body)
    .map((section) => {
      const markdown = section.includeTitle === false
        ? `${section.body}\n`
        : `## ${section.title}\n\n${section.body}\n`;
      const environment = {
        imageDestinations: section.imageDestinations,
        docId: section.id,
        footnoteOffset
      };
      const rendered = HTML_FRAGMENT_MARKDOWN.render(markdown, environment).trim();
      footnoteOffset += environment.footnotes?.list?.length || 0;
      return rendered;
    })
    .join('\n<hr>\n') + '\n';
  return { html, nextFootnoteOffset: footnoteOffset };
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

function hasReaderVisibleSourceLine(projection, nonReaderVisibleLines) {
  const { lines } = normalizedLines(projection.text);
  return lines.some((line, index) => {
    const sourceLine = projection.sourceLines[index] ?? index + 1;
    return line.trim() && !nonReaderVisibleLines.has(sourceLine);
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
  const tags = noteManifest.publication.hashtags
    .map((tag) => `#${escapedGeneratedTitle(tag, 'note hashtag')}`).join(' ');
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

  const paidDocumentOrder = visibilityReport.documents
    .filter((report) => report.decision === 'include')
    .map((report) => report.id);
  const sampleDocumentOrder = sampleReport.documents
    .filter((report) => report.decision === 'include')
    .map((report) => report.id);
  if (
    sampleDocumentOrder.length > paidDocumentOrder.length ||
    sampleDocumentOrder.some((documentId, index) => paidDocumentOrder[index] !== documentId)
  ) {
    throw new NoteAdapterError(
      'Free-sample documents must match the leading document order of the paid edition.'
    );
  }

  const entryById = new Map(
    flattenStructure(standardBook.metadata).map((entry) => [entry.id, entry])
  );
  const entries = paidDocumentOrder
    .map((documentId) => {
      const entry = entryById.get(documentId);
      if (!entry) {
        throw new NoteAdapterError(
          `Visibility report references unknown structure entry: ${documentId}`
        );
      }
      return entry;
    });
  const paidReports = new Map(visibilityReport.documents.map((report) => [report.id, report]));
  const sampleReports = new Map(sampleReport.documents.map((report) => [report.id, report]));
  const warnings = [];
  const copiedAssets = new Map();
  const imageCandidates = new Map();
  const freeSections = [];
  const paidSections = [];
  const freeSectionIds = new Set();
  const assetRoot = path.resolve(standardBook.bookRoot, standardBook.metadata.source.assets);
  const bookRootStat = await fs.lstat(standardBook.bookRoot);
  if (bookRootStat.isSymbolicLink() || !bookRootStat.isDirectory()) {
    throw new NoteAdapterError(
      `note book root must remain a real directory: ${standardBook.bookRoot}`
    );
  }
  const assetRootIdentity = await SAFE_IO.bindDirectoryFromHeldTree(
    standardBook.bookRoot,
    { dev: bookRootStat.dev, ino: bookRootStat.ino },
    path.relative(standardBook.bookRoot, assetRoot),
    { pathLabel: 'note asset root' }
  );
  let paidBoundaryStarted = false;
  const preparedDocuments = [];
  const freeReservations = createLabelReservations();
  const paidReservations = createLabelReservations();

  // Complete the visibility-bound dependency closure without allocating new
  // names first. Later documents and copied footnote bodies can reserve a name
  // that an earlier document would otherwise generate in the same fragment.
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
    const sourceNamespace = createDocumentLabelNamespace(source, null);
    const nonReaderVisibleLines = definitionSourceLines(sourceNamespace);
    for (const line of sourceNamespace.nonRenderedHtmlLines) {
      nonReaderVisibleLines.add(line);
    }
    const paidVisibleLines = visibleSourceLines(source, paidReport, entry.path);
    const freeVisibleLines = visibleSourceLines(source, freeReport, entry.path);
    const { lines: sourceLines } = normalizedLines(source);
    for (const [index, line] of sourceLines.entries()) {
      const lineNumber = index + 1;
      if (
        !line.trim() ||
        !paidVisibleLines.has(lineNumber) ||
        nonReaderVisibleLines.has(lineNumber)
      ) continue;
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

    const freeProjected = removeLeadingCanonicalH1(
      projectSourceLines(source, freeReport, entry.path),
      entry.path
    );
    const paidProjected = removeLeadingCanonicalH1(
      projectSourceLines(source, paidReport, entry.path, freeReport),
      entry.path
    );
    const hasFree = hasReaderVisibleSourceLine(freeProjected, nonReaderVisibleLines);
    const hasPaid = hasReaderVisibleSourceLine(paidProjected, nonReaderVisibleLines);
    for (const [present, projection, allowedLines, reservations, fragment] of [
      [hasFree, freeProjected, freeVisibleLines, freeReservations, 'free-sample fragment'],
      [hasPaid, paidProjected, paidVisibleLines, paidReservations, 'paid-body fragment']
    ]) {
      if (!present) continue;
      reserveFragmentLabels(completeDocumentReferences(
        projection, sourceNamespace, allowedLines, entry.path, fragment
      ), reservations);
    }
    preparedDocuments.push({
      entry, source, freeProjected, paidProjected, freeVisibleLines, paidVisibleLines,
      hasFree, hasPaid
    });
  }

  for (const prepared of preparedDocuments) {
    const {
      entry, source, freeProjected, paidProjected, freeVisibleLines, paidVisibleLines,
      hasFree, hasPaid
    } = prepared;
    const freeLabelNamespace = createDocumentLabelNamespace(
      source, `${entry.id}-free`, freeReservations
    );
    const paidLabelNamespace = createDocumentLabelNamespace(
      source, `${entry.id}-paid`, paidReservations
    );
    if (
      freeProjected.text &&
      hasFree
    ) {
      const body = convertStandardCallouts(
        completeDocumentReferences(
          freeProjected,
          freeLabelNamespace,
          freeVisibleLines,
          entry.path,
          'free-sample fragment'
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
        freeSectionIds.add(entry.id);
      }
    }

    if (
      paidProjected.text &&
      hasPaid
    ) {
      const body = convertStandardCallouts(
        completeDocumentReferences(
          paidProjected,
          paidLabelNamespace,
          paidVisibleLines,
          entry.path,
          'paid-body fragment'
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
          imageDestinations,
          includeTitle: !freeSectionIds.has(entry.id)
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
  const freeHtmlFragment = renderHtmlFragment(freeSections);
  const paidHtmlFragment = renderHtmlFragment(
    paidSections,
    freeHtmlFragment.nextFootnoteOffset
  );
  const freeHtml = freeHtmlFragment.html;
  const paidHtml = paidHtmlFragment.html;

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
