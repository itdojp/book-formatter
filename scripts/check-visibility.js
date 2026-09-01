#!/usr/bin/env node

import path from 'node:path';

import { Command } from 'commander';
import fs from 'fs-extra';

import {
  checkBookVisibility,
  VisibilityValidationError
} from '../src/VisibilityChecker.js';
import { StandardBookValidationError } from '../src/StandardBookValidator.js';

async function writeReport(outputPath, report) {
  const resolvedPath = path.resolve(outputPath);
  if (await fs.pathExists(resolvedPath)) {
    const stat = await fs.lstat(resolvedPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new VisibilityValidationError(`Output path must be a regular file: ${resolvedPath}`);
    }
  }
  await fs.ensureDir(path.dirname(resolvedPath));
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

const program = new Command();
program
  .name('check-visibility')
  .description('Validate a standard-book edition visibility plan and optional generated artifact')
  .argument('<book-directory>', 'standard-book directory containing book.yaml')
  .requiredOption('--edition <id>', 'edition ID declared in book.yaml')
  .option('--artifact <path>', 'generated text artifact file or directory to scan')
  .option('--output <path>', 'write a deterministic JSON report')
  .action(async (bookDirectory, options) => {
    try {
      const report = await checkBookVisibility(bookDirectory, options.edition, {
        artifactPath: options.artifact
      });
      const outputPath = options.output ? await writeReport(options.output, report) : null;

      console.log(
        `${report.summary.safe ? '✅' : '❌'} Visibility check: ` +
          `book=${report.book}, edition=${report.edition.id}, ` +
          `documents=${report.summary.includedDocuments}/${report.summary.documents}, ` +
          `protected=${report.summary.protectedRegions}, findings=${report.summary.findings}`
      );
      if (outputPath) console.log(`   report=${outputPath}`);

      if (!report.summary.safe) process.exitCode = 1;
    } catch (error) {
      if (
        error instanceof VisibilityValidationError ||
        error instanceof StandardBookValidationError
      ) {
        console.error(`❌ Visibility validation failed: ${error.message}`);
      } else {
        console.error(`❌ Unexpected visibility failure: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
