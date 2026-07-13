#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['src/index.js', '--help'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'CLI build smoke check failed.\n');
  process.exit(result.status ?? 1);
}

if (!result.stdout.includes('book-formatter')) {
  console.error('CLI build smoke check did not return the expected help output.');
  process.exit(1);
}

console.log('Build smoke check passed.');
