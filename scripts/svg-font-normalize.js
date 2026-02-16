#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';

// Keep the font stacks aligned with book-formatter's CSS variables.
// shared/assets/css/main.css defines the canonical values.
//
// NOTE: This script rewrites SVG files, including inline `style="..."` attributes.
// To avoid breaking XML/HTML attribute quoting, the stacks below intentionally use
// single quotes for font family names that include spaces (instead of double quotes).
const SANS_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'";
const MONO_STACK = "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace";

function normalizeFontValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
}

const SANS_REPLACE = new Set(
  [
    'sans-serif',
    'Inter, Helvetica, sans-serif',
    'Inter, Helvetica, Arial, sans-serif',
    'Inter, sans-serif',
    "'Inter', sans-serif",
    '"Inter", sans-serif',
    "Inter, 'Helvetica Neue', Arial, sans-serif",
    "'Inter', 'Helvetica Neue', Arial, sans-serif",
    "'Inter', 'Helvetica Neue', Helvetica, sans-serif",
    "'Inter', 'Helvetica', sans-serif",
    "'Inter', 'Helvetica Neue', sans-serif",
    "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    'system-ui, sans-serif',
    'Arial, sans-serif',
    "'Noto Sans JP', sans-serif",
    "'Hiragino Sans', 'Yu Gothic', sans-serif",
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
  ].map(normalizeFontValue)
);

const MONO_REPLACE = new Set(
  [
    'monospace',
    'Courier, monospace',
    "'Courier New', monospace",
    "'Monaco', 'Menlo', monospace",
    '"Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace',
    "'SF Mono', monospace",
    "'SF Mono', 'Monaco', 'Consolas', monospace"
  ].map(normalizeFontValue)
);

function maybeReplaceFontFamily(originalValue) {
  const norm = normalizeFontValue(originalValue);
  if (!norm) return null;

  // Do not rewrite math serif stacks (kept explicit in diagrams).
  if (/\b(Latin Modern Math|STIX Two Math)\b/i.test(norm)) return null;

  const sansNorm = normalizeFontValue(SANS_STACK);
  const monoNorm = normalizeFontValue(MONO_STACK);
  if (norm === sansNorm || norm === monoNorm) return null;

  if (SANS_REPLACE.has(norm)) return SANS_STACK;
  if (MONO_REPLACE.has(norm)) return MONO_STACK;

  return null;
}

function maybeReplaceFontShorthand(originalValue) {
  const rawValue = String(originalValue || '');
  if (!rawValue.trim()) return null;

  // Preserve a trailing !important (rare in SVGs but valid CSS).
  const importantMatch = rawValue.match(/\s*!important\s*$/i);
  const importantSuffix = importantMatch ? importantMatch[0] : '';
  const baseValue = importantMatch ? rawValue.slice(0, importantMatch.index) : rawValue;

  // `font` shorthand grammar ends with: <font-size>[/<line-height>]? <font-family>
  // We locate the first <font-size> token (with a unit) and treat everything after
  // the optional line-height as the font-family part.
  const sizeRe = /\b\d+(?:\.\d+)?(?:px|pt|em|rem|%)\b/i;
  const sizeMatch = sizeRe.exec(baseValue);
  if (!sizeMatch) return null;

  let familyStart = sizeMatch.index + sizeMatch[0].length;

  // Optional: /<line-height>
  const afterSize = baseValue.slice(familyStart);
  const lineHeightRe = /^\s*\/\s*(?:[0-9.]+(?:px|pt|em|rem|%)?|normal)\b/i;
  const lhMatch = lineHeightRe.exec(afterSize);
  if (lhMatch) familyStart += lhMatch[0].length;

  const familyRaw = baseValue.slice(familyStart).trim();
  if (!familyRaw) return null;

  const replacementFamily = maybeReplaceFontFamily(familyRaw);
  if (!replacementFamily) return null;

  const prefix = baseValue.slice(0, familyStart).trimEnd();
  return `${prefix} ${replacementFamily}${importantSuffix}`;
}

