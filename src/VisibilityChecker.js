import crypto from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';

import {
  detectStandardFenceOpen,
  isStandardFenceClose,
  parseStandardCalloutDelimiter,
  STANDARD_CALLOUT_TYPES
} from './StandardCalloutParser.js';
import { validateStandardBook } from './StandardBookValidator.js';

export const VISIBILITY_CONTRACT_VERSION = 1;
export const VISIBILITY_VALUES = Object.freeze(['free', 'sample', 'paid', 'internal']);

const VISIBILITY_RANK = new Map(VISIBILITY_VALUES.map((value, index) => [value, index]));
const MARKDOWN_TEXT_EXTRACTOR = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false
}).use(markdownItFootnote);
const ARTIFACT_TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.htm',
  '.ini',
  '.js',
  '.json',
  '.mjs',
  '.md',
  '.svg',
  '.toml',
  '.ts',
  '.txt',
  '.xhtml',
  '.xml',
  '.yaml',
  '.yml'
]);
const HTML_MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.md', '.xhtml']);
const MIN_INDEPENDENT_FRAGMENT_CODE_POINTS = 8;
const HTML_BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul'
]);

export class VisibilityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VisibilityValidationError';
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeComparableText(value) {
  return String(value || '')
    .replace(/^\uFEFF/u, '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/gu, ' ')
    .trim();
}

function findFrontMatterClosingIndex(lines) {
  if (!/^---[\t ]*$/u.test(lines[0] || '')) return null;
  return lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)[\t ]*$/u.test(line)
  );
}

function stripValidFrontMatter(value) {
  const normalizedValue = String(value || '')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n');
  const lines = normalizedValue.split('\n');
  const closingIndex = findFrontMatterClosingIndex(lines);
  return closingIndex !== null && closingIndex >= 0
    ? lines.slice(closingIndex + 1).join('\n')
    : normalizedValue;
}

function normalizeArtifactBody(value, allowFrontMatter) {
  const normalizedValue = String(value || '')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n');
  return allowFrontMatter ? stripValidFrontMatter(normalizedValue) : normalizedValue;
}

function stripHtmlTags(value, separator = '') {
  const source = String(value || '');
  let result = '';
  let inTag = false;
  let quote = null;
  let tagStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!inTag) {
      if (source.startsWith('<!--', index)) {
        const commentEnd = source.indexOf('-->', index + 4);
        if (commentEnd === -1) {
          result += source.slice(index);
          break;
        }
        const comment = source.slice(index, commentEnd + 3);
        result += typeof separator === 'function' ? separator(comment) : separator;
        index = commentEnd + 2;
        continue;
      }
      if (character === '<' && /[A-Za-z!/?]/u.test(source[index + 1] || '')) {
        inTag = true;
        tagStart = index;
      } else {
        result += character;
      }
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === '\'') {
      quote = character;
    } else if (character === '>') {
      inTag = false;
      const tag = source.slice(tagStart, index + 1);
      result += typeof separator === 'function' ? separator(tag) : separator;
      const imageAlt = tag.match(
        /^<\s*img(?=[\s/>])[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu
      );
      if (imageAlt) result += imageAlt[1] ?? imageAlt[2] ?? imageAlt[3] ?? '';
      tagStart = -1;
    }
  }

  return result;
}

function htmlBlockBoundary(tag) {
  const tagName = String(tag || '').match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9-]*)/u)?.[1];
  return tagName && HTML_BLOCK_ELEMENTS.has(tagName.toLowerCase()) ? '\n' : '';
}

