import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;
const MAX_CONSUMERS = 6;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_PLAN_OPERATIONS = new Set([
  'update-book',
  'sync-all-books',
  'rollout-ux-core',
  'rollout-ux-profile',
  'rollout-ux-core-profile'
]);
const PROFILE_PLAN_OPERATIONS = new Set([
  'rollout-ux-profile',
  'rollout-ux-core-profile'
]);
const LEGACY_MUTATION_COMMANDS = new Set([
  'update-book',
  'sync-all-books',
  'rollout-ux'
]);
const PLAN_ROOT_KEYS = new Set([
  'schemaVersion',
  'operation',
  'formatterSha',
  'registryPath',
  'registrySha256',
  'consumers'
]);
const PLAN_CONSUMER_KEYS = new Set([
  'id',
  'worktree',
  'baseSha',
  'allowedPaths',
  'configPath',
  'configSha256'
]);
const ISSUED_RUNTIME_ATTESTATIONS = new WeakSet();
const AUDITED_GIT_OPTIONS = [
  '-c', 'core.fsmonitor=false',
  '-c', `core.hooksPath=${os.devNull}`
];

let currentRuntimeAttestation = null;

class ConsumerDependencyBootstrapError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ConsumerDependencyBootstrapError';
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function safeEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toUpperCase();
    if (
      normalizedKey === 'NODE_OPTIONS'
      || normalizedKey === 'NODE_PATH'
      || normalizedKey.startsWith('GIT_')
      || normalizedKey.startsWith('NPM_CONFIG_')
    ) {
      delete environment[key];
    }
  }
  return { ...environment, ...overrides };
}

function gitBuffer(repositoryRoot, args) {
  try {
    return execFileSync(
      'git',
      [...AUDITED_GIT_OPTIONS, '-C', repositoryRoot, ...args],
      {
        encoding: 'buffer',
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: safeEnvironment({
          GIT_NO_REPLACE_OBJECTS: '1',
          GIT_OPTIONAL_LOCKS: '0'
        })
      }
    );
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString('utf8').trim()
      : String(error.stderr || error.message || '').trim();
    throw new ConsumerDependencyBootstrapError(
      `Git bootstrap audit failed: git ${args.join(' ')}${detail ? `: ${detail}` : ''}`,
      { cause: error }
    );
  }
}

function gitText(repositoryRoot, args) {
  return gitBuffer(repositoryRoot, args).toString('utf8');
}

function lstatRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new ConsumerDependencyBootstrapError(`${label} is not readable: ${filePath}`, {
      cause: error
    });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ConsumerDependencyBootstrapError(
      `${label} must be a regular non-symlink file: ${filePath}`
    );
  }
  return stat;
}

function rejectPathIfPresent(filePath, label) {
  try {
    fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new ConsumerDependencyBootstrapError(`${label} could not be inspected: ${filePath}`, {
      cause: error
    });
  }
  throw new ConsumerDependencyBootstrapError(`${label} is not allowed: ${filePath}`);
}

function parseTreeEntries(repositoryRoot, revision) {
  const output = gitBuffer(repositoryRoot, ['ls-tree', '-rz', '--full-tree', revision]);
  const entries = [];
  for (const record of output.toString('utf8').split('\0')) {
    if (record === '') continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(record);
    if (!match) {
      throw new ConsumerDependencyBootstrapError('Unexpected git ls-tree record');
    }
    entries.push({ mode: match[1], type: match[2], oid: match[3], path: match[4] });
  }
  if (entries.length === 0) {
    throw new ConsumerDependencyBootstrapError('Formatter commit contains no tracked files');
  }
  return entries;
}

function assertTrackedBootstrapTree(repositoryRoot, revision) {
  for (const entry of parseTreeEntries(repositoryRoot, revision)) {
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
      throw new ConsumerDependencyBootstrapError(
        `Formatter bootstrap rejects tracked ${entry.type} mode ${entry.mode}: ${entry.path}`
      );
    }
    const absolutePath = path.resolve(repositoryRoot, entry.path);
    if (
      absolutePath === repositoryRoot
      || !absolutePath.startsWith(`${repositoryRoot}${path.sep}`)
    ) {
      throw new ConsumerDependencyBootstrapError(
        `Tracked formatter path escapes repository root: ${entry.path}`
      );
    }
    const workingStat = lstatRegularFile(
      absolutePath,
      `Tracked formatter file ${entry.path}`
    );
    const expectedExecutable = entry.mode === '100755';
    const workingExecutable = (workingStat.mode & 0o111) !== 0;
    if (workingExecutable !== expectedExecutable) {
      throw new ConsumerDependencyBootstrapError(
        `Tracked formatter mode differs from ${revision}: ${entry.path}`
      );
    }
    const workingBytes = fs.readFileSync(absolutePath);
    const committedBytes = gitBuffer(repositoryRoot, ['cat-file', 'blob', entry.oid]);
    if (!workingBytes.equals(committedBytes)) {
      throw new ConsumerDependencyBootstrapError(
        `Tracked formatter bytes differ from ${revision}: ${entry.path}`
      );
    }
  }
}

