import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookGenerator } from '../src/BookGenerator.js';
import {
  ConsumerMutationBoundary,
  MAX_CONSUMERS,
  loadConsumerMutationPlan,
  selectConsumers
} from '../src/ConsumerMutationBoundary.js';
import { UxRollout } from '../src/UxRollout.js';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));

function git(repoRoot, ...args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

async function initRepository(repoRoot, files = {}) {
  await fs.ensureDir(repoRoot);
  git(repoRoot, 'init', '--initial-branch=main');
  git(repoRoot, 'config', 'user.name', 'Book Formatter Test');
  git(repoRoot, 'config', 'user.email', 'book-formatter@example.invalid');
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content);
  }
  git(repoRoot, 'add', '--all');
  git(repoRoot, 'commit', '-m', 'test fixture');
  return git(repoRoot, 'rev-parse', 'HEAD');
}

async function createLinkedConsumer(tempRoot, options = {}) {
  const sourceRoot = path.join(tempRoot, options.name || 'consumer-source');
  const config = options.config || {
    title: 'Audited consumer',
    description: 'Synthetic consumer fixture',
    author: 'Test Author',
    version: '1.0.0',
    language: 'ja',
    repository: {
      url: 'https://github.com/example/sample-book.git',
      branch: 'main'
    },
    structure: {
      chapters: [{ id: 'intro', title: 'Introduction' }]
    },
    shared: {
      version: '0.0.0',
      components: {
        layouts: true,
        includes: true,
        assets: { css: true, js: true }
      }
    }
  };
  const baseSha = await initRepository(sourceRoot, {
    '.gitignore': 'ignored-output.txt\n',
    'book-config.json': `${JSON.stringify(config, null, 2)}\n`,
    '_config.yml': 'title: Audited consumer\n',
    'index.md': '# Existing landing page\n',
    'src/chapter-intro/index.md': '# Existing chapter\n',
    ...(options.files || {})
  });
  const worktree = path.join(tempRoot, `${options.name || 'consumer'}-worktree`);
  git(sourceRoot, 'worktree', 'add', '--detach', worktree, baseSha);
  return { sourceRoot, worktree, baseSha, config };
}

async function createFormatterFixture(tempRoot) {
  const formatterRoot = path.join(tempRoot, 'formatter-fixture');
  const formatterSha = await initRepository(formatterRoot, {
    'audited.txt': 'formatter fixture\n'
  });
  return { formatterRoot, formatterSha };
}

function planFor({ operation, formatterSha, consumers, planPath }) {
  return {
    schemaVersion: 1,
    operation,
    formatterSha,
    consumers,
    path: planPath,
    directory: path.dirname(planPath)
  };
}

function consumerEntry({ id = 'sample-book', worktree, baseSha, allowedPaths = [] }) {
  return {
    id,
    worktree,
    baseSha,
    allowedPaths: [...allowedPaths].sort(),
    configPath: null,
    configSha256: null
  };
}

async function snapshotFiles(root) {
  const files = {};
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isSymbolicLink()) {
        files[relative] = `symlink:${await fs.readlink(absolute)}`;
      } else {
        files[relative] = (await fs.readFile(absolute)).toString('base64');
      }
    }
  };
  await visit(root);
  return files;
}

