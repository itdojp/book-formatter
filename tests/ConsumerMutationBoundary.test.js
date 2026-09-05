import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { runFreshDependencyBootstrap } from '../src/ConsumerDependencyBootstrap.js';

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
  await initRepository(formatterRoot, {
    '.gitignore': 'shared/assets/ignored.js\nnode_modules/\nbootstrap-plan.json\n',
    'package.json': `${JSON.stringify({
      name: 'consumer-boundary-formatter-fixture',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        'bootstrap-fixture-dependency': 'file:vendor/bootstrap-fixture-dependency'
      }
    }, null, 2)}\n`,
    'vendor/bootstrap-fixture-dependency/package.json': `${JSON.stringify({
      name: 'bootstrap-fixture-dependency',
      version: '1.0.0'
    }, null, 2)}\n`,
    'vendor/bootstrap-fixture-dependency/index.js': 'module.exports = {};\n',
    'audited.txt': 'formatter fixture\n',
    'shared/layouts/default.html': '<main>{{ content }}</main>\n',
    'shared/includes/navigation.html': '<nav>fixture</nav>\n',
    'shared/assets/main.css': 'main { display: block; }\n'
  });
  const lockResult = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: formatterRoot, encoding: 'utf8' }
  );
  assert.strictEqual(lockResult.status, 0, lockResult.stderr);
  git(formatterRoot, 'add', 'package-lock.json');
  git(formatterRoot, 'commit', '--amend', '--no-edit');
  const formatterSha = git(formatterRoot, 'rev-parse', 'HEAD');
  return { formatterRoot, formatterSha };
}

function planFor({
  operation,
  formatterSha,
  consumers,
  planPath,
  registryPath = null,
  registrySha256 = null
}) {
  return {
    schemaVersion: 1,
    operation,
    formatterSha,
    registryPath,
    registrySha256,
    consumers,
    path: planPath,
    directory: path.dirname(planPath)
  };
}

function rawPlanFromNormalized(plan) {
  const raw = {
    schemaVersion: plan.schemaVersion,
    operation: plan.operation,
    formatterSha: plan.formatterSha,
    consumers: plan.consumers.map((consumer) => {
      const entry = {
        id: consumer.id,
        worktree: consumer.worktree,
        baseSha: consumer.baseSha,
        allowedPaths: consumer.allowedPaths
      };
      if (consumer.configPath !== null) {
        entry.configPath = consumer.configPath;
        entry.configSha256 = consumer.configSha256;
      }
      return entry;
    })
  };
  if (plan.registryPath !== null) {
    raw.registryPath = plan.registryPath;
    raw.registrySha256 = plan.registrySha256;
  }
  return raw;
}

function bootstrapArgsForPlan(plan) {
  if (plan.operation === 'update-book' || plan.operation === 'sync-all-books') {
    return [plan.operation, '--plan', plan.path];
  }
  const args = ['rollout-ux', '--plan', plan.path];
  if (plan.operation.includes('core')) args.push('--apply-ux-core');
  if (plan.operation.includes('profile')) args.push('--apply-ux-profile');
  return args;
}

function freshCapabilityForPlan(formatter, plan) {
  fs.writeJsonSync(plan.path, rawPlanFromNormalized(plan), { spaces: 2 });
  return runFreshDependencyBootstrap(
    bootstrapArgsForPlan(plan),
    {
      repositoryRoot: formatter.formatterRoot,
      cwd: formatter.formatterRoot,
      installStdio: 'pipe'
    }
  );
}