function rewriteSvgFonts(svgText) {
  let changed = false;
  let changes = 0;

  const cssRe = /(font-family\s*:\s*)([^;}{]+?)(\s*;)/gi;
  const fontRe = /(font\s*:\s*)([^;}{]+?)(\s*;)/gi;
  // Robust attribute matchers:
  // - Handles valid values.
  // - Also handles a common invalid pattern where a double-quoted attribute value
  //   contains unescaped double quotes (we locate the closing quote by looking
  //   ahead to the next attribute or tag close).
  const attrDoubleRe =
    /(font-family\s*=\s*)"([\s\S]*?)"(?=\s+[a-zA-Z_:][-a-zA-Z0-9_:]*=|\s*\/?>)/gi;
  const attrSingleRe =
    /(font-family\s*=\s*)'([\s\S]*?)'(?=\s+[a-zA-Z_:][-a-zA-Z0-9_:]*=|\s*\/?>)/gi;

  const rewrittenCss = svgText.replace(cssRe, (full, prefix, value, suffix) => {
    const replacement = maybeReplaceFontFamily(value);
    if (!replacement) return full;
    changed = true;
    changes += 1;
    return `${prefix}${replacement}${suffix}`;
  });

  const rewrittenFont = rewrittenCss.replace(fontRe, (full, prefix, value, suffix) => {
    const replacement = maybeReplaceFontShorthand(value);
    if (!replacement) return full;
    changed = true;
    changes += 1;
    return `${prefix}${replacement}${suffix}`;
  });

  let rewritten = rewrittenFont;
  rewritten = rewritten.replace(attrDoubleRe, (full, prefix, value) => {
    const replacement = maybeReplaceFontFamily(value);
    if (!replacement) return full;
    changed = true;
    changes += 1;
    // Always emit double-quoted attributes so the replacement can safely include apostrophes.
    return `${prefix}"${replacement}"`;
  });
  rewritten = rewritten.replace(attrSingleRe, (full, prefix, value) => {
    const replacement = maybeReplaceFontFamily(value);
    if (!replacement) return full;
    changed = true;
    changes += 1;
    return `${prefix}"${replacement}"`;
  });

  return { changed, changes, text: rewritten };
}

const program = new Command();
program
  .name('svg-font-normalize')
  .description('Normalize common SVG font-family stacks to the book font stack.')
  .argument('[directory]', 'directory to scan', '.')
  .option('--pattern <glob>', 'glob pattern (relative to directory)', '**/*.svg')
  .option(
    '--ignore <globs...>',
    'ignore patterns',
    [
      '**/node_modules/**',
      '**/.git/**',
      '**/_site/**',
      '**/.jekyll-cache/**',
      '**/vendor/**',
      '**/dist/**',
      '**/build/**'
    ]
  )
  .option('--apply', 'write changes to files (default: dry-run)', false)
  .option('--check', 'exit with non-zero code if changes are needed', false)
  .option('--limit <n>', 'max files to list in output', '50')
  .action(async (directory, opts) => {
    const baseDir = path.resolve(directory || '.');
    const limit = Math.max(1, Number(opts.limit) || 50);

    try {
      const svgFiles = await glob(opts.pattern, {
        cwd: baseDir,
        ignore: opts.ignore,
        windowsPathsNoEscape: true,
        absolute: true
      });

      console.log(chalk.blue(`Scanning SVG files in ${baseDir}...`));
      console.log(chalk.gray(`Found ${svgFiles.length} svg files`));

      const changedFiles = [];
      let totalFontEdits = 0;
      let readErrors = 0;
      let writeErrors = 0;

      for (const filePath of svgFiles) {
        let content;
        try {
          content = await fs.readFile(filePath, 'utf8');
        } catch (error) {
          readErrors += 1;
          console.warn(chalk.yellow(`Warning: Failed to read "${filePath}": ${error.message}`));
          continue;
        }

        const res = rewriteSvgFonts(content);
        if (!res.changed) continue;

        const rel = path.relative(baseDir, filePath).replace(/\\/g, '/');
        changedFiles.push(rel);
        totalFontEdits += res.changes;

        if (opts.apply) {
          try {
            await fs.writeFile(filePath, res.text, 'utf8');
          } catch (error) {
            writeErrors += 1;
            console.warn(chalk.yellow(`Warning: Failed to write "${filePath}": ${error.message}`));
          }
        }
      }

      const summary = {
        baseDir,
        scannedSvgFiles: svgFiles.length,
        changedFiles: changedFiles.length,
        totalFontEdits,
        apply: Boolean(opts.apply),
        readErrors,
        writeErrors
      };

      console.log(chalk.gray(JSON.stringify(summary, null, 2)));

      if (changedFiles.length > 0) {
        console.log(chalk.blue('Changed files (sample):'));
        for (const f of changedFiles.slice(0, limit)) {
          console.log(chalk.gray(`- ${f}`));
        }
        if (changedFiles.length > limit) {
          console.log(chalk.gray(`... and ${changedFiles.length - limit} more`));
        }
      } else {
        console.log(chalk.green('No changes needed.'));
      }

      const shouldFail = (opts.check && changedFiles.length > 0) || readErrors > 0 || writeErrors > 0;
      process.exit(shouldFail ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
