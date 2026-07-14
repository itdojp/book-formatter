import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import fs from 'fs-extra';
import {
  MAX_TARGET_BOOKS,
  WRITE_CONFIRMATION_TOKEN,
  validateBookSyncRequest
} from '../scripts/validate-book-sync-request.js';

const WORKFLOW_PATH = path.resolve('.github/workflows/book-sync.yml');
const ALLOWLIST_PATH = path.resolve('config/book-sync-allowlist.json');
const TEST_ALLOWLIST = ['book-a', 'book_b', 'Book.C', 'a', 'b', 'c', 'd'];

function workflow() {
  return parse(readFileSync(WORKFLOW_PATH, 'utf8'));
}

function validateForTest(request) {
  return validateBookSyncRequest({
    ...request,
    allowedRepositories: TEST_ALLOWLIST
  });
}

test('book-sync: manual-only、dry-run既定、全dispatch直列化を構造として保持する', () => {
  const document = workflow();

  assert.deepStrictEqual(Object.keys(document.on), ['workflow_dispatch']);
  const inputs = document.on.workflow_dispatch.inputs;
  assert.equal(inputs.target_books.required, true);
  assert.equal(inputs.dry_run.default, true);
  assert.equal(inputs.dry_run.type, 'boolean');
  assert.match(inputs.confirmation_token.description, /WRITE_BOOK_SYNC/);
  assert.deepStrictEqual(document.concurrency, {
    group: 'book-sync',
    'cancel-in-progress': false
  });
  assert.deepStrictEqual(document.permissions, { contents: 'read' });
});

test('book-sync: 検証後にdry-runとwriteを分離し、write tokenをfail-closedで要求する', () => {
  const document = workflow();
  const dryRun = document.jobs['dry-run'];
  const writeSync = document.jobs['write-sync'];
  const source = readFileSync(WORKFLOW_PATH, 'utf8');

  assert.equal(dryRun.needs, 'validate-request');
  assert.equal(dryRun.if, '${{ inputs.dry_run }}');
  assert.equal(writeSync.needs, 'validate-request');
  assert.equal(writeSync.if, '${{ ! inputs.dry_run }}');
  assert.equal(writeSync.env.GH_TOKEN, undefined);
  const tokenSteps = writeSync.steps.filter((step) => step.env?.GH_TOKEN);
  assert.equal(tokenSteps.length, 3);
  assert.ok(tokenSteps.every((step) => step.env.GH_TOKEN === '${{ secrets.BOOK_SYNC_TOKEN }}'));
  const dryRunToken = dryRun.steps.find((step) => step.env?.GH_TOKEN)?.env.GH_TOKEN;
  assert.equal(dryRunToken, '${{ secrets.BOOK_SYNC_READ_TOKEN || github.token }}');
  assert.match(source, /BOOK_SYNC_TOKEN is not configured/);
  assert.match(source, /collaborators\/\$REQUESTING_ACTOR\/permission/);
  assert.match(source, /\.permission == "admin" or \.permission == "write"/);
  assert.match(source, /does not have write access to itdojp\/\$book/);
  assert.match(source, /already has an open pull request/);
  assert.match(source, /scripts\/sync-components\.js \\\n\s+--book/);
  assert.match(source, /--components layouts includes assets/);
  assert.match(source, /scripts\/validate-book-sync-paths\.js/);
  assert.match(source, /git add --pathspec-from-file="\$approved_pathspec" --pathspec-file-nul/);
  assert.doesNotMatch(source, /src\/index\.js update-book/);
  assert.match(source, /git diff --cached --check/);
  assert.match(source, /compensating prior remote changes/);
  assert.match(source, /gh pr close/);
  assert.match(source, /push origin --delete/);
  assert.doesNotMatch(source, /git add -A/);
  assert.doesNotMatch(source, /^\s{2}push:/m);
});

