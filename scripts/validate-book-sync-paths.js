#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const APPROVED_PATH_PREFIXES = [
  'docs/_layouts/',
  'docs/_includes/',
  'docs/assets/'
];

function isApprovedSyncPath(filePath) {
  return filePath === 'book-config.json'
    || APPROVED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function gitPaths(repoPath, args) {
  const output = execFileSync('git', ['-C', repoPath, ...args, '-z'], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function collectChangedPaths(repoPath) {
  const paths = [
    ...gitPaths(repoPath, ['diff', '--name-only']),
    ...gitPaths(repoPath, ['diff', '--cached', '--name-only']),
    ...gitPaths(repoPath, ['ls-files', '--others', '--exclude-standard'])
  ];
  return [...new Set(paths)];
}

function validateAndWritePathspec({ repoPath, outputPath }) {
  const changedPaths = collectChangedPaths(repoPath);
  const unexpectedPaths = changedPaths.filter((filePath) => !isApprovedSyncPath(filePath));
  if (unexpectedPaths.length > 0) {
    throw new Error(`Refusing unexpected sync path(s): ${unexpectedPaths.join(', ')}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const pathspec = changedPaths.length > 0
    ? Buffer.from(`${changedPaths.join('\0')}\0`, 'utf8')
    : Buffer.alloc(0);
  fs.writeFileSync(outputPath, pathspec);
  return changedPaths;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function main() {
  try {
    const repoPath = path.resolve(readOption('--repo'));
    const outputPath = path.resolve(readOption('--output'));
    const changedPaths = validateAndWritePathspec({ repoPath, outputPath });
    console.log(`Validated ${changedPaths.length} approved sync path(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const cliPath = process.argv[1];
const isDirectExecution = cliPath ? import.meta.url === pathToFileURL(cliPath).href : false;
if (isDirectExecution) {
  main();
}

export {
  APPROVED_PATH_PREFIXES,
  collectChangedPaths,
  isApprovedSyncPath,
  validateAndWritePathspec
};
