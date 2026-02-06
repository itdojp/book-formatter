#!/usr/bin/env node

import path from 'node:path';

import fs from 'fs-extra';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import MarkdownIt from 'markdown-it';

/**
 * Layout risk scanner (Markdown)
 * - Detects potential layout issues that are hard to catch by build/link checks:
 *   - Very long text lines / code lines (horizontal overflow risk)
 *   - Wide tables (many columns)
 *   - Large local images (slow load / layout shift risk)
 *   - Missing local images referenced via HTML <img> (markdown image links are covered by check-links)
 *
 * Notes:
 * - This tool is intentionally "risk based" and is best used as a report for manual review.
 * - Default thresholds are conservative and should be tuned per series policy.
 */

function normalizeFailOn(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'none' || v === 'warn' || v === 'error') return v;
  return null;
}

function shouldFail(report, failOn) {
  const errors = report.summary.errors;
  const warnings = report.summary.warnings;

  if (failOn === 'none') return false;
  if (failOn === 'warn') return errors + warnings > 0;
  if (failOn === 'error') return errors > 0;
  return false;
}

function resolveRoots(scanDir) {
  const baseDir = path.resolve(scanDir);
  const docsConfigInDocs = path.join(baseDir, 'docs', '_config.yml');
  const configInBase = path.join(baseDir, '_config.yml');

  let siteRootDir = baseDir;
  let repoRootDir = baseDir;

  if (fs.existsSync(docsConfigInDocs)) {
    siteRootDir = path.join(baseDir, 'docs');
    repoRootDir = baseDir;
  } else if (path.basename(baseDir) === 'docs' && fs.existsSync(configInBase)) {
    siteRootDir = baseDir;
    repoRootDir = path.dirname(baseDir);
  }

  return {
    baseDir,
    siteRootDir,
    repoRootDir,
    repoName: path.basename(repoRootDir)
  };
}

function normalizePathLikeLink(raw) {
  if (!raw) return '';
  let url = String(raw).trim();

  // Drop surrounding angle brackets (common in reference links).
  if (url.startsWith('<') && url.endsWith('>')) {
    url = url.slice(1, -1).trim();
  }

  // Strip query string / hash.
  const [withoutHash] = url.split('#', 1);
  const [withoutQuery] = withoutHash.split('?', 1);

  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep as-is
  }
  return decoded.trim();
}

function isExternalUrl(url) {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('mailto:') ||
    url.startsWith('data:')
  );
}

function resolveLocalAssetPath(url, sourceFile, roots) {
  const cleaned = normalizePathLikeLink(url);
  if (!cleaned || isExternalUrl(cleaned)) return null;
  // Liquid / template expressions are resolved at build time; skip static checks.
  if (cleaned.includes('{{') || cleaned.includes('{%')) return null;

  const sourceDir = path.dirname(sourceFile);

  if (cleaned.startsWith('/')) {
    // Support baseurl-prefixed assets: /<repoName>/assets/... -> /assets/...
    const normalized = cleaned.replace(/^\/+/, '/');
    const repoPrefix = `/${roots.repoName}`;

    let relativeFromRoot = normalized.replace(/^\/+/, '');
    if (normalized === repoPrefix || normalized === `${repoPrefix}/`) {
      relativeFromRoot = '';
    } else if (normalized.startsWith(`${repoPrefix}/`)) {
      relativeFromRoot = normalized.slice((`${repoPrefix}/`).length);
    }

    return path.join(roots.siteRootDir, relativeFromRoot);
  }

  return path.resolve(sourceDir, cleaned);
}

function findFencedCodeMarker(line) {
  // Capture ```lang or ~~~lang; ignore indentation.
  const m = String(line || '').match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  return { fence: m[1], markerChar: m[1][0], markerLen: m[1].length };
}