function stripHtmlCodeElementContents(
  value,
  { stripCode = true, stripNonRendered = false } = {}
) {
  const source = String(value || '');
  const stack = [];
  const ranges = [];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<' || !/[A-Za-z!/]/u.test(source[index + 1] || '')) continue;

    if (source.startsWith('<!--', index)) {
      const commentEnd = source.indexOf('-->', index + 4);
      if (commentEnd === -1) break;
      index = commentEnd + 2;
      continue;
    }

    let quote = null;
    let endIndex = index + 1;
    for (; endIndex < source.length; endIndex += 1) {
      const character = source[endIndex];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === '\'') {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }

    if (endIndex >= source.length) {
      break;
    }

    const tag = source.slice(index, endIndex + 1);
    const rawTextTag = tag.match(/^<\s*(script|style|textarea|title)(?=[\s/>])/iu);
    if (rawTextTag && !/\/\s*>$/u.test(tag)) {
      const closingPattern = new RegExp(`<\\/\\s*${rawTextTag[1]}\\s*>`, 'igu');
      closingPattern.lastIndex = endIndex + 1;
      const closingTag = closingPattern.exec(source);
      if (!closingTag) break;
      if (
        stripNonRendered &&
        ['script', 'style'].includes(rawTextTag[1].toLowerCase())
      ) {
        ranges.push([index, closingPattern.lastIndex]);
      }
      index = closingPattern.lastIndex - 1;
      continue;
    }

    const codeTag = tag.match(/^<\s*(\/?)\s*(pre|code)(?=[\s/>])/iu);
    if (stripCode && codeTag) {
      if (codeTag[1]) {
        const current = stack.at(-1);
        if (!current || current.name !== codeTag[2].toLowerCase()) {
          stack.length = 0;
        } else {
          stack.pop();
          if (stack.length === 0) ranges.push([current.start, endIndex + 1]);
        }
      } else if (!/\/\s*>$/u.test(tag)) {
        stack.push({ name: codeTag[2].toLowerCase(), start: index });
      }
    }
    index = endIndex;
  }

  let result = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    result += `${source.slice(cursor, start)} `;
    cursor = end;
  }
  result += source.slice(cursor);
  return result;
}

function createArtifactComparables(value, allowFrontMatter) {
  const completeBody = normalizeArtifactBody(value, false);
  const candidateBodies = allowFrontMatter
    ? [normalizeArtifactBody(value, true), completeBody]
    : [completeBody];
  const artifactComparables = candidateBodies.flatMap((candidateBody) => {
    const decodedBody = MARKDOWN_TEXT_EXTRACTOR.utils.unescapeAll(candidateBody);
    const readerVisibleBody = stripHtmlCodeElementContents(decodedBody, {
      stripCode: false,
      stripNonRendered: true
    });
    return [
      candidateBody,
      decodedBody,
      stripHtmlTags(readerVisibleBody),
      stripHtmlTags(readerVisibleBody, ' '),
      stripHtmlTags(readerVisibleBody, htmlBlockBoundary)
    ];
  });
  if (allowFrontMatter) {
    artifactComparables.push(...collectMarkdownTextFragments(candidateBodies[0]));
  }
  return artifactComparables
    .map((candidate) => normalizeComparableText(candidate))
    .filter(Boolean);
}

function isEscapedCharacter(value, index) {
  let backslashes = 0;
  for (let candidate = index - 1; candidate >= 0 && value[candidate] === '\\'; candidate -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function projectInlineMath(value) {
  const fragments = [];
  let projected = '';

  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] !== '$' ||
      isEscapedCharacter(value, index) ||
      value[index - 1] === '$' ||
      value[index + 1] === '$'
    ) {
      projected += value[index];
      continue;
    }

    let closingIndex = index + 1;
    for (; closingIndex < value.length; closingIndex += 1) {
      if (
        value[closingIndex] === '$' &&
        !isEscapedCharacter(value, closingIndex) &&
        value[closingIndex - 1] !== '$' &&
        value[closingIndex + 1] !== '$'
      ) {
        break;
      }
    }
    if (closingIndex >= value.length) {
      projected += value[index];
      continue;
    }

    const body = value.slice(index + 1, closingIndex);
    if (!normalizeComparableText(body)) {
      projected += value[index];
      continue;
    }
    projected += body;
    fragments.push(body);
    index = closingIndex;
  }

  return { projected, fragments };
}

