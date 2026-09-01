import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = path.resolve('scripts/check-markdown-structure.js');

async function withTempDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'book-formatter-check-markdown-structure-'));
  try {
    await fn(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function runCheckMarkdownStructure(
  targetDir,
  { failOn = 'error', standardCallouts = false, args = [] } = {}
) {
  const reportPath = path.join(targetDir, 'markdown-structure-report.json');
  const standardCalloutArgs = standardCallouts ? ['--standard-callouts'] : [];
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      targetDir,
      '--fail-on',
      failOn,
      '--output',
      reportPath,
      '--max-issues',
      '0',
      ...standardCalloutArgs,
      ...args
    ],
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

test('check-markdown-structure: invalid front matter should fail on error', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '---',
      'title: "broken',
      '---',
      '# Heading',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'page.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'invalid_front_matter'));
    assert.ok(report.summary.errors >= 1);
  });
});

test('check-markdown-structure: heading level skip should be warning and fail on warn', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Top',
      '',
      '### Skipped',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'heading.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'warn' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'heading_level_skip'));
    assert.equal(report.summary.errors, 0);
    assert.ok(report.summary.warnings >= 1);
  });
});

test('check-markdown-structure: missing fence language should be warning', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      '```',
      'echo hello',
      '```',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'code.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'warn' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'missing_fence_language'));
    assert.equal(report.summary.errors, 0);
    assert.ok(report.summary.warnings >= 1);
  });
});

test('check-markdown-structure: unclosed fence should fail on error', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      '```bash',
      'echo hello',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'broken-fence.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'unclosed_code_fence'));
    assert.ok(report.summary.errors >= 1);
  });
});

test('check-markdown-structure: valid markdown should pass', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '---',
      'title: "Valid"',
      '---',
      '# Heading',
      '',
      '## Section',
      '',
      '```bash',
      'echo hello',
      '```',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'ok.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-markdown-structure: all standard callout types should pass', async () => {
  await withTempDir(async (tmpRoot) => {
    const callouts = ['note', 'tip', 'warning', 'paid', 'internal']
      .flatMap((type) => [`:::${type}`, `${type} body`, ':::', '']);
    const md = ['# Example', '', ...callouts].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'callouts.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'warn',
      standardCallouts: true
    });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-markdown-structure: unknown and malformed callout types should fail', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      ':::danger',
      'unknown type',
      ':::',
      '',
      '::: note',
      'malformed opening delimiter',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'invalid-callouts.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'error',
      standardCallouts: true
    });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'unknown_callout_type'));
    assert.ok(report.issues.some((i) => i.kind === 'invalid_callout_delimiter'));
  });
});

test('check-markdown-structure: unclosed, nested, and orphan callouts should fail', async () => {
  await withTempDir(async (tmpRoot) => {
    const files = {
      'unclosed.md': ['# Example', '', ':::note', 'body', ''].join('\n'),
      'nested.md': ['# Example', '', ':::note', ':::tip', 'body', ':::', ':::', ''].join('\n'),
      'orphan.md': ['# Example', '', ':::', ''].join('\n')
    };
    await Promise.all(
      Object.entries(files).map(([name, content]) => fs.writeFile(path.join(tmpRoot, name), content, 'utf8'))
    );

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'error',
      standardCallouts: true
    });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'unclosed_callout'));
    assert.ok(report.issues.some((i) => i.kind === 'nested_callout'));
    assert.ok(report.issues.some((i) => i.kind === 'orphan_callout_close'));
  });
});

test('check-markdown-structure: indented callout delimiters should fail', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = ['# Example', '', '  :::note', 'body', '  :::', ''].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'indented-callout.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'error',
      standardCallouts: true
    });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.issues.filter((i) => i.kind === 'indented_callout_delimiter').length, 2);
  });
});

test('check-markdown-structure: callout examples inside code fences should be ignored', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      '```markdown',
      ':::unknown',
      'literal example',
      ':::',
      '```',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'fenced-callout.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'warn',
      standardCallouts: true
    });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-markdown-structure: callout-like text in front matter should be ignored', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '---',
      'example: |',
      '  ---',
      '  ...',
      '  :::unknown',
      '---',
      '# Example',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'front-matter-callout.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'warn',
      standardCallouts: true
    });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-markdown-structure: invalid backtick info strings should not hide callouts', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      '```markdown`invalid',
      ':::danger',
      '```',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'invalid-fence-info.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'error',
      standardCallouts: true
    });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.issues.some((i) => i.kind === 'invalid_code_fence'));
    assert.ok(report.issues.some((i) => i.kind === 'unknown_callout_type'));
  });
});

test('check-markdown-structure: fenced literals inside a callout should not change callout state', async () => {
  await withTempDir(async (tmpRoot) => {
    const md = [
      '# Example',
      '',
      ':::note',
      '````markdown',
      ':::unknown',
      ':::',
      '````',
      '',
      '~~~markdown',
      ':::danger',
      '~~~',
      ':::',
      ''
    ].join('\n');
    await fs.writeFile(path.join(tmpRoot, 'callout-with-fences.md'), md, 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, {
      failOn: 'warn',
      standardCallouts: true
    });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });
});

test('check-markdown-structure: book.yaml should not enable standard callout validation implicitly', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'book.yaml'), 'schema_version: 1\n', 'utf8');
    await fs.writeFile(path.join(tmpRoot, 'page.md'), '# Example\n\n:::unknown\n', 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
  });
});

test('check-markdown-structure: legacy roots should not enable the standard callout contract implicitly', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'page.md'), '# Legacy\n\n:::legacy-directive\n', 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0);
  });
});

test('check-markdown-structure: file read errors should fail on error', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.mkdir(path.join(tmpRoot, 'unreadable.md'));
    await fs.writeFile(path.join(tmpRoot, 'ok.md'), '# heading\n', 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'error' });

    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.ok(report.summary.fileReadErrors >= 1);
    assert.ok(report.issues.some((i) => i.kind === 'file_read_error'));
  });
});

test('check-markdown-structure: generated build directory should be ignored by default', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.mkdir(path.join(tmpRoot, 'build', 'ja'), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, 'build', 'ja', 'book.md'),
      ['# Chapter 1', '', '# Chapter 2', ''].join('\n'),
      'utf8'
    );
    await fs.writeFile(path.join(tmpRoot, 'index.md'), '# Root\n', 'utf8');

    const { result, report } = runCheckMarkdownStructure(tmpRoot, { failOn: 'warn' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.warnings, 0);
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.scannedFiles, 1);
  });
});
