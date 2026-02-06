import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = path.resolve('scripts/check-layout-risk.js');

async function withTempDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'book-formatter-check-layout-risk-'));
  try {
    await fn(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function runCheckLayoutRisk(targetDir, args) {
  const reportPath = path.join(targetDir, 'layout-risk-report.json');
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, targetDir, '--output', reportPath, ...(args || [])],
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

test('check-layout-risk: long text lines should be reported as warnings (and can fail on warn)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      'short line',
      'x'.repeat(120),
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'index.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-text-line', '80', '--fail-on', 'warn']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.summary.warnings >= 1);
    assert.equal(report.summary.errors, 0);
  });
});

test('check-layout-risk: missing local <img> should be an error (fail-on error)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Title',
      '',
      '<img src="assets/missing.png" />',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'page.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--fail-on', 'error']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.summary.errors >= 1);
  });
});

test('check-layout-risk: liquid-based src should be skipped (no missing_image error)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Title',
      '',
      '<img src="{{ site.baseurl }}/assets/dynamic.png" />',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'page.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--fail-on', 'error']);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
  });
});
