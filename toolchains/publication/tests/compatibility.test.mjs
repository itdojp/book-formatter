import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { stringify, readMetadata, StringifyMarkdownOptionsSchema } from '@vivliostyle/vfm';
import * as v from 'valibot';
import createDOMPurify from 'dompurify';
import { JSDOM } from '@vivliostyle/jsdom';
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
// Follow the pinned CLI's real dependency resolution, not a standalone test package.
const cliRequire = createRequire(require.resolve('@vivliostyle/cli/package.json'));
const arboristRequire = createRequire(cliRequire.resolve('@npmcli/arborist/package.json'));
const registryRequire = createRequire(arboristRequire.resolve('npm-registry-fetch/package.json'));
const fetchRequire = createRequire(registryRequire.resolve('make-fetch-happen/package.json'));
const CacheSemantics = fetchRequire('http-cache-semantics');
const CallerCachePolicy = fetchRequire('./lib/cache/policy.js');
const { Request: CacheRequest, Response: CacheResponse } = fetchRequire('minipass-fetch');
const corpus = json('tests/fixtures/corpus.json');
const baseline = json('tests/fixtures/baseline.json');
const assertNodeVersion = (version = process.versions.node) => assert.ok(satisfies(version, json('package.json').engines.node), 'Node version outside isolated package engines');

test('private isolated Node24 package and exact overrides/lock', () => {
  const p = json('package.json');
  assert.equal(p.private, true);
  assert.equal(p.engines.node, '>=24.18.0 <25');
  assertNodeVersion();
  assert.deepEqual(p.dependencies, { '@vivliostyle/cli': '11.3.3' });
  assert.deepEqual(p.overrides, { trim: '0.0.3', prismjs: '1.30.0', valibot: '1.4.2', 'press-ready': { uuid: '11.1.1' }, '@vivliostyle/cli': { dompurify: '3.4.16' } });
  for (const [name, version] of Object.entries({ trim: '0.0.3', prismjs: '1.30.0', valibot: '1.4.2' })) {
    const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith(`/node_modules/${name}`) || key === `node_modules/${name}`);
    assert.ok(entries.length > 0);
    for (const [, entry] of entries) assert.equal(entry.version, version);
  }
  assert.equal(pressRequire('uuid/package.json').version, '11.1.1');
  assert.equal(require('@vivliostyle/cli/package.json').version, '11.3.3');
  assert.equal(lock.packages['node_modules/dompurify'].version, '3.4.16');
  // Check the actual CLI resolution, not only a root-level dependency declaration.
  const cliRequire = createRequire(require.resolve('@vivliostyle/cli/package.json'));
  assert.equal(cliRequire('dompurify').version, '3.4.16');
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

test('official cache release resolves through the actual pinned CLI caller', () => {
  assert.equal(registryRequire('make-fetch-happen/package.json').version, '15.0.6');
  assert.equal(fetchRequire('http-cache-semantics/package.json').version, '4.3.0');
  assert.ok(satisfies('4.3.0', registryRequire('make-fetch-happen/package.json').dependencies['http-cache-semantics']));
  const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith('/http-cache-semantics'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].version, '4.3.0');
  assert.equal(entries[0][1].license, 'BSD-2-Clause');
});

test('cache Vary wildcard and own-header matching preserve ordinary and serialized cases', () => {
  const request = { url: 'https://registry.example.test/fixture', method: 'GET', headers: { host: 'registry.example.test', 'x-fixture': 'one' } };
  const response = (vary) => ({ status: 200, headers: { 'cache-control': 'max-age=3600', vary } });
  for (const vary of ['*', ' * ', 'x-fixture, *', '*, x-fixture']) {
    const policy = new CacheSemantics(request, response(vary), { shared: false });
    assert.equal(policy.satisfiesWithoutRevalidation(request), false, vary);
  }
  const inherited = Object.assign(Object.create({ 'x-fixture': 'one' }), { host: 'registry.example.test' });
  const inheritedPolicy = new CacheSemantics({ ...request, headers: inherited }, response('x-fixture'), { shared: false });
  assert.equal(inheritedPolicy.satisfiesWithoutRevalidation(request), false);
  const policy = new CacheSemantics(request, response('x-fixture'), { shared: false });
  assert.equal(policy.satisfiesWithoutRevalidation(request), true);
  assert.equal(policy.satisfiesWithoutRevalidation({ ...request, headers: { ...request.headers, 'x-fixture': 'two' } }), false);
  assert.equal(CacheSemantics.fromObject(policy.toObject()).satisfiesWithoutRevalidation(request), true);
  assert.equal(policy.status(), 200);
  assert.equal(policy.evaluateRequest(request).response.status, 200);
});