function projectCanonicalMath(value) {
  const lines = String(value || '').split('\n');
  const projectedLines = [];
  const fragments = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === '$$') {
      const closingIndex = lines.findIndex(
        (line, candidateIndex) => candidateIndex > index && line.trim() === '$$'
      );
      if (closingIndex !== -1) {
        const bodyLines = lines.slice(index + 1, closingIndex);
        const body = bodyLines.join('\n');
        if (normalizeComparableText(body)) fragments.push(body);
        projectedLines.push(...bodyLines);
        index = closingIndex;
        continue;
      }
    }

    const inline = projectInlineMath(lines[index]);
    projectedLines.push(inline.projected);
    fragments.push(...inline.fragments);
  }

  return { projected: projectedLines.join('\n'), fragments };
}

function projectInlineChildrenWithCanonicalMath(children) {
  const fragments = [];
  let projected = '';
  let textRun = '';
  const flushTextRun = () => {
    if (!textRun) return;
    const math = projectCanonicalMath(textRun);
    projected += math.projected;
    fragments.push(...math.fragments);
    textRun = '';
  };

  for (const child of children) {
    if (child.type === 'text') {
      textRun += child.content;
    } else if (child.type === 'softbreak' || child.type === 'hardbreak') {
      textRun += '\n';
    } else {
      flushTextRun();
      if (child.type === 'code_inline' || child.type === 'image') projected += child.content;
    }
  }
  flushTextRun();
  return { projected, fragments };
}

function hasSufficientIndependentFragmentContext(value) {
  const normalized = normalizeComparableText(value).replace(/\s/gu, '');
  return (
    [...normalized].length >= MIN_INDEPENDENT_FRAGMENT_CODE_POINTS &&
    /[\p{L}\p{N}]/u.test(normalized)
  );
}

function collectMarkdownTextFragments(value) {
  const fragments = [];
  for (const token of MARKDOWN_TEXT_EXTRACTOR.parse(String(value || ''), {})) {
    if (token.type !== 'inline' || !token.children) continue;
    const projectedText = token.children
      .map((child) => {
        if (['text', 'code_inline', 'image'].includes(child.type)) return child.content;
        if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
        return '';
      })
      .join('');
    if (hasSufficientIndependentFragmentContext(projectedText)) {
      fragments.push(projectedText);
    }
    const mathProjection = projectInlineChildrenWithCanonicalMath(token.children);
    const projectedMathText = normalizeComparableText(mathProjection.projected);
    const standaloneMath = mathProjection.fragments.some(
      (fragment) => normalizeComparableText(fragment) === projectedMathText
    );
    if (
      projectedMathText &&
      mathProjection.fragments.length > 0 &&
      (!standaloneMath || hasSufficientIndependentFragmentContext(projectedMathText))
    ) {
      fragments.push(mathProjection.projected);
    }
    for (const child of token.children) {
      if (
        child.type === 'image' &&
        hasSufficientIndependentFragmentContext(child.content)
      ) {
        fragments.push(child.content);
      }
    }
    if (token.children.some((child) => child.type === 'footnote_ref')) {
      for (const child of token.children) {
        if (
          child.type === 'text' &&
          hasSufficientIndependentFragmentContext(child.content)
        ) {
          fragments.push(child.content);
        }
      }
    }
  }
  return fragments;
}

function collectCanonicalMathFragments(value) {
  const fragments = [];
  for (const token of MARKDOWN_TEXT_EXTRACTOR.parse(String(value || ''), {})) {
    if (token.type === 'inline' && token.children) {
      fragments.push(
        ...projectInlineChildrenWithCanonicalMath(token.children).fragments.filter(
          hasSufficientIndependentFragmentContext
        )
      );
    }
  }

  return fragments;
}

