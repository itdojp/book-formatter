#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import { UnicodeChecker } from '../src/UnicodeChecker.js';

/**
 * Unicode品質チェッカー（Markdown向け）
 * - 不可視文字、互換漢字、異体字セレクタ、全角英数字などを検出
 * - 例外は allowlist（JSON）で管理
 */

function loadAllowlistIfExists(allowlistPath) {
  if (!allowlistPath) return null;
  const resolved = path.resolve(allowlistPath);
  try {
    if (!fs.existsSync(resolved)) return null;
    return fs.readJsonSync(resolved);
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Failed to load allowlist from "${resolved}": ${error.message}`));
    return null;
  }
}

function findDefaultAllowlist(baseDir) {
  const candidates = [
    path.join(baseDir, '.book-formatter', 'unicode-allowlist.json'),
    path.join(baseDir, 'unicode-allowlist.json')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

class UnicodeQualityRunner {
  constructor(options = {}) {
    this.options = options;
    this.issues = [];
    this.fileIssues = new Map();
    this.fileErrors = [];
  }

  async scanDirectory(directory, scanOptions) {
    const { pattern, ignore, allowlistPath } = scanOptions;

    const baseDir = path.resolve(directory);
    const allowlistFile = allowlistPath ? path.resolve(allowlistPath) : findDefaultAllowlist(baseDir);
    const allowlist = loadAllowlistIfExists(allowlistFile);

    const checker = new UnicodeChecker({ allowlist });

    console.log(chalk.blue(`Checking unicode in ${baseDir}...`));
    if (allowlistFile) {
      console.log(chalk.gray(`Allowlist: ${path.relative(baseDir, allowlistFile)}`));
    }

    // Use `cwd` + relative patterns so `ignore` reliably matches (e.g. node_modules/**)
    // even when scanning with an absolute baseDir.
    const files = await glob(pattern, {
      cwd: baseDir,
      ignore,
      windowsPathsNoEscape: true,
      absolute: true
    });

    console.log(chalk.gray(`Found ${files.length} markdown files`));

    for (const filePath of files) {
      await this.scanFile(filePath, baseDir, checker);
    }

    return this.generateReport();
  }

  async scanFile(filePath, baseDir, checker) {
    const relativeFile = path
      .relative(baseDir, filePath)
      .replace(/\\\\/g, '/');

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      this.fileErrors.push({
        file: relativeFile,
        message: error.message
      });
      console.warn(chalk.yellow(`Warning: Failed to read "${relativeFile}": ${error.message}`));
      return;
    }

    const issues = checker.scanText(content, relativeFile);
    if (issues.length === 0) return;

    this.fileIssues.set(relativeFile, issues);
    for (const issue of issues) {
      this.issues.push({
        file: relativeFile,
        ...issue
      });
    }
  }

  generateReport() {
    const totalFiles = this.fileIssues.size;
    const totalIssues = this.issues.length;
    const errors = this.issues.filter(i => i.severity === 'error').length;
    const warnings = this.issues.filter(i => i.severity === 'warning').length;
    const fileReadErrors = this.fileErrors.length;

    const report = {
      summary: {
        filesWithIssues: totalFiles,
        totalIssues,
        errors,
        warnings,
        fileReadErrors
      },
      issues: this.issues,
      fileDetails: Object.fromEntries(this.fileIssues),
      fileReadErrors: this.fileErrors
    };

    console.log('\n' + chalk.bold('Unicode Check Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Files with issues: ${totalFiles}`);
    if (fileReadErrors > 0) {
      console.log(chalk.yellow(`Files failed to read: ${fileReadErrors}`));
    }
    console.log(`Total issues: ${totalIssues} (errors: ${errors}, warnings: ${warnings})`);

    if (totalIssues > 0) {
      const formatIssueChar = (issue) => {
        const ch = issue.char;
        const codepoint = issue.codepoint;

        if (ch == null) return '<null>';
        if (ch === ' ') return '<space>';
        if (ch === '\t') return '<TAB>';
        if (ch === '\r') return '<CR>';
        if (ch === '\n') return '<LF>';

        if (codepoint === 'U+00A0') return '<NBSP>';
        if (codepoint === 'U+00AD') return '<SHY>';
        if (codepoint === 'U+200B') return '<ZWSP>';
        if (codepoint === 'U+200C') return '<ZWNJ>';
        if (codepoint === 'U+200D') return '<ZWJ>';
        if (codepoint === 'U+2060') return '<WORD_JOINER>';
        if (codepoint === 'U+FEFF') return '<BOM>';

        const cp = ch.codePointAt(0);
        if (cp !== undefined && (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f))) {
          return `<${codepoint}>`;
        }

        return ch;
      };

      console.log();
      for (const issue of this.issues) {
        const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
        const charDisplay = formatIssueChar(issue);
        console.log(color(`${issue.file}:${issue.line}:${issue.column} ${issue.codepoint} ${charDisplay}`));
        console.log(chalk.gray(`  ${issue.kind}: ${issue.message}`));
      }
    } else {
      console.log(chalk.green('No unicode issues found.'));
    }

    return report;
  }
}

function shouldFail(report, failOn) {
  const errors = report.summary.errors;
  const warnings = report.summary.warnings;

  if (failOn === 'none') return false;
  if (failOn === 'warn') return errors + warnings > 0;
  if (failOn === 'error') return errors > 0;

  // Should be unreachable because failOn is validated before calling this function.
  return false;
}

const program = new Command();

program
  .name('check-unicode')
  .description('Check suspicious unicode characters in markdown files')
  .version('1.0.0')
  .argument('[directory]', 'Directory to check', '.')
  .option('-p, --pattern <pattern>', 'Glob pattern for files', '**/*.md')
  .option('-i, --ignore <patterns...>', 'Patterns to ignore', ['node_modules/**', '**/node_modules/**'])
  .option('-a, --allowlist <file>', 'Allowlist JSON path (default: auto-detect)')
  .option('-o, --output <file>', 'Save report to file (JSON)')
  .option('--fail-on <level>', 'Fail level: error|warn|none', 'error')
  .action(async (directory, options) => {
    const runner = new UnicodeQualityRunner();

    try {
      const failOn = String(options.failOn || 'error').toLowerCase();
      if (!['error', 'warn', 'none'].includes(failOn)) {
        console.error(chalk.red(`Invalid --fail-on value: ${options.failOn}`));
        process.exit(2);
      }

      const report = await runner.scanDirectory(directory, {
        pattern: options.pattern,
        ignore: options.ignore,
        allowlistPath: options.allowlist
      });

      if (options.output) {
        await fs.writeJson(path.resolve(options.output), report, { spaces: 2 });
        console.log(chalk.blue(`\nReport saved: ${options.output}`));
      }

      process.exit(shouldFail(report, failOn) ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
