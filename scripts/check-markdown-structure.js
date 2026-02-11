#!/usr/bin/env node

import path from 'node:path';

import fs from 'fs-extra';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import YAML from 'yaml';

function normalizeFailOn(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'none' || v === 'warn' || v === 'error') return v;
  return null;
}

function shouldFail(report, failOn) {
  const errors = report.summary.errors;
  const warnings = report.summary.warnings;
  const fileReadErrors = report.summary.fileReadErrors;

  if (failOn === 'none') return false;
  if (failOn === 'warn') return errors + warnings + fileReadErrors > 0;
  if (failOn === 'error') return errors + fileReadErrors > 0;
  return false;
}

function findFrontMatter(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { hasFrontMatter: false, bodyStartLine: 1 };
  }

  if (String(lines[0]).trim() !== '---') {
    return { hasFrontMatter: false, bodyStartLine: 1 };
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = String(lines[i]).trim();
    if (line === '---' || line === '...') {
      return {
        hasFrontMatter: true,
        bodyStartLine: i + 2,
        frontMatterStartLine: 1,
        frontMatterEndLine: i + 1,
        frontMatterRaw: lines.slice(1, i).join('\n')
      };
    }
  }

  return {
    hasFrontMatter: true,
    bodyStartLine: lines.length + 1,
    frontMatterStartLine: 1,
    frontMatterEndLine: null,
    frontMatterRaw: lines.slice(1).join('\n'),
    frontMatterUnclosed: true
  };
}

function detectFenceOpen(line) {
  const m = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return null;

  const infoString = String(m[2] || '').trim();
  const language = infoString.split(/\s+/).filter(Boolean)[0] || '';

  return {
    markerChar: m[1][0],
    markerLen: m[1].length,
    infoString,
    language: language.toLowerCase()
  };
}

function isFenceClose(line, fence) {
  if (!fence) return false;
  const m = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  if (m[1][0] !== fence.markerChar) return false;
  return m[1].length >= fence.markerLen;
}