function createProtectedFragments(value, source, visibility) {
  const normalizedValue = String(value || '').replace(/\r\n?/g, '\n');
  const fragments = new Map();
  const addFragment = (candidate) => {
    const comparableText = normalizeComparableText(candidate);
    if (!comparableText || /^:::(?:paid|internal)?$/u.test(comparableText)) return;
    const fragmentDigest = digest(comparableText);
    fragments.set(fragmentDigest, {
      source,
      visibility,
      digest: fragmentDigest,
      comparableText
    });
  };

  addFragment(normalizedValue);
  for (const candidate of normalizedValue.split(/\n\s*\n/u)) {
    addFragment(candidate);
  }

  for (const line of normalizedValue.split('\n')) {
    const listItem = line.match(
      /^\s*(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/u
    );
    if (listItem && hasSufficientIndependentFragmentContext(listItem[1])) {
      addFragment(listItem[1]);
    }
  }

  for (const fragment of collectMarkdownTextFragments(normalizedValue)) {
    addFragment(fragment);
  }
  for (const fragment of collectCanonicalMathFragments(normalizedValue)) {
    addFragment(fragment);
  }

  const lines = normalizedValue.split('\n');
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (fence) {
      if (isStandardFenceClose(lines[index], fence)) {
        const body = lines.slice(fence.bodyStartIndex, index).join('\n');
        addFragment(body);
        for (const candidate of body.split(/\n\s*\n/u)) addFragment(candidate);
        fence = null;
      }
      continue;
    }
    const open = detectStandardFenceOpen(lines[index]);
    if (open && !open.invalidInfoString) {
      fence = { ...open, bodyStartIndex: index + 1 };
    }
  }

  return [...fragments.values()];
}

function parseVisibilityRegions(content, sourcePath) {
  const normalizedContent = String(content || '')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n');
  const lines = normalizedContent.split('\n');
  const findings = [];
  const regions = [];
  const calloutBodies = [];
  let fence = null;
  let callout = null;
  let contentStartIndex = 0;

  const frontMatterClosingIndex = findFrontMatterClosingIndex(lines);
  if (frontMatterClosingIndex !== null) {
    const closingIndex = frontMatterClosingIndex;
    if (closingIndex === -1) {
      findings.push({
        code: 'unclosed_front_matter',
        severity: 'error',
        file: sourcePath,
        line: 1,
        message: 'YAML front matter is not closed; visibility boundaries cannot be determined.'
      });
      contentStartIndex = lines.length;
    } else {
      contentStartIndex = closingIndex + 1;
    }
  }

  const addFinding = (code, line, message) => {
    findings.push({ code, severity: 'error', file: sourcePath, line, message });
  };

  for (let index = contentStartIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (fence) {
      if (isStandardFenceClose(line, fence)) fence = null;
      continue;
    }

    const fenceOpen = detectStandardFenceOpen(line);
    if (fenceOpen) {
      if (fenceOpen.invalidInfoString) {
        addFinding(
          'invalid_code_fence',
          lineNumber,
          'Backtick code fence info strings cannot contain a backtick.'
        );
      } else {
        fence = { ...fenceOpen, line: lineNumber };
      }
      continue;
    }

    const delimiter = parseStandardCalloutDelimiter(line);
    if (!delimiter) continue;

    if (delimiter.indented) {
      addFinding(
        'invalid_callout_delimiter',
        lineNumber,
        'Standard callout delimiters must start at the beginning of the line.'
      );
      continue;
    }

    if (delimiter.kind === 'invalid') {
      addFinding(
        'invalid_callout_delimiter',
        lineNumber,
        'Standard callout delimiter is malformed.'
      );
      continue;
    }

    if (delimiter.kind === 'open') {
      if (!STANDARD_CALLOUT_TYPES.has(delimiter.type)) {
        addFinding(
          'unknown_callout_type',
          lineNumber,
          `Unknown standard callout type: ${delimiter.type}.`
        );
        continue;
      }
      if (callout) {
        addFinding(
          'nested_callout',
          lineNumber,
          `Standard callouts cannot be nested (inside ${callout.type} from line ${callout.line}).`
        );
        continue;
      }
      callout = { type: delimiter.type, line: lineNumber, bodyStartIndex: index + 1 };
      continue;
    }

    if (!callout) {
      addFinding(
        'orphan_callout_close',
        lineNumber,
        'Callout closing delimiter has no matching opening delimiter.'
      );
      continue;
    }

    const body = lines.slice(callout.bodyStartIndex, index).join('\n');
    calloutBodies.push(body);
    if (callout.type === 'paid' || callout.type === 'internal') {
      const comparableText = normalizeComparableText(body);
      regions.push({
        visibility: callout.type,
        startLine: callout.line,
        endLine: lineNumber,
        digest: digest(comparableText),
        comparableText,
        protectedFragments: createProtectedFragments(body, sourcePath, callout.type)
      });
    }
    callout = null;
  }

  if (fence) {
    addFinding(
      'unclosed_code_fence',
      fence.line,
      'Code fence is not closed; visibility boundaries cannot be determined.'
    );
  }
  if (callout) {
    addFinding(
      'unclosed_callout',
      callout.line,
      `Standard callout ${callout.type} is not closed.`
    );
  }

  return {
    findings,
    regions,
    calloutBodies,
    comparableText: normalizeComparableText(normalizedContent)
  };
}

