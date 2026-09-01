#!/usr/bin/env node

import { Command } from 'commander';

import {
  checkMdbookResponsive,
  MdbookResponsiveError
} from '../src/MdbookResponsiveChecker.js';

const program = new Command();
program
  .name('check-mdbook-responsive')
  .description('Validate a generated web-mdbook project and its responsive geometry')
  .requiredOption('--book <path>', 'generated web-mdbook project directory')
  .option('--chrome <path>', 'Chrome/Chromium executable')
  .option('--static-only', 'skip browser geometry only when explicitly requested', false)
  .action(async (options) => {
    try {
      const report = await checkMdbookResponsive(options.book, {
        chrome: options.chrome,
        staticOnly: options.staticOnly
      });
      console.log(
        `✅ mdBook responsive check: static=success, ` +
          `html=${report.htmlFiles}, local-links=${report.localLinks}, ` +
          `viewports=${report.viewports}, browser-probes=${report.browserProbes}`
      );
    } catch (error) {
      if (error instanceof MdbookResponsiveError) {
        console.error(`❌ mdBook responsive check failed: ${error.message}`);
      } else {
        console.error(`❌ Unexpected mdBook responsive failure: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