test('private actual cache caller keeps bounded hit, stale, no-cache and Vary decisions', () => {
  // Construct in-memory Request/Response objects only. No fetch, socket or cache I/O.
  const request = new CacheRequest('https://registry.example.test/fixture', { headers: { 'x-fixture': 'one' } });
  for (const [name, extra, nextHeaders, expected] of [
    ['fresh', {}, {}, false],
    ['stale', { age: '7200' }, {}, true],
    ['ordinary no-cache', { 'cache-control': 'no-cache' }, {}, true],
    ['Vary match', { vary: 'x-fixture' }, {}, false],
    ['Vary mismatch', { vary: 'x-fixture' }, { 'x-fixture': 'two' }, true],
    ['Vary wildcard', { vary: 'x-fixture, *' }, {}, true]
  ]) {
    const response = new CacheResponse('', { headers: { 'cache-control': 'max-age=3600', ...extra } });
    const caller = new CallerCachePolicy({ request, response, options: {} });
    caller.policy.now = () => caller.policy.toObject().t;
    assert.equal(caller.policy._isShared, false, name);
    const next = new CacheRequest(request.url, { headers: { 'x-fixture': 'one', ...nextHeaders } });
    assert.equal(caller.needsRevalidation(next), expected, name);
  }
  assert.equal(CallerCachePolicy.storable(request, {}), false, 'no cache directory configured');
  assert.equal(CallerCachePolicy.storable(request, { cachePath: 'unused', cache: 'no-store' }), false);
});

test('actual cache caller retains conditional validation and bounded error behavior', () => {
  const request = new CacheRequest('https://registry.example.test/fixture');
  const make = (cacheControl) => new CallerCachePolicy({
    request, options: {}, response: new CacheResponse('', { headers: { 'cache-control': cacheControl, etag: '"fixture"', age: '120' } })
  });
  const validated = make('max-age=60');
  assert.equal(validated.revalidationHeaders(request)['if-none-match'], '"fixture"');
  assert.equal(validated.revalidated(request, new CacheResponse(null, { status: 304, headers: { etag: '"fixture"' } })), true);
  for (const [cacheControl, expected] of [['max-age=60', false], ['max-age=60, stale-if-error=600', true]]) {
    const caller = make(cacheControl);
    caller.policy.now = () => caller.policy.toObject().t;
    assert.equal(caller.revalidated(request, new CacheResponse('', { status: 503 })), expected, cacheControl);
  }
});

test('DOMPurify scoped patch preserves bounded ordinary HTML sanitation', () => {
  const { window } = new JSDOM('');
  try {
    const purify = createDOMPurify(window);
    for (const [input, expected] of [
      ['<p>合成 <em>fixture</em></p>', '<p>合成 <em>fixture</em></p>'],
      ['<table><tr><td>fixture</td></tr></table>', '<table><tbody><tr><td>fixture</td></tr></tbody></table>'],
      ['<p data-fixture="local">literal &amp; text</p>', '<p data-fixture="local">literal &amp; text</p>'],
      ['<p onclick="">fixture</p>', '<p>fixture</p>'],
      ['<script></script><p>fixture</p>', '<p>fixture</p>'],
      ['<a href="#fixture">local link</a>', '<a href="#fixture">local link</a>']
    ]) assert.equal(purify.sanitize(input), expected);
  } finally { window.close(); }
});

for (const hook of ['afterSanitizeElements', 'afterSanitizeAttributes']) {
  test(`DOMPurify IN_PLACE detached subtree is neutralized: ${hook}`, () => {
    // Inert attribute only: no script body, resource URL, network, or event dispatch.
    const { window } = new JSDOM('<div id="root"><section id="wrap"><span onclick="">fixture</span></section></div>');
    try {
      const rootNode = window.document.getElementById('root');
      const child = rootNode.querySelector('span');
      const purify = createDOMPurify(window);
      purify.addHook(hook, (node) => { if (node.id === 'wrap') node.remove(); });
      purify.sanitize(rootNode, { IN_PLACE: true });
      assert.equal(rootNode.querySelector('#wrap'), null);
      assert.equal(child.getAttribute('onclick'), null);
    } finally { window.close(); }
  });
}

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
