#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import { createLinter, loadTextlintrc } from 'textlint';

/**
 * textlint runner for book repos.
 * - Uses book-formatter's Node dependencies (textlint + rules) in CI
 * - Supports a shared PRH dictionary + optional book-local dictionaries
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOK_FORMATTER_ROOT = path.resolve(__dirname, '..');
const BOOK_FORMATTER_NODE_MODULES = path.join(BOOK_FORMATTER_ROOT, 'node_modules');
const COMMON_PRH_YAML = path.join(BOOK_FORMATTER_ROOT, 'resources', 'prh', 'common.yml');

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

function resolveRepoRoot(scanDir) {
  const baseDir = path.resolve(scanDir);
  if (path.basename(baseDir) === 'docs' && fs.existsSync(path.join(baseDir, '_config.yml'))) {
    return path.dirname(baseDir);
  }
  // If caller points at a repo root, prefer it.
  if (fs.existsSync(path.join(baseDir, 'docs', '_config.yml')) || fs.existsSync(path.join(baseDir, '_config.yml'))) {
    return baseDir;
  }
  return process.cwd();
}

function collectPrhDictionaries(repoRoot, extraRulePaths = []) {
  const candidates = [
    path.join(repoRoot, '.book-formatter', 'prh.yml'),
    path.join(repoRoot, '.book-formatter', 'prh.yaml'),
    path.join(repoRoot, 'prh.yml'),
    path.join(repoRoot, 'prh.yaml')
  ];

  const resolvedExtra = (extraRulePaths || []).map((p) => {
    const s = String(p || '').trim();
    if (!s) return null;
    return path.isAbsolute(s) ? s : path.resolve(repoRoot, s);
  }).filter(Boolean);

  const files = [COMMON_PRH_YAML, ...resolvedExtra, ...candidates]
    .map((p) => path.resolve(p))
    .filter((p, idx, arr) => arr.indexOf(p) === idx) // de-dup
    .filter((p) => fs.existsSync(p));

  return files;
}

async function loadLinterDescriptor({ prhRulePaths, withPreset }) {
  // Generate a minimal textlint config file dynamically so that:
  // - preset packages are resolved by textlint itself
  // - prh rule can load multiple rulePaths (absolute paths)
  const rules = {
    prh: {
      rulePaths: prhRulePaths
    }
  };
  if (withPreset) {
    rules['preset-ja-technical-writing'] = true;
  }

  const config = { rules };
  const tmpConfigPath = path.join(
    os.tmpdir(),
    `book-formatter-textlintrc-${process.pid}-${Date.now()}.json`
  );
  await fs.writeFile(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

  try {
    return await loadTextlintrc({
      configFilePath: tmpConfigPath,
      node_modulesDir: BOOK_FORMATTER_NODE_MODULES
    });
  } finally {
    await fs.remove(tmpConfigPath);
  }
}

async function runTextlint({ directory, pattern, ignore, failOn, output, maxIssues, withPreset, prhRulePaths }) {
  const baseDir = path.resolve(directory);
  const repoRoot = resolveRepoRoot(baseDir);

  const effectivePrh = collectPrhDictionaries(repoRoot, prhRulePaths);
  if (effectivePrh.length === 0) {
    // Defensive: ensure prh always has at least one rule file.
    throw new Error('PRH dictionary not found (unexpected).');
  }

  console.log(chalk.blue(`📝 Running textlint in ${baseDir}...`));
  console.log(chalk.gray(`PRH dictionaries: ${effectivePrh.map((p) => path.relative(repoRoot, p) || p).join(', ')}`));
  if (withPreset) {
    console.log(chalk.gray('Preset: preset-ja-technical-writing (enabled)'));
  }

  const files = await glob(pattern, {
    cwd: baseDir,
    ignore,
    windowsPathsNoEscape: true,
    absolute: true
  });
  console.log(chalk.gray(`Found ${files.length} markdown files`));

  const descriptor = await loadLinterDescriptor({ prhRulePaths: effectivePrh, withPreset });
  const linter = createLinter({ descriptor, cwd: baseDir });

  const results = await linter.lintFiles(files);

  const issues = [];
  const fileDetails = {};

  for (const result of results) {
    const rel = path.relative(baseDir, result.filePath || '').replace(/\\/g, '/');
    if (!Array.isArray(result.messages) || result.messages.length === 0) continue;

    fileDetails[rel] = result.messages.map((m) => ({
      ruleId: m.ruleId,
      message: m.message,
      severity: m.severity,
      line: m.line,
      column: m.column
    }));

    for (const m of result.messages) {
      issues.push({
        file: rel,
        ruleId: m.ruleId,
        message: m.message,
        severity: m.severity,
        line: m.line,
        column: m.column
      });
    }
  }

  const errors = issues.filter((i) => i.severity >= 2).length;
  const warnings = issues.filter((i) => i.severity === 1).length;
  const infos = issues.filter((i) => i.severity === 0).length;

  const report = {
    summary: {
      filesChecked: files.length,
      filesWithIssues: Object.keys(fileDetails).length,
      totalIssues: issues.length,
      errors,
      warnings,
      infos
    },
    config: {
      scanDir: directory,
      pattern,
      ignore,
      failOn,
      withPreset: Boolean(withPreset),
      prhRulePaths: effectivePrh.map((p) => path.relative(repoRoot, p) || p)
    },
    issues,
    fileDetails
  };

  console.log('\n' + chalk.bold('Textlint Check Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Files checked: ${report.summary.filesChecked}`);
  console.log(`Files with issues: ${report.summary.filesWithIssues}`);
  console.log(`Total issues: ${report.summary.totalIssues} (errors: ${errors}, warnings: ${warnings}, info: ${infos})`);

  if (issues.length > 0) {
    console.log();
    const limit = Math.max(0, Number(maxIssues) || 0);
    const slice = limit > 0 ? issues.slice(0, limit) : issues;
    for (const issue of slice) {
      const color = issue.severity >= 2 ? chalk.red : (issue.severity === 1 ? chalk.yellow : chalk.gray);
      console.log(color(`${issue.file}:${issue.line}:${issue.column} ${issue.ruleId}: ${issue.message}`));
    }
    if (limit > 0 && issues.length > limit) {
      console.log(chalk.gray(`... and ${issues.length - limit} more`));
    }
  } else {
    console.log(chalk.green('No textlint issues found.'));
  }

  if (output) {
    await fs.writeJson(output, report, { spaces: 2 });
    console.log(chalk.gray(`Report saved to ${output}`));
  }

  return report;
}

const program = new Command();

program
  .name('check-textlint')
  .description('Run textlint (prh + optional preset) on markdown files')
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
  .option('--fail-on <level>', 'Fail on: none|warn|error', 'none')
  .option('--output <file>', 'Save report to file (JSON)')
  .option('--max-issues <n>', 'Max issues to print (0=all)', '200')
  .option('--with-preset', 'Enable preset-ja-technical-writing', false)
  .option('--prh <paths...>', 'Additional prh dictionary file paths (relative to repo root)', [])
  .action(async (directory, opts) => {
    const failOn = normalizeFailOn(opts.failOn);
    if (!failOn) {
      console.error(chalk.red(`Invalid --fail-on value: ${opts.failOn} (expected: none|warn|error)`));
      process.exit(2);
    }

    try {
      const report = await runTextlint({
        directory,
        pattern: opts.pattern,
        ignore: opts.ignore,
        failOn,
        output: opts.output,
        maxIssues: opts.maxIssues,
        withPreset: Boolean(opts.withPreset),
        prhRulePaths: opts.prh
      });
      process.exit(shouldFail(report, failOn) ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error?.message || error}`));
      process.exit(1);
    }
  });

program.parse();
