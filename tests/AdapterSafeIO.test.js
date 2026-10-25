import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';
import fs from 'fs-extra';

import { AdapterSafeIOError, createAdapterSafeIO } from '../src/AdapterSafeIO.js';

const io = createAdapterSafeIO({ adapterName: 'held-tree test', target: 'test' });
const temporary = [];
const unreadableIdentity = new Proxy({}, {
  get() { throw new Error('identity accessed before input validation'); }
});

describe('AdapterSafeIO ownership manifest identity', () => {
  const manifest = `${JSON.stringify({
    kind: 'book-formatter.adapter-build', adapter: { target: 'test' }, title: '合成例'
  })}\n`;
  const invalidManifest = (error) => error instanceof AdapterSafeIOError &&
    /without a valid adapter manifest/.test(error.message);

  async function ownedFixture(contents = manifest) {
    const { root } = await fixture();
    const output = path.join(root, 'output');
    await fs.ensureDir(output);
    const file = path.join(output, 'manifest.json');
    await fs.writeFile(file, contents);
    await fs.writeFile(path.join(output, 'keep.txt'), 'synthetic output retained');
    return { root, output, file };
  }

  test('missing output returns null; stable UTF-8 manifest returns directory identity', async () => {
    const f = await ownedFixture();
    assert.equal(await io.assertOwnedExistingOutput(path.join(f.root, 'absent')), null);
    assert.deepEqual(await io.assertOwnedExistingOutput(f.output), await io.pathObjectIdentity(f.output));
    assert.equal(await fs.readFile(f.file, 'utf8'), manifest);
    assert.equal(await fs.readFile(path.join(f.output, 'keep.txt'), 'utf8'), 'synthetic output retained');
  });

  for (const [label, contents, diagnostic] of [
    ['invalid JSON', '{', /without a valid adapter manifest/],
    ['null JSON', 'null', /owned by another producer/],
    ['wrong kind', '{"kind":"other","adapter":{"target":"test"}}', /owned by another producer/],
    ['wrong target', '{"kind":"book-formatter.adapter-build","adapter":{"target":"other"}}', /owned by another producer/]
  ]) {
    test(`rejects ${label} without changing output`, async () => {
      const f = await ownedFixture(contents);
      await assert.rejects(io.assertOwnedExistingOutput(f.output), (error) =>
        error instanceof AdapterSafeIOError && diagnostic.test(error.message));
      assert.equal(await fs.readFile(f.file, 'utf8'), contents);
      assert.equal(await fs.readFile(path.join(f.output, 'keep.txt'), 'utf8'), 'synthetic output retained');
    });
  }

  test('does not reopen manifest by fs-extra path read', async (context) => {
    const f = await ownedFixture();
    const readFile = fs.readFile;
    context.mock.method(fs, 'readFile', async (candidate, ...args) => {
      assert.notEqual(String(candidate), f.file, 'ownership bytes must come from the inspected handle');
      return readFile(candidate, ...args);
    });
    assert.deepEqual(await io.assertOwnedExistingOutput(f.output), await io.pathObjectIdentity(f.output));
  });

  for (const when of ['before open', 'after read']) {
    for (const change of ['same-byte replacement', 'in-place edit', 'directory replacement', 'removal']) {
      test(`rejects ${change} ${when}`, async (context) => {
        const f = await ownedFixture();
        const lstat = fs.lstat;
        let reads = 0;
        let injected = false;
        const mutate = async () => {
          injected = true;
          if (change === 'in-place edit') {
            await fs.writeFile(f.file, manifest.replace('合成例', '模擬例'));
            await fs.utimes(f.file, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
          } else {
            await fs.rename(f.file, path.join(f.root, 'displaced.json'));
            if (change === 'same-byte replacement') await fs.writeFile(f.file, manifest);
            if (change === 'directory replacement') await fs.mkdir(f.file);
          }
        };
        context.mock.method(fs, 'lstat', async (candidate, ...args) => {
          if (String(candidate) !== f.file) return lstat(candidate, ...args);
          reads += 1;
          if (when === 'after read' && reads === 2) await mutate();
          const stat = await lstat(candidate, ...args);
          if (when === 'before open' && reads === 1) await mutate();
          return stat;
        });
        await assert.rejects(io.assertOwnedExistingOutput(f.output), invalidManifest);
        assert.equal(injected, true, 'the intended read boundary was reached');
        assert.equal(await fs.readFile(path.join(f.output, 'keep.txt'), 'utf8'), 'synthetic output retained');
      });
    }
  }

  for (const change of ['grow file', 'same-size edit', 'short read', 'read error']) {
    test(`handle read rejects ${change} and closes the inspected handle`, async (context) => {
      const f = await ownedFixture();
      const sample = await open(f.file, 'r');
      const prototype = Object.getPrototypeOf(sample);
      await sample.close();
      const readFile = prototype.readFile;
      const openedHandles = [];
      context.mock.method(prototype, 'readFile', async function (...args) {
        openedHandles.push(this);
        const bytes = await readFile.apply(this, args);
        if (change === 'read error') throw new Error('synthetic read error');
        if (change === 'short read') return bytes.subarray(0, bytes.length - 1);
        await fs.writeFile(f.file, change === 'grow file' ? `${manifest} ` : manifest.replace('合成例', '模擬例'));
        await fs.utimes(f.file, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
        return bytes;
      });
      await assert.rejects(io.assertOwnedExistingOutput(f.output), invalidManifest);
      assert.equal(openedHandles.length, 1, 'read uses the inspected handle exactly once');
      assert.equal(openedHandles[0].fd, -1);
    });
  }

  test('rejects a symlink substituted after lstat without consuming its bytes', async (context) => {
    const f = await ownedFixture();
    const replacement = path.join(f.root, 'replacement.json');
    await fs.writeFile(replacement, manifest);
    const link = path.join(f.root, 'link.json');
    try { await fs.symlink(replacement, link, 'file'); }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return context.skip('file symlink privilege unavailable');
      throw error;
    }
    const lstat = fs.lstat;
    let injected = false;
    context.mock.method(fs, 'lstat', async (candidate, ...args) => {
      const stat = await lstat(candidate, ...args);
      if (String(candidate) === f.file && !injected) {
        injected = true;
        await fs.rename(f.file, path.join(f.root, 'displaced.json'));
        await fs.rename(link, f.file);
      }
      return stat;
    });
    await assert.rejects(io.assertOwnedExistingOutput(f.output), invalidManifest);
    assert.equal(injected, true);
    assert.equal(await fs.readFile(replacement, 'utf8'), manifest);
  });

  test('POSIX FIFO substitution does not block waiting for a writer', async (context) => {
    if (process.platform === 'win32') return context.skip('POSIX FIFO is not a Windows file type');
    const f = await ownedFixture();
    const fifo = path.join(f.root, 'fifo');
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
    assert.equal(created.status, 0, created.stderr || String(created.error));
    // A broken blocking open must fail this probe, not hang the entire suite.
    const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', `
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import { createAdapterSafeIO } from ${JSON.stringify(new URL('../src/AdapterSafeIO.js', import.meta.url).href)};
const io = createAdapterSafeIO({ adapterName: 'FIFO probe', target: 'test' });
const file = ${JSON.stringify(f.file)};
const lstat = fs.lstat;
let injected = false;
fs.lstat = async (candidate, ...args) => {
  const stat = await lstat(candidate, ...args);
  if (String(candidate) === file && !injected) {
    injected = true;
    await fs.rename(file, ${JSON.stringify(path.join(f.root, 'displaced.json'))});
    await fs.rename(${JSON.stringify(fifo)}, file);
  }
  return stat;
};
await assert.rejects(io.assertOwnedExistingOutput(${JSON.stringify(f.output)}), /without a valid adapter manifest/);
assert.equal(injected, true);
`], { cwd: process.cwd(), env: {}, encoding: 'utf8', timeout: 5000 });
    assert.equal(probe.status, 0, probe.stderr || String(probe.error));
  });
});
const missingRoot = path.resolve('tests/tmp-held-tree-does-not-exist');
const inputError = (error) => error instanceof AdapterSafeIOError && /maximumSize/.test(error.message);
const pathError = (error) => error instanceof AdapterSafeIOError && /Invalid .* path/.test(error.message);
async function fixture() {
  const root = await fs.mkdtemp(path.resolve('tests/tmp-held-tree-'));
  temporary.push(root);
  await fs.ensureDir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'data.bin'), Buffer.from('synthetic'));
  return { root, identity: await io.pathObjectIdentity(root), file: path.join('nested', 'data.bin') };
}
afterEach(async () => {
  for (const root of temporary.splice(0)) await fs.remove(root);
});

describe('AdapterSafeIO held-tree input contract', () => {
  for (const [label, options] of [
    ['omitted', undefined], ['null', null], ['boolean', false], ['string', '9'],
    ['number', 9], ['array', []], ['missing maximumSize', {}]
  ]) {
    test(`size guard before traversal: ${label} options`, async () => {
      await assert.rejects(io.readFileFromHeldTree(missingRoot, unreadableIdentity, path.join('nested', 'data.bin'), options), inputError);
    });
  }
  for (const [label, maximumSize] of [
    ['undefined', undefined], ['null', null], ['NaN', NaN], ['Infinity', Infinity],
    ['negative Infinity', -Infinity], ['zero', 0], ['negative', -1], ['fraction', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['numeric string', '9'],
    ['boolean', true], ['object', {}], ['bigint', 9n]
  ]) {
    test(`size guard before traversal: ${label} maximumSize`, async () => {
      await assert.rejects(io.readFileFromHeldTree(missingRoot, unreadableIdentity, path.join('nested', 'data.bin'), { maximumSize }), inputError);
    });
  }

  for (const maximumSize of [9, 10, Number.MAX_SAFE_INTEGER]) {
    test(`positive safe integer ${maximumSize} reads exact synthetic bytes without source changes`, async () => {
      const { root, identity, file } = await fixture();
      const before = await fs.lstat(path.join(root, file));
      const contents = await io.readFileFromHeldTree(root, identity, file, { maximumSize });
      assert.deepEqual(contents, Buffer.from('synthetic'));
      const after = await fs.lstat(path.join(root, file));
      assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
      assert.deepEqual(await fs.readFile(path.join(root, file)), contents);
      assert.deepEqual(await io.bindDirectoryFromHeldTree(root, identity, 'nested'), await io.pathObjectIdentity(path.join(root, 'nested')));
    });
  }
  test('oversize is rejected with the supplied diagnostic', async () => {
    const { root, identity, file } = await fixture();
    await assert.rejects(io.readFileFromHeldTree(root, identity, file, { maximumSize: 8, tooLargeMessage: 'fixture limit exceeded' }),
      (error) => error instanceof AdapterSafeIOError && error.message === 'fixture limit exceeded');
  });
  test('incorrect source-directory identity remains rejected', async () => {
    const { root, identity, file } = await fixture();
    await assert.rejects(io.readFileFromHeldTree(root, { ...identity, ino: identity.ino + 1 }, file, { maximumSize: 9 }), AdapterSafeIOError);
    await assert.rejects(io.bindDirectoryFromHeldTree(root, { ...identity, ino: identity.ino + 1 }, 'nested'), AdapterSafeIOError);
  });
  test('source directory replacement does not reuse the previous identity', async () => {
    const { root, identity, file } = await fixture();
    await fs.move(path.join(root, 'nested'), path.join(root, 'old'));
    const old = await io.pathObjectIdentity(path.join(root, 'old'));
    await fs.ensureDir(path.join(root, 'nested'));
    await fs.writeFile(path.join(root, file), 'synthetic');
    await assert.rejects(io.readFileFromHeldTree(path.join(root, 'nested'), old, 'data.bin', { maximumSize: 9 }), AdapterSafeIOError);
    assert.deepEqual(await io.readFileFromHeldTree(root, identity, file, { maximumSize: 9 }), Buffer.from('synthetic'));
  });
  test('symbolic directory traversal is rejected', async () => {
    const { root, identity } = await fixture();
    await fs.symlink(path.join(root, 'nested'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(io.readFileFromHeldTree(root, identity, path.join('alias', 'data.bin'), { maximumSize: 9 }), /symbolic links/);
    await assert.rejects(io.bindDirectoryFromHeldTree(root, identity, 'alias'), /symbolic links/);
  });
  test('symbolic file is rejected', async (context) => {
    const { root, identity, file } = await fixture();
    try { await fs.symlink(path.join(root, file), path.join(root, 'link.bin'), 'file'); }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') return context.skip('file symlink privilege unavailable; directory junction covered separately');
      throw error;
    }
    await assert.rejects(io.readFileFromHeldTree(root, identity, 'link.bin', { maximumSize: 9 }), /symbolic links/);
  });

  const rejected = [
    '', null, 12, '.', '..', ['nested', '..', 'data.bin'].join(path.sep),
    'nested//data.bin', 'nested\\\\data.bin', './data.bin', '.\\data.bin',
    '/absolute.bin', 'C:\\absolute.bin', '\\\\server\\share\\data.bin',
    'nested/sub\\data.bin', 'nested\\sub/data.bin', 'nul\0.bin'
  ];
  if (process.platform === 'win32') rejected.push('C:relative.bin', 'data.bin:stream', 'C:', '\\rooted.bin', 'nested/data.bin');
  else rejected.push('nested\\data.bin');
  for (const relative of rejected) {
    test(`native path rejects before traversal: ${JSON.stringify(relative)}`, async () => {
      await assert.rejects(io.readFileFromHeldTree(missingRoot, unreadableIdentity, relative, { maximumSize: 9 }), pathError);
      await assert.rejects(io.bindDirectoryFromHeldTree(missingRoot, unreadableIdentity, relative), pathError);
    });
  }
  test('POSIX colon names are literal, not silently converted into Windows drives', async (context) => {
    if (process.platform === 'win32') return context.skip('POSIX-only literal filename; Windows drive/stream forms rejected above');
    const { root, identity } = await fixture();
    await fs.writeFile(path.join(root, 'C:relative.bin'), 'synthetic');
    assert.deepEqual(await io.readFileFromHeldTree(root, identity, 'C:relative.bin', { maximumSize: 9 }), Buffer.from('synthetic'));
  });
});