describe('ConsumerMutationBoundary plan', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(TEST_ROOT, 'tmp-consumer-plan-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  async function writePlan(overrides = {}) {
    const raw = {
      schemaVersion: 1,
      operation: 'update-book',
      formatterSha: 'a'.repeat(40),
      consumers: [{
        id: 'book-a',
        worktree: './book-a',
        baseSha: 'b'.repeat(40),
        allowedPaths: ['book-config.json']
      }],
      ...overrides
    };
    const planPath = path.join(tempDir, 'plan.json');
    await fs.writeJson(planPath, raw, { spaces: 2 });
    return { raw, planPath };
  }

  test('strict finite planを読み込み、writeは単一targetだけを許可する', async () => {
    const { planPath } = await writePlan();
    const plan = await loadConsumerMutationPlan(planPath, {
      expectedOperation: 'update-book'
    });
    assert.strictEqual(plan.consumers.length, 1);
    assert.throws(
      () => selectConsumers(plan, { dryRun: false }),
      /Write mode requires --target/
    );
    assert.deepStrictEqual(
      selectConsumers(plan, { dryRun: false, targetId: 'book-a' }).map(({ id }) => id),
      ['book-a']
    );
    assert.deepStrictEqual(
      selectConsumers(plan, { dryRun: true }).map(({ id }) => id),
      ['book-a']
    );
  });

  test('0件、重複、上限超過、unknown key、operation不一致を拒否する', async () => {
    for (const [name, overrides, pattern] of [
      ['empty', { consumers: [] }, /at least one consumer/],
      ['duplicate-id', {
        consumers: [
          { id: 'same', worktree: './a', baseSha: 'b'.repeat(40) },
          { id: 'same', worktree: './b', baseSha: 'c'.repeat(40) }
        ]
      }, /duplicate IDs/],
      ['duplicate-root', {
        consumers: [
          { id: 'a', worktree: './same', baseSha: 'b'.repeat(40) },
          { id: 'b', worktree: './same', baseSha: 'c'.repeat(40) }
        ]
      }, /duplicate worktrees/],
      ['too-many', {
        consumers: Array.from({ length: MAX_CONSUMERS + 1 }, (_, index) => ({
          id: `book-${index}`,
          worktree: `./book-${index}`,
          baseSha: 'b'.repeat(40)
        }))
      }, /finite maximum/],
      ['unknown', { unexpected: true }, /unknown key/]
    ]) {
      const planPath = path.join(tempDir, `${name}.json`);
      const base = (await writePlan()).raw;
      await fs.writeJson(planPath, { ...base, ...overrides });
      await assert.rejects(loadConsumerMutationPlan(planPath), pattern);
    }

    const { planPath } = await writePlan();
    await assert.rejects(
      loadConsumerMutationPlan(planPath, { expectedOperation: 'sync-all-books' }),
      /plan.operation must be sync-all-books/
    );
  });

  test('path escape、absolute path、重複allowlist、symlink planを拒否する', async () => {
    for (const [name, allowedPaths, pattern] of [
      ['escape', ['../outside'], /stay below/],
      ['absolute', ['/outside'], /stay below/],
      ['duplicate', ['index.md', 'index.md'], /duplicate paths/]
    ]) {
      const { raw } = await writePlan();
      raw.consumers[0].allowedPaths = allowedPaths;
      const planPath = path.join(tempDir, `${name}.json`);
      await fs.writeJson(planPath, raw);
      await assert.rejects(loadConsumerMutationPlan(planPath), pattern);
    }

    const { planPath } = await writePlan();
    const symlinkPath = path.join(tempDir, 'plan-link.json');
    await fs.symlink(planPath, symlinkPath);
    await assert.rejects(
      loadConsumerMutationPlan(symlinkPath),
      /regular non-symlink file/
    );
  });
});

