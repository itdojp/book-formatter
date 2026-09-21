// Native browser counterpart to SharedDomSafety.test.js. Only trusted shipped
// scripts + inert synthetic fixtures; no public book or remote test target.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] :
  ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
const chrome = candidates.find((candidate) => spawnSync(candidate, ['--version'], { timeout: 3000 }).status === 0);
assert.ok(chrome, 'Chrome is required for the native shared DOM gate (CHROME_PATH may select it)');
// Chrome's temporary Unix socket needs a short TMPDIR. The operator controls
// this workspace-owned path; do not silently fall back outside that workspace.
assert.ok(Buffer.byteLength(os.tmpdir()) <= 60, 'set TMPDIR to a short owned directory for Chrome sockets');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-dom-'));
try {
  let html = fs.readFileSync(path.join(root, 'tests/fixtures/shared-dom/page.html'), 'utf8');
  for (const name of ['search', 'main']) {
    const marker = `/* SHARED_SOURCE:${name} */`;
    assert.equal(html.split(marker).length, 2, `one ${name} injection point required`);
    html = html.replace(marker, () => fs.readFileSync(path.join(root, `shared/assets/js/${name}.js`), 'utf8'));
  }
  const page = path.join(directory, 'page.html');
  fs.writeFileSync(page, html);
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
    '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${path.join(directory, 'profile')}`,
    '--virtual-time-budget=6000', '--timeout=20000', '--dump-dom', pathToFileURL(page).href
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Chrome failed (${result.signal}): ${result.stderr}`);
  const findProbe = (node) => {
    if (node.tagName === 'pre' && node.attrs?.some((a) => a.name === 'id' && a.value === 'probe')) return node;
    for (const child of node.childNodes || []) {
      const match = findProbe(child);
      if (match) return match;
    }
  };
  const probe = findProbe(parse(result.stdout));
  assert.ok(probe, 'native DOM probe is absent');
  const results = JSON.parse(probe.childNodes.map((node) => node.value || '').join(''));
  assert.equal(results.length, 20, 'all browser assertions must finish');
  assert.ok(results.every((check) => check.pass === true), JSON.stringify(results.filter((check) => !check.pass)));
  console.log(JSON.stringify({ browser: chrome, passed: results.length, results }, null, 2));
} finally {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