function flattenStructure(metadata) {
  return [
    ...metadata.structure.frontmatter.map((entry) => ({ ...entry, section: 'frontmatter' })),
    ...metadata.structure.chapters.map((entry) => ({ ...entry, section: 'chapters' })),
    ...metadata.structure.backmatter.map((entry) => ({ ...entry, section: 'backmatter' }))
  ];
}

function visibilityAllowed(contentVisibility, editionVisibility) {
  const contentRank = VISIBILITY_RANK.get(contentVisibility);
  const editionRank = VISIBILITY_RANK.get(editionVisibility);
  return contentRank !== undefined && editionRank !== undefined && contentRank <= editionRank;
}

async function inspectArtifactPath(artifactPath) {
  const requestedPath = path.resolve(artifactPath);
  let rootStat;
  try {
    rootStat = await fs.lstat(requestedPath);
  } catch {
    throw new VisibilityValidationError(`Artifact path does not exist: ${requestedPath}`);
  }
  if (rootStat.isSymbolicLink()) {
    throw new VisibilityValidationError(`Artifact path must not be a symbolic link: ${requestedPath}`);
  }
  if ((await fs.realpath(requestedPath)) !== requestedPath) {
    throw new VisibilityValidationError(
      `Artifact path must not traverse a symbolic link: ${requestedPath}`
    );
  }

  if (rootStat.isFile()) {
    const extension = path.extname(requestedPath).toLowerCase();
    if (!ARTIFACT_TEXT_EXTENSIONS.has(extension)) {
      throw new VisibilityValidationError(
        `Artifact file extension is not supported for text scanning: ${extension || '(none)'}`
      );
    }
    return [{ absolutePath: requestedPath, reportPath: path.basename(requestedPath) }];
  }
  if (!rootStat.isDirectory()) {
    throw new VisibilityValidationError(`Artifact path must be a file or directory: ${requestedPath}`);
  }

  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) {
        throw new VisibilityValidationError(
          `Artifact tree must not contain symbolic links: ${path.relative(requestedPath, entryPath)}`
        );
      }
      if (stat.isDirectory()) {
        await visit(entryPath);
      } else if (stat.isFile() && ARTIFACT_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({
          absolutePath: entryPath,
          reportPath: path.relative(requestedPath, entryPath).replace(/\\/g, '/')
        });
      }
    }
  }

  await visit(requestedPath);
  return files;
}

function findRawProtectedDelimiter(content, allowFrontMatter, allowMarkdownFences) {
  const lines = normalizeArtifactBody(content, false).split('\n');
  let fence = null;
  const frontMatterClosingIndex = allowFrontMatter
    ? findFrontMatterClosingIndex(lines)
    : null;
  const contentStartIndex =
    frontMatterClosingIndex !== null && frontMatterClosingIndex >= 0
      ? frontMatterClosingIndex + 1
      : 0;

  for (let index = contentStartIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (allowMarkdownFences && fence) {
      if (isStandardFenceClose(line, fence)) fence = null;
      continue;
    }
    if (allowMarkdownFences) {
      const open = detectStandardFenceOpen(line);
      if (open && !open.invalidInfoString) {
        fence = open;
        continue;
      }
    }
    const delimiter = parseStandardCalloutDelimiter(line);
    if (
      delimiter?.kind === 'open' &&
      (delimiter.type === 'paid' || delimiter.type === 'internal')
    ) {
      return index + 1;
    }
  }
  return null;
}

