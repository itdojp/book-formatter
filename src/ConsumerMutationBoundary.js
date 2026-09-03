import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentSync } from '../scripts/sync-components.js';

const PLAN_SCHEMA_VERSION = 1;
const MAX_CONSUMERS = 6;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ALLOWED_OPERATIONS = new Set([
  'update-book',
  'sync-all-books',
  'rollout-ux-core',
  'rollout-ux-profile',
  'rollout-ux-core-profile'
]);
const PROFILE_OPERATIONS = new Set(['rollout-ux-profile', 'rollout-ux-core-profile']);
const ROOT_KEYS = new Set([
  'schemaVersion',
  'operation',
  'formatterSha',
  'registryPath',
  'registrySha256',
  'consumers'
]);
const CONSUMER_KEYS = new Set([
  'id',
  'worktree',
  'baseSha',
  'allowedPaths',
  'configPath',
  'configSha256'
]);
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMATTER_MUTATION_INPUTS = [
  'shared/layouts',
  'shared/includes',
  'shared/assets',
  'templates'
];

class ConsumerMutationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConsumerMutationError';
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConsumerMutationError(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowedKeys, label) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new ConsumerMutationError(`${label} contains unknown key(s): ${unknown.join(', ')}`);
  }
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new ConsumerMutationError(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

function normalizeManagedPath(value, label = 'managed path') {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new ConsumerMutationError(`${label} must be a non-empty relative path`);
  }

  const portable = value.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(portable)
    || path.win32.isAbsolute(value)
    || portable.split('/').includes('..')
  ) {
    throw new ConsumerMutationError(`${label} must stay below the consumer root: ${value}`);
  }

  const normalized = path.posix.normalize(portable);
  if (normalized === '.' || normalized.startsWith('../') || normalized !== portable) {
    throw new ConsumerMutationError(`${label} must be a normalized relative path: ${value}`);
  }
  return normalized;
}

function normalizedUniquePaths(values, label, { required = true } = {}) {
  if (values === undefined && !required) return [];
  if (!Array.isArray(values) || (required && values.length === 0)) {
    throw new ConsumerMutationError(`${label} must be a non-empty array`);
  }

  const normalized = values.map((value, index) => (
    normalizeManagedPath(value, `${label}[${index}]`)
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new ConsumerMutationError(`${label} must not contain duplicate paths`);
  }
  return normalized.sort();
}

function gitOutput(repoRoot, args, options = {}) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: options.encoding || 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
    });
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString('utf8').trim()
      : String(error.stderr || error.message).trim();
    throw new ConsumerMutationError(
      `git ${args.join(' ')} failed for ${repoRoot}: ${detail}`,
      { cause: error }
    );
  }
}

