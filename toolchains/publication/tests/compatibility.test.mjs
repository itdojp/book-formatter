import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { stringify, readMetadata, StringifyMarkdownOptionsSchema } from '@vivliostyle/vfm';
import * as v from 'valibot';
import { parse } from 'parse5';
import { satisfies } from 'semver';
import { licenseInventory } from './licenses.mjs';
// Deliberately pinned internal schema chunk; re-audit this probe on CLI upgrades. No CLI/config loading.
import { A as InlineConfig } from '../node_modules/@vivliostyle/cli/dist/schema-jMUYOVzB.js';

const root = new URL('../', import.meta.url);
const json = (file) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
const lock = json('package-lock.json');
const require = createRequire(import.meta.url);
const pressRequire = createRequire(require.resolve('press-ready/package.json'));
const corpus = json('tests/fixtures/corpus.json');
const baseline = json('tests/fixtures/baseline.json');
const assertNodeVersion = (version = process.versions.node) => assert.ok(satisfies(version, json('package.json').engines.node), 'Node version outside isolated package engines');

test('private isolated Node24 package and exact overrides/lock', () => {
  const p = json('package.json');
  assert.equal(p.private, true);
  assert.equal(p.engines.node, '>=24.18.0 <25');
  assertNodeVersion();
  assert.deepEqual(p.dependencies, { '@vivliostyle/cli': '11.3.3' });
  assert.deepEqual(p.overrides, { trim: '0.0.3', prismjs: '1.30.0', valibot: '1.4.2', 'press-ready': { uuid: '11.1.1' } });
  for (const [name, version] of Object.entries({ trim: '0.0.3', prismjs: '1.30.0', valibot: '1.4.2' })) {
    const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith(`/node_modules/${name}`) || key === `node_modules/${name}`);
    assert.ok(entries.length > 0);
    for (const [, entry] of entries) assert.equal(entry.version, version);
  }
  assert.equal(pressRequire('uuid/package.json').version, '11.1.1');
  assert.equal(require('@vivliostyle/cli/package.json').version, '11.3.3');
});

test('Node engine gate rejects unsupported patches and prereleases', () => {
  for (const version of ['24.0.0', '24.17.9', '22.22.2', '25.0.0', '24.18.0-rc.1', 'invalid']) assert.throws(() => assertNodeVersion(version));
  for (const version of ['24.18.0', '24.18.1', '24.19.0']) assert.doesNotThrow(() => assertNodeVersion(version));
});

test('fixture and baseline sets match exactly', () => {
  assert.deepEqual(corpus.map(f => f.id).sort(), Object.keys(baseline).sort());
  assert.equal(corpus.length, 5);
});
for (const fixture of corpus) {
  test(`VFM output parity, visible content, reading order and DOM: ${fixture.id}`, () => {
    const html = stringify(fixture.markdown, { partial: false, language: 'ja', title: 'Synthetic fixture' });
    assert.equal(html, baseline[fixture.id]);
    assert.equal(stringify(fixture.markdown, { partial: false, language: 'ja', title: 'Synthetic fixture' }), html);
    const tags = new Set(); let visible = '';
    const walk = (node) => {
      if (node.tagName) tags.add(node.tagName);
      if (node.nodeName === '#text') visible += node.value;
      for (const child of node.childNodes || []) walk(child);
    };
    walk(parse(html));
    for (const marker of fixture.markers) assert.ok(visible.includes(marker), marker);
    for (const tag of fixture.tags) assert.ok(tags.has(tag), tag);
    assert.ok(!tags.has('script') && !tags.has('iframe'));
    // The same version's frozen golden HTML binds ordering, footnote IDs and exact text, not only a tag count.
  });
}

test('Valibot schema composition and VFM frontmatter settings stay functional', () => {
  assert.equal(v.safeParse(StringifyMarkdownOptionsSchema, { partial: true, hardLineBreaks: true }).success, true);
  assert.equal(v.safeParse(StringifyMarkdownOptionsSchema, { hardLineBreaks: 'yes' }).success, false);
  const metadata = readMetadata(corpus.find(f => f.id === 'metadata').markdown);
  assert.equal(metadata.title, '合成メタデータ');
  assert.equal(metadata.lang, 'ja');
  assert.equal(metadata.vfm.hardLineBreaks, true);
});
test('CLI pinned JSON schema transforms and rejects invalid inputs without loading a config', () => {
  const parsed = v.parse(InlineConfig, { input: 'fixture.md', output: ['screen.pdf', 'book.epub'] });
  assert.deepEqual(parsed.input, { format: 'markdown', entry: 'fixture.md' });
  assert.deepEqual(parsed.output.map(o => o.format), ['pdf', 'epub']);
  assert.equal(v.safeParse(InlineConfig, { input: 42 }).success, false);
  assert.equal(v.safeParse(InlineConfig, { input: 'input.epub', output: 'again.epub' }).success, false);
});
for (const key of ['toString', 'valueOf', 'hasOwnProperty']) {
  test(`Valibot advisory regression: ${key}`, () => {
    const result = v.safeParse(v.record(v.string(), v.number()), { [key]: 'not a number' });
    assert.equal(result.success, false);
    const flat = v.flatten(result.issues);
    assert.ok(Object.hasOwn(flat.nested, key));
    assert.equal(flat.nested[key].length, 1);
  });
}

test('press-ready CommonJS v4 caller and uuid bounds fix remain compatible', () => {
  const uuid = pressRequire('uuid');
  const value = uuid.v4();
  assert.ok(uuid.validate(value)); assert.equal(uuid.version(value), 4);
  assert.equal(uuid.v5('synthetic fixture', uuid.v5.DNS), uuid.v5('synthetic fixture', uuid.v5.DNS));
  assert.throws(() => uuid.v5('synthetic fixture', uuid.v5.DNS, new Uint8Array(1)), RangeError);
  assert.equal(typeof pressRequire('./lib/ghostScript.js').ghostScript, 'function');
  // Do not execute Ghostscript, ICC conversion, CLI configs or a real renderer in this dependency gate.
});

test('trim patched API preserves bounded whitespace behavior', () => {
  const trim = require('trim');
  for (const input of ['', ' \tfixture\n ', '\u00a0fixture\u00a0', 'x'.repeat(1000)]) assert.equal(trim(input), input.trim());
});

test('locked dependency license inventory has no undispositioned missing metadata', () => {
  const inventory = licenseInventory();
  assert.ok(inventory.packages.length > 600);
  assert.ok(inventory.packages.every(p => typeof p.license === 'string' && p.license.length > 0));
  assert.deepEqual(inventory, json('license-inventory.json'));
});

test('offline gate has no external interface, write, child-process or outside read access', { skip: process.env.PUBLICATION_OFFLINE_REQUIRED !== '1' ? 'Run test:offline for mandatory confinement probes' : false }, () => {
  assert.ok(process.permission?.has);
  assert.equal(process.permission.has('fs.write'), false);
  assert.equal(process.permission.has('child'), false);
  assert.ok(Object.values(networkInterfaces()).flat().every(i => i.internal));
  assert.throws(() => readFileSync(new URL('../../package.json', root)), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => writeFileSync(new URL('blocked-write', root), 'no'), { code: 'ERR_ACCESS_DENIED' });
  assert.throws(() => spawnSync(process.execPath, ['--version']), { code: 'ERR_ACCESS_DENIED' });
  assert.equal(process.permission.has('fs.read', fileURLToPath(root)), true);
});