test('book-sync request: 正常なdry-run/write requestを正規化する', () => {
  assert.equal(
    validateForTest({
      targetBooks: ' book-a,book_b,Book.C ',
      dryRun: 'true'
    }),
    'book-a,book_b,Book.C'
  );
  assert.equal(
    validateForTest({
      targetBooks: 'book-a',
      dryRun: 'false',
      confirmationToken: WRITE_CONFIRMATION_TOKEN
    }),
    'book-a'
  );
});

test('book-sync request: 不正または過大な対象指定を拒否する', () => {
  const invalidRequests = [
    [{ targetBooks: '', dryRun: 'true' }, /at least one/],
    [{ targetBooks: 'book-a,', dryRun: 'true' }, /empty repository/],
    [{ targetBooks: 'book-a,,book-b', dryRun: 'true' }, /empty repository/],
    [{ targetBooks: 'ALL', dryRun: 'true' }, /all target/],
    [{ targetBooks: 'book/a', dryRun: 'true' }, /Invalid repository/],
    [{ targetBooks: 'book-a,BOOK-A', dryRun: 'true' }, /Duplicate repository/],
    [{ targetBooks: 'a,b,c,d', dryRun: 'true' }, new RegExp(`at most ${MAX_TARGET_BOOKS}`)],
    [{ targetBooks: 'a'.repeat(101), dryRun: 'true' }, /exceeds 100/],
    [{ targetBooks: 'book-a', dryRun: 'yes' }, /true or false/],
    [{ targetBooks: 'book-a', dryRun: 'false' }, /confirmation_token/],
    [{ targetBooks: 'unknown-book', dryRun: 'true' }, /not in the book sync allowlist/]
  ];

  for (const [request, expected] of invalidRequests) {
    assert.throws(() => validateForTest(request), expected);
  }
});

test('book-sync allowlist: published bookだけを重複なく保持する', () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  assert.equal(allowlist.schemaVersion, 1);
  assert.equal(allowlist.organization, 'itdojp');
  assert.equal(allowlist.repositories.length, 42);
  assert.equal(new Set(allowlist.repositories.map((name) => name.toLowerCase())).size, 42);
  assert.ok(allowlist.repositories.includes('theoretical-computer-science-textbook'));
  assert.ok(!allowlist.repositories.includes('book-formatter'));
  assert.ok(!allowlist.repositories.includes('it-engineer-knowledge-architecture'));
});