function resolveRepositoryRoot(repositoryRoot = MODULE_ROOT) {
  const resolved = path.resolve(repositoryRoot);
  let rootStat;
  try {
    rootStat = fs.lstatSync(resolved);
  } catch (error) {
    throw new ConsumerDependencyBootstrapError(`Formatter root is not readable: ${resolved}`, {
      cause: error
    });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ConsumerDependencyBootstrapError(
      `Formatter root must be a real directory: ${resolved}`
    );
  }
  const gitRoot = path.resolve(gitText(resolved, ['rev-parse', '--show-toplevel']).trim());
  if (gitRoot !== resolved) {
    throw new ConsumerDependencyBootstrapError(
      `Formatter root must equal its Git repository root: ${resolved}`
    );
  }
  if (gitText(resolved, ['for-each-ref', '--format=%(refname)', 'refs/replace']).trim() !== '') {
    throw new ConsumerDependencyBootstrapError('Formatter replacement refs are not allowed');
  }
  return resolved;
}

function verifyBootstrapInputs(repositoryRoot, formatterSha) {
  if (typeof formatterSha !== 'string' || !SHA_PATTERN.test(formatterSha)) {
    throw new ConsumerDependencyBootstrapError(
      'Bootstrap formatterSha must be a lowercase 40-character commit SHA'
    );
  }
  const root = resolveRepositoryRoot(repositoryRoot);
  const head = gitText(root, ['rev-parse', 'HEAD']).trim();
  if (head !== formatterSha) {
    throw new ConsumerDependencyBootstrapError(
      `Bootstrap formatter HEAD mismatch: expected ${formatterSha}, received ${head}`
    );
  }
  assertTrackedBootstrapTree(root, formatterSha);

  rejectPathIfPresent(
    path.join(root, '.npmrc'),
    'Formatter project npm configuration'
  );
  rejectPathIfPresent(
    path.join(root, 'npm-shrinkwrap.json'),
    'Formatter alternate npm lockfile'
  );

  const packagePath = path.join(root, 'package.json');
  const lockfilePath = path.join(root, 'package-lock.json');
  lstatRegularFile(packagePath, 'Bootstrap package.json');
  lstatRegularFile(lockfilePath, 'Bootstrap package-lock.json');
  const packageBytes = fs.readFileSync(packagePath);
  const lockfileBytes = fs.readFileSync(lockfilePath);

  return {
    repositoryRoot: root,
    formatterSha,
    packageJsonSha256: sha256(packageBytes),
    lockfileSha256: sha256(lockfileBytes)
  };
}

function expectedOperationFromArgs(args) {
  const command = args[0];
  if (command === 'update-book' || command === 'sync-all-books') return command;
  if (command !== 'rollout-ux') return null;
  const core = args.includes('--apply-ux-core');
  const profile = args.includes('--apply-ux-profile');
  if (core && profile) return 'rollout-ux-core-profile';
  if (core) return 'rollout-ux-core';
  if (profile) return 'rollout-ux-profile';
  throw new ConsumerDependencyBootstrapError(
    'rollout-ux bootstrap requires --apply-ux-core or --apply-ux-profile'
  );
}

function planArgument(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--plan') {
      if (index + 1 >= args.length || args[index + 1].startsWith('-')) {
        throw new ConsumerDependencyBootstrapError('--plan requires a path');
      }
      values.push(args[index + 1]);
      index += 1;
    } else if (args[index].startsWith('--plan=')) {
      values.push(args[index].slice('--plan='.length));
    }
  }
  if (values.length !== 1 || values[0].trim() === '') {
    throw new ConsumerDependencyBootstrapError(
      'Legacy consumer bootstrap requires exactly one --plan path'
    );
  }
  return values[0];
}

