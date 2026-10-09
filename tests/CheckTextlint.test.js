import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
    assert.equal(report.summary.errors, 2, `expected exactly 2 errors, got ${report.summary.errors}`);

    const messages = (report.issues || []).map((i) => String(i.message || ''));
    assert.ok(
      messages.some((m) => m.includes('ubuntu:20.04')),
      'expected at least one message to mention "ubuntu:20.04"'
    );
    assert.ok(
      messages.some((m) => m.includes('Amazon Linux 2')),
      'expected at least one message to mention "Amazon Linux 2"'
    );
  });
});

test('check-textlint: should not flag supported environment examples (Amazon Linux 2023)', async () => {
  await withTempDir(async (tmpRoot) => {
    await fs.writeFile(path.join(tmpRoot, 'doc.md'), 'FROM amazonlinux:2023\nAmazon Linux 2023\n', 'utf8');

    const { result, report } = runCheckTextlint(tmpRoot, { failOn: 'none' });

    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}\n${result.stderr}`);
    assert.ok(report, 'report should be generated');
    assert.equal(report.summary.errors, 0, `expected 0 errors, got ${report.summary.errors}`);
  });
});

// #181: keep PRH's YAML 3 parser/schema; only its CLI argument dependency changes.
const prhRequire = createRequire(import.meta.url);
const yamlRequire = createRequire(prhRequire.resolve('prh'));
const argparseRequire = createRequire(yamlRequire.resolve('js-yaml'));
const yamlCli = yamlRequire.resolve('js-yaml/bin/js-yaml.js');

test('PRH dependency closure removes sprintf without replacing its YAML parser', () => {
  assert.match(yamlRequire('js-yaml/package.json').version, /^3\./);
  assert.equal(argparseRequire('argparse/package.json').version, '2.0.1');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(Object.keys(lock.packages).some(p => /(?:^|\/)node_modules\/sprintf-js$/.test(p)), false);
  const yaml = yamlRequire('js-yaml');
  assert.deepEqual(yaml.load('base: &value {expected: API}\ncopy: *value\n'), {
    base: { expected: 'API' }, copy: { expected: 'API' }
  });
  assert.throws(() => yaml.load('broken: [\n'));
});

test('PRH dictionary imports, disableImports and replacement semantics are retained', async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'base.yml'), 'version: 1\nrules:\n  - expected: GitHub\n    pattern: Github\n');
    const source = 'version: 1\nimports:\n  - base.yml\nrules:\n  - expected: API\n    pattern: Api\n';
    const prh = prhRequire('prh');
    const engine = prh.fromYAML(path.join(dir, 'rules.yml'), source);
    assert.equal(engine.makeChangeSet('fixture.md', 'Github Api').applyChangeSets('Github Api'), 'GitHub API');
    const isolated = prh.fromYAML(path.join(dir, 'rules.yml'), source, { disableImports: true });
    assert.equal(isolated.makeChangeSet('fixture.md', 'Github Api').applyChangeSets('Github Api'), 'Github API');
    assert.equal(engine.makeChangeSet('fixture.md', 'GitHub API').diffs.length, 0);
  });
});

for (const args of [[], ['--compact'], ['--trace'], ['--to-json']]) {
  test(`PRH YAML CLI legacy arguments still parse stdin: ${JSON.stringify(args)}`, () => {
    const r = spawnSync(process.execPath, [yamlCli, ...args], {
      input: 'key: value\nitems: [one, two]\n', encoding: 'utf8', timeout: 10000
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { key: 'value', items: ['one', 'two'] });
    // Argparse2 supports deprecated camelCase aliases. Do not hide this warning
    // with NODE_NO_WARNINGS or pretend that direct YAML CLI stderr is unchanged.
    assert.match(r.stderr, /DeprecationWarning/);
  });
}
for (const args of [['--help'], ['--version']]) {
  test(`dependency-internal YAML CLI observed boundary: ${args[0]}`, () => {
    const r = spawnSync(process.execPath, [yamlCli, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    if (args[0] === '--version') {
      // Operator-approved QA-only support boundary (#181). This is a known
      // lost version display, NOT a claim of nested CLI backward compatibility.
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    } else {
      assert.match(r.stdout, /usage:/i);
    }
  });
}
test('PRH YAML CLI rejects unknown arguments and malformed YAML', () => {
  for (const [args, input, exit] of [[['--unknown-fixture-option'], 'key: value', 2], [['--compact'], 'broken: [', 1]]) {
    const r = spawnSync(process.execPath, [yamlCli, ...args], { input, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, exit, r.stderr);
    assert.ok(r.stderr.trim());
  }
});

test('supported PRH CLI still reports its own version', () => {
  const r = spawnSync(process.execPath, [prhRequire.resolve('prh/bin/prh'), '--version'], {
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), prhRequire('prh/package.json').version);
  assert.equal(r.stderr, '');
});
test('dependency-internal CLI strict-warning mode remains explicitly unsupported', () => {
  const r = spawnSync(process.execPath, ['--throw-deprecation', yamlCli], {
    input: 'key: value\n', encoding: 'utf8', timeout: 10000
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DeprecationWarning/);
  assert.equal(r.stdout, '');
});

// The security override must not be advertised to npm versions that ignore it.
test('npm support floor and lock metadata require overrides-aware npm', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(manifest.engines.npm, '>=8.3.0');
  assert.equal(lock.packages[''].engines.npm, manifest.engines.npm);
  for (const guide of ['README.md', 'docs/book-creation-guide.md']) {
    const text = readFileSync(guide, 'utf8');
    assert.match(text, /npm 8\.3\.0以上/);
    assert.doesNotMatch(text, /npm 8\.0\.0以上/);
  }
});