async function scanArtifact(artifactPath, protectedFragments) {
  const files = await inspectArtifactPath(artifactPath);
  const findings = [];

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath, 'utf8');
    const fileExtension = path.extname(file.reportPath).toLowerCase();
    const allowFrontMatter = fileExtension === '.md';
    const allowMarkdownFences = fileExtension === '.md';
    const rawMarkerContent = HTML_MARKUP_EXTENSIONS.has(fileExtension)
      ? stripHtmlCodeElementContents(content)
      : content;
    const artifactComparables = createArtifactComparables(content, allowFrontMatter);
    const readerVisibleBase = MARKDOWN_TEXT_EXTRACTOR.utils.unescapeAll(
      stripHtmlCodeElementContents(
        normalizeArtifactBody(content, allowFrontMatter),
        { stripNonRendered: true }
      )
    );
    const readerVisibleCandidates = [
      stripHtmlTags(readerVisibleBase),
      stripHtmlTags(readerVisibleBase, '\n'),
      stripHtmlTags(readerVisibleBase, htmlBlockBoundary)
    ];
    const renderedDelimiterLine =
      readerVisibleCandidates
        .map((candidate) =>
          findRawProtectedDelimiter(candidate, false, allowMarkdownFences)
        )
        .find((line) => line !== null) ?? null;
    const delimiterLine =
      findRawProtectedDelimiter(
        rawMarkerContent,
        allowFrontMatter,
        allowMarkdownFences
      ) ||
      renderedDelimiterLine;
    if (delimiterLine !== null) {
      findings.push({
        code: 'raw_protected_marker_in_artifact',
        severity: 'error',
        file: file.reportPath,
        line: delimiterLine,
        message: 'Generated artifact contains a raw paid/internal callout marker.'
      });
    }

    for (const fragment of protectedFragments) {
      if (
        !fragment.comparableText ||
        !artifactComparables.some((candidate) => candidate.includes(fragment.comparableText))
      ) {
        continue;
      }
      findings.push({
        code: 'protected_content_in_artifact',
        severity: 'error',
        file: file.reportPath,
        line: 1,
        source: fragment.source,
        visibility: fragment.visibility,
        digest: fragment.digest,
        message: 'Generated artifact contains a protected source region.'
      });
    }
  }

  return { files: files.map((file) => file.reportPath), findings };
}

function sortFindings(findings) {
  return findings.sort((left, right) =>
    compareCodeUnits(String(left.file || ''), String(right.file || '')) ||
    Number(left.line || 0) - Number(right.line || 0) ||
    compareCodeUnits(String(left.code || ''), String(right.code || ''))
  );
}