function readBootstrapPlan(args, cwd = process.cwd()) {
  const expectedOperation = expectedOperationFromArgs(args);
  if (!expectedOperation) {
    throw new ConsumerDependencyBootstrapError('Not a legacy consumer mutation command');
  }
  const planPath = path.resolve(cwd, planArgument(args));
  const stat = lstatRegularFile(planPath, 'Consumer mutation plan');
  if (stat.size > MAX_PLAN_BYTES) {
    throw new ConsumerDependencyBootstrapError(
      `Consumer mutation plan exceeds ${MAX_PLAN_BYTES} bytes`
    );
  }
  const bytes = fs.readFileSync(planPath);
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ConsumerDependencyBootstrapError('Consumer mutation plan must be strict JSON', {
      cause: error
    });
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new ConsumerDependencyBootstrapError('Consumer mutation plan must be an object');
  }
  if (plan.schemaVersion !== 1) {
    throw new ConsumerDependencyBootstrapError('plan.schemaVersion must be 1');
  }
  if (typeof plan.formatterSha !== 'string' || !SHA_PATTERN.test(plan.formatterSha)) {
    throw new ConsumerDependencyBootstrapError(
      'Consumer mutation plan formatterSha must be a lowercase 40-character commit SHA'
    );
  }
  if (plan.operation !== expectedOperation) {
    throw new ConsumerDependencyBootstrapError(
      `Consumer mutation plan operation must be ${expectedOperation}`
    );
  }
  if (!rawPlanProjection(plan, planPath)) {
    throw new ConsumerDependencyBootstrapError(
      'Consumer mutation plan violates the strict finite plan contract'
    );
  }
  return {
    path: planPath,
    sha256: sha256(bytes),
    formatterSha: plan.formatterSha,
    expectedOperation
  };
}

