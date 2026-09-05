import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, test } from 'node:test';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isLegacyMutationInvocation,
  isNpmLifecycleInvocation,
  legacyMutationHelpText,
  loadFreshLegacyMutationApi,
  readBootstrapPlan,
  rebuildFreshDependencies,
  runFreshDependencyBootstrapForTest,
  runFreshLegacyMutationProcess,
  safeEnvironment,
  verifyBootstrapInputs
} from '../src/ConsumerDependencyBootstrap.js';
import {
  ConsumerMutationBoundary,
  loadConsumerMutationPlan
} from '../src/ConsumerMutationBoundary.js';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_ROOT, '..');
function git(repositoryRoot, ...args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

async function createFixture(tempRoot, { invalidLock = false } = {}) {
  const repositoryRoot = path.join(tempRoot, 'formatter-fixture');
  await fs.ensureDir(path.join(repositoryRoot, 'vendor', 'fs-extra'));
  await fs.writeJson(path.join(repositoryRoot, 'package.json'), {
    name: 'fresh-bootstrap-fixture',
    version: '1.0.0',
    type: 'module',
    dependencies: {
      'fs-extra': 'file:vendor/fs-extra'
    }
  }, { spaces: 2 });
  await fs.writeJson(path.join(repositoryRoot, 'vendor', 'fs-extra', 'package.json'), {
    name: 'fs-extra',
    version: '1.0.0',
    type: 'module',
    exports: './index.js',
    scripts: {
      postinstall: 'node postinstall.cjs'
    }
  }, { spaces: 2 });
  await fs.writeFile(
    path.join(repositoryRoot, 'vendor', 'fs-extra', 'index.js'),
    'export const identity = "fresh-lockfile-install";\n'
  );
  await fs.writeFile(
    path.join(repositoryRoot, 'vendor', 'fs-extra', 'postinstall.cjs'),
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'fs.writeFileSync(path.resolve(__dirname, "..", "..", "install-script-marker"), "ran");',
      ''
    ].join('\n')
  );
  await fs.writeFile(
    path.join(repositoryRoot, 'fixture-runtime.mjs'),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'const dependency = await import("fs-extra");',
      'const root = path.dirname(fileURLToPath(import.meta.url));',
      'fs.writeFileSync(path.join(root, "runtime-output.json"), JSON.stringify({ identity: dependency.identity }));',
      ''
    ].join('\n')
  );
  await fs.ensureDir(path.join(repositoryRoot, 'consumer'));
  await fs.ensureDir(path.join(repositoryRoot, 'src'));
  await fs.copyFile(
    path.join(REPOSITORY_ROOT, 'src', 'ConsumerDependencyBootstrap.js'),
    path.join(repositoryRoot, 'src', 'ConsumerDependencyBootstrap.js')
  );
  await fs.copyFile(
    path.join(REPOSITORY_ROOT, 'src', 'index.js'),
    path.join(repositoryRoot, 'src', 'index.js')
  );
  await fs.writeFile(
    path.join(repositoryRoot, 'src', 'cli-implementation.js'),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { assertFreshDependencyRuntimePresent } from "./ConsumerDependencyBootstrap.js";',
      'assertFreshDependencyRuntimePresent(process.cwd());',
      'const dependency = await import("fs-extra");',
      'fs.writeFileSync(path.join(process.cwd(), "runtime-output.json"),',
      '  JSON.stringify({ identity: dependency.identity }));',
      ''
    ].join('\n')
  );
  await fs.writeFile(
    path.join(repositoryRoot, '.gitignore'),
    [
      'node_modules/',
      'plan.json',
      'runtime-output.json',
      'install-script-marker',
      'malicious-import-marker',
      'outside-marker',
      ''
    ].join('\n')
  );

  const lockResult = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  assert.strictEqual(lockResult.status, 0, lockResult.stderr);

  if (invalidLock) {
    const packageJson = await fs.readJson(path.join(repositoryRoot, 'package.json'));
    packageJson.dependencies['missing-local-package'] = 'file:vendor/missing-local-package';
    await fs.writeJson(path.join(repositoryRoot, 'package.json'), packageJson, { spaces: 2 });
  }

  git(repositoryRoot, 'init', '--initial-branch=main');
  git(repositoryRoot, 'config', 'user.name', 'Book Formatter Test');
  git(repositoryRoot, 'config', 'user.email', 'book-formatter@example.invalid');
  git(repositoryRoot, 'add', '--all');
  git(repositoryRoot, 'commit', '-m', 'bootstrap fixture');
  const formatterSha = git(repositoryRoot, 'rev-parse', 'HEAD');
  const planPath = path.join(repositoryRoot, 'plan.json');
  await fs.writeJson(planPath, {
    schemaVersion: 1,
    operation: 'update-book',
    formatterSha,
    consumers: [{
      id: 'synthetic-consumer',
      worktree: './consumer',
      baseSha: 'a'.repeat(40),
      allowedPaths: ['index.md']
    }]
  }, { spaces: 2 });
  return { repositoryRoot, formatterSha, planPath };
}