function freshBoundaryFacade(formatter) {
  let activePlan = null;
  let activeAttestedPlan = null;
  let boundary = null;
  const forPlan = (plan) => {
    if (activePlan !== plan && activeAttestedPlan !== plan) {
      boundary = new ConsumerMutationBoundary({
        formatterRoot: formatter.formatterRoot,
        enforceFormatterCwd: false,
        freshDependencyAttestation: freshCapabilityForPlan(formatter, plan)
      });
      activePlan = plan;
      activeAttestedPlan = null;
    }
    return boundary;
  };
  return {
    formatterRoot: formatter.formatterRoot,
    assertFreshDependencyRuntime(plan) {
      activeAttestedPlan = forPlan(plan).assertFreshDependencyRuntime(plan);
      return activeAttestedPlan;
    },
    resolveAttestedConsumer(plan, consumer) {
      return forPlan(plan).resolveAttestedConsumer(plan, consumer);
    },
    loadPinnedConfig(plan, consumer) {
      return forPlan(plan).loadPinnedConfig(plan, consumer);
    },
    loadPinnedRegistry(plan, registryPath) {
      return forPlan(plan).loadPinnedRegistry(plan, registryPath);
    },
    async preflight(options) {
      return forPlan(options.plan).preflight(options);
    },
    async run(options) {
      return forPlan(options.plan).run(options);
    }
  };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
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

  test('UX profile planはregistry pathとSHA-256の対を必須にする', async () => {
    const registrySha256 = 'c'.repeat(64);
    const { planPath } = await writePlan({
      operation: 'rollout-ux-profile',
      registryPath: './legacy-ux-registry.json',
      registrySha256
    });
    const plan = await loadConsumerMutationPlan(planPath, {
      expectedOperation: 'rollout-ux-profile'
    });
    assert.strictEqual(
      plan.registryPath,
      path.join(tempDir, 'legacy-ux-registry.json')
    );
    assert.strictEqual(plan.registrySha256, registrySha256);

    const missingHash = await writePlan({
      operation: 'rollout-ux-profile',
      registryPath: './legacy-ux-registry.json'
    });
    await assert.rejects(
      loadConsumerMutationPlan(missingHash.planPath),
      /registryPath and plan\.registrySha256 must be specified together/
    );

    const missingPair = await writePlan({ operation: 'rollout-ux-profile' });
    await assert.rejects(
      loadConsumerMutationPlan(missingPair.planPath),
      /requires a pinned registryPath and registrySha256/
    );

    const unusedPair = await writePlan({
      registryPath: './legacy-ux-registry.json',
      registrySha256
    });
    await assert.rejects(
      loadConsumerMutationPlan(unusedPair.planPath),
      /must not declare an unused profile registry/
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
    return freshBoundaryFacade(formatter);
  }

  test('caller-controlled capabilityによるprogrammatic mutationを拒否する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const boundary = new ConsumerMutationBoundary({
      formatterRoot: formatter.formatterRoot,
      enforceFormatterCwd: false,
      freshDependencyAttestation: {
        repositoryRoot: formatter.formatterRoot,
        formatterSha: formatter.formatterSha
      }
    });

    await assert.rejects(
      boundary.preflight({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: true
      }),
      /runtime capability is missing or invalid/
    );
  });

  test('attestation後のcaller-owned plan/consumer変更をtransactionへ反映しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const plannedConsumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const callerConsumer = {
      ...plannedConsumer,
      allowedPaths: [...plannedConsumer.allowedPaths]
    };
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [plannedConsumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const trapRoot = path.join(tempDir, 'caller-controlled-target');
    await fs.ensureDir(trapRoot);
    await fs.writeFile(path.join(trapRoot, 'index.md'), 'must remain unchanged\n');

    const transaction = createBoundary().run({
      plan,
      consumer: callerConsumer,
      managedPaths: ['index.md'],
      dryRun: false,
      mutate: async ({ consumerRoot }) => {
        await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Updated safely\n');
      }
    });

    plan.formatterSha = 'f'.repeat(40);
    plannedConsumer.worktree = trapRoot;
    plannedConsumer.baseSha = 'f'.repeat(40);
    plannedConsumer.allowedPaths.push('outside.md');
    callerConsumer.worktree = trapRoot;
    callerConsumer.baseSha = 'f'.repeat(40);
    callerConsumer.allowedPaths.push('outside.md');

    const result = await transaction;
    assert.strictEqual(result.consumerRoot, fixture.worktree);
    assert.strictEqual(
      await fs.readFile(path.join(fixture.worktree, 'index.md'), 'utf8'),
      '# Updated safely\n'
    );
    assert.strictEqual(
      await fs.readFile(path.join(trapRoot, 'index.md'), 'utf8'),
      'must remain unchanged\n'
    );
  });

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
      /Bootstrap formatter HEAD mismatch/
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
      /Tracked formatter bytes differ/
    );
    git(formatter.formatterRoot, 'update-index', '--no-skip-worktree', 'audited.txt');
    git(formatter.formatterRoot, 'checkout', '--', 'audited.txt');

    const attributesPath = path.resolve(
      formatter.formatterRoot,
      git(formatter.formatterRoot, 'rev-parse', '--git-path', 'info/attributes')
    );
    const formatterFilterMarker = path.join(tempDir, 'formatter-filter-executed');
    await fs.ensureDir(path.dirname(attributesPath));
    await fs.writeFile(attributesPath, 'audited.txt filter=normalize-audited\n');
    git(
      formatter.formatterRoot,
      'config',
      'filter.normalize-audited.clean',
      `touch ${formatterFilterMarker}; cat`
    );
    git(formatter.formatterRoot, 'config', 'filter.normalize-audited.required', 'true');
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /Formatter Git filter attributes are not allowed: audited\.txt \(normalize-audited\)/
    );
    assert.strictEqual(await fs.pathExists(formatterFilterMarker), false);
    git(formatter.formatterRoot, 'config', '--unset', 'filter.normalize-audited.required');
    git(formatter.formatterRoot, 'config', '--unset', 'filter.normalize-audited.clean');
    await fs.remove(attributesPath);
    assert.strictEqual(
      git(formatter.formatterRoot, 'status', '--porcelain', '--untracked-files=no'),
      ''
    );

    const consumerAttributes = path.resolve(
      fixture.worktree,
      git(fixture.worktree, 'rev-parse', '--git-path', 'info/attributes')
    );
    const normalizedConfigPath = path.join(tempDir, 'normalized-book-config.json');
    const originalConfig = await fs.readFile(path.join(fixture.worktree, 'book-config.json'));
    await fs.ensureDir(path.dirname(consumerAttributes));
    await fs.writeFile(consumerAttributes, 'book-config.json filter=normalize-config\n');
    await fs.writeFile(normalizedConfigPath, originalConfig);
    git(
      fixture.worktree,
      'config',
      'filter.normalize-config.clean',
      `cat >/dev/null; cat ${normalizedConfigPath}`
    );
    git(fixture.worktree, 'config', 'filter.normalize-config.required', 'true');
    await fs.writeFile(
      path.join(fixture.worktree, 'book-config.json'),
      '{"title":"working bytes hidden by clean filter"}\n'
    );
    git(fixture.worktree, 'add', 'book-config.json');
    assert.strictEqual(
      git(fixture.worktree, 'status', '--porcelain', '--untracked-files=no'),
      ''
    );
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /Consumer Git filter attributes are not allowed: book-config\.json \(normalize-config\)/
    );
    git(fixture.worktree, 'config', '--unset', 'filter.normalize-config.required');
    git(fixture.worktree, 'config', '--unset', 'filter.normalize-config.clean');
    await fs.remove(consumerAttributes);
    await fs.writeFile(path.join(fixture.worktree, 'book-config.json'), originalConfig);
    git(fixture.worktree, 'add', 'book-config.json');
    assert.strictEqual(
      git(fixture.worktree, 'status', '--porcelain', '--untracked-files=no'),
      ''
    );

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

    const wrongBaseConsumer = { ...consumer, baseSha: 'e'.repeat(40) };
    await assert.rejects(
      createBoundary().preflight({
        plan: { ...basePlan, consumers: [wrongBaseConsumer] },
        consumer: wrongBaseConsumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /base SHA mismatch/
    );

    const primaryCheckoutConsumer = { ...consumer, worktree: fixture.sourceRoot };
    await assert.rejects(
      createBoundary().preflight({
        plan: { ...basePlan, consumers: [primaryCheckoutConsumer] },
        consumer: primaryCheckoutConsumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /isolated linked worktree/
    );

    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer: { ...consumer, id: 'not-in-plan' },
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /exactly match an entry in the audited plan/
    );

    for (const [setFlag, clearFlag] of [
      ['--skip-worktree', '--no-skip-worktree'],
      ['--assume-unchanged', '--no-assume-unchanged']
    ]) {
      git(fixture.worktree, 'update-index', setFlag, 'book-config.json');
      await fs.writeFile(path.join(fixture.worktree, 'book-config.json'), '{"hidden":true}\n');
      await assert.rejects(
        createBoundary().preflight({
          plan: basePlan,
          consumer,
          managedPaths: ['index.md'],
          dryRun: false
        }),
        /must not use skip-worktree, assume-unchanged/
      );
      git(fixture.worktree, 'update-index', clearFlag, 'book-config.json');
      git(fixture.worktree, 'checkout', '--', 'book-config.json');
    }

    const replacement = git(
      fixture.worktree,
      'commit-tree',
      git(fixture.worktree, 'write-tree'),
      '-p',
      fixture.baseSha,
      '-m',
      'replacement fixture'
    );
    git(fixture.worktree, 'replace', fixture.baseSha, replacement);
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /must not contain Git replacement refs/
    );
    git(fixture.worktree, 'replace', '-d', fixture.baseSha);

    const formatterReplacement = git(
      formatter.formatterRoot,
      'commit-tree',
      git(formatter.formatterRoot, 'write-tree'),
      '-p',
      formatter.formatterSha,
      '-m',
      'formatter replacement fixture'
    );
    git(formatter.formatterRoot, 'replace', formatter.formatterSha, formatterReplacement);
    await assert.rejects(
      createBoundary().preflight({
        plan: basePlan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false
      }),
      /Formatter replacement refs are not allowed/
    );
    git(formatter.formatterRoot, 'replace', '-d', formatter.formatterSha);
  });

  test('mutation監査のGit subprocessへcallerのGIT_*環境を継承しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const previousGitDir = process.env.GIT_DIR;
    const previousGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = path.join(tempDir, 'caller-controlled-git-dir');
    process.env.GIT_WORK_TREE = path.join(tempDir, 'caller-controlled-worktree');
    try {
      const result = await createBoundary().preflight({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: true
      });
      assert.strictEqual(result.consumerRoot, fixture.worktree);
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = previousGitWorkTree;
    }
  });

  test('formatter mutation inputのuntracked/ignored fileを拒否する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });

    for (const relativePath of [
      'shared/layouts/injected.html',
      'shared/assets/ignored.js'
    ]) {
      const injectedPath = path.join(formatter.formatterRoot, relativePath);
      await fs.ensureDir(path.dirname(injectedPath));
      await fs.writeFile(injectedPath, 'untracked mutation input\n');
      await assert.rejects(
        createBoundary().preflight({
          plan,
          consumer,
          managedPaths: ['index.md'],
          dryRun: false
        }),
        /mutation inputs must come from the audited commit/
      );
      await fs.remove(injectedPath);
    }
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

  test('managed final fileのhard linkをcallback前に拒否する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const destination = path.join(fixture.worktree, 'index.md');
    const outside = path.join(tempDir, 'outside-hard-link.md');
    const original = await fs.readFile(destination);
    await fs.writeFile(outside, original);
    await fs.remove(destination);
    await fs.link(outside, destination);
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');

    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
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
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async () => { called = true; }
      }),
      /must not be hard-linked/
    );
    assert.strictEqual(called, false);
    assert.deepStrictEqual(await fs.readFile(outside), original);
  });

  test('consumer clean filterを実行前に拒否する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({
      ...fixture,
      allowedPaths: ['book-config.json']
    });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const attributes = path.resolve(
      fixture.worktree,
      git(fixture.worktree, 'rev-parse', '--git-path', 'info/attributes')
    );
    const marker = path.join(tempDir, 'clean-filter-executed');

    await fs.ensureDir(path.dirname(attributes));
    await fs.writeFile(attributes, '/index.md filter=side-effect\n');
    git(
      fixture.worktree,
      'config',
      'filter.side-effect.clean',
      `touch ${marker}; cat`
    );
    git(fixture.worktree, 'config', 'filter.side-effect.required', 'true');
    let called = false;

    await assert.rejects(
      createBoundary().run({
        plan,
        consumer,
        managedPaths: ['book-config.json'],
        dryRun: true,
        mutate: async () => { called = true; }
      }),
      /Consumer Git filter attributes are not allowed: index\.md \(side-effect\)/
    );

    assert.strictEqual(called, false);
    assert.strictEqual(await fs.pathExists(marker), false);
  });

  test('tracked submoduleをstatus実行前に拒否してnested clean filterを実行しない', async () => {
    const nestedSource = path.join(tempDir, 'nested-source');
    await initRepository(nestedSource, { 'nested.txt': 'audited nested bytes\n' });
    const fixture = await createLinkedConsumer(tempDir);
    git(
      fixture.sourceRoot,
      '-c', 'protocol.file.allow=always',
      'submodule', 'add', nestedSource, 'vendor/nested'
    );
    git(fixture.sourceRoot, 'commit', '-am', 'add nested fixture');
    const baseSha = git(fixture.sourceRoot, 'rev-parse', 'HEAD');
    git(fixture.sourceRoot, 'worktree', 'remove', '--force', fixture.worktree);
    git(fixture.sourceRoot, 'worktree', 'add', '--detach', fixture.worktree, baseSha);
    git(
      fixture.worktree,
      '-c', 'protocol.file.allow=always',
      'submodule', 'update', '--init', '--recursive'
    );

    const nestedWorktree = path.join(fixture.worktree, 'vendor/nested');
    const attributes = path.resolve(
      nestedWorktree,
      git(nestedWorktree, 'rev-parse', '--git-path', 'info/attributes')
    );
    const marker = path.join(tempDir, 'nested-clean-filter-executed');
    await fs.ensureDir(path.dirname(attributes));
    await fs.writeFile(attributes, '/nested.txt filter=nested-side-effect\n');
    git(
      nestedWorktree,
      'config',
      'filter.nested-side-effect.clean',
      `touch ${marker}; cat`
    );
    git(nestedWorktree, 'config', 'filter.nested-side-effect.required', 'true');
    await fs.writeFile(path.join(nestedWorktree, 'nested.txt'), 'changed nested bytes\n');

    const consumer = consumerEntry({
      ...fixture,
      baseSha,
      allowedPaths: ['book-config.json']
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
        managedPaths: ['book-config.json'],
        dryRun: true,
        mutate: async () => { called = true; }
      }),
      /Consumer tracked gitlinks are not allowed before mutation audit: vendor\/nested/
    );

    assert.strictEqual(called, false);
    assert.strictEqual(await fs.pathExists(marker), false);
  });

  test('required smudge filterをcheckout前に拒否する', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({
      ...fixture,
      allowedPaths: ['index.md']
    });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const attributes = path.resolve(
      fixture.worktree,
      git(fixture.worktree, 'rev-parse', '--git-path', 'info/attributes')
    );
    let called = false;

    await fs.ensureDir(path.dirname(attributes));
    await fs.writeFile(attributes, '/index.md filter=required-smudge\n');
    git(fixture.worktree, 'config', 'filter.required-smudge.smudge', 'false');
    git(fixture.worktree, 'config', 'filter.required-smudge.required', 'true');

    await assert.rejects(
      createBoundary().run({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async () => { called = true; }
      }),
      /Consumer Git filter attributes are not allowed: index\.md \(required-smudge\)/
    );

    assert.strictEqual(called, false);
  });

  test('rollbackはconsumer post-index-change hookを実行しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const hooks = path.join(tempDir, 'consumer-hooks');
    const marker = path.join(tempDir, 'post-index-change-executed');
    await fs.ensureDir(hooks);
    await fs.writeFile(
      path.join(hooks, 'post-index-change'),
      `#!/bin/sh\ntouch ${marker}\n`,
      { mode: 0o755 }
    );
    git(fixture.worktree, 'config', 'core.hooksPath', hooks);

    await assert.rejects(
      createBoundary().run({
        plan,
        consumer,
        managedPaths: ['index.md'],
        dryRun: false,
        mutate: async ({ consumerRoot }) => {
          await fs.writeFile(path.join(consumerRoot, 'index.md'), '# Partial\n');
          throw new Error('synthetic interruption before rollback');
        }
      }),
      /Mutation failed and was rolled back/
    );

    assert.strictEqual(await fs.pathExists(marker), false);
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
    assert.strictEqual(git(fixture.worktree, 'rev-parse', 'HEAD'), fixture.baseSha);
  });

  test('rollbackは欠落した親directoryを再作成し大きなtracked blobを復元する', async () => {
    // Exceed the buffered Git-output ceiling to prove rollback streams blobs
    // instead of merely moving the execFileSync limit.
    const largeContent = Buffer.alloc((64 * 1024 * 1024) + 1, 0x61);
    const relativePath = 'managed/nested/large.bin';
    const fixture = await createLinkedConsumer(tempDir, {
      files: { [relativePath]: largeContent }
    });
    const consumer = consumerEntry({
      ...fixture,
      allowedPaths: [relativePath]
    });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });

    await assert.rejects(
      createBoundary().run({
        plan,
        consumer,
        managedPaths: [relativePath],
        dryRun: false,
        mutate: async ({ consumerRoot }) => {
          await fs.remove(path.join(consumerRoot, 'managed'));
          throw new Error('synthetic interruption after deleting tracked parents');
        }
      }),
      /Mutation failed and was rolled back/
    );

    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
    assert.deepStrictEqual(
      await fs.readFile(path.join(fixture.worktree, relativePath)),
      largeContent
    );
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

  test('dry-run preflightはstale statでもconsumer indexを更新しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const indexPath = path.resolve(
      fixture.worktree,
      git(fixture.worktree, 'rev-parse', '--git-path', 'index')
    );
    const trackedPath = path.join(fixture.worktree, 'index.md');
    const trackedStat = await fs.stat(trackedPath);
    await fs.utimes(
      trackedPath,
      trackedStat.atime,
      new Date(trackedStat.mtimeMs + 60_000)
    );
    const indexBefore = await fs.readFile(indexPath);

    const result = await createBoundary().run({
      plan,
      consumer,
      managedPaths: ['index.md'],
      dryRun: true,
      mutate: async () => {
        throw new Error('dry-run callback must not execute');
      }
    });

    assert.deepStrictEqual(await fs.readFile(indexPath), indexBefore);
    assert.deepStrictEqual(result.changedPaths, []);
    assert.strictEqual(git(fixture.worktree, 'status', '--porcelain'), '');
  });

  test('dry-run preflightはconsumer fsmonitor hookを実行しない', async () => {
    const fixture = await createLinkedConsumer(tempDir);
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['index.md'] });
    const plan = planFor({
      operation: 'update-book',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json')
    });
    const marker = path.join(tempDir, 'fsmonitor-executed');
    const hook = path.join(tempDir, 'fsmonitor-hook.sh');
    await fs.writeFile(hook, `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
    git(fixture.worktree, 'config', 'core.fsmonitor', hook);
    let called = false;

    const result = await createBoundary().run({
      plan,
      consumer,
      managedPaths: ['index.md'],
      dryRun: true,
      mutate: async () => { called = true; }
    });

    assert.strictEqual(called, false);
    assert.deepStrictEqual(result.changedPaths, []);
    assert.strictEqual(await fs.pathExists(marker), false);
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
    const boundary = freshBoundaryFacade(formatter);
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
    const registryContent = await fs.readFile(registryPath);
    const { rollout } = dependencies();
    const consumer = consumerEntry({
      ...fixture,
      allowedPaths: ['book-config.json']
    });
    const plan = planFor({
      operation: 'rollout-ux-profile',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json'),
      registryPath,
      registrySha256: sha256(registryContent)
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

    await assert.rejects(
      rollout.rollout({
        plan,
        consumers: [consumer],
        registryPath: path.join(tempDir, 'different-registry.json'),
        applyUxCore: false,
        applyUxProfile: true,
        dryRun: true
      }),
      /UX registry path mismatch/
    );

    const registryLink = path.join(tempDir, 'registry-link.json');
    await fs.symlink(registryPath, registryLink, 'file');
    await assert.rejects(
      rollout.rollout({
        plan: { ...plan, registryPath: registryLink },
        consumers: [consumer],
        registryPath: registryLink,
        applyUxCore: false,
        applyUxProfile: true,
        dryRun: true
      }),
      /must be a regular non-symlink file/
    );
    await fs.remove(registryLink);

    await fs.writeJson(registryPath, { books: {} });
    await assert.rejects(
      rollout.rollout({
        plan,
        consumers: [consumer],
        registryPath,
        applyUxCore: false,
        applyUxProfile: true,
        dryRun: false
      }),
      /UX registry SHA-256 mismatch/
    );
    assert.deepStrictEqual(await snapshotFiles(fixture.worktree), before);
    await fs.writeFile(registryPath, registryContent);

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
    const registryContent = await fs.readFile(registryPath);
    const { rollout } = dependencies();
    const consumer = consumerEntry({ ...fixture, allowedPaths: ['book-config.json'] });
    const plan = planFor({
      operation: 'rollout-ux-profile',
      formatterSha: formatter.formatterSha,
      consumers: [consumer],
      planPath: path.join(tempDir, 'plan.json'),
      registryPath,
      registrySha256: sha256(registryContent)
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

  test('UX rolloutのprogrammatic writeも複数consumerを拒否する', async () => {
    const first = await createLinkedConsumer(tempDir, { name: 'first' });
    const second = await createLinkedConsumer(tempDir, { name: 'second' });
    const consumers = [first, second].map((fixture, index) => consumerEntry({
      id: `consumer-${index + 1}`,
      ...fixture,
      allowedPaths: ['book-config.json']
    }));
    const plan = planFor({
      operation: 'rollout-ux-profile',
      formatterSha: formatter.formatterSha,
      consumers,
      planPath: path.join(tempDir, 'multi-plan.json')
    });
    const { rollout } = dependencies();

    await assert.rejects(
      rollout.rollout({
        plan,
        consumers,
        applyUxCore: false,
        applyUxProfile: true,
        dryRun: false
      }),
      /write mode requires exactly one consumer/
    );
    assert.strictEqual(git(first.worktree, 'status', '--porcelain'), '');
    assert.strictEqual(git(second.worktree, 'status', '--porcelain'), '');
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

  const caller = await fs.mkdtemp(path.join(TEST_ROOT, 'tmp-shell-caller-'));
  const relativePlan = path.join(caller, 'plan.json');
  const reportRoot = path.join(caller, 'reports');
  await fs.writeJson(relativePlan, {});
  const relativeResult = await import('node:child_process').then(({ spawnSync }) => (
    spawnSync(
      'bash',
      [scriptPath, '--plan', 'plan.json', '--target', 'sample-book', '--dry-run'],
      {
        cwd: caller,
        encoding: 'utf8',
        env: { ...process.env, BOOK_FORMATTER_REPORT_ROOT: reportRoot }
      }
    )
  ));
  const relativeOutput = `${relativeResult.stdout}${relativeResult.stderr}`;
  assert.notStrictEqual(relativeResult.status, 0);
  assert.doesNotMatch(relativeOutput, /--plan not found|Consumer mutation plan does not exist/);
  assert.match(relativeOutput, /plan\.schemaVersion must be 1/);
  await fs.remove(caller);
});

test('update-book CLIはdry-runの有限plan全件検査とwriteの単一targetを保持する', async () => {
  const launcherSource = await fs.readFile(path.resolve('src/index.js'), 'utf8');
  const source = await fs.readFile(path.resolve('src/cli-implementation.js'), 'utf8');
  assert.match(launcherSource, /runFreshDependencyBootstrap/);
  assert.match(launcherSource, /isLegacyMutationInvocation/);
  const updateBlock = source.slice(
    source.indexOf('.command(\'update-book\')'),
    source.indexOf('// validate-config コマンド')
  );

  assert.match(updateBlock, /\.option\('--target <consumer-id>'/);
  assert.doesNotMatch(updateBlock, /\.requiredOption\('--target <consumer-id>'/);
  assert.match(updateBlock, /const consumers = selectConsumers\(plan,/);
  assert.match(updateBlock, /for \(const consumer of consumers\)/);
  assert.match(updateBlock, /bookGenerator\.updateBook\(plan, consumer,/);
});