function assertDependencyRoot(repositoryRoot) {
  const dependencyRoot = path.join(repositoryRoot, 'node_modules');
  let stat;
  try {
    stat = fs.lstatSync(dependencyRoot);
  } catch (error) {
    throw new ConsumerDependencyBootstrapError(
      `Fresh dependency tree is missing: ${dependencyRoot}`,
      { cause: error }
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ConsumerDependencyBootstrapError(
      `Fresh dependency tree must be a real directory: ${dependencyRoot}`
    );
  }
  return dependencyRoot;
}

function removeDependencyRoot(repositoryRoot, { rejectUnsafeType = true } = {}) {
  const dependencyRoot = path.join(repositoryRoot, 'node_modules');
  let stat;
  try {
    stat = fs.lstatSync(dependencyRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    if (rejectUnsafeType) {
      throw new ConsumerDependencyBootstrapError(
        `Existing dependency root must be a real directory before replacement: ${dependencyRoot}`
      );
    }
    fs.rmSync(dependencyRoot, { force: true });
    return;
  }
  fs.rmSync(dependencyRoot, { recursive: true, force: true });
}

function rebuildFreshDependencies(repositoryRoot, options = {}) {
  const npmExecutable = options.npmExecutable
    || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  removeDependencyRoot(repositoryRoot);
  const configRoot = fs.mkdtempSync(
    path.join(repositoryRoot, '.book-formatter-bootstrap-')
  );
  const userConfig = path.join(configRoot, 'user.npmrc');
  const globalConfig = path.join(configRoot, 'global.npmrc');
  let install;
  try {
    fs.writeFileSync(userConfig, '', { mode: 0o600 });
    fs.writeFileSync(globalConfig, '', { mode: 0o600 });
    install = spawnSync(
      npmExecutable,
      [
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--userconfig=${userConfig}`,
        `--globalconfig=${globalConfig}`
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: options.installStdio || 'inherit',
        env: safeEnvironment({
          npm_config_ignore_scripts: 'true',
          npm_config_audit: 'false',
          npm_config_fund: 'false'
        })
      }
    );
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
  if (install.error || install.status !== 0) {
    removeDependencyRoot(repositoryRoot, { rejectUnsafeType: false });
    const detail = String(install.stderr || install.error?.message || '').trim();
    throw new ConsumerDependencyBootstrapError(
      `Fresh dependency bootstrap failed with status ${install.status ?? 'unknown'}`
      + `${detail ? `: ${detail}` : ''}`,
      { cause: install.error }
    );
  }
  try {
    assertDependencyRoot(repositoryRoot);
  } catch (error) {
    removeDependencyRoot(repositoryRoot, { rejectUnsafeType: false });
    throw error;
  }
  return { status: install.status, stdout: install.stdout || '', stderr: install.stderr || '' };
}

function isLegacyMutationHelpInvocation(args = process.argv.slice(2)) {
  return (
    LEGACY_MUTATION_COMMANDS.has(args[0])
    && args.length === 2
    && (args[1] === '--help' || args[1] === '-h')
  );
}

function legacyMutationHelpText(command) {
  const common = [
    `Usage: node src/index.js ${command} --plan <path> [options]`,
    '',
    'Required:',
    '  --plan <path>          Audited finite consumer mutation plan',
    '',
    'Options:',
    '  --target <consumer-id> Single write target',
    '  --dry-run              Validate without changing consumer files',
    '  -h, --help             Display this built-in-only help'
  ];
  if (command === 'rollout-ux') {
    common.splice(
      common.length - 1,
      0,
      '  -r, --registry <path> Registry path required by UX profile plans',
      '  --apply-ux-core      Apply the shared UX core',
      '  --apply-ux-profile   Apply the registry-pinned UX profile'
    );
  }
  return `${common.join('\n')}\n`;
}

function isLegacyMutationInvocation(args = process.argv.slice(2)) {
  return (
    LEGACY_MUTATION_COMMANDS.has(args[0])
    && !isLegacyMutationHelpInvocation(args)
  );
}

function isNpmLifecycleInvocation(environment = process.env) {
  return ['start', 'dev'].includes(environment.npm_lifecycle_event);
}

function createRuntimeAttestation(plan, verified) {
  const attestation = Object.freeze({
    schemaVersion: 1,
    formatterSha: verified.formatterSha,
    packageJsonSha256: verified.packageJsonSha256,
    lockfileSha256: verified.lockfileSha256,
    planPath: plan.path,
    planSha256: plan.sha256,
    bootstrapNonce: crypto.randomBytes(32).toString('hex'),
    repositoryRoot: verified.repositoryRoot
  });
  ISSUED_RUNTIME_ATTESTATIONS.add(attestation);
  return attestation;
}

function assertBrandedRuntimeAttestation(attestation) {
  if (!attestation || !ISSUED_RUNTIME_ATTESTATIONS.has(attestation)) {
    throw new ConsumerDependencyBootstrapError(
      'Fresh dependency runtime capability is missing or invalid'
    );
  }
  return attestation;
}

function assertAttestedFormatterState(attestation, repositoryRoot, formatterSha) {
  const root = path.resolve(repositoryRoot);
  if (
    attestation.repositoryRoot !== root
    || attestation.formatterSha !== formatterSha
  ) {
    throw new ConsumerDependencyBootstrapError('Fresh dependency attestation scope mismatch');
  }
  const verified = verifyBootstrapInputs(root, formatterSha);
  if (
    verified.lockfileSha256 !== attestation.lockfileSha256
    || verified.packageJsonSha256 !== attestation.packageJsonSha256
  ) {
    throw new ConsumerDependencyBootstrapError(
      'Bootstrap package or lockfile digest changed after dependency installation'
    );
  }
  assertDependencyRoot(root);
  return verified;
}

function exactKeys(value, allowed) {
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key))
  );
}

function normalizeRawManagedPath(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    return null;
  }
  const portable = value.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(portable)
    || path.win32.isAbsolute(value)
    || portable.split('/').includes('..')
  ) {
    return null;
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === '.' || normalized.startsWith('../') || normalized !== portable) {
    return null;
  }
  return normalized;
}

function normalizeRawAllowedPaths(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  const normalized = value.map(normalizeRawManagedPath);
  if (
    normalized.some((entry) => entry === null)
    || new Set(normalized).size !== normalized.length
  ) {
    return null;
  }
  return normalized.sort();
}

function rawPlanProjection(rawPlan, planPath) {
  if (
    !exactKeys(rawPlan, PLAN_ROOT_KEYS)
    || rawPlan.schemaVersion !== 1
    || !ALLOWED_PLAN_OPERATIONS.has(rawPlan.operation)
    || typeof rawPlan.formatterSha !== 'string'
    || !SHA_PATTERN.test(rawPlan.formatterSha)
    || !Array.isArray(rawPlan.consumers)
    || rawPlan.consumers.length === 0
    || rawPlan.consumers.length > MAX_CONSUMERS
  ) {
    return null;
  }
  const directory = path.dirname(planPath);
  const registryPathPresent = Object.hasOwn(rawPlan, 'registryPath');
  const registryHashPresent = Object.hasOwn(rawPlan, 'registrySha256');
  if (
    registryPathPresent !== registryHashPresent
    || (PROFILE_PLAN_OPERATIONS.has(rawPlan.operation) !== registryPathPresent)
    || (registryPathPresent
      && (typeof rawPlan.registryPath !== 'string'
        || rawPlan.registryPath.trim() === ''
        || typeof rawPlan.registrySha256 !== 'string'
        || !SHA256_PATTERN.test(rawPlan.registrySha256)))
  ) {
    return null;
  }
  const consumers = [];
  for (const rawConsumer of rawPlan.consumers) {
    if (!exactKeys(rawConsumer, PLAN_CONSUMER_KEYS)) return null;
    const allowedPaths = normalizeRawAllowedPaths(rawConsumer.allowedPaths);
    const configPathPresent = Object.hasOwn(rawConsumer, 'configPath');
    const configHashPresent = Object.hasOwn(rawConsumer, 'configSha256');
    if (
      allowedPaths === null
      || typeof rawConsumer.id !== 'string'
      || !ID_PATTERN.test(rawConsumer.id)
      || typeof rawConsumer.worktree !== 'string'
      || rawConsumer.worktree.trim() === ''
      || typeof rawConsumer.baseSha !== 'string'
      || !SHA_PATTERN.test(rawConsumer.baseSha)
      || configPathPresent !== configHashPresent
      || (configPathPresent
        && (typeof rawConsumer.configPath !== 'string'
          || rawConsumer.configPath.trim() === ''
          || typeof rawConsumer.configSha256 !== 'string'
          || !SHA256_PATTERN.test(rawConsumer.configSha256)))
    ) {
      return null;
    }
    consumers.push({
      id: rawConsumer.id,
      worktree: path.resolve(directory, rawConsumer.worktree),
      baseSha: rawConsumer.baseSha,
      allowedPaths,
      configPath: configPathPresent
        ? path.resolve(directory, rawConsumer.configPath)
        : null,
      configSha256: configHashPresent
        ? rawConsumer.configSha256
        : null
    });
  }
  if (
    new Set(consumers.map((consumer) => consumer.id)).size !== consumers.length
    || new Set(consumers.map((consumer) => consumer.worktree)).size !== consumers.length
  ) {
    return null;
  }
  return {
    schemaVersion: rawPlan.schemaVersion,
    operation: rawPlan.operation,
    formatterSha: rawPlan.formatterSha,
    registryPath: registryPathPresent
      ? path.resolve(directory, rawPlan.registryPath)
      : null,
    registrySha256: registryHashPresent
      ? rawPlan.registrySha256
      : null,
    consumers,
    path: planPath,
    directory
  };
}

function runtimePlanProjection(plan) {
  const expectedKeys = new Set([
    'schemaVersion',
    'operation',
    'formatterSha',
    'registryPath',
    'registrySha256',
    'consumers',
    'path',
    'directory'
  ]);
  if (!exactKeys(plan, expectedKeys) || !Array.isArray(plan.consumers)) return null;
  for (const consumer of plan.consumers) {
    if (!exactKeys(consumer, PLAN_CONSUMER_KEYS)) return null;
  }
  return {
    schemaVersion: plan.schemaVersion,
    operation: plan.operation,
    formatterSha: plan.formatterSha,
    registryPath: plan.registryPath,
    registrySha256: plan.registrySha256,
    consumers: plan.consumers.map((consumer) => ({
      id: consumer.id,
      worktree: consumer.worktree,
      baseSha: consumer.baseSha,
      allowedPaths: consumer.allowedPaths,
      configPath: consumer.configPath,
      configSha256: consumer.configSha256
    })),
    path: plan.path,
    directory: plan.directory
  };
}

function freezePlanProjection(plan) {
  for (const consumer of plan.consumers) {
    Object.freeze(consumer.allowedPaths);
    Object.freeze(consumer);
  }
  Object.freeze(plan.consumers);
  return Object.freeze(plan);
}

function assertAttestedPlan(attestation, plan) {
  if (path.resolve(plan?.path || '') !== attestation.planPath) {
    throw new ConsumerDependencyBootstrapError('Fresh dependency plan scope mismatch');
  }
  lstatRegularFile(attestation.planPath, 'Attested consumer mutation plan');
  const bytes = fs.readFileSync(attestation.planPath);
  if (sha256(bytes) !== attestation.planSha256) {
    throw new ConsumerDependencyBootstrapError(
      'Consumer mutation plan changed after dependency bootstrap'
    );
  }
  let rawPlan;
  try {
    rawPlan = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ConsumerDependencyBootstrapError(
      'Attested consumer mutation plan is not valid JSON',
      { cause: error }
    );
  }
  const expected = rawPlanProjection(rawPlan, attestation.planPath);
  const actual = runtimePlanProjection(plan);
  if (!expected || !actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ConsumerDependencyBootstrapError(
      'In-memory consumer mutation plan differs from attested plan bytes'
    );
  }
  return freezePlanProjection(expected);
}

function assertFreshDependencyRuntime({
  repositoryRoot,
  plan,
  explicitAttestation = null
}) {
  const attestation = assertBrandedRuntimeAttestation(
    explicitAttestation || currentRuntimeAttestation
  );
  assertAttestedFormatterState(attestation, repositoryRoot, plan?.formatterSha);
  return assertAttestedPlan(attestation, plan);
}

function assertFreshDependencyRuntimePresent(repositoryRoot = MODULE_ROOT) {
  const attestation = assertBrandedRuntimeAttestation(currentRuntimeAttestation);
  assertAttestedFormatterState(
    attestation,
    repositoryRoot,
    attestation.formatterSha
  );
  return attestation;
}

function runFreshDependencyBootstrap(args, options = {}) {
  const repositoryRoot = resolveRepositoryRoot(options.repositoryRoot || MODULE_ROOT);
  if (path.resolve(options.cwd || process.cwd()) !== repositoryRoot) {
    throw new ConsumerDependencyBootstrapError(
      `Legacy consumer bootstrap must run from the formatter root: ${repositoryRoot}`
    );
  }
  currentRuntimeAttestation = null;
  const plan = readBootstrapPlan(args, repositoryRoot);
  const verifiedBeforeInstall = verifyBootstrapInputs(repositoryRoot, plan.formatterSha);
  rebuildFreshDependencies(repositoryRoot, {
    installStdio: options.installStdio
  });
  let verifiedAfterInstall;
  try {
    verifiedAfterInstall = verifyBootstrapInputs(repositoryRoot, plan.formatterSha);
  } catch (error) {
    removeDependencyRoot(repositoryRoot, { rejectUnsafeType: false });
    throw error;
  }
  if (
    verifiedAfterInstall.packageJsonSha256 !== verifiedBeforeInstall.packageJsonSha256
    || verifiedAfterInstall.lockfileSha256 !== verifiedBeforeInstall.lockfileSha256
  ) {
    removeDependencyRoot(repositoryRoot, { rejectUnsafeType: false });
    throw new ConsumerDependencyBootstrapError(
      'Bootstrap package or lockfile digest changed during dependency installation'
    );
  }
  currentRuntimeAttestation = createRuntimeAttestation(plan, verifiedAfterInstall);
  return currentRuntimeAttestation;
}

async function loadFreshLegacyMutationApi(args) {
  const freshDependencyAttestation = runFreshDependencyBootstrap(args);
  const [
    { BookGenerator },
    { ConsumerMutationBoundary, loadConsumerMutationPlan },
    { UxRollout }
  ] = await Promise.all([
    import('./BookGenerator.js'),
    import('./ConsumerMutationBoundary.js'),
    import('./UxRollout.js')
  ]);
  return Object.freeze({
    BookGenerator,
    ConsumerMutationBoundary,
    UxRollout,
    loadConsumerMutationPlan,
    freshDependencyAttestation
  });
}

export {
  ConsumerDependencyBootstrapError,
  LEGACY_MUTATION_COMMANDS,
  assertFreshDependencyRuntime,
  assertFreshDependencyRuntimePresent,
  isLegacyMutationInvocation,
  isLegacyMutationHelpInvocation,
  isNpmLifecycleInvocation,
  legacyMutationHelpText,
  loadFreshLegacyMutationApi,
  readBootstrapPlan,
  rebuildFreshDependencies,
  runFreshDependencyBootstrap,
  safeEnvironment,
  verifyBootstrapInputs
};