function gitNullPaths(repoRoot, args) {
  const pathspecIndex = args.indexOf('--');
  const nullTerminatedArgs = pathspecIndex < 0
    ? [...args, '-z']
    : [...args.slice(0, pathspecIndex), '-z', ...args.slice(pathspecIndex)];
  const output = gitOutput(repoRoot, nullTerminatedArgs, { encoding: 'buffer' });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function collectChangedPaths(repoRoot) {
  return [...new Set([
    ...gitNullPaths(repoRoot, ['diff', '--name-only']),
    ...gitNullPaths(repoRoot, ['diff', '--cached', '--name-only']),
    ...gitNullPaths(repoRoot, ['ls-files', '--others', '--exclude-standard']),
    ...gitNullPaths(repoRoot, ['ls-files', '--others', '--ignored', '--exclude-standard'])
  ].map((entry) => normalizeManagedPath(entry, 'changed path')))].sort();
}

function readIndexModes(repoRoot) {
  const entries = gitNullPaths(repoRoot, ['ls-files', '--stage']);
  const modes = new Map();
  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    if (separator < 0) {
      throw new ConsumerMutationError(`Unexpected git index entry: ${entry}`);
    }
    const metadata = entry.slice(0, separator).split(' ');
    const filePath = normalizeManagedPath(entry.slice(separator + 1), 'git index path');
    if (metadata.length !== 3) {
      throw new ConsumerMutationError(`Unexpected git index metadata for ${filePath}`);
    }
    modes.set(filePath, metadata[0]);
  }
  return modes;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function assertNoReplacementRefs(repoRoot, label) {
  const replacementRefs = gitOutput(
    repoRoot,
    ['for-each-ref', '--format=%(refname)', 'refs/replace/']
  ).trim();
  if (replacementRefs !== '') {
    throw new ConsumerMutationError(`${label} must not contain Git replacement refs`);
  }
}

function assertNoIndexFlags(repoRoot, label) {
  const records = gitNullPaths(repoRoot, ['ls-files', '-v']);
  const flagged = records.filter((entry) => !entry.startsWith('H '));
  if (flagged.length > 0) {
    throw new ConsumerMutationError(
      `${label} tracked files must not use skip-worktree, assume-unchanged, or other index flags`
    );
  }
}

function assertConsumerBelongsToPlan(plan, consumer) {
  if (!Array.isArray(plan?.consumers)) {
    throw new ConsumerMutationError('Consumer mutation plan is missing its finite consumer set');
  }
  const planned = plan.consumers.find((entry) => entry.id === consumer?.id);
  const comparable = (entry) => JSON.stringify({
    id: entry?.id,
    worktree: entry?.worktree,
    baseSha: entry?.baseSha,
    allowedPaths: entry?.allowedPaths,
    configPath: entry?.configPath,
    configSha256: entry?.configSha256
  });
  if (!planned || comparable(planned) !== comparable(consumer)) {
    throw new ConsumerMutationError(
      `Consumer target must exactly match an entry in the audited plan: ${consumer?.id || '(missing)'}`
    );
  }
}

function assertNoUntrackedMutationInputs(repoRoot) {
  const pathspec = ['--', ...FORMATTER_MUTATION_INPUTS];
  const untracked = [
    ...gitNullPaths(repoRoot, ['ls-files', '--others', '--exclude-standard', ...pathspec]),
    ...gitNullPaths(repoRoot, [
      'ls-files', '--others', '--ignored', '--exclude-standard', ...pathspec
    ])
  ];
  if (untracked.length > 0) {
    throw new ConsumerMutationError(
      `Formatter mutation inputs must come from the audited commit: ${untracked.sort().join(', ')}`
    );
  }
}

async function assertTrackedFormatterTree(repoRoot, revision) {
  const entries = gitNullPaths(repoRoot, ['ls-tree', '-r', '--full-tree', revision]);
  if (entries.length === 0) {
    throw new ConsumerMutationError('Formatter audited revision contains no tracked files');
  }

  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    if (separator < 0) {
      throw new ConsumerMutationError(`Unexpected formatter tree entry: ${entry}`);
    }
    const [mode, type, expectedHash] = entry.slice(0, separator).split(' ');
    const relativePath = normalizeManagedPath(
      entry.slice(separator + 1),
      'formatter tracked path'
    );
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new ConsumerMutationError(
        `Formatter tracked entry must be a regular file (${mode} ${type}): ${relativePath}`
      );
    }

    const absolutePath = path.join(repoRoot, relativePath);
    const stat = await lstatRegularFile(absolutePath, 'Formatter tracked file');
    const executable = Boolean(stat.mode & 0o111);
    if (executable !== (mode === '100755')) {
      throw new ConsumerMutationError(
        `Formatter tracked file mode differs from ${revision}: ${relativePath}`
      );
    }
    const actualHash = gitOutput(
      repoRoot,
      ['hash-object', '--no-filters', '--', relativePath]
    ).trim();
    if (actualHash !== expectedHash) {
      throw new ConsumerMutationError(
        `Formatter tracked file differs from ${revision}: ${relativePath}`
      );
    }
  }
}

