import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fileSystemConstants } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';

import fs from 'fs-extra';

// Shared adapter I/O boundary for visibility-bound source reads and owned,
// identity-checked output replacement. This defends against accidental and
// concurrent path changes; hostile same-UID parent-directory mutation remains
// the separately tracked output-parent boundary from book-formatter#138.

const IDENTITY_BOUND_DIRECTORY_CLEANUP = `
import { lstat, readdir, rm } from 'node:fs/promises';
const [expectedDev, expectedIno] = process.argv.slice(1);
const current = await lstat('.');
if (String(current.dev) !== expectedDev || String(current.ino) !== expectedIno) {
  process.exit(73);
}
for (const entry of (await readdir('.')).sort()) {
  await rm(entry, { recursive: true, force: false, maxRetries: 0 });
}
if ((await readdir('.')).length !== 0) process.exit(74);
`;

const IDENTITY_BOUND_DIRECTORY_CREATE = `
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
await mkdir(name, { mode: 0o700 });
const handle = await open(
  name,
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
);
let created;
try {
  created = await handle.stat();
  if (!created.isDirectory()) process.exit(74);
} finally {
  await handle.close();
}
process.stdout.write(JSON.stringify({ dev: String(created.dev), ino: String(created.ino) }));
`;

const IDENTITY_BOUND_EXCLUSIVE_WRITE = `
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const handle = await open(
  name,
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  0o600
);
let written;
try {
  await handle.writeFile(Buffer.concat(chunks));
  await handle.sync();
  written = await handle.stat();
  if (!written.isFile()) process.exit(74);
} finally {
  await handle.close();
}
process.stdout.write(JSON.stringify({
  dev: String(written.dev),
  ino: String(written.ino),
  size: String(written.size)
}));
`;

const IDENTITY_BOUND_DIRECTORY_INSPECT = `
import { lstat } from 'node:fs/promises';
const [expectedDev, expectedIno, name] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const child = await lstat(name);
if (!child.isDirectory() || child.isSymbolicLink()) process.exit(74);
process.stdout.write(JSON.stringify({ dev: String(child.dev), ino: String(child.ino) }));
`;

const IDENTITY_BOUND_FILE_READ = `
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
const [expectedDev, expectedIno, name, maximumSize] = process.argv.slice(1);
if (!name || name === '.' || name === '..' || /[\\/]/u.test(name)) process.exit(64);
const parent = await lstat('.');
if (String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) process.exit(73);
const pathStat = await lstat(name);
if (!pathStat.isFile() || pathStat.isSymbolicLink()) process.exit(74);
if (pathStat.size > Number(maximumSize)) process.exit(75);
const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
try {
  const opened = await handle.stat();
  if (
    !opened.isFile() ||
    opened.dev !== pathStat.dev ||
    opened.ino !== pathStat.ino ||
    opened.size !== pathStat.size
  ) process.exit(76);
  const contents = await handle.readFile();
  const completed = await handle.stat();
  const current = await lstat(name);
  if (
    completed.dev !== opened.dev ||
    completed.ino !== opened.ino ||
    completed.size !== opened.size ||
    completed.mtimeMs !== opened.mtimeMs ||
    completed.ctimeMs !== opened.ctimeMs ||
    current.isSymbolicLink() ||
    current.dev !== opened.dev ||
    current.ino !== opened.ino ||
    contents.length !== opened.size ||
    contents.length > Number(maximumSize)
  ) process.exit(76);
  process.stdout.write(contents);
} finally {
  await handle.close();
}
`;

export class AdapterSafeIOError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdapterSafeIOError';
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function samePathIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function pathIdentity(candidate) {
  const stat = await fs.stat(candidate);
  return { dev: stat.dev, ino: stat.ino };
}

async function pathObjectIdentity(candidate) {
  const stat = await fs.lstat(candidate);
  return { dev: stat.dev, ino: stat.ino };
}

