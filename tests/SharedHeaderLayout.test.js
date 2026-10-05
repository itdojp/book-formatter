import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { parse, serialize } from 'parse5';
import { headerScript, headerPage, profiles } from './shared-header-fixture.js';

function* elements(node) {
  if (node.tagName) yield node;
  for (const child of node.childNodes ?? []) yield* elements(child);
}

const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value;

function assertHeaderOrder(html, profile) {
  const headers = [...elements(parse(html))].filter(node => node.tagName === 'header');
  assert.equal(headers.length, 1);
  const controls = [...elements(headers[0])].filter(node =>
    ['a', 'button', 'input'].includes(node.tagName) || attribute(node, 'tabindex') !== undefined);
  assert.deepEqual(controls.map(node => attribute(node, 'class')), [
    'sidebar-toggle', 'header-title', 'search-input', 'theme-toggle', 'github-link',
    ...(profile.extra ? ['fixture-edit'] : [])
  ], 'fixed header control DOM order');
  return headers[0];
}

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
    const header = assertHeaderOrder(html, profile);
    const title = [...elements(header)].find(node => node.tagName === 'h1');
    assert.equal(title.childNodes[0].value, profile.title);
    assert.ok(!html.includes('{{'), 'fixture must project the shipped Liquid placeholders');
  }
});

test('CSS class mentions cannot mask a swapped title/search DOM mutation', () => {
  for (const profile of profiles) {
    const tree = parse(headerPage({ profile }));
    const header = [...elements(tree)].find(node => node.tagName === 'header');
    const left = header.childNodes.findIndex(node => attribute(node, 'class') === 'header-left');
    const center = header.childNodes.findIndex(node => attribute(node, 'class') === 'header-center');
    assert.ok(left >= 0 && center > left);
    [header.childNodes[left], header.childNodes[center]] = [header.childNodes[center], header.childNodes[left]];
    const mutated = serialize(tree);
    // The previous string predicates all accept this wrong DOM because CSS comes first.
    assert.ok(mutated.indexOf('header-title') < mutated.indexOf('id="search-input"'));
    assert.ok(mutated.indexOf('id="search-input"') < mutated.indexOf('class="theme-toggle"'));
    assert.ok(mutated.indexOf('class="theme-toggle"') < mutated.indexOf('class="github-link"'));
    assert.throws(() => assertHeaderOrder(mutated, profile), /fixed header control DOM order/);
  }
});

test('responsive geometry has an explicit mandatory native gate', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:shared-header-browser'], 'node tests/shared-header-browser.js');
  const workflow = fs.readFileSync(new URL('../.github/workflows/quality-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: \|\n\s+npm run test:shared-dom-browser\n\s+npm run test:shared-header-browser/);
});

test('header native gate reuses the tested fail-closed Chrome discovery', () => {
  const source = fs.readFileSync(new URL('./shared-header-browser.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ discoverChrome \} from '\.\/shared-browser-discovery\.js';/);
  assert.match(source, /const \{ chrome, diagnostics \} = discoverChrome\(\);/);
  assert.doesNotMatch(source, /\bspawnSync\b|\bconst candidates\b/);
});

test('expanded header fixture uses shipped search behavior and many indexed paragraphs', () => {
  const source = fs.readFileSync(new URL('../shared/assets/js/search.js', import.meta.url), 'utf8');
  const html = headerPage({ search: true });
  assert.ok(html.includes(source), 'use actual renderer/list styles, not a mock search implementation');
  const paragraphs = [...elements(parse(html))].filter(node => attribute(node, 'data-fixture-index') !== undefined);
  assert.deepEqual(paragraphs.map(node => attribute(node, 'data-fixture-index')), Array.from({ length: 14 }, (_, index) => String(index)));
  assert.ok(!headerPage().includes(source), 'closed-state baseline remains independent');
});