async function lstatRegularFile(filePath, label) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ConsumerMutationError(`${label} does not exist: ${filePath}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ConsumerMutationError(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  return stat;
}

function parseConsumerEntry(rawEntry, index, planDirectory) {
  const label = `consumers[${index}]`;
  assertPlainObject(rawEntry, label);
  assertExactKeys(rawEntry, CONSUMER_KEYS, label);

  if (typeof rawEntry.id !== 'string' || !ID_PATTERN.test(rawEntry.id)) {
    throw new ConsumerMutationError(`${label}.id must match ${ID_PATTERN}`);
  }
  if (typeof rawEntry.worktree !== 'string' || rawEntry.worktree.trim() === '') {
    throw new ConsumerMutationError(`${label}.worktree must be a non-empty path`);
  }

  const configPathPresent = Object.hasOwn(rawEntry, 'configPath');
  const configHashPresent = Object.hasOwn(rawEntry, 'configSha256');
  if (configPathPresent !== configHashPresent) {
    throw new ConsumerMutationError(
      `${label}.configPath and ${label}.configSha256 must be specified together`
    );
  }
  if (
    configHashPresent
    && (typeof rawEntry.configSha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(rawEntry.configSha256))
  ) {
    throw new ConsumerMutationError(`${label}.configSha256 must be a lowercase SHA-256 digest`);
  }

  return {
    id: rawEntry.id,
    worktree: path.resolve(planDirectory, rawEntry.worktree),
    baseSha: assertSha(rawEntry.baseSha, `${label}.baseSha`),
    allowedPaths: normalizedUniquePaths(
      rawEntry.allowedPaths,
      `${label}.allowedPaths`,
      { required: false }
    ),
    configPath: configPathPresent
      ? path.resolve(planDirectory, rawEntry.configPath)
      : null,
    configSha256: configHashPresent ? rawEntry.configSha256 : null
  };
}

async function loadConsumerMutationPlan(planPath, { expectedOperation } = {}) {
  if (typeof planPath !== 'string' || planPath.trim() === '') {
    throw new ConsumerMutationError('--plan is required');
  }

  const absolutePlanPath = path.resolve(planPath);
  await lstatRegularFile(absolutePlanPath, 'Consumer mutation plan');
  const rawContent = await fs.readFile(absolutePlanPath, 'utf8');
  let rawPlan;
  try {
    rawPlan = JSON.parse(rawContent);
  } catch (error) {
    throw new ConsumerMutationError(`Consumer mutation plan is not valid JSON: ${error.message}`);
  }

  assertPlainObject(rawPlan, 'plan');
  assertExactKeys(rawPlan, ROOT_KEYS, 'plan');
  if (rawPlan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new ConsumerMutationError(
      `plan.schemaVersion must be ${PLAN_SCHEMA_VERSION}`
    );
  }
  if (!ALLOWED_OPERATIONS.has(rawPlan.operation)) {
    throw new ConsumerMutationError(`plan.operation is unsupported: ${rawPlan.operation}`);
  }
  if (expectedOperation && rawPlan.operation !== expectedOperation) {
    throw new ConsumerMutationError(
      `plan.operation must be ${expectedOperation}, received ${rawPlan.operation}`
    );
  }
  assertSha(rawPlan.formatterSha, 'plan.formatterSha');
  const registryPathPresent = Object.hasOwn(rawPlan, 'registryPath');
  const registryHashPresent = Object.hasOwn(rawPlan, 'registrySha256');
  if (registryPathPresent !== registryHashPresent) {
    throw new ConsumerMutationError(
      'plan.registryPath and plan.registrySha256 must be specified together'
    );
  }
  if (PROFILE_OPERATIONS.has(rawPlan.operation) && !registryPathPresent) {
    throw new ConsumerMutationError(
      `${rawPlan.operation} requires a pinned registryPath and registrySha256`
    );
  }
  if (!PROFILE_OPERATIONS.has(rawPlan.operation) && registryPathPresent) {
    throw new ConsumerMutationError(
      `${rawPlan.operation} must not declare an unused profile registry`
    );
  }
  if (
    registryPathPresent
    && (typeof rawPlan.registryPath !== 'string' || rawPlan.registryPath.trim() === '')
  ) {
    throw new ConsumerMutationError('plan.registryPath must be a non-empty path');
  }
  if (
    registryHashPresent
    && (typeof rawPlan.registrySha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(rawPlan.registrySha256))
  ) {
    throw new ConsumerMutationError(
      'plan.registrySha256 must be a lowercase SHA-256 digest'
    );
  }
  if (!Array.isArray(rawPlan.consumers) || rawPlan.consumers.length === 0) {
    throw new ConsumerMutationError('plan.consumers must contain at least one consumer');
  }
  if (rawPlan.consumers.length > MAX_CONSUMERS) {
    throw new ConsumerMutationError(
      `plan.consumers exceeds the finite maximum of ${MAX_CONSUMERS}`
    );
  }

  const planDirectory = path.dirname(absolutePlanPath);
  const consumers = rawPlan.consumers.map((entry, index) => (
    parseConsumerEntry(entry, index, planDirectory)
  ));
  const ids = consumers.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new ConsumerMutationError('plan.consumers must not contain duplicate IDs');
  }
  const worktrees = consumers.map((entry) => entry.worktree);
  if (new Set(worktrees).size !== worktrees.length) {
    throw new ConsumerMutationError('plan.consumers must not contain duplicate worktrees');
  }

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    operation: rawPlan.operation,
    formatterSha: rawPlan.formatterSha,
    registryPath: registryPathPresent
      ? path.resolve(planDirectory, rawPlan.registryPath)
      : null,
    registrySha256: registryHashPresent ? rawPlan.registrySha256 : null,
    consumers,
    path: absolutePlanPath,
    directory: planDirectory
  };
}

function selectConsumers(plan, { targetId, dryRun }) {
  if (!dryRun && !targetId) {
    throw new ConsumerMutationError(
      'Write mode requires --target <consumer-id>; one invocation may mutate only one consumer'
    );
  }

  if (targetId) {
    const selected = plan.consumers.find((entry) => entry.id === targetId);
    if (!selected) {
      throw new ConsumerMutationError(`Unknown consumer target: ${targetId}`);
    }
    return [selected];
  }
  return [...plan.consumers];
}

class ConsumerMutationBoundary {
  constructor(options = {}) {
    this.formatterRoot = path.resolve(options.formatterRoot || MODULE_ROOT);
    this.componentSync = options.componentSync || new ComponentSync();
    this.enforceFormatterCwd = options.enforceFormatterCwd !== false;
  }

  async assertFormatterRevision(plan) {
    if (this.enforceFormatterCwd && path.resolve(process.cwd()) !== this.formatterRoot) {
      throw new ConsumerMutationError(
        `Audited legacy mutation must run from the formatter root: ${this.formatterRoot}`
      );
    }
    const rootStat = await fs.lstat(this.formatterRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new ConsumerMutationError(
        `Formatter root must be a real directory: ${this.formatterRoot}`
      );
    }
    const repoRoot = path.resolve(
      gitOutput(this.formatterRoot, ['rev-parse', '--show-toplevel']).trim()
    );
    if (repoRoot !== this.formatterRoot) {
      throw new ConsumerMutationError(
        `Formatter root must equal its Git repository root: ${this.formatterRoot}`
      );
    }
    assertNoReplacementRefs(this.formatterRoot, 'Formatter repository');
    const head = gitOutput(this.formatterRoot, ['rev-parse', 'HEAD']).trim();
    if (head !== plan.formatterSha) {
      throw new ConsumerMutationError(
        `Formatter HEAD mismatch: expected ${plan.formatterSha}, received ${head}`
      );
    }
    const trackedStatus = gitOutput(
      this.formatterRoot,
      ['status', '--porcelain=v1', '--untracked-files=no']
    );
    if (trackedStatus !== '') {
      throw new ConsumerMutationError('Formatter tracked files must be clean at the audited SHA');
    }
    await assertTrackedFormatterTree(this.formatterRoot, plan.formatterSha);
    assertNoUntrackedMutationInputs(this.formatterRoot);
    const dependenciesPath = path.join(this.formatterRoot, 'node_modules');
    try {
      const dependencyStat = await fs.lstat(dependenciesPath);
      if (dependencyStat.isSymbolicLink() || !dependencyStat.isDirectory()) {
        throw new ConsumerMutationError(
          `Formatter node_modules must be a real directory: ${dependenciesPath}`
        );
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return head;
  }

  async assertConsumerWorktree(consumer) {
    const consumerRoot = await this.componentSync.assertConsumerRoot(consumer.worktree);
    if (consumerRoot !== path.resolve(consumer.worktree)) {
      throw new ConsumerMutationError(
        `Consumer worktree must resolve without indirection: ${consumer.worktree}`
      );
    }

    const repoRoot = path.resolve(
      gitOutput(consumerRoot, ['rev-parse', '--show-toplevel']).trim()
    );
    if (repoRoot !== consumerRoot) {
      throw new ConsumerMutationError(
        `Consumer worktree must equal its Git repository root: ${consumerRoot}`
      );
    }
    assertNoReplacementRefs(consumerRoot, `Consumer ${consumer.id}`);
    assertNoIndexFlags(consumerRoot, `Consumer ${consumer.id}`);

    const gitDirectory = path.resolve(
      consumerRoot,
      gitOutput(consumerRoot, ['rev-parse', '--git-dir']).trim()
    );
    const commonDirectory = path.resolve(
      consumerRoot,
      gitOutput(consumerRoot, ['rev-parse', '--git-common-dir']).trim()
    );
    if (gitDirectory === commonDirectory) {
      throw new ConsumerMutationError(
        `Consumer must be an isolated linked worktree: ${consumerRoot}`
      );
    }

    const head = gitOutput(consumerRoot, ['rev-parse', 'HEAD']).trim();
    if (head !== consumer.baseSha) {
      throw new ConsumerMutationError(
        `Consumer base SHA mismatch for ${consumer.id}: expected ${consumer.baseSha}, received ${head}`
      );
    }
    const status = gitOutput(consumerRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    const ignored = gitNullPaths(
      consumerRoot,
      ['ls-files', '--others', '--ignored', '--exclude-standard']
    );
    if (status !== '' || ignored.length > 0) {
      throw new ConsumerMutationError(
        `Consumer worktree must be clean and contain no ignored residue before mutation: ${consumer.id}`
      );
    }
    return consumerRoot;
  }

  async loadPinnedConfig(plan, consumer) {
    const configPath = consumer.configPath || path.join(consumer.worktree, 'book-config.json');
    if (consumer.configPath && !/^[0-9a-f]{64}$/.test(consumer.configSha256 || '')) {
      throw new ConsumerMutationError('External consumer config requires a lowercase SHA-256 digest');
    }
    await lstatRegularFile(configPath, 'Consumer config');
    const content = await fs.readFile(configPath);
    if (consumer.configSha256 && sha256(content) !== consumer.configSha256) {
      throw new ConsumerMutationError(`Consumer config SHA-256 mismatch: ${configPath}`);
    }

    if (!consumer.configPath) {
      const expected = await this.componentSync.assertManagedDestination(
        consumer.worktree,
        'book-config.json',
        { mustExist: true }
      );
      if (expected.absolutePath !== configPath) {
        throw new ConsumerMutationError('Consumer config resolved outside the consumer worktree');
      }
    }
    return { path: configPath, content };
  }

  async loadPinnedRegistry(plan, requestedPath) {
    if (!PROFILE_OPERATIONS.has(plan?.operation)) {
      throw new ConsumerMutationError('Pinned UX registry is only valid for profile operations');
    }
    if (
      typeof plan.registryPath !== 'string'
      || !/^[0-9a-f]{64}$/.test(plan.registrySha256 || '')
    ) {
      throw new ConsumerMutationError(
        'UX profile operations require a pinned registryPath and registrySha256'
      );
    }
    if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
      throw new ConsumerMutationError('--registry is required for UX profile operations');
    }

    const resolvedPath = path.resolve(requestedPath);
    if (resolvedPath !== plan.registryPath) {
      throw new ConsumerMutationError(
        `UX registry path mismatch: expected ${plan.registryPath}, received ${resolvedPath}`
      );
    }
    await lstatRegularFile(resolvedPath, 'UX profile registry');
    const content = await fs.readFile(resolvedPath);
    if (sha256(content) !== plan.registrySha256) {
      throw new ConsumerMutationError(`UX registry SHA-256 mismatch: ${resolvedPath}`);
    }
    return { path: resolvedPath, content };
  }

  async preflight({ plan, consumer, managedPaths, dryRun }) {
    assertConsumerBelongsToPlan(plan, consumer);
    await this.assertFormatterRevision(plan);
    const consumerRoot = await this.assertConsumerWorktree(consumer);
    const normalizedManagedPaths = normalizedUniquePaths(managedPaths, 'managedPaths');

    if (!dryRun && consumer.allowedPaths.length === 0) {
      throw new ConsumerMutationError(
        `Write mode requires a finite allowedPaths list for ${consumer.id}`
      );
    }
    if (consumer.allowedPaths.length > 0) {
      const expected = JSON.stringify(normalizedManagedPaths);
      const declared = JSON.stringify(consumer.allowedPaths);
      if (expected !== declared) {
        throw new ConsumerMutationError(
          `allowedPaths must exactly match the operation plan for ${consumer.id}`
        );
      }
    }

    const indexModes = readIndexModes(consumerRoot);
    for (const managedPath of normalizedManagedPaths) {
      // Inspect the filesystem boundary before invoking Git commands that may
      // themselves refuse to traverse a hostile symlink.
      await this.componentSync.assertManagedDestination(consumerRoot, managedPath);
      const ignoreCheck = spawnSync(
        'git',
        ['-C', consumerRoot, 'check-ignore', '--quiet', '--', managedPath],
        {
          encoding: 'utf8',
          env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
        }
      );
      if (ignoreCheck.error || ![0, 1].includes(ignoreCheck.status)) {
        throw new ConsumerMutationError(
          `git check-ignore failed for ${managedPath}: ${ignoreCheck.error?.message || ignoreCheck.stderr}`
        );
      }
      if (ignoreCheck.status === 0) {
        throw new ConsumerMutationError(`Managed destination must not be ignored: ${managedPath}`);
      }

      const segments = managedPath.split('/');
      for (let index = 1; index <= segments.length; index++) {
        const current = segments.slice(0, index).join('/');
        const mode = indexModes.get(current);
        if (mode === undefined) continue;
        if (index < segments.length) {
          throw new ConsumerMutationError(
            `Managed destination ancestor is tracked as ${mode}: ${current}`
          );
        }
        if (!['100644', '100755'].includes(mode)) {
          throw new ConsumerMutationError(
            `Managed destination has unsupported index mode ${mode}: ${managedPath}`
          );
        }
      }
      // Recheck after index/ignore inspection to keep the preflight fail-closed
      // if another process mutates the tree during validation.
      await this.componentSync.assertManagedDestination(consumerRoot, managedPath);
    }

    return { consumerRoot, managedPaths: normalizedManagedPaths };
  }

  rollback(consumerRoot, baseSha) {
    gitOutput(consumerRoot, ['reset', '--hard', baseSha]);
    gitOutput(consumerRoot, ['clean', '-fdx', '--']);
    assertNoReplacementRefs(consumerRoot, 'Consumer rollback repository');
    assertNoIndexFlags(consumerRoot, 'Consumer rollback repository');
    const head = gitOutput(consumerRoot, ['rev-parse', 'HEAD']).trim();
    const status = gitOutput(consumerRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
    const ignored = gitNullPaths(
      consumerRoot,
      ['ls-files', '--others', '--ignored', '--exclude-standard']
    );
    if (head !== baseSha || status !== '' || ignored.length > 0) {
      throw new ConsumerMutationError(`Rollback verification failed for ${consumerRoot}`);
    }
  }

  async run({ plan, consumer, managedPaths, dryRun, mutate }) {
    if (typeof mutate !== 'function') {
      throw new ConsumerMutationError('mutate callback is required');
    }
    const context = await this.preflight({ plan, consumer, managedPaths, dryRun });
    if (dryRun) {
      return {
        consumerId: consumer.id,
        consumerRoot: context.consumerRoot,
        dryRun: true,
        changedPaths: [],
        managedPaths: context.managedPaths
      };
    }

    try {
      await mutate(context);
      assertNoReplacementRefs(context.consumerRoot, `Consumer ${consumer.id}`);
      assertNoIndexFlags(context.consumerRoot, `Consumer ${consumer.id}`);
      const changedPaths = collectChangedPaths(context.consumerRoot);
      const unexpected = changedPaths.filter((entry) => !consumer.allowedPaths.includes(entry));
      if (unexpected.length > 0) {
        throw new ConsumerMutationError(
          `Mutation produced path(s) outside allowedPaths: ${unexpected.join(', ')}`
        );
      }

      const currentHead = gitOutput(context.consumerRoot, ['rev-parse', 'HEAD']).trim();
      if (currentHead !== consumer.baseSha) {
        throw new ConsumerMutationError(
          `Mutation changed consumer HEAD: expected ${consumer.baseSha}, received ${currentHead}`
        );
      }
      for (const managedPath of context.managedPaths) {
        await this.componentSync.assertManagedDestination(context.consumerRoot, managedPath);
      }

      return {
        consumerId: consumer.id,
        consumerRoot: context.consumerRoot,
        dryRun: false,
        changedPaths,
        managedPaths: context.managedPaths
      };
    } catch (error) {
      try {
        this.rollback(context.consumerRoot, consumer.baseSha);
      } catch (rollbackError) {
        throw new ConsumerMutationError(
          `Mutation failed and rollback also failed: ${rollbackError.message}`,
          { cause: error }
        );
      }
      throw new ConsumerMutationError(
        `Mutation failed and was rolled back for ${consumer.id}: ${error.message}`,
        { cause: error }
      );
    }
  }
}

export {
  ALLOWED_OPERATIONS,
  ConsumerMutationBoundary,
  ConsumerMutationError,
  MAX_CONSUMERS,
  PLAN_SCHEMA_VERSION,
  collectChangedPaths,
  loadConsumerMutationPlan,
  normalizeManagedPath,
  selectConsumers
};