describe('ConsumerMutationBoundary transaction', () => {
  let tempDir;
  let formatter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(TEST_ROOT, 'tmp-consumer-boundary-'));
    formatter = await createFormatterFixture(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  function createBoundary() {
    return new ConsumerMutationBoundary({
      formatterRoot: formatter.formatterRoot,
      enforceFormatterCwd: false
    });
  }

  test('fixed formatter SHA、clean linked worktree、base SHAを要求する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const basePlan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });

    await assert.rejects(
      createBoundary().preflight({
        plan: { ...basePlan, formatterSha: 'f'.repeat(40) },
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /Formatter HEAD mismatch/
    );

    git(formatter.formatterRoot, 'update-index', '--skip-worktree', 'audited.txt');
    await fs.writeFile(path.join(formatter.formatterRoot, 'audited.txt'), 'hidden change\n');
    assert.strictEqual(
      git(formatter.formatterRoot, 'status', '--porcelain', '--untracked-files=no'),
      ''
    );
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /tracked file differs/
    );
    git(formatter.formatterRoot, 'update-index', '--no-skip-worktree', 'audited.txt');
    git(formatter.formatterRoot, 'checkout', '--', 'audited.txt');

    await fs.writeFile(path.join(fixture.worktree, 'dirty.txt'), 'dirty\n');
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /must be clean/
    );
    await fs.remove(path.join(fixture.worktree, 'dirty.txt'));

    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer: { ...consumer, baseSha: 'e'.repeat(40) },
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /base SHA mismatch/
    );

    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer: { ...consumer, worktree: fixture.sourceRoot },
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /isolated linked worktree/
    );
  });

  test('root、ancestor、final symlinkをcallback前に拒否しconsumer外へ書かない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const outside = path.join(tempDir, 'outside');
    await fs.ensureDir(outside);
    const marker = path.join(outside, 'marker.txt');
    const rootLink = path.join(tempDir, 'root-link');
    await fs.symlink(fixture.worktree, rootLink, 'dir');

    for (const [name, worktree, prepare, pattern] of [
      ['root', rootLink, async () => {}, /Consumer root must not be a symbolic link/],
      ['ancestor', fixture.worktree, async () => {
        await fs.symlink(outside, path.join(fixture.worktree, 'managed'), 'dir');
      }, /must not contain a symbolic link/],
      ['final', fixture.worktree, async () => {
        await fs.ensureDir(path.join(fixture.worktree, 'managed'));
        await fs.symlink(marker, path.join(fixture.worktree, 'managed', 'file.txt'));
      }, /must not contain a symbolic link/]
    ]) {
      git(fixture.worktree, 'reset', '--hard', fixture.baseSha);
      git(fixture.worktree, 'clean', '-fd');
      await prepare();
      let auditedBase = fixture.baseSha;
      if (name !== 'root') {
        git(fixture.worktree, 'add', '--all');
        git(fixture.worktree, 'commit', '-m', `${name} boundary fixture`);
        auditedBase = git(fixture.worktree, 'rev-parse', 'HEAD');
      }
      const consumer = consumerEntry({
        id: name,
        worktree,
        baseSha: auditedBase,
        allowedPaths: ['managed/file.txt']
      });
      const plan = planFor({
        operation: 'update-book',
        formatterSha: formatter.formatterSha,
        consumers: [consumer],
        planPath: path.join(tempDir, 'plan.json')
      });
      let called = false;
      await assert.rejects(
        createBoundary().run({
          plan,
          consumer,
          managedPaths: ['managed/file.txt'],
          dryRun: false,
          mutate: async () => {
            called = true;
            await fs.writeFile(marker, 'outside write\n');
          }
        }),
        pattern
      );
      assert.strictEqual(called, false, `${name}: callback must not run`);
      assert.strictEqual(await fs.pathExists(marker), false, `${name}: outside write must be 0`);
    }
  });

  test('operation failureとallowlist外差分をbase SHAへrollbackし、明示再開できる', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const boundary = createBoundary();

    await assert.rejects(
      boundary.run({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async ({ consumerRoot }) => {
          await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Partial\n');
          throw new Error('synthetic interruption');
        }
      }),
      /rolled back/
    );
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
    assert.strictEqual(await fs.readFile(path.join(fixture.worktree, 'index.md'), 'utf8'), '# Existing landing page\n');

    await assert.rejects(
      boundary.run({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async ({ consumerRoot }) => {
          await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Allowed\n');
          await fs.writeFile(path.join(consumerRoot, 'unexpected.txt'), 'unexpected\n');
        }
      }),
      /outside allowedPaths/
    );
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
    assert.strictEqual(await fs.pathExists(path.join(fixture.worktree, 'unexpected.txt')), false);

    await assert.rejects(
      boundary.run({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async ({ consumerRoot }) => {
          await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Allowed\n');
          await fs.writeFile(path.join(consumerRoot, 'ignored-output.txt'), 'ignored\n');
        }
      }),
      /outside allowedPaths/
    );
    assert.strictEqual(await fs.pathExists(path.join(fixture.worktree, 'ignored-output.txt')), false);

    const resumed = await boundary.run({
      plan,
      consumer,
      managedPaths: ['index.md'],
      dryRun: false,
      mutate: async ({ consumerRoot }) => {
        await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Resumed\n');
      }
    });
    assert.deepStrictEqual(resumed.changedPaths, ['index.md']);
  });

  test('dry-runはcallbackを実行せずfile内容を変更しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const before = await snapshotFiles(fixture.worktree);
    let called = false;
    const result = await createBoundary().run({
      plan,
      consumer,
      managedPaths: ['index.md'],
      dryRun: true,
      mutate: async () => { called = true; }
    });
    assert.strictEqual(called, false);
    assert.strictEqual(result.dryRun, true);
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), before);
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
  });
});