function isFenceClose(line, state) {
  if (!state || !state.inFence) return false;
  const m = String(line || '').match(/^\s*(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  const fence = m[1];
  if (fence[0] !== state.markerChar) return false;
  return fence.length >= state.markerLen;
}

function looksLikeTableDelimiter(line) {
  // Matches Markdown table delimiter row like:
  // | --- | ---: | :---: |
  const s = String(line || '').trim();
  if (!s) return false;
  if (!s.includes('-')) return false;
  // must be mostly pipes/colons/dashes/spaces
  if (!/^[\s|:\-]+$/.test(s)) return false;
  // must contain at least one dash-run
  return /-{3,}/.test(s) && s.includes('|');
}

function countTableColumns(rowLine) {
  // Best-effort: split by pipes, ignore leading/trailing pipes.
  const s = String(rowLine || '').trim();
  if (!s.includes('|')) return 0;
  const trimmed = s.replace(/^\|/, '').replace(/\|$/, '');
  const cols = trimmed.split('|');
  return cols.length;
}

function clampSnippet(line, maxLen = 120) {
  const s = String(line || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

class LayoutRiskScanner {
  constructor({ thresholds, maxIssues }) {
    this.thresholds = thresholds;
    this.maxIssues = maxIssues;

    this.issues = [];
    this.fileReadErrors = [];

    this.summary = {
      scannedFiles: 0,
      filesWithIssues: 0,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      fileReadErrors: 0,
      tableBlocks: 0,
      tableRows: 0,
      maxTableCols: 0,
      codeBlocks: 0,
      maxTextLineLen: 0,
      longTextLines: 0,
      maxCodeLineLen: 0,
      longCodeLines: 0,
      imagesTotal: 0,
      imagesLocal: 0,
      imagesLocalMissing: 0,
      imagesLocalOverLarge: 0,
      largestLocalImageBytes: 0
    };

    this.fileDetails = new Map();

    this.md = new MarkdownIt({
      linkify: false,
      html: true
    });
  }

  pushIssue(issue) {
    this.summary.totalIssues += 1;
    if (issue.severity === 'error') this.summary.errors += 1;
    if (issue.severity === 'warning') this.summary.warnings += 1;

    if (this.issues.length < this.maxIssues) {
      this.issues.push(issue);
    }
  }

  async scanDirectory(directory, { pattern, ignore }) {
    const roots = resolveRoots(directory);

    const files = await glob(pattern, {
      cwd: roots.baseDir,
      ignore,
      windowsPathsNoEscape: true,
      absolute: true
    });

    console.log(chalk.blue(`📐 Scanning layout risks in ${roots.baseDir}...`));
    console.log(chalk.gray(`Found ${files.length} markdown files`));

    for (const filePath of files) {
      await this.scanFile(filePath, roots);
    }

    // Final summary derived values
    this.summary.scannedFiles = files.length;
    this.summary.fileReadErrors = this.fileReadErrors.length;

    const report = {
      thresholds: this.thresholds,
      summary: this.summary,
      issuesTruncated: this.issues.length < this.summary.totalIssues,
      issues: this.issues,
      fileDetails: Object.fromEntries(this.fileDetails),
      fileReadErrors: this.fileReadErrors
    };

    this.printSummary(report, roots);
    return report;
  }

  async scanFile(filePath, roots) {
    const relativeFile = path
      .relative(roots.baseDir, filePath)
      .replace(/\\/g, '/');

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      this.fileReadErrors.push({ file: relativeFile, message: error.message });
      this.pushIssue({
        severity: 'error',
        kind: 'file_read_error',
        file: relativeFile,
        line: 1,
        column: 1,
        message: error.message
      });
      return;
    }

    const perFile = {
      tableBlocks: 0,
      tableRows: 0,
      maxTableCols: 0,
      codeBlocks: 0,
      maxTextLineLen: 0,
      longTextLines: 0,
      maxCodeLineLen: 0,
      longCodeLines: 0,
      imagesTotal: 0,
      imagesLocal: 0,
      imagesLocalMissing: 0,
      imagesLocalOverLarge: 0,
      largestLocalImageBytes: 0
    };

    const fileHadIssueBefore = this.summary.totalIssues;

    // 1) Line-based scan (code fences, text line lengths, tables)
    const lines = content.split(/\r?\n/);
    const fenceState = { inFence: false, markerChar: null, markerLen: 0 };

    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const line = lines[i];

      if (!fenceState.inFence) {
        const fence = findFencedCodeMarker(line);
        if (fence) {
          fenceState.inFence = true;
          fenceState.markerChar = fence.markerChar;
          fenceState.markerLen = fence.markerLen;
          perFile.codeBlocks += 1;
          continue;
        }

        // Table detection: header row + delimiter row.
        if (line.includes('|') && i + 1 < lines.length && looksLikeTableDelimiter(lines[i + 1])) {
          perFile.tableBlocks += 1;

          // Header row counts as a table row in risk metrics.
          const headerCols = countTableColumns(line);
          perFile.maxTableCols = Math.max(perFile.maxTableCols, headerCols);
          perFile.tableRows += 1;

          // Skip delimiter row at i+1
          i += 1;

          // Consume subsequent rows until blank line or non-table-ish line.
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (!nextLine || !nextLine.includes('|')) break;
            const cols = countTableColumns(nextLine);
            if (cols <= 1) break;
            perFile.maxTableCols = Math.max(perFile.maxTableCols, cols);
            perFile.tableRows += 1;
            i += 1;
          }
          continue;
        }

        // Text line length scan (outside code fences)
        const textLen = line.length;
        perFile.maxTextLineLen = Math.max(perFile.maxTextLineLen, textLen);
        if (textLen > this.thresholds.maxTextLineLength) {
          perFile.longTextLines += 1;
          this.pushIssue({
            severity: 'warning',
            kind: 'long_text_line',
            file: relativeFile,
            line: lineNo,
            column: 1,
            message: `Text line length ${textLen} exceeds ${this.thresholds.maxTextLineLength}`,
            meta: { length: textLen, snippet: clampSnippet(line) }
          });
        }
      } else {
        if (isFenceClose(line, fenceState)) {
          fenceState.inFence = false;
          fenceState.markerChar = null;
          fenceState.markerLen = 0;
          continue;
        }

        const codeLen = line.length;
        perFile.maxCodeLineLen = Math.max(perFile.maxCodeLineLen, codeLen);
        if (codeLen > this.thresholds.maxCodeLineLength) {
          perFile.longCodeLines += 1;
          this.pushIssue({
            severity: 'warning',
            kind: 'long_code_line',
            file: relativeFile,
            line: lineNo,
            column: 1,
            message: `Code line length ${codeLen} exceeds ${this.thresholds.maxCodeLineLength}`,
            meta: { length: codeLen, snippet: clampSnippet(line) }
          });
        }
      }
    }

    // 2) Image scan (markdown image tokens + HTML <img> in html_inline/html_block)
    const imageSrcs = [];
    const extractImgSrcFromHtml = (html) => {
      const raw = String(html || '');
      // Accept src= in three styles: src="...", src='...', src=unquoted
      for (const m of raw.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const src = m[1] || m[2] || m[3];
        if (src) imageSrcs.push(src);
      }
    };
    try {
      const tokens = this.md.parse(content, {});
      for (const token of tokens) {
        if (token.type === 'inline' && Array.isArray(token.children)) {
          for (const child of token.children) {
            if (child.type === 'image') {
              const src = child.attrGet('src');
              if (src) imageSrcs.push(src);
            }
            if (child.type === 'html_inline') {
              extractImgSrcFromHtml(child.content);
            }
          }
        }
        if (token.type === 'html_block') {
          extractImgSrcFromHtml(token.content);
        }
      }
    } catch (error) {
      // Non-fatal: markdown-it parse errors are rare, but keep scanning other files.
      this.pushIssue({
        severity: 'warning',
        kind: 'markdown_parse_warning',
        file: relativeFile,
        line: 1,
        column: 1,
        message: `Failed to parse markdown for image scan: ${error.message}`
      });
    }

    // De-dup within the file to avoid double-counts for repeated images.
    const seenSrc = new Set();
    for (const src of imageSrcs) {
      const s = String(src || '').trim();
      if (!s) continue;
      if (seenSrc.has(s)) continue;
      seenSrc.add(s);

      perFile.imagesTotal += 1;

      const localPath = resolveLocalAssetPath(s, filePath, roots);
      if (!localPath) continue;

      perFile.imagesLocal += 1;
      try {
        const stat = await fs.stat(localPath);
        if (stat.isFile()) {
          const bytes = stat.size;
          perFile.largestLocalImageBytes = Math.max(perFile.largestLocalImageBytes, bytes);
          if (bytes > this.thresholds.largeImageBytes) {
            perFile.imagesLocalOverLarge += 1;
            this.pushIssue({
              severity: 'warning',
              kind: 'large_image',
              file: relativeFile,
              line: 1,
              column: 1,
              message: `Local image is large (${bytes} bytes > ${this.thresholds.largeImageBytes})`,
              meta: { src: s, localPath: path.relative(roots.baseDir, localPath).replace(/\\/g, '/'), bytes }
            });
          }
        }
      } catch (error) {
        perFile.imagesLocalMissing += 1;
        this.pushIssue({
          severity: 'error',
          kind: 'missing_image',
          file: relativeFile,
          line: 1,
          column: 1,
          message: `Local image not found: ${s}`,
          meta: { src: s, localPath: path.relative(roots.baseDir, localPath).replace(/\\/g, '/') }
        });
      }
    }

    // Per-file wide table warning (once per file) to avoid overwhelming logs.
    if (perFile.maxTableCols > this.thresholds.maxTableCols) {
      this.pushIssue({
        severity: 'warning',
        kind: 'wide_table',
        file: relativeFile,
        line: 1,
        column: 1,
        message: `Max table columns ${perFile.maxTableCols} exceeds ${this.thresholds.maxTableCols}`,
        meta: { maxTableCols: perFile.maxTableCols }
      });
    }

    // Aggregate into global summary
    this.summary.tableBlocks += perFile.tableBlocks;
    this.summary.tableRows += perFile.tableRows;
    this.summary.maxTableCols = Math.max(this.summary.maxTableCols, perFile.maxTableCols);
    this.summary.codeBlocks += perFile.codeBlocks;
    this.summary.maxTextLineLen = Math.max(this.summary.maxTextLineLen, perFile.maxTextLineLen);
    this.summary.longTextLines += perFile.longTextLines;
    this.summary.maxCodeLineLen = Math.max(this.summary.maxCodeLineLen, perFile.maxCodeLineLen);
    this.summary.longCodeLines += perFile.longCodeLines;
    this.summary.imagesTotal += perFile.imagesTotal;
    this.summary.imagesLocal += perFile.imagesLocal;
    this.summary.imagesLocalMissing += perFile.imagesLocalMissing;
    this.summary.imagesLocalOverLarge += perFile.imagesLocalOverLarge;
    this.summary.largestLocalImageBytes = Math.max(
      this.summary.largestLocalImageBytes,
      perFile.largestLocalImageBytes
    );

    this.fileDetails.set(relativeFile, perFile);

    if (this.summary.totalIssues > fileHadIssueBefore) {
      this.summary.filesWithIssues += 1;
    }
  }

  printSummary(report, roots) {
    console.log('\n' + chalk.bold('Layout Risk Scan Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Scanned files: ${report.summary.scannedFiles}`);
    if (report.summary.fileReadErrors > 0) {
      console.log(chalk.red(`File read errors: ${report.summary.fileReadErrors}`));
    }
    console.log(`Issues: ${report.summary.totalIssues} (errors: ${report.summary.errors}, warnings: ${report.summary.warnings})`);
    console.log(`Tables: blocks=${report.summary.tableBlocks}, rows=${report.summary.tableRows}, maxCols=${report.summary.maxTableCols}`);
    console.log(`Code fences: ${report.summary.codeBlocks}, maxCodeLineLen=${report.summary.maxCodeLineLen}, longCodeLines=${report.summary.longCodeLines}`);
    console.log(`Text: maxLineLen=${report.summary.maxTextLineLen}, longTextLines=${report.summary.longTextLines}`);
    console.log(`Images: total=${report.summary.imagesTotal}, local=${report.summary.imagesLocal}, missing=${report.summary.imagesLocalMissing}, large=${report.summary.imagesLocalOverLarge}`);
    if (report.summary.largestLocalImageBytes > 0) {
      console.log(`Largest local image: ${report.summary.largestLocalImageBytes} bytes`);
    }

    if (report.summary.totalIssues === 0) {
      console.log(chalk.green('No layout risks detected (based on current thresholds).'));
      return;
    }

    // Print a small subset of issues for quick navigation.
    const top = report.issues.slice(0, 25);
    console.log('\n' + chalk.gray(`Top ${top.length} issues (max ${this.maxIssues}, total ${report.summary.totalIssues})`));
    for (const issue of top) {
      const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
      const loc = `${issue.file}:${issue.line}:${issue.column}`;
      console.log(color(`${loc} ${issue.kind}: ${issue.message}`));
      if (issue.meta && issue.meta.snippet) {
        console.log(chalk.gray(`  ${issue.meta.snippet}`));
      }
      if (issue.kind === 'large_image' && issue.meta && issue.meta.localPath) {
        console.log(chalk.gray(`  image: ${issue.meta.localPath}`));
      }
      if (issue.kind === 'missing_image' && issue.meta && issue.meta.localPath) {
        console.log(chalk.gray(`  expected: ${issue.meta.localPath}`));
      }
    }

    if (report.issuesTruncated) {
      console.log(chalk.gray(`\nNote: issues list is truncated. Use --max-issues to increase.`));
    }

    // Helpful hint for GitHub Pages baseurl cases.
    if (roots.repoName) {
      console.log(chalk.gray(`\nHint: absolute links like "/${roots.repoName}/assets/..." are resolved under the scan root.`));
    }
  }
}

const program = new Command();

program
  .name('check-layout-risk')
  .description('Scan markdown files for layout risk signals (long lines, wide tables, large images)')
  .version('1.0.0')
  .argument('[directory]', 'Directory to check', '.')
  .option('-p, --pattern <pattern>', 'Glob pattern for files', '**/*.md')
  .option('-i, --ignore <patterns...>', 'Patterns to ignore', [
    'node_modules/**',
    '**/node_modules/**',
    'book-formatter/**',
    '**/book-formatter/**',
    'templates/**',
    '**/templates/**',
    'examples/**',
    '**/examples/**'
  ])
  .option('--max-text-line <n>', 'Warn when text line length exceeds this value', (v) => Number(v), 160)
  .option('--max-code-line <n>', 'Warn when code line length exceeds this value', (v) => Number(v), 200)
  .option('--max-table-cols <n>', 'Warn when a table has more than this number of columns', (v) => Number(v), 10)
  .option('--large-image-bytes <n>', 'Warn when a local image exceeds this size (bytes)', (v) => Number(v), 1_000_000)
  .option('--max-issues <n>', 'Max issues to include in the report', (v) => Number(v), 200)
  .option('-o, --output <file>', 'Save report to file (JSON)')
  .option('--fail-on <level>', 'Fail level: error|warn|none', 'none')
  .action(async (directory, options) => {
    const failOn = normalizeFailOn(options.failOn);
    if (!failOn) {
      console.error(chalk.red(`Invalid --fail-on value: ${options.failOn}`));
      process.exit(2);
    }

    const thresholds = {
      maxTextLineLength: Number.isFinite(options.maxTextLine) ? options.maxTextLine : 160,
      maxCodeLineLength: Number.isFinite(options.maxCodeLine) ? options.maxCodeLine : 200,
      maxTableCols: Number.isFinite(options.maxTableCols) ? options.maxTableCols : 10,
      largeImageBytes: Number.isFinite(options.largeImageBytes) ? options.largeImageBytes : 1_000_000
    };
    const maxIssues = Number.isFinite(options.maxIssues) ? options.maxIssues : 200;

    const scanner = new LayoutRiskScanner({ thresholds, maxIssues });

    try {
      const report = await scanner.scanDirectory(directory, {
        pattern: options.pattern,
        ignore: options.ignore
      });

      if (options.output) {
        await fs.writeJson(path.resolve(options.output), report, { spaces: 2 });
        console.log(chalk.blue(`\nReport saved: ${options.output}`));
      }

      process.exit(shouldFail(report, failOn) ? 1 : 0);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));

      // Best-effort: write an error report so CI can still upload an artifact.
      if (options.output) {
        const errorReport = {
          error: message,
          stack: error && error.stack ? error.stack : undefined,
          directory,
          thresholds,
          failedAt: new Date().toISOString()
        };

        try {
          await fs.writeJson(path.resolve(options.output), errorReport, { spaces: 2 });
          console.log(chalk.blue(`\nError report saved: ${options.output}`));
        } catch (writeErr) {
          const writeMessage = writeErr && writeErr.message ? writeErr.message : String(writeErr);
          console.error(chalk.red(`Failed to write error report: ${writeMessage}`));
        }
      }
      process.exit(1);
    }
  });

program.parse();
