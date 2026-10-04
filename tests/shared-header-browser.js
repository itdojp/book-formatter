// Native CDP/CSS oracle; no DOM/layout emulation or new browser dependency.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { headerPage, profiles, widths } from './shared-header-fixture.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] :
  ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
const chrome = candidates.find(candidate => spawnSync(candidate, ['--version'], { timeout: 3000 }).status === 0);
assert.ok(chrome, 'Chrome is mandatory for shared header geometry');
assert.ok(Buffer.byteLength(os.tmpdir()) <= 60, 'set TMPDIR to a short owned directory');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'header-'));
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
function probe() {
  const header = document.querySelector('.book-header');
  const hb = header.getBoundingClientRect();
  const targets = [...header.querySelectorAll('a,button,input,[tabindex]')];
  const details = targets.map(el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const hiddenSidebar = el.classList.contains('sidebar-toggle') && style.display === 'none';
    const fits = rect.width > 0 && rect.height > 0 && rect.left >= 4 && rect.right <= document.documentElement.clientWidth - 4 && rect.top >= 4 && rect.bottom <= Math.min(hb.bottom, innerHeight) - 4;
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const hit = hiddenSidebar || center === el || el.contains(center);
    const name = el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('placeholder');
    return { className: el.className, pass: hiddenSidebar || (fits && hit && Boolean(name)), hiddenSidebar, name, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, fits, hit };
  });
  const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
  const main = document.querySelector('.book-main').getBoundingClientRect();
  const sidebar = document.querySelector('.book-sidebar').getBoundingClientRect();
  const css = getComputedStyle(document.querySelector('.header-title h1'));
  const pass = details.every(x => x.pass) && hb.bottom < innerHeight && document.documentElement.scrollWidth <= document.documentElement.clientWidth && header.scrollWidth <= header.clientWidth && offset >= hb.height && offset - hb.height < 1 && main.top >= hb.bottom && Math.abs(sidebar.top - offset) < 1 && css.textOverflow === 'ellipsis';
  return { pass, headerHeight: hb.height, offset, mainTop: main.top, viewport: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, details };
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
  await command('Page.enable');
  const { frameTree } = await command('Page.getFrameTree');
  const cases = [];
  for (const width of widths) for (const theme of ['light', 'dark']) for (const profile of profiles) {
    for (const reflow of [1, 2]) cases.push({ width, theme, profile, reflow, actualWidth: Math.floor(width / reflow), fontSize: 16 });
  }
  for (const width of widths) for (const theme of ['light', 'dark']) cases.push({ width, theme, profile: profiles[1], reflow: 'text-200%', actualWidth: width, fontSize: 32 });
  const results = [];
  for (const item of cases) {
    await command('Emulation.setDeviceMetricsOverride', { width: item.actualWidth, height: 1000, deviceScaleFactor: 1, mobile: false });
    await command('Page.setDocumentContent', { frameId: frameTree.frame.id, html: headerPage(item) });
    await delay(70);
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(item.theme)}`);
    const result = await evaluate(`(${probe.toString()})()`);
    assert.equal(result.viewport, item.actualWidth, 'actual CSS viewport must match');
    const { nodes } = await command('Accessibility.getFullAXTree');
    assert.ok(nodes.some(node => node.role?.value === 'link' && node.name?.value === item.profile.title), 'visual ellipsis must preserve the complete accessible title');
    assert.ok(nodes.some(node => node.role?.value === 'searchbox' && node.name?.value === 'Search...'), 'mobile search must remain in the accessibility tree');
    // Real Tab input checks order; programmatic .focus() is not a substitute.
    await evaluate('document.body.tabIndex = -1; document.body.focus()');
    const tabbed = [];
    for (const detail of result.details.filter(x => !x.hiddenSidebar)) {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      let focused = await evaluate('document.activeElement.className');
      // Existing offscreen checkbox precedes the header in the shipped DOM.
      // Its keyboard/ARIA redesign belongs to #116, not the width correction.
      if (focused === 'sidebar-toggle-checkbox') {
        assert.equal(tabbed.length, 0);
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        focused = await evaluate('document.activeElement.className');
      }
      tabbed.push(focused);
      assert.equal(focused, detail.className, `Tab order: ${JSON.stringify(item)}`);
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const focusStyle = await evaluate('(() => { const style = getComputedStyle(document.activeElement); return { visible: document.activeElement.matches(\':focus-visible\'), outline: style.outlineWidth, shadow: style.boxShadow }; })()');
      assert.ok(focusStyle.visible && (parseFloat(focusStyle.outline) > 0 || focusStyle.shadow !== 'none'), `keyboard focus indicator: ${JSON.stringify({ width: item.actualWidth, profile: item.profile.id, focused, focusStyle })}`);
    }
    const toggle = result.details.find(x => x.className === 'theme-toggle');
    const x = (toggle.rect.left + toggle.rect.right) / 2, y = (toggle.rect.top + toggle.rect.bottom) / 2;
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    assert.equal(await evaluate('document.documentElement.dataset.theme'), item.theme === 'light' ? 'dark' : 'light', 'actual pointer reaches theme button');
    results.push({ width: item.width, theme: item.theme, profile: item.profile.id, reflow: item.reflow, ...result, tabbed });
  }
  assert.equal(results.length, 162);
  const failed = results.filter(item => !item.pass);
  assert.deepEqual(failed, [], JSON.stringify(failed));
  const resizeResults = [];
  for (const width of [320, 768, 1366]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    const result = await evaluate(`(${probe.toString()})()`);
    assert.ok(result.pass, JSON.stringify(result));
    resizeResults.push({ width, ...result });
  }
  console.log(JSON.stringify({ browser: chrome, passed: results.length, actualResizeProbes: resizeResults.length, widthMatrix: widths, interactiveBrowserZoomClaimed: false, results, resizeResults }, null, 2));
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
