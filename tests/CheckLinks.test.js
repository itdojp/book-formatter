import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = path.resolve('scripts/check-links.js');

async function withTempDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'book-formatter-check-links-'));
  try {
    await fn(tmpRoot);
  } finally {
    // Best-effort cleanup (ignore failures on Windows etc.)
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function runCheckLinks(targetDir) {
  const reportPath = path.join(targetDir, 'link-report.json');
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, targetDir, '--output', reportPath],
    { encoding: 'utf8' }
  );

  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    // keep null
  }

  return { result, report, reportPath };
}

test('check-links: footnote syntax should not be treated as a broken link', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      'This is a footnote example.[^1]',
      '',
      '[^1]: Footnote text',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'notes.md'), md, 'utf8');

    const { result, report } = runCheckLinks(tmpRoot);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.brokenLinks, 0);
  });
});

test('check-links: absolute links should resolve to docs/ when docs/_config.yml exists', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.mkdir(path.join(tmpRoot, 'docs', 'assets'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'docs', '_config.yml'), 'title: test\n', 'utf8');
    await fs.writeFile(path.join(tmpRoot, 'docs', 'assets', 'test.png'), '', 'utf8');

    const md = '[img](/assets/test.png)\n';
    await fs.writeFile(path.join(tmpRoot, 'README.md'), md, 'utf8');

    const { result, report } = runCheckLinks(tmpRoot);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.brokenLinks, 0);
  });
});

test('check-links: URL-encoded anchors should match slugified headings', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'page.md'), '## My Title\n', 'utf8');
    await fs.writeFile(path.join(tmpRoot, 'index.md'), '[go](page.md#My%20Title)\n', 'utf8');

    const { result, report } = runCheckLinks(tmpRoot);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.brokenLinks, 0);
  });
});

test('check-links: baseurl-prefixed absolute links should work when scanning docs/ directly', async () => {
  await withTempDir(async (tmpRoot) => {
    const repoName = path.basename(tmpRoot);
    const docsDir = path.join(tmpRoot, 'docs');

    await fs.mkdir(path.join(docsDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(docsDir, '_config.yml'), 'title: test\n', 'utf8');
    await fs.writeFile(path.join(docsDir, 'assets', 'test.png'), '', 'utf8');

    // Simulate links already rendered with GitHub Pages baseurl: /<repo-name>/...
    await fs.writeFile(path.join(docsDir, 'index.md'), `[img](/${repoName}/assets/test.png)\n`, 'utf8');

    const { result, report } = runCheckLinks(docsDir);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.brokenLinks, 0);
  });
});
