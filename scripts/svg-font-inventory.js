#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';

function normalizeFontValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
}

function extractFontFamilies(svgText) {
  const results = [];

  // CSS property: font-family: ...;
  // Keep the match permissive so it works for common style blocks.
  const cssRe = /font-family\s*:\s*([^;}{\n]+)\s*;/gi;
  let m;
  while ((m = cssRe.exec(svgText)) !== null) {
    results.push(m[1]);
  }

  // Attribute: font-family="..."
  const attrRe = /font-family\s*=\s*["']([^"']+)["']/gi;
  while ((m = attrRe.exec(svgText)) !== null) {
    results.push(m[1]);
  }

  return results;
}

async function main() {
  const program = new Command();
  program
    .name('svg-font-inventory')
    .description('Inventory font-family usage in SVG files (for book font unification).')
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
    .option('--limit <n>', 'sample files per font value', '5')
    .option('--json <file>', 'write JSON report to a file')
    .option('--report <file>', 'write Markdown report to a file');

  program.parse(process.argv);
  const opts = program.opts();
  const baseDir = path.resolve(program.args[0] || '.');
  const limit = Math.max(1, Number(opts.limit) || 5);

  const svgFiles = await glob(opts.pattern, {
    cwd: baseDir,
    ignore: opts.ignore,
    windowsPathsNoEscape: true,
    absolute: true
  });

  console.log(chalk.blue(`Scanning SVG files in ${baseDir}...`));
  console.log(chalk.gray(`Found ${svgFiles.length} svg files`));

  const fontMap = new Map(); // value -> { occurrences, files: Set }
  let totalMatches = 0;
  let readErrors = 0;

  for (const filePath of svgFiles) {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      readErrors += 1;
      console.warn(chalk.yellow(`Warning: Failed to read "${filePath}": ${error.message}`));
      continue;
    }

    const fonts = extractFontFamilies(content);
    if (fonts.length === 0) continue;

    const rel = path.relative(baseDir, filePath).replace(/\\/g, '/');
    for (const fontRaw of fonts) {
      const value = normalizeFontValue(fontRaw);
      if (!value) continue;

      totalMatches += 1;
      const entry = fontMap.get(value) || { occurrences: 0, files: new Set() };
      entry.occurrences += 1;
      entry.files.add(rel);
      fontMap.set(value, entry);
    }
  }

  const items = Array.from(fontMap.entries())
    .map(([value, data]) => ({
      value,
      occurrences: data.occurrences,
      fileCount: data.files.size,
      files: Array.from(data.files).slice(0, limit)
    }))
    .sort((a, b) => b.occurrences - a.occurrences || b.fileCount - a.fileCount || a.value.localeCompare(b.value));

  const summary = {
    baseDir,
    scannedSvgFiles: svgFiles.length,
    totalFontFamilyMatches: totalMatches,
    uniqueFontFamilyValues: items.length,
    readErrors
  };

  console.log(chalk.gray(JSON.stringify(summary, null, 2)));

  if (items.length === 0) {
    console.log(chalk.green('No font-family declarations found.'));
  } else {
    console.log(chalk.blue('Top font-family values:'));
    for (const item of items.slice(0, 20)) {
      console.log(
        chalk.white(`- ${item.occurrences} matches / ${item.fileCount} files: `) + chalk.gray(item.value)
      );
      for (const f of item.files) {
        console.log(chalk.gray(`  - ${f}`));
      }
    }
  }

  const reportJson = { summary, fonts: items };

  if (opts.json) {
    const outPath = path.resolve(opts.json);
    await fs.outputJson(outPath, reportJson, { spaces: 2 });
    console.log(chalk.green(`Wrote JSON report: ${outPath}`));
  }

  if (opts.report) {
    const outPath = path.resolve(opts.report);
    const lines = [];
    lines.push('# SVG Font Inventory');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(summary, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('## font-family values (by occurrences)');
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item.occurrences} matches / ${item.fileCount} files: ${item.value}`);
      for (const f of item.files) {
        lines.push(`  - ${f}`);
      }
    }
    await fs.outputFile(outPath, lines.join('\n') + '\n', 'utf8');
    console.log(chalk.green(`Wrote Markdown report: ${outPath}`));
  }
}

main().catch((error) => {
  console.error(chalk.red(`Error: ${error.message}`));
  process.exitCode = 1;
});