async function installMaliciousDependency(repositoryRoot) {
  const dependencyRoot = path.join(repositoryRoot, 'node_modules', 'fs-extra');
  await fs.ensureDir(dependencyRoot);
  await fs.writeJson(path.join(dependencyRoot, 'package.json'), {
    name: 'fs-extra',
    version: '99.0.0',
    type: 'module',
    exports: './index.js'
  });
  await fs.writeFile(
    path.join(dependencyRoot, 'index.js'),
    [
      'import fs from "node:fs";',
      'import { fileURLToPath } from "node:url";',
      'fs.writeFileSync(fileURLToPath(new URL("../../malicious-import-marker", import.meta.url)), "executed");',
      'export const identity = "modified-ignored-dependency";',
      ''
    ].join('\n')
  );
}

describe('ConsumerDependencyBootstrap', () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(TEST_ROOT, 'tmp-dependency-bootstrap-'));
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  test('legacy mutation commandだけをbootstrap対象にする', () => {
    assert.strictEqual(isLegacyMutationInvocation(['update-book']), true);
    assert.strictEqual(isLegacyMutationInvocation(['sync-all-books']), true);
    assert.strictEqual(isLegacyMutationInvocation(['rollout-ux']), true);
    assert.strictEqual(isLegacyMutationInvocation(['update-book', '--help']), false);
    assert.strictEqual(
      isLegacyMutationInvocation(['update-book', '--dry-run', '--', '--help']),
      true
    );
    assert.strictEqual(isLegacyMutationInvocation(['build']), false);
    assert.strictEqual(isLegacyMutationInvocation(['--help']), false);
    assert.match(
      legacyMutationHelpText('rollout-ux'),
      /^Usage: node src\/index\.js rollout-ux --plan <path> \[options\]/
    );
    assert.match(legacyMutationHelpText('rollout-ux'), /-r, --registry <path>/);
    assert.strictEqual(isNpmLifecycleInvocation({}), false);
    assert.strictEqual(isNpmLifecycleInvocation({ npm_lifecycle_event: 'start' }), true);
    assert.strictEqual(isNpmLifecycleInvocation({ npm_lifecycle_event: 'dev' }), true);
    assert.strictEqual(isNpmLifecycleInvocation({ npm_lifecycle_event: 'test' }), false);
    const mixedCaseKeys = ['Git_Dir', 'Node_Options', 'NpM_CoNfIg_PrOxY'];
    const previousValues = new Map(mixedCaseKeys.map((key) => [key, process.env[key]]));
    process.env.Git_Dir = 'untrusted';
    process.env.Node_Options = '--require untrusted.js';
    process.env.NpM_CoNfIg_PrOxY = 'https://proxy.example.invalid';
    try {
      const sanitized = safeEnvironment({ SAFE_MARKER: 'kept' });
      assert.strictEqual(sanitized.Git_Dir, undefined);
      assert.strictEqual(sanitized.Node_Options, undefined);
      assert.strictEqual(sanitized.NpM_CoNfIg_PrOxY, undefined);
      assert.strictEqual(sanitized.SAFE_MARKER, 'kept');
    } finally {
      for (const [key, value] of previousValues) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('launcherのstatic import graphはbootstrap完了までbuilt-in-onlyを維持する', async () => {
    const launcher = await fs.readFile(
      path.join(REPOSITORY_ROOT, 'src', 'index.js'),
      'utf8'
    );
    const bootstrap = await fs.readFile(
      path.join(REPOSITORY_ROOT, 'src', 'ConsumerDependencyBootstrap.js'),
      'utf8'
    );
    const implementation = await fs.readFile(
      path.join(REPOSITORY_ROOT, 'src', 'cli-implementation.js'),
      'utf8'
    );
    const npmCompatibilityEntrypoint = await fs.readFile(
      path.join(REPOSITORY_ROOT, 'src', 'npm-compatibility-cli.js'),
      'utf8'
    );
    const packageJson = await fs.readJson(path.join(REPOSITORY_ROOT, 'package.json'));

    const launcherStaticImports = [
      ...launcher.matchAll(/^import[\s\S]*?from ['"]([^'"]+)['"];$/gm)
    ].map((match) => match[1]);
    const launcherDynamicImports = [
      ...launcher.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)
    ].map((match) => match[1]);
    assert.deepStrictEqual(launcherStaticImports, ['./ConsumerDependencyBootstrap.js']);
    assert.deepStrictEqual(launcherDynamicImports, ['./cli-implementation.js']);
    assert.doesNotMatch(launcher, /^\s*import\s*['"][^'"]+['"];\s*$/m);
    assert.ok(
      launcher.indexOf('runFreshLegacyMutationProcess(args, { stdio: \'inherit\' })')
      < launcher.indexOf('import(\'./cli-implementation.js\')')
    );
    assert.ok(
      [...bootstrap.matchAll(/^import[\s\S]*?from ['"]([^'"]+)['"];$/gm)]
        .every((match) => match[1].startsWith('node:'))
    );
    assert.doesNotMatch(bootstrap, /^\s*import\s*['"][^'"]+['"];\s*$/m);
    assert.ok(
      [...bootstrap.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .every((match) => match[1].startsWith('./'))
    );
    assert.match(bootstrap, /runFreshLegacyMutationProcess/);
    assert.match(bootstrap, /In-process legacy mutation API loading is not supported/);
    assert.doesNotMatch(bootstrap, /Promise\.all\(\[\s*import\('\.\/BookGenerator\.js'/);
    assert.ok(
      implementation.indexOf('assertFreshDependencyRuntimePresent(process.cwd())')
      < implementation.indexOf('import(\'commander\')')
    );
    assert.doesNotMatch(
      bootstrap.match(/export \{[\s\S]*?\};/)?.[0] || '',
      /\brunFreshDependencyBootstrap,/
    );
    const bootstrapModule = await import('../src/ConsumerDependencyBootstrap.js');
    assert.strictEqual(Object.hasOwn(bootstrapModule, 'runFreshDependencyBootstrap'), false);
    assert.throws(
      () => runFreshDependencyBootstrapForTest(
        ['update-book', '--plan', path.join(REPOSITORY_ROOT, 'missing-plan.json')],
        { repositoryRoot: REPOSITORY_ROOT, cwd: REPOSITORY_ROOT }
      ),
      /restricted to a tests\/tmp-\* sandbox/
    );
    assert.strictEqual(packageJson.scripts.start, 'node src/npm-compatibility-cli.js');
    assert.strictEqual(packageJson.scripts.dev, 'node src/npm-compatibility-cli.js --watch');
    assert.ok(
      npmCompatibilityEntrypoint.indexOf('LEGACY_MUTATION_COMMANDS.has(command)')
      < npmCompatibilityEntrypoint.indexOf('new URL(\'./index.js\', import.meta.url)')
    );
    assert.ok(
      npmCompatibilityEntrypoint.indexOf('LEGACY_MUTATION_COMMANDS.has(command)')
      < npmCompatibilityEntrypoint.indexOf('import(\'./index.js\')')
    );

    const markdownPaths = git(REPOSITORY_ROOT, 'ls-files', '*.md').split('\n').filter(Boolean);
    const documentedEntrypoints = (await Promise.all(
      markdownPaths.map((entry) => fs.readFile(path.join(REPOSITORY_ROOT, entry), 'utf8'))
    )).join('\n');
    assert.doesNotMatch(
      documentedEntrypoints,
      /npm\s+(?:run\s+)?(?:start|dev)\s+(?:--\s+)?(?:update-book|sync-all-books|rollout-ux)/
    );
    assert.match(documentedEntrypoints, /node src\/index\.js update-book/);

    const lifecycleBypass = spawnSync(
      process.execPath,
      [
        path.join(REPOSITORY_ROOT, 'src', 'index.js'),
        'update-book',
        '--plan',
        path.join(REPOSITORY_ROOT, 'missing-plan.json'),
        '--dry-run'
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        env: { ...process.env, npm_lifecycle_event: 'start' }
      }
    );
    assert.notStrictEqual(lifecycleBypass.status, 0);
    assert.match(lifecycleBypass.stderr, /must use node src\/index\.js directly/);

    for (const lifecycleArgs of [['start'], ['run', 'dev']]) {
      const realNpmBypass = spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        [
          ...lifecycleArgs, '--', 'update-book',
          '--plan', path.join(REPOSITORY_ROOT, 'missing-plan.json'),
          '--dry-run'
        ],
        { cwd: REPOSITORY_ROOT, encoding: 'utf8', timeout: 10_000 }
      );
      assert.notStrictEqual(realNpmBypass.status, 0);
      assert.strictEqual(realNpmBypass.signal, null);
      assert.match(
        `${realNpmBypass.stdout}\n${realNpmBypass.stderr}`,
        /npm lifecycle scripts do not expose legacy consumer mutation commands/
      );
    }
  });

  test('launcher error context distinguishes bootstrap from ordinary CLI failures', async () => {
    const launcher = await fs.readFile(path.join(REPOSITORY_ROOT, 'src', 'index.js'), 'utf8');
    assert.match(launcher, /failureContext = 'Book formatter CLI failed'/);
    assert.match(launcher, /failureContext = 'Legacy consumer bootstrap failed'/);
    assert.ok(
      launcher.indexOf('failureContext = \'Legacy consumer bootstrap failed\'')
      < launcher.indexOf('runFreshLegacyMutationProcess(args, { stdio: \'inherit\' })')
    );
    assert.ok(
      launcher.indexOf('runFreshLegacyMutationProcess(args, { stdio: \'inherit\' })')
      < launcher.lastIndexOf('failureContext = \'Book formatter CLI failed\'')
    );
  });

  test('plan operationと固定formatter SHAをbuilt-in bootstrapで読む', async () => {
    const fixture = await createFixture(tempRoot);
    const plan = readBootstrapPlan(
      ['update-book', `--plan=${fixture.planPath}`],
      fixture.repositoryRoot
    );
    assert.strictEqual(plan.formatterSha, fixture.formatterSha);
    assert.strictEqual(plan.expectedOperation, 'update-book');
    assert.match(plan.sha256, /^[0-9a-f]{64}$/);

    await assert.rejects(
      async () => readBootstrapPlan(['sync-all-books', '--plan', fixture.planPath]),
      /operation must be sync-all-books/
    );
    assert.throws(
      () => readBootstrapPlan(['update-book', '--plan', fixture.planPath, '--plan', fixture.planPath]),
      /exactly one --plan/
    );

    await fs.writeJson(fixture.planPath, {
      schemaVersion: 2,
      operation: 'update-book',
      formatterSha: fixture.formatterSha,
      consumers: []
    });
    assert.throws(
      () => readBootstrapPlan(['update-book', '--plan', fixture.planPath]),
      /plan\.schemaVersion must be 1/
    );
  });

  test('programmatic bootstrapもstrict finite plan contractを迂回できない', async () => {
    const fixture = await createFixture(tempRoot);
    const original = await fs.readJson(fixture.planPath);
    const cases = [
      ['consumer上限', (plan) => {
        plan.consumers = Array.from({ length: 7 }, (_unused, index) => ({
          ...plan.consumers[0],
          id: `consumer-${index}`,
          worktree: `./consumer-${index}`
        }));
      }],
      ['consumer ID重複', (plan) => {
        plan.consumers.push({ ...plan.consumers[0], worktree: './other-consumer' });
      }],
      ['worktree重複', (plan) => {
        plan.consumers.push({ ...plan.consumers[0], id: 'other-consumer' });
      }],
      ['base SHA形式', (plan) => {
        plan.consumers[0].baseSha = 'main';
      }],
      ['IDの暗黙型変換', (plan) => {
        plan.consumers[0].id = 123;
      }],
      ['base SHAの暗黙型変換', (plan) => {
        plan.consumers[0].baseSha = ['a'.repeat(40)];
      }],
      ['allowedPaths正規化', (plan) => {
        plan.consumers[0].allowedPaths = ['docs/../outside.md'];
      }],
      ['allowedPaths重複', (plan) => {
        plan.consumers[0].allowedPaths = ['index.md', 'index.md'];
      }],
      ['config path/hash対', (plan) => {
        plan.consumers[0].configPath = './book-config.json';
      }],
      ['config digestの暗黙型変換', (plan) => {
        plan.consumers[0].configPath = './book-config.json';
        plan.consumers[0].configSha256 = ['a'.repeat(64)];
      }],
      ['未使用registry', (plan) => {
        plan.registryPath = './registry.json';
        plan.registrySha256 = 'a'.repeat(64);
      }]
    ];

    for (const [label, mutate] of cases) {
      const malformed = structuredClone(original);
      mutate(malformed);
      await fs.writeJson(fixture.planPath, malformed, { spaces: 2 });
      assert.throws(
        () => readBootstrapPlan(['update-book', '--plan', fixture.planPath]),
        /strict finite plan contract/,
        label
      );
    }

    const coercedFormatterSha = structuredClone(original);
    coercedFormatterSha.formatterSha = [fixture.formatterSha];
    await fs.writeJson(fixture.planPath, coercedFormatterSha, { spaces: 2 });
    assert.throws(
      () => readBootstrapPlan(['update-book', '--plan', fixture.planPath]),
      /formatterSha must be a lowercase 40-character commit SHA/
    );

    const coercedRegistryDigest = structuredClone(original);
    coercedRegistryDigest.operation = 'rollout-ux-profile';
    coercedRegistryDigest.registryPath = './registry.json';
    coercedRegistryDigest.registrySha256 = ['a'.repeat(64)];
    await fs.writeJson(fixture.planPath, coercedRegistryDigest, { spaces: 2 });
    assert.throws(
      () => readBootstrapPlan(
        ['rollout-ux', '--apply-ux-profile', '--plan', fixture.planPath]
      ),
      /strict finite plan contract/
    );
  });

  test('tracked source、package、lockfileのraw driftをimport前に拒否する', async () => {
    const fixture = await createFixture(tempRoot);
    const verified = verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha);
    assert.match(verified.lockfileSha256, /^[0-9a-f]{64}$/);
    assert.match(verified.packageJsonSha256, /^[0-9a-f]{64}$/);
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, 'f'.repeat(40)),
      /Bootstrap formatter HEAD mismatch/
    );

    await fs.appendFile(path.join(fixture.repositoryRoot, 'fixture-runtime.mjs'), '// drift\n');
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha),
      /Tracked formatter bytes differ/
    );

    git(fixture.repositoryRoot, 'checkout', '--', 'fixture-runtime.mjs');
    await fs.chmod(path.join(fixture.repositoryRoot, 'fixture-runtime.mjs'), 0o755);
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha),
      /Tracked formatter mode differs/
    );
  });

  test('project npm configをtracked/untrackedにかかわらず拒否する', async () => {
    const fixture = await createFixture(tempRoot);
    await fs.writeFile(path.join(fixture.repositoryRoot, '.npmrc'), 'ignore-scripts=false\n');
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha),
      /project npm configuration is not allowed/
    );
  });

  test('npm-shrinkwrap.jsonによる監査済みlockfileの置換を拒否する', async () => {
    const fixture = await createFixture(tempRoot);
    const shrinkwrapPath = path.join(fixture.repositoryRoot, 'npm-shrinkwrap.json');
    await fs.writeJson(shrinkwrapPath, {
      name: 'untrusted-alternate-lock',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {}
    });
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha),
      /alternate npm lockfile is not allowed/
    );

    await fs.remove(shrinkwrapPath);
    const outside = path.join(tempRoot, 'outside-shrinkwrap');
    await fs.writeFile(outside, '{}\n');
    await fs.symlink(outside, shrinkwrapPath);
    assert.throws(
      () => verifyBootstrapInputs(fixture.repositoryRoot, fixture.formatterSha),
      /alternate npm lockfile is not allowed/
    );
  });

  test('改変済みignored fs-extraを除去しlockfileからfresh treeだけを起動する', async () => {
    const fixture = await createFixture(tempRoot);
    await installMaliciousDependency(fixture.repositoryRoot);

    const capability = runFreshDependencyBootstrapForTest(
      ['update-book', '--plan', fixture.planPath],
      {
        repositoryRoot: fixture.repositoryRoot,
        cwd: fixture.repositoryRoot,
        installStdio: 'pipe'
      }
    );
    assert.strictEqual(capability.formatterSha, fixture.formatterSha);
    const loadedPlan = await loadConsumerMutationPlan(fixture.planPath, {
      expectedOperation: 'update-book'
    });
    const boundary = new ConsumerMutationBoundary({
      formatterRoot: fixture.repositoryRoot,
      enforceFormatterCwd: false,
      freshDependencyAttestation: capability
    });
    const attestedPlan = boundary.assertFreshDependencyRuntime(loadedPlan);
    assert.notStrictEqual(attestedPlan, loadedPlan);
    assert.strictEqual(Object.isFrozen(attestedPlan), true);
    assert.strictEqual(Object.isFrozen(attestedPlan.consumers), true);
    assert.strictEqual(Object.isFrozen(attestedPlan.consumers[0]), true);
    assert.strictEqual(Object.isFrozen(attestedPlan.consumers[0].allowedPaths), true);
    assert.strictEqual(attestedPlan.formatterSha, capability.formatterSha);
    assert.throws(
      () => boundary.assertFreshDependencyRuntime({
        ...loadedPlan,
        consumers: loadedPlan.consumers.map((consumer) => ({
          ...consumer,
          id: 'different-consumer'
        }))
      }),
      /In-memory consumer mutation plan differs from attested plan bytes/
    );
    await import(`${pathToFileURL(path.join(
      fixture.repositoryRoot,
      'fixture-runtime.mjs'
    )).href}?run=fresh`);

    assert.deepStrictEqual(
      await fs.readJson(path.join(fixture.repositoryRoot, 'runtime-output.json')),
      { identity: 'fresh-lockfile-install' }
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'malicious-import-marker')),
      false
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'install-script-marker')),
      false
    );
    assert.deepStrictEqual(
      (await fs.readdir(fixture.repositoryRoot))
        .filter((name) => name.startsWith('.book-formatter-bootstrap-')),
      []
    );
  });

  test('programmatic mutationはpreloaded module cacheを共有しないchildで実行する', async () => {
    const fixture = await createFixture(tempRoot);
    await installMaliciousDependency(fixture.repositoryRoot);
    const dependencyUrl = pathToFileURL(path.join(
      fixture.repositoryRoot,
      'node_modules',
      'fs-extra',
      'index.js'
    )).href;
    const preloaded = await import(dependencyUrl);
    assert.strictEqual(preloaded.identity, 'modified-ignored-dependency');
    await fs.remove(path.join(fixture.repositoryRoot, 'malicious-import-marker'));

    assert.throws(
      () => loadFreshLegacyMutationApi(),
      /In-process legacy mutation API loading is not supported/
    );

    const result = runFreshLegacyMutationProcess(
      ['update-book', '--plan', fixture.planPath, '--dry-run'],
      {
        repositoryRoot: fixture.repositoryRoot,
        cwd: fixture.repositoryRoot,
        stdio: 'pipe'
      }
    );

    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(
      await fs.readJson(path.join(fixture.repositoryRoot, 'runtime-output.json')),
      { identity: 'fresh-lockfile-install' }
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'malicious-import-marker')),
      false
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'install-script-marker')),
      false
    );
  });

  test('install失敗時はpartial dependency treeとruntime起動を残さない', async () => {
    const fixture = await createFixture(tempRoot, { invalidLock: true });

    assert.throws(
      () => runFreshDependencyBootstrapForTest(
        ['update-book', '--plan', fixture.planPath],
        {
          repositoryRoot: fixture.repositoryRoot,
          cwd: fixture.repositoryRoot,
          installStdio: 'pipe'
        }
      ),
      /Fresh dependency bootstrap failed/
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'node_modules')),
      false
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'runtime-output.json')),
      false
    );
  });

  test('install後のdependency root型異常もcleanupしてruntimeを起動しない', async () => {
    const fixture = await createFixture(tempRoot);
    const outside = path.join(tempRoot, 'post-install-outside');
    await fs.ensureDir(outside);
    await fs.writeFile(path.join(outside, 'outside-marker'), 'keep\n');
    const unsafeNpm = path.join(tempRoot, 'unsafe-npm');
    await fs.writeFile(
      unsafeNpm,
      [
        '#!/usr/bin/env node',
        'import fs from \'node:fs\';',
        `fs.symlinkSync(${JSON.stringify(outside)}, 'node_modules');`,
        ''
      ].join('\n')
    );
    await fs.chmod(unsafeNpm, 0o755);

    assert.throws(
      () => rebuildFreshDependencies(fixture.repositoryRoot, {
        npmExecutable: unsafeNpm,
        installStdio: 'pipe'
      }),
      /Fresh dependency tree must be a real directory/
    );
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'node_modules')),
      false
    );
    assert.strictEqual(await fs.readFile(path.join(outside, 'outside-marker'), 'utf8'), 'keep\n');
    assert.strictEqual(
      await fs.pathExists(path.join(fixture.repositoryRoot, 'runtime-output.json')),
      false
    );
  });

  test('symlinked dependency rootをたどらず拒否する', async () => {
    const fixture = await createFixture(tempRoot);
    const outside = path.join(tempRoot, 'outside');
    await fs.ensureDir(outside);
    await fs.writeFile(path.join(outside, 'outside-marker'), 'keep\n');
    await fs.symlink(outside, path.join(fixture.repositoryRoot, 'node_modules'));

    assert.throws(
      () => runFreshDependencyBootstrapForTest(
        ['update-book', '--plan', fixture.planPath],
        {
          repositoryRoot: fixture.repositoryRoot,
          cwd: fixture.repositoryRoot,
          installStdio: 'pipe'
        }
      ),
      /Existing dependency root must be a real directory/
    );
    assert.strictEqual(await fs.readFile(path.join(outside, 'outside-marker'), 'utf8'), 'keep\n');
  });

  test('direct CLIとcaller-controlled programmatic capabilityを拒否する', async () => {
    const directCli = spawnSync(
      process.execPath,
      [
        path.join(REPOSITORY_ROOT, 'src', 'cli-implementation.js'),
        'update-book',
        '--plan',
        path.join(REPOSITORY_ROOT, 'missing-plan.json'),
        '--dry-run'
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          BOOK_FORMATTER_BOOTSTRAP_ATTESTED: 'true'
        }
      }
    );
    assert.notStrictEqual(directCli.status, 0);
    assert.match(directCli.stderr, /runtime capability is missing or invalid/);

    const boundary = new ConsumerMutationBoundary({
      formatterRoot: REPOSITORY_ROOT,
      enforceFormatterCwd: false,
      freshDependencyAttestation: {
        repositoryRoot: REPOSITORY_ROOT,
        formatterSha: git(REPOSITORY_ROOT, 'rev-parse', 'HEAD')
      }
    });
    assert.throws(
      () => boundary.assertFreshDependencyRuntime({
        formatterSha: git(REPOSITORY_ROOT, 'rev-parse', 'HEAD'),
        path: path.join(REPOSITORY_ROOT, 'missing-plan.json')
      }),
      /runtime capability is missing or invalid/
    );

    const proxyCapability = new Proxy({}, {
      get(_target, key) {
        return typeof key === 'symbol' ? true : undefined;
      }
    });
    const proxyBoundary = new ConsumerMutationBoundary({
      formatterRoot: REPOSITORY_ROOT,
      enforceFormatterCwd: false,
      freshDependencyAttestation: proxyCapability
    });
    assert.throws(
      () => proxyBoundary.assertFreshDependencyRuntime({
        formatterSha: git(REPOSITORY_ROOT, 'rev-parse', 'HEAD'),
        path: path.join(REPOSITORY_ROOT, 'missing-plan.json')
      }),
      /runtime capability is missing or invalid/
    );

    const helpBypass = spawnSync(
      process.execPath,
      [
        path.join(REPOSITORY_ROOT, 'src', 'index.js'),
        'update-book',
        '--plan',
        path.join(REPOSITORY_ROOT, 'missing-plan.json'),
        '--dry-run',
        '--',
        '--help'
      ],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.notStrictEqual(helpBypass.status, 0);
    assert.match(helpBypass.stderr, /Consumer mutation plan is not readable/);
  });
});
