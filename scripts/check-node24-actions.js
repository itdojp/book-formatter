#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_ACTION_MAJORS = new Map([
  ['actions/checkout', 'v6'],
  ['actions/setup-node', 'v6'],
  ['actions/setup-python', 'v6'],
  ['actions/configure-pages', 'v6'],
  ['actions/upload-pages-artifact', 'v5'],
  ['actions/deploy-pages', 'v5'],
  ['actions/upload-artifact', 'v7'],
  ['actions/download-artifact', 'v8'],
  ['actions/github-script', 'v9'],
  ['actions/cache', 'v6'],
  ['actions/stale', 'v10'],
  ['actions/jekyll-build-pages', 'v1'],
  ['github/codeql-action', 'v4'],
  ['davidanson/markdownlint-cli2-action', 'v24'],
  ['softprops/action-gh-release', 'v3'],
  ['ruby/setup-ruby', 'v1']
]);

const FORBIDDEN_ACTIONS = new Set([
  'peaceiris/actions-mdbook',
  'rossjrw/pr-preview-action'
]);

const SCOPED_PATHS = [
  '.github/workflows',
  'templates',
  'src/GitHubPagesHandler.js',
  'README.md',
  'ARCHITECTURE.md',
  'TROUBLESHOOTING.md',
  'docs'
];

const EXCLUDED_DIRECTORIES = new Set(['archive', 'node_modules']);
const SCANNED_EXTENSIONS = new Set(['.js', '.md', '.yaml', '.yml']);
const USES_PATTERN = /uses:\s*['"]?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)@([A-Za-z0-9._-]+)/g;

function collectFiles(rootDir, targetPath) {
  const absolutePath = path.join(rootDir, targetPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    return SCANNED_EXTENSIONS.has(path.extname(absolutePath)) ? [absolutePath] : [];
  }

  const files = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, entryPath));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(rootDir, entryPath));
    }
  }
  return files;
}

function actionKey(reference) {
  const parts = reference.split('/');
  return parts.slice(0, 2).join('/').toLowerCase();
}

function usesExpectedMajor(version, expectedMajor) {
  return version === expectedMajor || version.startsWith(`${expectedMajor}.`);
}

function findActionMajorProblems(rootDir) {
  const problems = [];
  const files = SCOPED_PATHS.flatMap((targetPath) => collectFiles(rootDir, targetPath));

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(USES_PATTERN)) {
      const [, reference, version] = match;
      const key = actionKey(reference);
      const expectedMajor = EXPECTED_ACTION_MAJORS.get(key);
      if (FORBIDDEN_ACTIONS.has(key) || !expectedMajor || !usesExpectedMajor(version, expectedMajor)) {
        const line = content.slice(0, match.index).split('\n').length;
        problems.push({
          file: path.relative(rootDir, filePath),
          line,
          reference,
          version,
          expectedMajor
        });
      }
    }
  }

  return problems;
}

function main() {
  const rootDir = path.resolve(process.argv[2] || '.');
  const problems = findActionMajorProblems(rootDir);
  if (problems.length === 0) {
    console.log('Node 24 Actions major check passed.');
    return;
  }

  console.error('Node 24 Actions major check failed:');
  for (const problem of problems) {
    console.error(
      problem.expectedMajor
        ? `- ${problem.file}:${problem.line} uses ${problem.reference}@${problem.version}; expected @${problem.expectedMajor}`
        : `- ${problem.file}:${problem.line} uses ${problem.reference}@${problem.version}; no Node.js 24-compatible release is approved`
    );
  }
  process.exitCode = 1;
}

main();
