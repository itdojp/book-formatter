import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import { sidebarScript, checkbox, sidebarPage } from './shared-sidebar-fixture.js';

// State/event harness only. Native Tab/label activation/inert/CSS are tested
// separately; this does not emulate browser focus or label default actions.
function setup({ narrow = true, missing = null, script = sidebarScript } = {}) {
  const timers = [];
  const document = element('document');
  function element(name) {
    const listeners = new Map();
    return { name, attributes: {}, checked: true, inert: false,
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn) { const fns = listeners.get(k) ?? []; fns.push(fn); listeners.set(k, fns); },
      emit(k, values = {}) {
        const event = { target: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
        for (const fn of listeners.get(k) ?? []) fn(event);
        return event;
      },
      contains(node) { return node === this || node?.parent === this; },
      focus() { document.activeElement = this; },
      closest() { return this.href ? this : null; }
    };
  }
  const cb = element('checkbox'), toggle = element('toggle'), sidebar = element('sidebar'), overlay = element('overlay');
  const link = element('link'), outside = element('outside'); link.parent = sidebar; link.href = '#content';
  const nodes = { 'sidebar-toggle-checkbox': cb, sidebar, 'sidebar-overlay': overlay };
  document.getElementById = id => id === missing ? null : nodes[id];
  document.querySelector = () => missing === 'toggle' ? null : toggle;
  document.querySelectorAll = () => [];
  document.activeElement = outside;
  const media = element('media'); media.matches = narrow;
  const window = { matchMedia: query => { assert.equal(query, '(max-width: 1024px)'); return media; }, location: { pathname: '/', origin: 'https://book.example' } };
  vm.runInNewContext(script, { document, window, URL, setTimeout: fn => timers.push(fn) });
  document.emit('DOMContentLoaded');
  return { cb, toggle, sidebar, overlay, link, outside, document, media, timers,
    resize(narrow) { media.matches = narrow; media.emit('change'); },
    open() { toggle.focus(); toggle.emit('click'); },
    flush() { for (const fn of timers.splice(0)) fn(); }
  };
}

test('shipped label fallback, controls target, checkbox Tab exclusion and native gate', () => {
  const page = sidebarPage();
  assert.match(checkbox, /tabindex="-1"/);
  assert.match(page, /<label for="sidebar-toggle-checkbox" class="sidebar-toggle"[^>]+role="button"[^>]+aria-controls="sidebar"/);
  assert.match(page, /<aside class="book-sidebar" id="sidebar">/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:shared-dom-browser'], 'node tests/shared-dom-browser.js && node tests/shared-sidebar-browser.js');
});
for (const narrow of [true, false]) test(`initial visibility uses viewport, not stale checkbox: ${narrow}`, () => {
  const f = setup({ narrow }); assert.equal(f.cb.checked, false);
  assert.equal(f.sidebar.inert, narrow); assert.equal(f.toggle.attributes['aria-expanded'], String(!narrow));
});
for (const key of ['Enter', ' ']) test(`keyboard ${JSON.stringify(key)} toggles once and repeat cannot reopen`, () => {
  const f = setup(); f.toggle.focus();
  assert.equal(f.toggle.emit('keydown', { key }).defaultPrevented, true);
  assert.equal(f.cb.checked, true); assert.equal(f.sidebar.inert, false);
  assert.equal(f.toggle.attributes['aria-expanded'], 'true');
  f.toggle.emit('keydown', { key, repeat: true }); assert.equal(f.cb.checked, true);
  f.toggle.emit('keydown', { key }); assert.equal(f.cb.checked, false);
  f.toggle.emit('keydown', { key, repeat: true }); assert.equal(f.cb.checked, false);
});
test('pointer uses one state and prevents the second native label activation', () => {
  const f = setup(); assert.equal(f.toggle.emit('click').defaultPrevented, true); assert.equal(f.cb.checked, true);
  f.toggle.emit('click'); assert.equal(f.cb.checked, false);
});
for (const close of ['Escape', 'overlay', 'link', 'change']) test(`safe focus return on ${close}`, () => {
  const f = setup(); f.open(); f.link.focus();
  if (close === 'Escape') f.document.emit('keydown', { key: 'Escape' });
  if (close === 'overlay') assert.equal(f.overlay.emit('click').defaultPrevented, true);
  if (close === 'link') assert.equal(f.sidebar.emit('click', { target: f.link }).defaultPrevented, false);
  if (close === 'change') { f.cb.checked = false; f.cb.emit('change'); }
  assert.equal(f.cb.checked, false); assert.equal(f.sidebar.inert, true);
  assert.equal(f.document.activeElement, f.toggle); assert.equal(f.toggle.attributes['aria-expanded'], 'false');
});
test('close does not steal unrelated focus, Escape does not intercept other widgets', () => {
  const f = setup(); f.open(); f.outside.focus();
  assert.equal(f.document.emit('keydown', { key: 'Escape' }).defaultPrevented, false); assert.equal(f.cb.checked, true);
  f.overlay.emit('click'); assert.equal(f.document.activeElement, f.outside);
});
test('handled Escape and unrelated keys are unchanged', () => {
  const f = setup(); f.open();
  f.document.emit('keydown', { key: 'Escape', defaultPrevented: true }); assert.equal(f.cb.checked, true);
  assert.equal(f.toggle.emit('keydown', { key: 'ArrowDown' }).defaultPrevented, false); assert.equal(f.cb.checked, true);
});
for (const values of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) test(`modified/handled link preserves drawer ${JSON.stringify(values)}`, () => {
  const f = setup(); f.open(); f.sidebar.emit('click', { target: f.link, ...values }); assert.equal(f.cb.checked, true);
});
test('desktop remains visible, mobile resize returns only newly-hidden focus', () => {
  const f = setup(); f.open(); f.link.focus(); f.resize(false);
  assert.equal(f.cb.checked, false); assert.equal(f.sidebar.inert, false);
  assert.equal(f.toggle.attributes['aria-expanded'], 'true'); assert.equal(f.document.activeElement, f.link);
  f.toggle.emit('click'); f.toggle.emit('keydown', { key: 'Enter' }); assert.equal(f.cb.checked, false);
  f.resize(true); assert.equal(f.sidebar.inert, true); assert.equal(f.document.activeElement, f.toggle);
});
test('scheduled active TOC callback tolerates close before tick', () => {
  const f = setup(); f.open(); f.toggle.emit('click'); f.flush(); assert.equal(f.cb.checked, false);
});
for (const missing of ['sidebar-toggle-checkbox', 'toggle', 'sidebar']) test(`partial layout without ${missing} is untouched`, () => {
  const f = setup({ missing }); assert.equal(f.cb.checked, true); assert.equal(f.toggle.attributes['aria-expanded'], undefined);
});

test('overlay left mousedown retains focused sidebar link until close', () => {
  const f = setup(); f.open(); f.link.focus();
  assert.equal(f.overlay.emit('mousedown').defaultPrevented, true);
  assert.equal(f.overlay.emit('mousedown', { button: 2 }).defaultPrevented, false);
  f.overlay.emit('click'); assert.equal(f.document.activeElement, f.toggle);
});

test('focus leaving the drawer/header closes without trapping or stealing content focus', () => {
  const f = setup(); f.open(); f.outside.focus();
  f.document.emit('focusin', { target: f.outside });
  assert.equal(f.cb.checked, false); assert.equal(f.document.activeElement, f.outside);
});
