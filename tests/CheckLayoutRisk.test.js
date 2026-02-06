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

test('check-layout-risk: should not fail by default (--fail-on none)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      'x'.repeat(220),
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'index.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, []);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.summary.warnings >= 1);
  });
});

test('check-layout-risk: long code lines should be reported as warnings (and can fail on warn)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '```txt',
      'x'.repeat(120),
      '```',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'code.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-code-line', '80', '--fail-on', 'warn']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'long_code_line'));
  });
});

test('check-layout-risk: wide tables should be reported (and can fail on warn)', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '| a | b | c |',
      '| --- | --- | --- |',
      '| 1 | 2 | 3 |',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'table.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-table-cols', '2', '--fail-on', 'warn']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'wide_table'));
  });
});

test('check-layout-risk: escaped pipes inside a table cell should not inflate column count', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '| op | meaning | example |',
      '| --- | --- | --- |',
      '| \\|\\|\\|[A]\\|\\|\\| | sync parallel | P \\|\\|\\|[{a,b}]\\|\\|\\| Q |',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'table.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-table-cols', '3', '--fail-on', 'warn']);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.maxTableCols, 3);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-layout-risk: long CJK-only text should not be treated as an unbreakable ASCII run', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '\u3042'.repeat(200),
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'jp.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-text-line', '80', '--fail-on', 'warn']);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-layout-risk: markdown link destination URL should not count towards unbreakable text runs', async () => {
  await withTempDir(async (tmpRoot) => {
    const longUrl = `https://example.com/${'a'.repeat(200)}`;
    const md = [
      `[label](${longUrl})`,
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'link.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-text-line', '80', '--fail-on', 'warn']);

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-layout-risk: markdown autolinks should be treated as visible text', async () => {
  await withTempDir(async (tmpRoot) => {
    const longUrl = `https://example.com/${'a'.repeat(200)}`;
    const md = [
      `<${longUrl}>`,
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'autolink.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--max-text-line', '80', '--fail-on', 'warn']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'long_text_line'));
  });
});

test('check-layout-risk: large local images should be reported (and can fail on warn)', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.mkdir(path.join(tmpRoot, 'assets'), { recursive: true });
    // Not a real PNG; size is what matters for the scanner.
    await fs.writeFile(path.join(tmpRoot, 'assets', 'test.png'), Buffer.alloc(64, 0x61));

    const md = [
      '![img](assets/test.png)',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'image.md'), md, 'utf8');

    const { result, report } = runCheckLayoutRisk(tmpRoot, ['--large-image-bytes', '10', '--fail-on', 'warn']);

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'large_image'));
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
