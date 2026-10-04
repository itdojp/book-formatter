// Native offline search integration: actual DOM and trusted shipped search only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { discoverChrome } from './shared-browser-discovery.js';
import { inspectSharedSearchDocument } from '../src/SharedSearchLayoutGuard.js';
import { searchLayoutCases, searchLayoutPage } from './shared-search-layout-fixtures.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { chrome, diagnostics } = discoverChrome();
console.log(`Native Chrome discovery: ${JSON.stringify(diagnostics)}`);
assert.ok(chrome, 'Chrome is mandatory for the shared search layout gate');
assert.ok(Buffer.byteLength(os.tmpdir()) <= 60, 'set TMPDIR to a short owned directory');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'search-layout-'));
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
  await command('Page.enable');
  const { frameTree } = await command('Page.getFrameTree');
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  const search = await fs.readFile(new URL('../shared/assets/js/search.js', import.meta.url), 'utf8');
  const reports = [];
  for (const item of searchLayoutCases) {
    await command('Page.setDocumentContent', { frameId: frameTree.frame.id, html: searchLayoutPage(item.html) });
    const before = await evaluate('document.documentElement.outerHTML');
    const report = await evaluate(`(${inspectSharedSearchDocument.toString()})(document)`);
    assert.deepEqual(report.findings.map(finding => finding.code), item.codes, item.id);
    assert.equal(report.passed, item.codes.length === 0, item.id);
    assert.deepEqual(await evaluate(`(${inspectSharedSearchDocument.toString()})(document)`), report, 'deterministic report');
    assert.equal(await evaluate('document.documentElement.outerHTML'), before, 'preflight is read-only');
    let operation = 'rejected-before-operation';
    // Only inert synthetic negative controls deliberately bypass the failing guard.
    // Consumer callers MUST abort on any finding instead of continuing this way.
    if (report.passed || item.demonstration) {
      const originalContent = await evaluate('document.querySelector(".page-content").textContent');
      await evaluate(search);
      await evaluate('document.querySelector("#search-input").focus()');
      for (const key of ['A', 'l']) {
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key, unmodifiedText: key });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key });
      }
      await delay(400);
      const state = await evaluate(`(() => ({
        input: document.querySelectorAll('#search-input').length,
        content: document.querySelectorAll('.page-content').length,
        text: document.querySelector('.page-content')?.textContent,
        value: document.querySelector('#search-input')?.value,
        results: document.querySelectorAll('.search-result-item').length,
        active: document.querySelector('#search-results').classList.contains('active')
      }))()`);
      if (item.demonstration === 'removed-both') {
        assert.equal(state.input + state.content, 0, 'negative control reproduces destructive results ancestor');
      } else if (item.demonstration === 'one-character') {
        assert.equal(state.value, 'A', 'native keyboard must observe maxLength1');
        assert.equal(state.results, 0);
      } else {
        assert.equal(state.input, 1);
        assert.equal(state.content, 1);
        assert.equal(state.text, originalContent, 'search must not remove or rewrite required content');
        assert.equal(state.value, 'Al', 'actual two-character keyboard input must be admitted');
        assert.ok(state.results > 0 && state.active, item.id);
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
        assert.equal(await evaluate('document.querySelector("#search-results").classList.contains("active")'), false);
      }
      operation = state;
    }
    reports.push({ id: item.id, report, operation });
  }
  assert.equal(reports.length, searchLayoutCases.length, 'every fixture must run');
  console.log(JSON.stringify({ browser: chrome, contractVersion: '1.0.0', passed: reports.length,
    unsafe: reports.filter(item => !item.report.passed).length,
    safe: reports.filter(item => item.report.passed).length,
    negativeControls: searchLayoutCases.filter(item => item.demonstration).length, reports }, null, 2));
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
