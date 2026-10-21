// Native CDP/CSS oracle; no DOM/layout emulation or new browser dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { profiles } from './shared-header-fixture.js';
import { sidebarPage } from './shared-sidebar-fixture.js';
import { discoverChrome } from './shared-browser-discovery.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { chrome, diagnostics } = discoverChrome();
console.log(`Native Chrome discovery: ${JSON.stringify(diagnostics)}`);
assert.ok(chrome, 'Chrome is mandatory for shared sidebar keyboard/focus');
assert.ok(Buffer.byteLength(os.tmpdir()) <= 60, 'set TMPDIR to a short owned directory');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sidebar-'));
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
  '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
  '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-port=0',
  `--user-data-dir=${directory}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '', socket;
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
let nextId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, stderr);
    try {
      const [port, route] = (await fs.readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      if (port && route) { endpoint = `ws://127.0.0.1:${port}${route}`; break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(100);
  }
  assert.ok(endpoint, 'Chrome endpoint did not become ready');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', data => {
    const message = JSON.parse(String(data)), task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  // Only trusted functions defined by this test supply executable source.
  // Per-case values travel as CDP data, never concatenated into JavaScript.
  const call = async (fn, ...args) => {
    const global = await command('Runtime.evaluate', { expression: 'globalThis' });
    assert.ok(!global.exceptionDetails && global.result.objectId);
    const objectId = global.result.objectId;
    try {
      const result = await command('Runtime.callFunctionOn', {
        objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })),
        awaitPromise: true, returnByValue: true
      });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    } finally {
      await command('Runtime.releaseObject', { objectId });
    }
  };
  await command('Page.enable');
  const { frameTree } = await command('Page.getFrameTree');
  const key = async (key, code, keyCode, extra = {}) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...extra });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  };
  const state = () => evaluate(`(() => {
    const cb = document.getElementById('sidebar-toggle-checkbox');
    const toggle = document.querySelector('.sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const box = sidebar.getBoundingClientRect();
    return { checked: cb.checked, expanded: toggle.getAttribute('aria-expanded'),
      controls: toggle.getAttribute('aria-controls'), inert: sidebar.inert,
      focus: document.activeElement.className, inSidebar: sidebar.contains(document.activeElement),
      sidebarVisible: box.left >= 0 && box.right <= innerWidth,
      scroll: scrollY, checkboxTab: cb.tabIndex };
  })()`);
  const click = async selector => {
    const point = await call(selector => {
      const el = document.querySelector(selector), box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, selector);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const load = async (width, theme, profile, script) => {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await command('Page.setDocumentContent', { frameId: frameTree.frame.id, html: sidebarPage({ theme, profile, script }) });
    await delay(80);
    await call(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await evaluate('document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute("tabindex")');
  };
  const assertOpen = async open => {
    await delay(350);
    const current = await state();
    assert.equal(current.checked, open); assert.equal(current.expanded, String(open));
    assert.equal(current.inert, !open); assert.equal(current.sidebarVisible, open);
    const { nodes } = await command('Accessibility.getFullAXTree');
    const toggle = nodes.find(node => node.role?.value === 'button' && node.name?.value === 'Toggle sidebar');
    assert.ok(toggle); assert.equal(toggle.properties.find(p => p.name === 'expanded')?.value.value, open);
    assert.equal(nodes.some(node => node.role?.value === 'link' && node.name?.value === 'First synthetic chapter'), open);
    return current;
  };
  const results = [];
  for (const width of [320, 390, 768, 1366]) for (const theme of ['light', 'dark']) for (const profile of profiles.slice(0, 2)) {
    await load(width, theme, profile);
    const initial = await state();
    assert.equal(initial.checkboxTab, -1); assert.equal(initial.controls, 'sidebar');
    await key('Tab', 'Tab', 9);
    if (width > 1024) {
      assert.equal(initial.inert, false); assert.equal(initial.expanded, 'true');
      assert.equal(initial.sidebarVisible, true); assert.equal((await state()).focus, 'header-title');
      results.push({ width, theme, profile: profile.id, desktopVisible: true }); continue;
    }
    assert.equal((await state()).focus, 'sidebar-toggle'); await assertOpen(false);
    await key('Enter', 'Enter', 13); await assertOpen(true);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await assertOpen(true);
    const activeVisible = await evaluate('(() => { const a=document.querySelector(".toc-link.active").getBoundingClientRect(), s=document.getElementById("sidebar").getBoundingClientRect(); return a.top>=s.top && a.bottom<=s.bottom; })()');
    assert.equal(activeVisible, true, 'opening retains active TOC scroll');
    await key('Enter', 'Enter', 13); await assertOpen(false);
    const beforeSpace = (await state()).scroll;
    await key(' ', 'Space', 32); await assertOpen(true);
    assert.equal((await state()).scroll, beforeSpace, 'Space must not scroll the document');
    await key(' ', 'Space', 32); await assertOpen(false);
    // Closed offscreen links and the hidden checkbox must not take Tab focus.
    for (let n = 0; n < 5; n++) { await key('Tab', 'Tab', 9); assert.equal((await state()).inSidebar, false); }
    await click('.sidebar-toggle'); await assertOpen(true);
    await evaluate('document.querySelector(".toc-link").focus()');
    await key('Escape', 'Escape', 27); assert.equal((await assertOpen(false)).focus, 'sidebar-toggle');
    await click('.sidebar-toggle'); await assertOpen(true);
    await evaluate('document.querySelector(".toc-link").focus()');
    const overlayX = await evaluate('document.documentElement.clientWidth - 8');
    assert.equal(await call(x => document.elementFromPoint(x, 500)?.id, overlayX), 'sidebar-overlay');
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: overlayX, y: 500, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: overlayX, y: 500, button: 'left', clickCount: 1 });
    assert.equal((await assertOpen(false)).focus, 'sidebar-toggle', 'overlay restores sidebar focus');
    await click('.sidebar-toggle'); await assertOpen(true);
    await evaluate('document.querySelector(".toc-link").focus()');
    await key('Enter', 'Enter', 13); await assertOpen(false);
    assert.equal((await state()).inSidebar, false, 'normal anchor navigation cannot leave hidden focus');
    await click('.sidebar-toggle'); await assertOpen(true);
    await evaluate('document.querySelector(".toc-link").focus()');
    await command('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(350); const desktop = await state();
    assert.equal(desktop.inert, false); assert.equal(desktop.expanded, 'true'); assert.equal(desktop.inSidebar, true);
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.equal((await assertOpen(false)).focus, 'sidebar-toggle');
    await click('.sidebar-toggle'); await assertOpen(true);
    await evaluate('document.querySelector(".toc-link.active").focus()');
    await key('Tab', 'Tab', 9); await assertOpen(false);
    assert.equal(await evaluate('document.activeElement.id'), 'after-sidebar', 'Tab may leave without an obscuring overlay');
    results.push({ width, theme, profile: profile.id, pointerKeyboardAriaFocusResize: true });
  }
  // Original no-controller keyboard defect must be observable, not masked by
  // programmatic checkbox writes or a simulator that manufactures clicks.
  await load(390, 'light', profiles[0], '');
  await key('Tab', 'Tab', 9); await key('Enter', 'Enter', 13);
  assert.equal((await state()).checked, false, 'negative control detects missing controller');
  await key(' ', 'Space', 32); assert.equal((await state()).checked, false);
  // Pointer CSS-only fallback remains available without this enhancement.
  await click('.sidebar-toggle'); assert.equal((await state()).checked, true);
  assert.equal(results.length, 16);
  console.log(JSON.stringify({ browser: chrome, passed: results.length, negativeControls: 2,
    noJsPointerFallback: true, actualBrowserZoomClaimed: false, results }, null, 2));
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    await Promise.race([closed, delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([closed, delay(2000)]); }
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'owned Chrome process did not exit');
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