async function pathObjectIdentityIfExists(candidate) {
  try {
    return await pathObjectIdentity(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function runIdentityBoundOperation({
  script,
  cwd,
  args,
  input,
  context,
  binaryOutput = false,
  codeMessages = {}
}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', script, ...args],
      {
        cwd,
        env: {},
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      }
    );
    const output = [];
    let settled = false;
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, output: Buffer.concat(output) });
    });
    child.stdin.end(input);
  });
  if (result.code !== 0) {
    throw new AdapterSafeIOError(
      codeMessages[result.code] || `${context} (${result.code ?? 'terminated'})`
    );
  }
  return binaryOutput ? result.output : result.output.toString('utf8');
}

export function createAdapterSafeIO({ adapterName, target }) {
  if (!adapterName || !target) {
    throw new AdapterSafeIOError('Adapter safe I/O requires an adapter name and target.');
  }

  async function assertOwnedExistingOutput(outputDirectory) {
    let stat;
    try {
      stat = await fs.lstat(outputDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new AdapterSafeIOError(
        `${adapterName} output must be a real directory: ${outputDirectory}`
      );
    }
    const expectedIdentity = { dev: stat.dev, ino: stat.ino };
    let manifest;
    try {
      const manifestPath = path.join(outputDirectory, 'manifest.json');
      const manifestStat = await fs.lstat(manifestPath);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('not a file');
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      throw new AdapterSafeIOError(
        `Refusing to replace output without a valid adapter manifest: ${outputDirectory}`
      );
    }
    if (
      manifest.kind !== 'book-formatter.adapter-build' ||
      manifest.adapter?.target !== target
    ) {
      throw new AdapterSafeIOError(
        `Refusing to replace output owned by another producer: ${outputDirectory}`
      );
    }
    const currentIdentity = await pathObjectIdentity(outputDirectory);
    if (!samePathIdentity(currentIdentity, expectedIdentity)) {
      throw new AdapterSafeIOError(
        `${adapterName} output changed during ownership validation: ${outputDirectory}`
      );
    }
    return expectedIdentity;
  }

  async function createDirectoryInHeldParent(parent, parentIdentity, name) {
    const output = await runIdentityBoundOperation({
      script: IDENTITY_BOUND_DIRECTORY_CREATE,
      cwd: parent,
      args: [String(parentIdentity.dev), String(parentIdentity.ino), name],
      input: '',
      context: `${adapterName} staging directory could not be created exclusively`
    });
    let identity;
    try {
      identity = JSON.parse(output);
    } catch {
      throw new AdapterSafeIOError(
        `${adapterName} staging directory identity response was invalid`
      );
    }
    if (!/^\d+$/u.test(identity?.dev || '') || !/^\d+$/u.test(identity?.ino || '')) {
      throw new AdapterSafeIOError(
        `${adapterName} staging directory identity response was invalid`
      );
    }
    return { dev: Number(identity.dev), ino: Number(identity.ino) };
  }

  async function inspectDirectoryInHeldParent(
    parent,
    parentIdentity,
    name,
    relativePath,
    pathLabel
  ) {
    const output = await runIdentityBoundOperation({
      script: IDENTITY_BOUND_DIRECTORY_INSPECT,
      cwd: parent,
      args: [String(parentIdentity.dev), String(parentIdentity.ino), name],
      input: '',
      context: `${pathLabel} path could not be traversed safely: ${relativePath}`,
      codeMessages: {
        74: `${pathLabel} path must not contain symbolic links: ${relativePath}`
      }
    });
    let identity;
    try {
      identity = JSON.parse(output);
    } catch {
      throw new AdapterSafeIOError(
        `${pathLabel} directory identity response was invalid: ${relativePath}`
      );
    }
    if (!/^\d+$/u.test(identity?.dev || '') || !/^\d+$/u.test(identity?.ino || '')) {
      throw new AdapterSafeIOError(
        `${pathLabel} directory identity response was invalid: ${relativePath}`
      );
    }
    return { dev: Number(identity.dev), ino: Number(identity.ino) };
  }

  async function readFileInHeldDirectory(
    parent,
    parentIdentity,
    name,
    relativePath,
    { maximumSize, pathLabel, tooLargeMessage }
  ) {
    return runIdentityBoundOperation({
      script: IDENTITY_BOUND_FILE_READ,
      cwd: parent,
      args: [
        String(parentIdentity.dev),
        String(parentIdentity.ino),
        name,
        String(maximumSize)
      ],
      input: '',
      context: `${pathLabel} could not be opened safely: ${relativePath}`,
      binaryOutput: true,
      codeMessages: {
        74: `${pathLabel} path must not contain symbolic links: ${relativePath}`,
        75: tooLargeMessage,
        76: `${pathLabel} changed while being read: ${relativePath}`
      }
    });
  }

  function heldTreePathComponents(relativePath, pathLabel) {
    const components = String(relativePath).split(path.sep);
    if (
      typeof relativePath !== 'string' ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      components.some((component) =>
        !component || component === '.' || component === '..' || /[\\/]/u.test(component)
      )
    ) {
      throw new AdapterSafeIOError(`Invalid ${pathLabel} path: ${relativePath}`);
    }
    return components;
  }

  async function inspectDirectoryPathInHeldTree(
    root,
    rootIdentity,
    components,
    relativePath,
    pathLabel
  ) {
    let current = { path: root, identity: rootIdentity };
    for (const component of components) {
      const identity = await inspectDirectoryInHeldParent(
        current.path,
        current.identity,
        component,
        relativePath,
        pathLabel
      );
      current = { path: path.join(current.path, component), identity };
    }
    return current;
  }

  async function bindDirectoryFromHeldTree(
    root,
    rootIdentity,
    relativePath,
    { pathLabel = 'Directory' } = {}
  ) {
    const components = heldTreePathComponents(relativePath, pathLabel);
    return (await inspectDirectoryPathInHeldTree(
      root,
      rootIdentity,
      components,
      relativePath,
      pathLabel
    )).identity;
  }

  async function readFileFromHeldTree(
    root,
    rootIdentity,
    relativePath,
    {
      maximumSize,
      pathLabel = 'Asset',
      tooLargeMessage = `${pathLabel} exceeds its size limit: ${relativePath}`
    }
  ) {
    const components = heldTreePathComponents(relativePath, pathLabel);
    const name = components.pop();
    const current = await inspectDirectoryPathInHeldTree(
      root,
      rootIdentity,
      components,
      relativePath,
      pathLabel
    );
    return readFileInHeldDirectory(current.path, current.identity, name, relativePath, {
      maximumSize,
      pathLabel,
      tooLargeMessage
    });
  }

  async function writeFileInHeldDirectory(directory, directoryIdentity, name, contents) {
    const output = await runIdentityBoundOperation({
      script: IDENTITY_BOUND_EXCLUSIVE_WRITE,
      cwd: directory,
      args: [String(directoryIdentity.dev), String(directoryIdentity.ino), name],
      input: Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8'),
      context: `${adapterName} staging file could not be created exclusively`
    });
    let identity;
    try {
      identity = JSON.parse(output);
    } catch {
      throw new AdapterSafeIOError(`${adapterName} staging file identity response was invalid`);
    }
    if (
      !/^\d+$/u.test(identity?.dev || '') ||
      !/^\d+$/u.test(identity?.ino || '') ||
      !/^\d+$/u.test(identity?.size || '')
    ) {
      throw new AdapterSafeIOError(`${adapterName} staging file identity response was invalid`);
    }
    return {
      dev: Number(identity.dev),
      ino: Number(identity.ino),
      size: Number(identity.size)
    };
  }

  function stagingPathComponents(relativePath) {
    const components = String(relativePath).split('/');
    if (
      components.length === 0 ||
      components.some((component) =>
        !component || component === '.' || component === '..' || /[\\/]/u.test(component)
      )
    ) {
      throw new AdapterSafeIOError(
        `Invalid ${adapterName} staging path: ${relativePath}`
      );
    }
    return components;
  }

  function createStagingTree(stagingDirectory, expectedStagingIdentity) {
    const directories = new Map([
      ['', { path: stagingDirectory, identity: expectedStagingIdentity }]
    ]);
    const files = new Map();

    async function requireDirectory(relativePath) {
      const components = relativePath ? stagingPathComponents(relativePath) : [];
      let currentKey = '';
      let current = directories.get(currentKey);
      for (const component of components) {
        const nextKey = currentKey ? `${currentKey}/${component}` : component;
        let next = directories.get(nextKey);
        if (!next) {
          const identity = await createDirectoryInHeldParent(
            current.path,
            current.identity,
            component
          );
          next = { path: path.join(current.path, component), identity };
          directories.set(nextKey, next);
        }
        currentKey = nextKey;
        current = next;
      }
      return current;
    }

    async function write(relativePath, contents) {
      const components = stagingPathComponents(relativePath);
      const name = components.pop();
      const parent = await requireDirectory(components.join('/'));
      const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
      const identity = await writeFileInHeldDirectory(parent.path, parent.identity, name, bytes);
      files.set(relativePath, {
        identity,
        digest: sha256(bytes)
      });
    }

    async function assertTreeUnchanged(rootDirectory = stagingDirectory) {
      const expectedEntries = new Map([...directories.keys()].map((key) => [key, new Set()]));
      for (const key of directories.keys()) {
        if (!key) continue;
        const parent = path.posix.dirname(key) === '.' ? '' : path.posix.dirname(key);
        expectedEntries.get(parent).add(path.posix.basename(key));
      }
      for (const relativePath of files.keys()) {
        const parent = path.posix.dirname(relativePath) === '.'
          ? ''
          : path.posix.dirname(relativePath);
        expectedEntries.get(parent).add(path.posix.basename(relativePath));
      }

      for (const [relativePath, directory] of directories) {
        const candidate = relativePath
          ? path.join(rootDirectory, ...relativePath.split('/'))
          : rootDirectory;
        await assertPathObjectIdentity(
          candidate,
          directory.identity,
          `${adapterName} staging directory changed after exclusive creation`
        );
        const actual = (await fs.readdir(candidate)).sort();
        const expected = [...expectedEntries.get(relativePath)].sort();
        if (
          actual.length !== expected.length ||
          actual.some((entry, index) => entry !== expected[index])
        ) {
          throw new AdapterSafeIOError(
            `${adapterName} staging directory entries changed: ${candidate}`
          );
        }
      }

      for (const [relativePath, file] of files) {
        await assertFileContentsUnchanged(
          path.join(rootDirectory, ...relativePath.split('/')),
          file,
          `${adapterName} staging file changed after exclusive creation`
        );
      }
    }

    return { write, assertTreeUnchanged };
  }

  async function assertFileContentsUnchanged(candidate, expected, context) {
    try {
      const pathStat = await fs.lstat(candidate);
      if (
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        !samePathIdentity(pathStat, expected.identity) ||
        pathStat.size !== expected.identity.size
      ) {
        throw new AdapterSafeIOError(`${context}: ${candidate}`);
      }
      const handle = await openFile(
        candidate,
        fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW
      );
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          !samePathIdentity(opened, expected.identity) ||
          opened.size !== expected.identity.size
        ) {
          throw new AdapterSafeIOError(`${context}: ${candidate}`);
        }
        const contents = await handle.readFile();
        const completed = await handle.stat();
        const currentPath = await fs.lstat(candidate);
        if (
          !samePathIdentity(completed, expected.identity) ||
          completed.size !== expected.identity.size ||
          currentPath.isSymbolicLink() ||
          !currentPath.isFile() ||
          !samePathIdentity(currentPath, expected.identity) ||
          sha256(contents) !== expected.digest
        ) {
          throw new AdapterSafeIOError(`${context}: ${candidate}`);
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof AdapterSafeIOError) throw error;
      throw new AdapterSafeIOError(`${context}: ${candidate}`);
    }
  }

  async function assertPathObjectIdentity(candidate, expected, context) {
    const current = await pathObjectIdentityIfExists(candidate);
    if (!current || !samePathIdentity(current, expected)) {
      throw new AdapterSafeIOError(`${context}: ${candidate}`);
    }
  }

  async function emptyDirectoryByHeldIdentity(candidate, expected) {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          IDENTITY_BOUND_DIRECTORY_CLEANUP,
          String(expected.dev),
          String(expected.ino)
        ],
        {
          cwd: candidate,
          env: {},
          stdio: 'ignore',
          windowsHide: true
        }
      );
      const timeout = setTimeout(() => child.kill(), 30_000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    if (exitCode !== 0) {
      throw new AdapterSafeIOError(
        `${adapterName} backup cleanup could not bind the validated directory identity (${exitCode})`
      );
    }
    await fs.rmdir(candidate);
  }

  async function removeDirectoryByExpectedIdentity(candidate, expected, context) {
    const current = await pathObjectIdentityIfExists(candidate);
    if (!current) return false;
    if (!samePathIdentity(current, expected)) {
      throw new AdapterSafeIOError(`${context}: ${candidate}`);
    }
    await emptyDirectoryByHeldIdentity(candidate, expected);
    return true;
  }

  async function assertProtectedRootsUnchanged(protectedRoots, expected) {
    for (const [index, protectedRoot] of protectedRoots.entries()) {
      let current;
      try {
        current = await pathIdentity(protectedRoot);
      } catch {
        throw new AdapterSafeIOError(
          `Protected book path became unavailable: ${protectedRoot}`
        );
      }
      if (!samePathIdentity(current, expected[index])) {
        throw new AdapterSafeIOError(
          `Protected book path changed during output replacement: ${protectedRoot}`
        );
      }
    }
  }

  async function replaceOwnedDirectory({
    stagingDirectory,
    outputDirectory,
    expectedStagingIdentity,
    expectedOutputIdentity,
    protectedRoots,
    revalidateReplacementDirectory,
    revalidateStagingTree,
    revalidateMetadataSnapshot
  }) {
    const backupDirectory = `${outputDirectory}.backup-${process.pid}-${randomUUID()}`;
    const currentOutputIdentity = await pathObjectIdentityIfExists(outputDirectory);
    if (expectedOutputIdentity) {
      if (
        !currentOutputIdentity ||
        !samePathIdentity(currentOutputIdentity, expectedOutputIdentity)
      ) {
        throw new AdapterSafeIOError(
          `${adapterName} output changed after ownership validation: ${outputDirectory}`
        );
      }
    } else if (currentOutputIdentity) {
      throw new AdapterSafeIOError(
        `${adapterName} output appeared after ownership validation: ${outputDirectory}`
      );
    }
    const outputExists = Boolean(expectedOutputIdentity);
    const identities = await Promise.all(protectedRoots.map(pathIdentity));
    let outputMoved = false;
    let stagingInstalled = false;
    let committed = false;
    try {
      await revalidateMetadataSnapshot();
      if (outputExists) {
        await fs.rename(outputDirectory, backupDirectory);
        outputMoved = true;
        await assertPathObjectIdentity(
          backupDirectory,
          expectedOutputIdentity,
          `${adapterName} output identity changed across backup rename`
        );
        await assertProtectedRootsUnchanged(protectedRoots, identities);
        await revalidateMetadataSnapshot();
        await revalidateReplacementDirectory(backupDirectory);
      }
      await assertPathObjectIdentity(
        stagingDirectory,
        expectedStagingIdentity,
        `${adapterName} staging identity changed before install`
      );
      await revalidateStagingTree(stagingDirectory);
      await fs.rename(stagingDirectory, outputDirectory);
      stagingInstalled = true;
      await assertPathObjectIdentity(
        outputDirectory,
        expectedStagingIdentity,
        `${adapterName} staging identity changed across install rename`
      );
      await revalidateStagingTree(outputDirectory);
      await assertProtectedRootsUnchanged(protectedRoots, identities);
      await revalidateMetadataSnapshot();
      if (outputMoved) await revalidateReplacementDirectory(backupDirectory);
      committed = true;
      if (outputMoved) {
        try {
          await emptyDirectoryByHeldIdentity(backupDirectory, expectedOutputIdentity);
        } catch (error) {
          throw new AdapterSafeIOError(
            `New ${adapterName} output was installed, but backup cleanup failed; retained path: ` +
              `${backupDirectory}; ${error.message}`
          );
        }
      }
    } catch (error) {
      if (!committed) {
        let rollbackError = null;
        if (stagingInstalled) {
          try {
            await removeDirectoryByExpectedIdentity(
              outputDirectory,
              expectedStagingIdentity,
              `Installed ${adapterName} output changed before rollback`
            );
          } catch (cleanupError) {
            rollbackError = cleanupError;
          }
        }
        const currentOutput = await pathObjectIdentityIfExists(outputDirectory);
        if (outputMoved && !rollbackError && !currentOutput) {
          try {
            await assertPathObjectIdentity(
              backupDirectory,
              expectedOutputIdentity,
              `${adapterName} backup identity changed before rollback restore`
            );
            await fs.rename(backupDirectory, outputDirectory);
            await assertPathObjectIdentity(
              outputDirectory,
              expectedOutputIdentity,
              `${adapterName} backup identity changed across rollback restore`
            );
          } catch (restoreError) {
            rollbackError = restoreError;
          }
        }
        if (rollbackError) {
          throw new AdapterSafeIOError(
            `${adapterName} replacement failed and rollback retained paths for manual recovery: ` +
              `output=${outputDirectory}; backup=${backupDirectory}; ` +
              `${rollbackError.message}; original error: ${error.message}`
          );
        }
      }
      throw error;
    }
  }

  async function readVisibilityBoundSource(bookRoot, sourcePath, expectedDigest) {
    if (!/^[0-9a-f]{64}$/u.test(expectedDigest || '')) {
      throw new AdapterSafeIOError(
        `${adapterName} source is missing its visibility digest: ${sourcePath}`
      );
    }
    const absolutePath = path.join(bookRoot, sourcePath);
    let pathStat;
    try {
      pathStat = await fs.lstat(absolutePath);
    } catch {
      throw new AdapterSafeIOError(
        `${adapterName} source became unavailable: ${sourcePath}`
      );
    }
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new AdapterSafeIOError(
        `${adapterName} source must remain a regular non-symlink file: ${sourcePath}`
      );
    }

    let handle;
    try {
      handle = await openFile(
        absolutePath,
        fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW
      );
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        openedStat.dev !== pathStat.dev ||
        openedStat.ino !== pathStat.ino ||
        openedStat.size !== pathStat.size
      ) {
        throw new AdapterSafeIOError(
          `${adapterName} source changed during safe open: ${sourcePath}`
        );
      }
      const contents = await handle.readFile();
      const completedStat = await handle.stat();
      if (
        completedStat.dev !== openedStat.dev ||
        completedStat.ino !== openedStat.ino ||
        completedStat.size !== openedStat.size ||
        completedStat.mtimeMs !== openedStat.mtimeMs ||
        completedStat.ctimeMs !== openedStat.ctimeMs ||
        contents.length !== openedStat.size
      ) {
        throw new AdapterSafeIOError(
          `${adapterName} source changed while being read: ${sourcePath}`
        );
      }
      const currentPathStat = await fs.lstat(absolutePath);
      if (
        currentPathStat.isSymbolicLink() ||
        currentPathStat.dev !== openedStat.dev ||
        currentPathStat.ino !== openedStat.ino
      ) {
        throw new AdapterSafeIOError(
          `${adapterName} source path changed during safe read: ${sourcePath}`
        );
      }
      if (sha256(contents) !== expectedDigest) {
        throw new AdapterSafeIOError(
          `${adapterName} source changed after visibility validation: ${sourcePath}`
        );
      }
      return contents.toString('utf8');
    } catch (error) {
      if (error instanceof AdapterSafeIOError) throw error;
      throw new AdapterSafeIOError(
        `${adapterName} source could not be opened safely: ${sourcePath}`
      );
    } finally {
      if (handle) await handle.close();
    }
  }

  return Object.freeze({
    assertOwnedExistingOutput,
    assertPathObjectIdentity,
    bindDirectoryFromHeldTree,
    createDirectoryInHeldParent,
    createStagingTree,
    pathIdentity,
    pathObjectIdentity,
    readFileFromHeldTree,
    readVisibilityBoundSource,
    removeDirectoryByExpectedIdentity,
    replaceOwnedDirectory
  });
}
