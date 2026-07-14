import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
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
  assert.match(source, /scripts\/sync-components\.js --book/);
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