test('book-sync validator CLI: checked-in allowlistを読みcanonical outputだけを書き出す', () => {
  const tempDir = mkdtempSync(path.join('tests', 'tmp-book-sync-validator-'));
  const outputPath = path.join(tempDir, 'github-output');
  try {
    const result = spawnSync(process.execPath, ['scripts/validate-book-sync-request.js'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TARGET_BOOKS: 'bioinformaticsguide-book',
        DRY_RUN: 'true',
        CONFIRMATION_TOKEN: '',
        GITHUB_OUTPUT: outputPath
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(outputPath, 'utf8'), 'target_books=BioinformaticsGuide-book\n');

    const rejected = spawnSync(process.execPath, ['scripts/validate-book-sync-request.js'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TARGET_BOOKS: 'it-engineer-knowledge-architecture',
        DRY_RUN: 'true',
        CONFIRMATION_TOKEN: '',
        GITHUB_OUTPUT: outputPath
      }
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /not in the book sync allowlist/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('component sync: 同一内容への再同期ではlastSyncだけを書き換えない', async () => {
  const tempDir = mkdtempSync(path.join('tests', 'tmp-component-sync-'));

  try {
    const sharedDir = path.resolve('shared');
    const sharedVersion = await fs.readJson(path.join(sharedDir, 'version.json'));
    const initialConfig = {
      title: 'Component sync no-op fixture',
      shared: {
        version: sharedVersion.version,
        lastSync: '2026-01-01T00:00:00.000Z',
        components: { templates: true, schemas: true }
      }
    };
    const configPath = path.join(tempDir, 'book-config.json');
    await fs.writeJson(configPath, initialConfig, { spaces: 2 });

    const layoutFiles = sharedVersion.components.layouts.files;
    for (const file of layoutFiles) {
      const sourcePath = path.join(sharedDir, file);
      const destPath = path.join(tempDir, 'docs', '_layouts', path.basename(file));
      await fs.ensureDir(path.dirname(destPath));
      await fs.copy(sourcePath, destPath);
    }

    const before = readFileSync(configPath, 'utf8');
    const noOp = spawnSync(
      process.execPath,
      ['scripts/sync-components.js', '--book', tempDir, '--components', 'layouts'],
      { encoding: 'utf8' }
    );
    assert.equal(noOp.status, 0, noOp.stderr);
    assert.equal(readFileSync(configPath, 'utf8'), before);
    assert.equal(await fs.pathExists(path.join(tempDir, 'templates')), false);
    assert.equal(await fs.pathExists(path.join(tempDir, 'schemas')), false);

    const staleDest = path.join(tempDir, 'docs', '_layouts', path.basename(layoutFiles[0]));
    await fs.writeFile(staleDest, 'stale layout\n');
    const changed = spawnSync(
      process.execPath,
      ['scripts/sync-components.js', '--book', tempDir, '--components', 'layouts'],
      { encoding: 'utf8' }
    );
    assert.equal(changed.status, 0, changed.stderr);

    assert.deepStrictEqual(
      await fs.readFile(staleDest),
      await fs.readFile(path.join(sharedDir, layoutFiles[0]))
    );
    const updatedConfig = await fs.readJson(configPath);
    assert.equal(updatedConfig.shared.version, sharedVersion.version);
    assert.notEqual(updatedConfig.shared.lastSync, initialConfig.shared.lastSync);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('book-sync path guard: 許可pathだけをNUL pathspecへ出力し、想定外pathを拒否する', async () => {
  const tempDir = mkdtempSync(path.join('tests', 'tmp-book-sync-paths-'));
  const repoDir = path.join(tempDir, 'book');
  const outputPath = path.join(tempDir, 'approved-paths');
  const runGit = (...args) => spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });

  try {
    await fs.ensureDir(path.join(repoDir, 'docs', 'assets'));
    await fs.writeFile(path.join(repoDir, 'book-config.json'), '{}\n');
    await fs.writeFile(path.join(repoDir, 'docs', 'assets', 'existing.css'), 'body {}\n');
    assert.equal(runGit('init').status, 0);
    assert.equal(runGit('config', 'user.name', 'Book Sync Test').status, 0);
    assert.equal(runGit('config', 'user.email', 'book-sync@example.invalid').status, 0);
    assert.equal(runGit('add', '.').status, 0);
    assert.equal(runGit('commit', '-m', 'fixture').status, 0);

    await fs.writeFile(path.join(repoDir, 'book-config.json'), '{"shared":{}}\n');
    await fs.writeFile(path.join(repoDir, 'docs', 'assets', 'new.css'), 'a {}\n');
    const approved = spawnSync(
      process.execPath,
      ['scripts/validate-book-sync-paths.js', '--repo', repoDir, '--output', outputPath],
      { encoding: 'utf8' }
    );
    assert.equal(approved.status, 0, approved.stderr);
    assert.deepStrictEqual(
      (await fs.readFile(outputPath, 'utf8')).split('\0').filter(Boolean).sort(),
      ['book-config.json', 'docs/assets/new.css']
    );

    await fs.ensureDir(path.join(repoDir, 'manuscript'));
    await fs.writeFile(path.join(repoDir, 'manuscript', 'chapter.md'), '# unexpected\n');
    const rejected = spawnSync(
      process.execPath,
      ['scripts/validate-book-sync-paths.js', '--repo', repoDir, '--output', outputPath],
      { encoding: 'utf8' }
    );
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Refusing unexpected sync path\(s\): manuscript\/chapter\.md/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
