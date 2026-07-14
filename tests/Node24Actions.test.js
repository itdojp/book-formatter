import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const SCRIPT_PATH = path.resolve('scripts/check-node24-actions.js');

async function withTempDir(fn) {
  const tempRoot = await fs.mkdtemp(path.join('tests', 'tmp-node24-actions-'));
  try {
    await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function runCheck(rootDir) {
  return spawnSync(process.execPath, [SCRIPT_PATH, rootDir], { encoding: 'utf8' });
}

test('active and template workflows use only valid top-level workflow keys', async () => {
  const workflowPaths = [
    '.github/workflows/book-sync.yml',
    '.github/workflows/quality-check.yml',
    'templates/.github/workflows/book-qa.yml',
    'templates/.github/workflows/nav-link-check.yml'
  ];
  const allowedKeys = new Set([
    'name',
    'run-name',
    'on',
    'permissions',
    'env',
    'defaults',
    'concurrency',
    'jobs'
  ]);

  for (const workflowPath of workflowPaths) {
    const document = parse(await fs.readFile(workflowPath, 'utf8'));
    assert.ok(document.on, `${workflowPath} must define on`);
    assert.ok(document.jobs, `${workflowPath} must define jobs`);
    assert.deepStrictEqual(
      Object.keys(document).filter((key) => !allowedKeys.has(key)),
      [],
      `${workflowPath} contains unsupported top-level keys`
    );
  }
});

test('check-node24-actions: current active, template, generator, and docs scopes pass', () => {
  const result = runCheck('.');
  assert.equal(result.status, 0, `expected success\n${result.stderr}`);
  assert.match(result.stdout, /Node 24 Actions major check passed/);
});

test('check-node24-actions: known legacy majors and unapproved actions fail', async () => {
  await withTempDir(async (tempRoot) => {
    const workflowDir = path.join(tempRoot, '.github', 'workflows');
    await fs.mkdir(workflowDir, { recursive: true });
    const legacyReferences = [
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/setup-python@v5',
      'actions/configure-pages@v5',
      'actions/upload-pages-artifact@v4',
      'actions/deploy-pages@v4',
      'actions/upload-artifact@v4',
      'actions/download-artifact@v4',
      'actions/github-script@v7',
      'actions/cache@v4',
      'actions/stale@v9',
      'github/codeql-action/analyze@v3',
      'DavidAnson/markdownlint-cli2-action@v19',
      'softprops/action-gh-release@v1',
      'peaceiris/actions-mdbook@v2',
      'rossjrw/pr-preview-action@v1'
    ];
    await fs.writeFile(
      path.join(workflowDir, 'quality.yml'),
      `steps:\n${legacyReferences.map((reference, index) => `  - uses: ${index === 0 ? `'${reference}'` : reference}`).join('\n')}\n`,
      'utf8'
    );

    const result = runCheck(tempRoot);
    assert.equal(result.status, 1, `expected failure\n${result.stderr}`);
    for (const reference of legacyReferences) {
      assert.match(result.stderr, new RegExp(reference.replaceAll('/', '\\/').replace('.', '\\.')));
    }
  });
});

test('check-node24-actions: exact semver in the approved major passes', async () => {
  await withTempDir(async (tempRoot) => {
    const workflowDir = path.join(tempRoot, '.github', 'workflows');
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.writeFile(
      path.join(workflowDir, 'quality.yml'),
      'steps:\n  - uses: actions/checkout@v6.0.1\n  - uses: actions/upload-artifact@v7.0.1\n  - uses: actions/jekyll-build-pages@v1\n  - uses: ruby/setup-ruby@v1.314.0\n',
      'utf8'
    );

    const result = runCheck(tempRoot);
    assert.equal(result.status, 0, `expected success\n${result.stderr}`);
  });
});

test('check-node24-actions: 未承認の外部actionはfail-closedで拒否する', async () => {
  await withTempDir(async (tempRoot) => {
    const workflowDir = path.join(tempRoot, '.github', 'workflows');
    await fs.mkdir(workflowDir, { recursive: true });
    await fs.writeFile(
      path.join(workflowDir, 'quality.yml'),
      'steps:\n  - uses: example/unknown-action@v1\n',
      'utf8'
    );

    const result = runCheck(tempRoot);
    assert.equal(result.status, 1, `expected failure\n${result.stderr}`);
    assert.match(result.stderr, /example\/unknown-action@v1/);
    assert.match(result.stderr, /no Node\.js 24-compatible release is approved/);
  });
});

test('check-node24-actions: archive, node_modules, and historical changelog references are excluded', async () => {
  await withTempDir(async (tempRoot) => {
    await fs.mkdir(path.join(tempRoot, 'docs', 'archive'), { recursive: true });
    await fs.mkdir(path.join(tempRoot, 'docs', 'node_modules', 'example'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, 'docs', 'archive', 'historical.md'),
      'uses: actions/checkout@v4\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(tempRoot, 'docs', 'node_modules', 'example', 'workflow.yml'),
      'uses: actions/setup-node@v4\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(tempRoot, 'CHANGELOG.md'),
      'Historical example: uses: actions/checkout@v4\n',
      'utf8'
    );

    const result = runCheck(tempRoot);
    assert.equal(result.status, 0, `expected excluded paths to pass\n${result.stderr}`);
  });
});