describe('audited legacy operations', () => {
  let tempDir;
  let formatter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(TEST_ROOT, 'tmp-legacy-operation-'));
    formatter = await createFormatterFixture(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  function dependencies() {
    const boundary = new ConsumerMutationBoundary({
      formatterRoot: formatter.formatterRoot,
      enforceFormatterCwd: false
    });
    return {
      boundary,
      generator: new BookGenerator({ mutationBoundary: boundary }),
      rollout: new UxRollout({ mutationBoundary: boundary })
    };
  }

  test('update-bookはmanaged metadata/templateだけを更新しsibling backupを作らない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const { boundary, generator } = dependencies();
    const consumer = consumerEntry({ ...fixture });
    const managedPaths = await generator.getLegacyUpdateManagedPaths(
      fixture.config,
      fixture.worktree
    );
    consumer.allowedPaths = managedPaths;
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const result = await generator.updateBook(plan, consumer);

    assert.ok(result.changedPaths.length > 0);
    assert.ok(result.changedPaths.every((entry) => managedPaths.includes(entry)));
    assert.ok(result.changedPaths.every((entry) => !entry.startsWith('src/')));
    assert.deepStrictEqual(
      (await fs.readdir(tempDir)).filter((entry) => entry.includes('.backup-')),
      []
    );
    assert.strictEqual(git(fixture.worktree, 'rev-parse', 'HEAD'), fixture.baseSha);
    assert.strictEqual(boundary.formatterRoot, formatter.formatterRoot);
  });

  test('update-book dry-runは内容不変、途中失敗はrollbackする', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const { generator } = dependencies();
    const consumer = consumerEntry({ ...fixture });
    consumer.allowedPaths = await generator.getLegacyUpdateManagedPaths(
      fixture.config,
      fixture.worktree
    );
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const before = await snapshotFiles(fixture.worktree);
    await generator.updateBook(plan, consumer, { dryRun: true });
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), before);

    const originalUpdateFiles = generator.updateFiles.bind(generator);
    generator.updateFiles = async (config, root) => {
      await fs.writeFile(path.join(root, 'index.md'), '# Partial generator output\n');
      throw new Error('synthetic generator failure');
    };
    await assert.rejects(generator.updateBook(plan, consumer), /rolled back/);
    generator.updateFiles = originalUpdateFiles;
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
  });

  test('update-bookは本文自動生成をpreflightで拒否する', async () => {
    const config = {
      title: 'Audited consumer',
      description: 'Synthetic consumer fixture',
      author: 'Test Author',
      structure: { chapters: [{ id: 'missing', title: 'Missing' }] }
    };
    const fixture = await createLinkedConsumer(tempDir, { config });
    const { generator } = dependencies();
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['book-config.json'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    await assert.rejects(
      generator.updateBook(plan, consumer),
      /refuses automatic manuscript creation/
    );
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
  });

  test('UX profileはbook-configだけをtransaction内で更新しdry-runは内容不変', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const registryPath = path.join(tempDir, 'registry.json');
    await fs.writeJson(registryPath, {
      books: {
        'sample-book': {
          profile: 'B',
          modules: {
            quickStart: false,
            readingGuide: false,
            checklistPack: true,
            troubleshootingFlow: true,
            conceptMap: false,
            figureIndex: true,
            legalNotice: false,
            glossary: false
          }
        }
      }
    });
    const { rollout } = dependencies();
    const consumer = consumerEntry({
      ...fixture,
      allowedPaths: ['book-config.json']
    });
    const plan = planFor({
      operation: 'rollout-ux-profile',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });

    const before = await snapshotFiles(fixture.worktree);
    await rollout.rollout({
      plan,
      consumers: [consumer],
      registryPath,
      applyUxCore: false,
      applyUxProfile: true,
      dryRun: true
    });
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), before);

    await rollout.rollout({
      plan,
      consumers: [consumer],
      registryPath,
      applyUxCore: false,
      applyUxProfile: true,
      dryRun: false
    });
    const updated = await fs.readJson(path.join(fixture.worktree, 'book-config.json'));
    assert.strictEqual(updated.ux.profile, 'B');
    assert.deepStrictEqual(
      git(fixture.worktree, 'status', '--porcelain').split('\n').filter(Boolean),
      ['M book-config.json']
    );
  });

  test('UX profileはinvalid registryをdry-runでもfail-closedにする', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const registryPath = path.join(tempDir, 'invalid-registry.json');
    await fs.writeJson(registryPath, {
      books: {
        'sample-book': { profile: 'UNSUPPORTED', modules: {} }
      }
    });
    const { rollout } = dependencies();
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['book-config.json'] });
    const plan = planFor({
      operation: 'rollout-ux-profile',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const before = await snapshotFiles(fixture.worktree);
    await assert.rejects(
      rollout.rollout({
        plan,
        consumers: [consumer],
        registryPath,
        applyUxCore: false,
        applyUxProfile: true,
        dryRun: true
      }),
      /registry entry is invalid/
    );
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), before);
  });

  test('UX coreは#129 destination planを同じ単一consumer transactionで使う', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const { rollout } = dependencies();
    await rollout.componentSync.loadVersion();
    const components = rollout.componentSync.determineComponents(fixture.config, {
      components: ['layouts', 'includes', 'assets']
    });
    const syncPlan = rollout.componentSync.createSyncPlan(fixture.worktree, components);
    const allowedPaths = [
      'book-config.json',
      ...syncPlan.map((entry) => entry.destRel.split(path.sep).join('/'))
    ].sort();
    const consumer = consumerEntry({ ...fixture, allowedPaths });
    const plan = planFor({
      operation: 'rollout-ux-core',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const resultBefore = await snapshotFiles(fixture.worktree);
    await rollout.rollout({
      plan,
      consumers: [consumer],
      applyUxCore: true,
      applyUxProfile: false,
      dryRun: true
    });
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), resultBefore);

    await rollout.rollout({
      plan,
      consumers: [consumer],
      applyUxCore: true,
      applyUxProfile: false,
      dryRun: false
    });
    const changed = git(
      fixture.worktree,
      'status',
      '--porcelain',
      '--untracked-files=all'
    );
    assert.notStrictEqual(changed, '');
    for (const line of changed.split('\n')) {
      assert.ok(allowedPaths.some((allowedPath) => line.endsWith(allowedPath)), line);
    }
  });
});

test('rollout_unificationは安全な単一target wrapperでremote Git操作を内包しない', async () => {
  const scriptPath = path.resolve('scripts/rollout_unification.sh');
  const source = await fs.readFile(scriptPath, 'utf8');
  assert.match(source, /--plan <json> --target <consumer-id>/);
  assert.match(source, /rollout-ux/);
  assert.match(source, /--apply-ux-core/);
  assert.doesNotMatch(source, /gh pr create|git push|git commit|git checkout/);

  const result = await import('node:child_process').then(({ spawnSync }) => (
    spawnSync('bash', [scriptPath, '--dry-run'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        BOOK_FORMATTER_REPORT_ROOT: path.resolve('tests', 'tmp-shell-report-unused')
      }
    })
  ));
  assert.notStrictEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /--plan is required/);
  await fs.remove(path.resolve('tests', 'tmp-shell-report-unused'));
});
