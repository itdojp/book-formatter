import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';

import { AdapterSafeIOError, createAdapterSafeIO } from '../src/AdapterSafeIO.js';

const io = createAdapterSafeIO({ adapterName: 'held-tree test', target: 'test' });
const temporary = [];
const unreadableIdentity = new Proxy({}, {
  get() { throw new Error('identity accessed before input validation'); }
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
