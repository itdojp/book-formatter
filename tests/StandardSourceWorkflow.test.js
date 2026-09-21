// Execute the exact lightweight workflow block with a synthetic copied book.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const workflow = YAML.parse(await fs.readFile(path.join(ROOT, '.github/workflows/quality-check.yml'), 'utf8'));
const step = workflow.jobs['validate-templates'].steps.find((item) => item.name === 'Validate standard book source gates');
assert.ok(step, 'lightweight source gate must remain wired into CI');
assert.equal(step.shell, 'bash');
assert.equal(step['continue-on-error'], undefined);
assert.equal(step.if, undefined);

async function runFixture(context, mutate = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'standard-cli-'));
  context.after(() => fs.remove(directory));
  const book = path.join(directory, 'book');
  const reports = path.join(directory, 'reports');
  await fs.copy(path.join(ROOT, 'examples/standard-book'), book);
  await mutate(book);
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, BOOK_ROOT: book, QA_REPORT_DIR: reports }
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { result, reports };
}

async function metadata(book, mutate) {
  const filename = path.join(book, 'book.yaml');
  const data = YAML.parse(await fs.readFile(filename, 'utf8'));
  mutate(data);
  await fs.writeFile(filename, YAML.stringify(data));
}

test('lightweight CI: standard schema/visibility/Markdown commands succeed', async (context) => {
  const { result, reports } = await runFixture(context);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /schema_version=1, documents=5, editions=4/);
  assert.equal((await fs.readJson(path.join(reports, 'visibility.json'))).summary.safe, true);
  const markdown = await fs.readJson(path.join(reports, 'markdown.json'));
  assert.equal(markdown.summary.errors, 0);
  assert.equal(markdown.summary.warnings, 0);
});

test('lightweight CI: schema failure stops before producing downstream reports', async (context) => {
  const { result, reports } = await runFixture(context, (book) => metadata(book, (data) => { data.schema_version = 999; }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Standard book validation failed/);
  assert.equal(await fs.pathExists(reports), false);
});

test('lightweight CI: paid document in free edition fails, no Markdown success hides it', async (context) => {
  const { result, reports } = await runFixture(context, (book) => metadata(book, (data) => {
    data.editions.find((edition) => edition.id === 'free').documents.push('afterword');
  }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = await fs.readJson(path.join(reports, 'visibility.json'));
  assert.equal(report.summary.safe, false);
  assert.ok(report.findings.some((finding) => finding.code === 'incompatible_document_visibility'));
  assert.equal(await fs.pathExists(path.join(reports, 'markdown.json')), false);
});

test('lightweight CI: malformed Markdown fails after schema and visibility pass', async (context) => {
  const { result, reports } = await runFixture(context, (book) => fs.writeFile(
    path.join(book, 'README.md'), '---\ntitle: "unclosed\n---\n# Synthetic invalid YAML\n'
  ));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal((await fs.readJson(path.join(reports, 'visibility.json'))).summary.safe, true);
  const markdown = await fs.readJson(path.join(reports, 'markdown.json'));
  assert.ok(markdown.summary.errors > 0);
  assert.ok(markdown.issues.some((finding) => finding.kind === 'invalid_front_matter'));
});