export async function checkBookVisibility(bookDirectory, editionId, options = {}) {
  if (!editionId) throw new VisibilityValidationError('Edition ID is required.');

  const standardBook = await validateStandardBook(bookDirectory);
  const { bookRoot, metadata } = standardBook;
  const edition = metadata.editions.find((candidate) => candidate.id === editionId);
  if (!edition) throw new VisibilityValidationError(`Unknown edition: ${editionId}`);
  if (!edition.visibility || !edition.documents) {
    throw new VisibilityValidationError(
      `Edition ${editionId} must declare visibility and documents for visibility checking.`
    );
  }
  if (VISIBILITY_RANK.has(edition.id) && edition.id !== edition.visibility) {
    throw new VisibilityValidationError(
      `Reserved edition ID ${edition.id} must use matching visibility ${edition.id}.`
    );
  }

  const entries = flattenStructure(metadata);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const includedIds = new Set(edition.documents);
  const findings = [];
  const documents = [];
  const protectedFragments = [];
  let regionCount = 0;
  let protectedRegionCount = 0;

  for (const entry of entries) {
    if (!entry.visibility) {
      findings.push({
        code: 'missing_document_visibility',
        severity: 'error',
        file: entry.path,
        line: 1,
        message: `Structure entry ${entry.id} must declare visibility.`
      });
    }
  }

  for (const documentId of edition.documents) {
    const entry = entryById.get(documentId);
    if (!entry) {
      findings.push({
        code: 'unknown_edition_document',
        severity: 'error',
        file: 'book.yaml',
        line: 1,
        message: `Edition ${edition.id} references unknown structure ID: ${documentId}`
      });
    } else if (entry.visibility && !visibilityAllowed(entry.visibility, edition.visibility)) {
      findings.push({
        code: 'incompatible_document_visibility',
        severity: 'error',
        file: entry.path,
        line: 1,
        visibility: entry.visibility,
        message: `Edition ${edition.id} (${edition.visibility}) cannot include ${entry.id} (${entry.visibility}).`
      });
    }
  }

  for (const entry of entries) {
    const absolutePath = path.join(bookRoot, entry.path);
    const content = await fs.readFile(absolutePath, 'utf8');
    const parsed = parseVisibilityRegions(content, entry.path);
    findings.push(...parsed.findings);
    regionCount += parsed.regions.length;

    const included = includedIds.has(entry.id);
    const protectedRegions = [];

    if (!included) {
      const documentVisibility = entry.visibility || 'unknown';
      const documentDigest = digest(parsed.comparableText);
      protectedFragments.push(
        ...createProtectedFragments(content, entry.path, documentVisibility)
      );
      for (const body of parsed.calloutBodies) {
        protectedFragments.push(
          ...createProtectedFragments(body, entry.path, documentVisibility)
        );
      }
      protectedRegions.push({
        visibility: documentVisibility,
        startLine: 1,
        endLine: content.replace(/\r\n?/g, '\n').split('\n').length,
        digest: documentDigest,
        decision: 'exclude-document'
      });
    }

    for (const region of parsed.regions) {
      const allowed = included && visibilityAllowed(region.visibility, edition.visibility);
      if (!allowed) {
        protectedRegionCount += 1;
        protectedFragments.push(...region.protectedFragments);
      }
      protectedRegions.push({
        visibility: region.visibility,
        startLine: region.startLine,
        endLine: region.endLine,
        digest: region.digest,
        decision: allowed ? 'include' : 'exclude-block'
      });
    }

    documents.push({
      id: entry.id,
      section: entry.section,
      path: entry.path,
      visibility: entry.visibility || 'unknown',
      decision: included ? 'include' : 'exclude-document',
      protectedRegions
    });
  }

  let artifact = null;
  if (options.artifactPath) {
    const uniqueFragments = [
      ...new Map(
        protectedFragments.map((fragment) => [
          `${fragment.source}\u0000${fragment.visibility}\u0000${fragment.digest}`,
          fragment
        ])
      ).values()
    ];
    artifact = await scanArtifact(options.artifactPath, uniqueFragments);
    findings.push(...artifact.findings);
  }

  sortFindings(findings);
  const includedDocumentCount = documents.filter((document) => document.decision === 'include').length;
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const orderedDocuments = [
    ...edition.documents.map((documentId) => documentById.get(documentId)),
    ...documents.filter((document) => !includedIds.has(document.id))
  ];

  return {
    schema_version: 1,
    visibility_contract_version: VISIBILITY_CONTRACT_VERSION,
    book: metadata.id,
    edition: {
      id: edition.id,
      visibility: edition.visibility,
      status: edition.status
    },
    summary: {
      safe: findings.length === 0,
      documents: documents.length,
      includedDocuments: includedDocumentCount,
      excludedDocuments: documents.length - includedDocumentCount,
      visibilityRegions: regionCount,
      protectedRegions: documents.length - includedDocumentCount + protectedRegionCount,
      artifactFiles: artifact ? artifact.files.length : 0,
      findings: findings.length
    },
    documents: orderedDocuments,
    artifact: artifact ? { files: artifact.files } : null,
    findings
  };
}