function parseHeading(line) {
  const m = String(line || '').match(/^\s{0,3}(#{1,6})\s+(.+)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

class MarkdownStructureRunner {
  constructor({ maxIssues }) {
    this.maxIssues = maxIssues;
    this.issues = [];
    this.fileIssues = new Map();
    this.fileErrors = [];
    this.summary = {
      scannedFiles: 0,
      filesWithIssues: 0,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      fileReadErrors: 0
    };
  }

  addIssue(issue) {
    this.issues.push(issue);
    const list = this.fileIssues.get(issue.file) || [];
    list.push(issue);
    this.fileIssues.set(issue.file, list);

    if (issue.severity === 'error') {
      this.summary.errors += 1;
    } else {
      this.summary.warnings += 1;
    }
  }

  async scanDirectory(directory, { pattern, ignore }) {
    const baseDir = path.resolve(directory);
    const files = await glob(pattern, {
      cwd: baseDir,
      ignore,
      windowsPathsNoEscape: true,
      absolute: true
    });

    this.summary.scannedFiles = files.length;
    console.log(chalk.blue(`Checking markdown structure in ${baseDir}...`));
    console.log(chalk.gray(`Found ${files.length} markdown files`));

    for (const filePath of files) {
      await this.scanFile(filePath, baseDir);
    }

    this.summary.totalIssues = this.issues.length;
    this.summary.fileReadErrors = this.fileErrors.length;
    this.summary.filesWithIssues = this.fileIssues.size;

    return {
      summary: this.summary,
      issues: this.issues,
      fileDetails: Object.fromEntries(this.fileIssues),
      fileReadErrors: this.fileErrors
    };
  }

  async scanFile(filePath, baseDir) {
    const relativeFile = path.relative(baseDir, filePath).replace(/\\/g, '/');
    let content;

    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      this.fileErrors.push({ file: relativeFile, message: error.message });
      this.addIssue({
        file: relativeFile,
        line: 1,
        column: 1,
        kind: 'file_read_error',
        severity: 'error',
        message: `Failed to read file: ${error.message}`
      });
      console.warn(chalk.yellow(`Warning: Failed to read "${relativeFile}": ${error.message}`));
      return;
    }

    const lines = content.split(/\r?\n/);
    const frontMatter = findFrontMatter(lines);
    let bodyStartLine = frontMatter.bodyStartLine;

    if (frontMatter.hasFrontMatter && frontMatter.frontMatterUnclosed) {
      this.addIssue({
        file: relativeFile,
        line: 1,
        column: 1,
        kind: 'unclosed_front_matter',
        severity: 'error',
        message: 'Front Matter is opened with "---" but not closed.'
      });
      bodyStartLine = lines.length + 1;
    } else if (frontMatter.hasFrontMatter) {
      const doc = YAML.parseDocument(frontMatter.frontMatterRaw || '');
      if (Array.isArray(doc.errors) && doc.errors.length > 0) {
        const firstError = doc.errors[0];
        const relativeLine = firstError?.linePos?.[0]?.line || 1;
        const line = frontMatter.frontMatterStartLine + relativeLine;
        this.addIssue({
          file: relativeFile,
          line,
          column: 1,
          kind: 'invalid_front_matter',
          severity: 'error',
          message: firstError.message || 'Invalid YAML in Front Matter.'
        });
      }
    }

    let inFence = false;
    let fence = null;
    let fenceStartLine = null;
    let previousHeadingLevel = null;
    let h1Count = 0;

    for (let i = bodyStartLine - 1; i < lines.length; i += 1) {
      const lineText = lines[i];
      const lineNumber = i + 1;

      if (!inFence) {
        const open = detectFenceOpen(lineText);
        if (open) {
          inFence = true;
          fence = open;
          fenceStartLine = lineNumber;

          if (!open.language) {
            this.addIssue({
              file: relativeFile,
              line: lineNumber,
              column: 1,
              kind: 'missing_fence_language',
              severity: 'warning',
              message: 'Code fence has no language specifier.'
            });
          }
          continue;
        }

        const heading = parseHeading(lineText);
        if (!heading) continue;

        if (heading.level === 1) {
          h1Count += 1;
        }

        if (previousHeadingLevel !== null && heading.level > previousHeadingLevel + 1) {
          this.addIssue({
            file: relativeFile,
            line: lineNumber,
            column: 1,
            kind: 'heading_level_skip',
            severity: 'warning',
            message: `Heading level jumps from h${previousHeadingLevel} to h${heading.level}.`
          });
        }

        previousHeadingLevel = heading.level;
        continue;
      }

      if (isFenceClose(lineText, fence)) {
        inFence = false;
        fence = null;
        fenceStartLine = null;
      }
    }

    if (inFence) {
      this.addIssue({
        file: relativeFile,
        line: fenceStartLine || lines.length,
        column: 1,
        kind: 'unclosed_code_fence',
        severity: 'error',
        message: 'Code fence is not closed.'
      });
    }

    if (h1Count > 1) {
      this.addIssue({
        file: relativeFile,
        line: bodyStartLine,
        column: 1,
        kind: 'multiple_h1',
        severity: 'warning',
        message: `Multiple h1 headings found (${h1Count}).`
      });
    }
  }
}

function printSummary(report, maxIssues) {
  console.log('\n' + chalk.bold('Markdown Structure Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Files checked: ${report.summary.scannedFiles}`);
  console.log(`Files with issues: ${report.summary.filesWithIssues}`);
  if (report.summary.fileReadErrors > 0) {
    console.log(chalk.yellow(`Files failed to read: ${report.summary.fileReadErrors}`));
  }
  console.log(`Total issues: ${report.summary.totalIssues} (errors: ${report.summary.errors}, warnings: ${report.summary.warnings})`);

  if (!report.issues || report.issues.length === 0) {
    console.log(chalk.green('No markdown structure issues found.'));
    return;
  }

  console.log();
  const limit = Math.max(0, Number(maxIssues) || 0);
  const slice = limit > 0 ? report.issues.slice(0, limit) : report.issues;

  for (const issue of slice) {
    const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
    console.log(color(`${issue.file}:${issue.line}:${issue.column} ${issue.kind}: ${issue.message}`));
  }
  if (limit > 0 && report.issues.length > limit) {
    console.log(chalk.gray(`... and ${report.issues.length - limit} more`));
  }
}

const program = new Command();

program
  .name('check-markdown-structure')
  .description('Check markdown structural risks (front matter, headings, code fences)')
  .version('1.0.0')
  .argument('[directory]', 'Directory to check', '.')
  .option('-p, --pattern <pattern>', 'Glob pattern for files', '**/*.md')
  .option('-i, --ignore <patterns...>', 'Patterns to ignore', [
    'node_modules/**',
    '**/node_modules/**',
    'book-formatter/**',
    '**/book-formatter/**',
    'examples/**',
    '**/examples/**',
    '.git/**',
    '**/.git/**',
    '_site/**',
    '**/_site/**',
    'vendor/**',
    '**/vendor/**',
    'templates/**',
    '**/templates/**'
  ])
  .option('--fail-on <level>', 'Fail on: none|warn|error', 'error')
  .option('--max-issues <n>', 'Max issues to print (0=all)', '200')
  .option('-o, --output <file>', 'Save report to file (JSON)')
  .action(async (directory, options) => {
    const failOn = normalizeFailOn(options.failOn);
    if (!failOn) {
      console.error(chalk.red(`Invalid --fail-on value: ${options.failOn} (expected: none|warn|error)`));
      process.exit(2);
    }

    try {
      const runner = new MarkdownStructureRunner({ maxIssues: options.maxIssues });
      const report = await runner.scanDirectory(directory, {
        pattern: options.pattern,
        ignore: options.ignore
      });

      printSummary(report, options.maxIssues);

      if (options.output) {
        await fs.writeJson(path.resolve(options.output), report, { spaces: 2 });
        console.log(chalk.gray(`Report saved to ${options.output}`));
      }

      process.exit(shouldFail(report, failOn) ? 1 : 0);
    } catch (error) {
      if (options.output) {
        const fatalReport = {
          summary: {
            scannedFiles: 0,
            filesWithIssues: 0,
            totalIssues: 0,
            errors: 1,
            warnings: 0,
            fileReadErrors: 0
          },
          issues: [],
          fileDetails: {},
          fileReadErrors: [],
          fatalError: String(error?.message || error)
        };
        try {
          await fs.writeJson(path.resolve(options.output), fatalReport, { spaces: 2 });
          console.log(chalk.gray(`Report saved to ${options.output}`));
        } catch {
          // Ignore secondary output write errors and keep original failure as primary signal.
        }
      }
      console.error(chalk.red(`Error: ${error?.message || error}`));
      process.exit(1);
    }
  });

program.parse();
