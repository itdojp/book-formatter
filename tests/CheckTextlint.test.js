import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = path.resolve('scripts/check-textlint.js');

async function withTempDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'book-formatter-check-textlint-'));
  try {
    await fn(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function runCheckTextlint(targetDir, { failOn = 'none' } = {}) {
  const reportPath = path.join(targetDir, 'textlint-report.json');
  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, targetDir, '--fail-on', failOn, '--output', reportPath, '--max-issues', '0'],
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

test('check-textlint: should report PRH issues but not fail when --fail-on none', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'doc.md'), 'Github\n', 'utf8');

    const { result, report } = runCheckTextlint(tmpRoot, { failOn: 'none' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.totalIssues, 1);
    assert.equal(report.summary.errors, 1);
  });
});

test('check-textlint: should fail when --fail-on error and issues exist', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'doc.md'), 'Github\n', 'utf8');

    const { result, report } = runCheckTextlint(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.totalIssues, 1);
    assert.equal(report.summary.errors, 1);
  });
});

test('check-textlint: should flag EOL environment examples (Ubuntu 20.04, Amazon Linux 2)', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'doc.md'), 'FROM ubuntu:20.04\nAmazon Linux 2\n', 'utf8');

    const { result, report } = runCheckTextlint(tmpRoot, { failOn: 'none' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.summary.errors >= 2, `expected >=2 errors, got ${report.summary.errors}`);
  });
});
