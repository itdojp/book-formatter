import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { parse } from 'parse5';
import { headerScript, headerPage, profiles } from './shared-header-fixture.js';

function measurement({ observer = true, present = true } = {}) {
  let height = 91.25;
  const properties = [], events = [];
  const header = { getBoundingClientRect: () => ({ height }) };
  const document = {
    querySelector: selector => { assert.equal(selector, '.book-header'); return present ? header : null; },
    documentElement: { style: { setProperty: (...args) => properties.push(args) } }
  };
  let callback;
  const ResizeObserver = observer ? class {
    constructor(fn) { callback = fn; }
    observe(element) { assert.equal(element, header); }
  } : undefined;
  vm.runInNewContext(headerScript, {
    document, ResizeObserver,
    window: { addEventListener: (name, fn) => { events.push(name); callback = fn; } }
  });
  return { properties, events, resize: value => { height = value; callback(); } };
}

test('shipped header offsets round up, update on resize and avoid redundant writes', () => {
  const probe = measurement();
  assert.deepEqual(probe.properties, [['--header-height', '92px']]);
  probe.resize(91.25);
  assert.equal(probe.properties.length, 1);
  probe.resize(128);
  assert.deepEqual(probe.properties.at(-1), ['--header-height', '128px']);
  probe.resize(0);
  assert.equal(probe.properties.length, 2);
});

test('resize fallback preserves offsets when ResizeObserver is unavailable', () => {
  const probe = measurement({ observer: false });
  assert.deepEqual(probe.events, ['resize']);
  probe.resize(64);
  assert.deepEqual(probe.properties.at(-1), ['--header-height', '64px']);
});

test('pages without a header are not modified or subscribed', () => {
  const probe = measurement({ present: false });
  assert.deepEqual(probe.properties, []);
  assert.deepEqual(probe.events, []);
});

test('fixtures retain shipped control DOM order and full title text', () => {
  for (const profile of profiles) {
    const html = headerPage({ profile });
    assert.ok(html.indexOf('header-title') < html.indexOf('id="search-input"'));
    assert.ok(html.indexOf('id="search-input"') < html.indexOf('class="theme-toggle"'));
    assert.ok(html.indexOf('class="theme-toggle"') < html.indexOf('class="github-link"'));
    const tree = parse(html);
    const find = node => node.tagName === 'h1' ? node : (node.childNodes ?? []).map(find).find(Boolean);
    assert.equal(find(tree).childNodes[0].value, profile.title);
    assert.ok(!html.includes('{{'), 'fixture must project the shipped Liquid placeholders');
  }
});

test('responsive geometry has an explicit mandatory native gate', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:shared-header-browser'], 'node tests/shared-header-browser.js');
  const workflow = fs.readFileSync(new URL('../.github/workflows/quality-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: \|\n\s+npm run test:shared-dom-browser\n\s+npm run test:shared-header-browser/);
});
