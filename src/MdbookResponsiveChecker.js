import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import fs from 'fs-extra';
import { parse as parseHtml } from 'parse5';
import WebSocket from 'ws';

export const MDBOOK_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 390, height: 844 }),
  Object.freeze({ width: 480, height: 900 }),
  Object.freeze({ width: 768, height: 1024 }),
  Object.freeze({ width: 820, height: 1180 }),
  Object.freeze({ width: 1024, height: 1366 }),
  Object.freeze({ width: 1366, height: 768 })
]);

const REQUIRED_PROJECT_FILES = Object.freeze([
  'book.toml',
  'manifest.json',
  'src/SUMMARY.md',
  'src/book.yaml',
  'theme/css/itdo-mdbook.css',
  'book/index.html'
]);

export class MdbookResponsiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MdbookResponsiveError';
  }
}

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) visit(child, callback);
  if (node.content) visit(node.content, callback);
}

function attribute(node, name) {
  return node.attrs?.find((candidate) => candidate.name === name)?.value || null;
}

async function requireRegularFile(projectRoot, relativePath) {
  const candidate = path.join(projectRoot, relativePath);
  let stat;
  try {
    stat = await fs.lstat(candidate);
  } catch {
    throw new MdbookResponsiveError(`Required mdBook file is missing: ${relativePath}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new MdbookResponsiveError(`Required mdBook path must be a regular file: ${relativePath}`);
  }
  return candidate;
}

function inspectBuiltHtml(source) {
  const document = parseHtml(source);
  const requiredIds = new Set([
    'mdbook-sidebar-toggle-anchor',
    'mdbook-sidebar',
    'mdbook-page-wrapper',
    'mdbook-menu-bar',
    'mdbook-content'
  ]);
  let hasViewport = false;
  let hasAdditionalCss = false;

  visit(document, (node) => {
    const id = attribute(node, 'id');
    if (id) requiredIds.delete(id);
    if (node.tagName === 'meta' && attribute(node, 'name') === 'viewport') {
      hasViewport = /width=device-width/u.test(attribute(node, 'content') || '');
    }
    if (node.tagName === 'link' && attribute(node, 'rel') === 'stylesheet') {
      hasAdditionalCss ||= /^theme\/css\/itdo-mdbook(?:-[a-f0-9]+)?\.css$/u.test(
        attribute(node, 'href') || ''
      );
    }
  });

  if (requiredIds.size > 0) {
    throw new MdbookResponsiveError(
      `Built mdBook DOM is missing required IDs: ${[...requiredIds].join(', ')}`
    );
  }
  if (!hasViewport) throw new MdbookResponsiveError('Built mdBook lacks the device-width viewport contract.');
  if (!hasAdditionalCss) throw new MdbookResponsiveError('Built mdBook does not link the shared additional CSS.');
}

async function collectBuiltFiles(directory, root = directory, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new MdbookResponsiveError(`Built mdBook must not contain symbolic links: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      await collectBuiltFiles(absolutePath, root, files);
    } else if (stat.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function parseHtmlContract(source) {
  const document = parseHtml(source);
  const ids = new Set();
  const destinations = [];
  visit(document, (node) => {
    const id = attribute(node, 'id');
    if (id) ids.add(id);
    for (const name of ['href', 'src']) {
      const destination = attribute(node, name);
      if (destination) destinations.push(destination);
    }
  });
  return { ids, destinations };
}

function decodeUrlPart(value, sourcePath) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new MdbookResponsiveError(`Malformed URL encoding in built HTML ${sourcePath}: ${value}`);
  }
}

async function inspectBuiltLinks(buildRoot) {
  const files = await collectBuiltFiles(buildRoot);
  const htmlFiles = files.filter((file) => path.extname(file).toLowerCase() === '.html');
  const contractByPath = new Map();
  for (const file of htmlFiles) {
    contractByPath.set(file, parseHtmlContract(await fs.readFile(file, 'utf8')));
  }

  let localLinks = 0;
  for (const [file, contract] of contractByPath.entries()) {
    const reportPath = path.relative(buildRoot, file);
    for (const destination of contract.destinations) {
      if (destination.startsWith('//')) {
        throw new MdbookResponsiveError(`Protocol-relative URL in built HTML ${reportPath}: ${destination}`);
      }
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(destination)) {
        let url;
        try {
          url = new URL(destination);
        } catch {
          throw new MdbookResponsiveError(`Malformed external URL in built HTML ${reportPath}: ${destination}`);
        }
        if (url.protocol !== 'https:' || url.username || url.password) {
          throw new MdbookResponsiveError(`Unsafe external URL in built HTML ${reportPath}: ${destination}`);
        }
        continue;
      }

      const [rawPath, rawFragment = ''] = destination.split('#', 2);
      const pathWithoutQuery = rawPath.split('?', 1)[0];
      const decodedPath = decodeUrlPart(pathWithoutQuery, reportPath);
      const rootRelative = decodedPath.startsWith('/');
      let target = decodedPath
        ? path.resolve(rootRelative ? buildRoot : path.dirname(file), decodedPath.replace(/^\/+/, ''))
        : file;
      const relative = path.relative(buildRoot, target);
      if (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new MdbookResponsiveError(`Built URL escapes the static root in ${reportPath}: ${destination}`);
      }
      if (decodedPath.endsWith('/')) target = path.join(target, 'index.html');
      let stat;
      try {
        stat = await fs.lstat(target);
      } catch {
        throw new MdbookResponsiveError(`Broken local URL in built HTML ${reportPath}: ${destination}`);
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new MdbookResponsiveError(`Local URL is not a regular file in ${reportPath}: ${destination}`);
      }
      localLinks += 1;

      if (rawFragment && path.extname(target).toLowerCase() === '.html') {
        const targetContract = contractByPath.get(target) ||
          parseHtmlContract(await fs.readFile(target, 'utf8'));
        const fragment = decodeUrlPart(rawFragment, reportPath);
        if (!targetContract.ids.has(fragment)) {
          throw new MdbookResponsiveError(`Broken local anchor in built HTML ${reportPath}: ${destination}`);
        }
      }
    }
  }
  return { htmlFiles: htmlFiles.length, localLinks };
}

function inspectProjectContract(bookToml, css, manifest) {
  const requiredToml = [
    'build-dir = "book"',
    'create-missing = false',
    'additional-css = ["theme/css/itdo-mdbook.css"]'
  ];
  for (const marker of requiredToml) {
    if (!bookToml.includes(marker)) {
      throw new MdbookResponsiveError(`book.toml is missing the exact contract: ${marker}`);
    }
  }

  const requiredCss = [
    '#mdbook-page-wrapper',
    '.content table',
    'overflow-x: auto',
    '--sidebar-target-width: min(300px, 86vw)',
    '--sidebar-target-width: min(300px, 36vw)',
    '@media only screen and (max-width: 619px)',
    '@media only screen and (min-width: 620px) and (max-width: 1080px)'
  ];
  for (const marker of requiredCss) {
    if (!css.includes(marker)) {
      throw new MdbookResponsiveError(`Shared CSS is missing the responsive marker: ${marker}`);
    }
  }

  if (
    manifest.kind !== 'book-formatter.adapter-build' ||
    manifest.adapter?.target !== 'web-mdbook' ||
    manifest.adapter?.implementation !== 'web-mdbook-v1' ||
    manifest.adapter?.verified_mdbook_version !== '0.5.4'
  ) {
    throw new MdbookResponsiveError('manifest.json does not declare web-mdbook-v1 / mdBook 0.5.4.');
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser'
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  return null;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new MdbookResponsiveError(`Chrome CDP error: ${message.error.message}`));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new CdpClient(socket);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MdbookResponsiveError(`Chrome CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForChromeEndpoint(profileDirectory, processState) {
  const endpointPath = path.join(profileDirectory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processState.exitCode !== null) {
      throw new MdbookResponsiveError(
        `Chrome exited before CDP startup: ${processState.stderr.trim()}`
      );
    }
    if (await fs.pathExists(endpointPath)) {
      const [port, browserPath] = (await fs.readFile(endpointPath, 'utf8')).trim().split('\n');
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    }
    await delay(100);
  }
  throw new MdbookResponsiveError('Chrome CDP endpoint did not become ready.');
}

async function launchChrome(chrome, projectRoot) {
  const profileDirectory = await fs.mkdtemp(path.join(projectRoot, '.itdo-chrome-profile-'));
  const child = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const processState = { exitCode: null, stderr: '' };
  child.stderr.on('data', (chunk) => {
    processState.stderr = `${processState.stderr}${String(chunk)}`.slice(-8000);
  });
  child.once('exit', (code) => {
    processState.exitCode = code;
  });

  try {
    const endpoint = await waitForChromeEndpoint(profileDirectory, processState);
    const client = await CdpClient.connect(endpoint);
    return { child, client, profileDirectory };
  } catch (error) {
    child.kill('SIGKILL');
    await fs.remove(profileDirectory);
    throw error;
  }
}

async function closeChrome(browser) {
  browser.client.close();
  if (browser.child.exitCode === null) browser.child.kill('SIGTERM');
  for (let attempt = 0; attempt < 20 && browser.child.exitCode === null; attempt += 1) {
    await delay(50);
  }
  if (browser.child.exitCode === null) browser.child.kill('SIGKILL');
  await fs.remove(browser.profileDirectory);
}

function probeExpression(state) {
  return `(async () => {
    const toggle = document.getElementById('mdbook-sidebar-toggle-anchor');
    const sidebar = document.getElementById('mdbook-sidebar');
    const wrapper = document.getElementById('mdbook-page-wrapper');
    const content = document.getElementById('mdbook-content');
    if (!toggle || !sidebar || !wrapper || !content) throw new Error('required mdBook DOM is missing');
    let style = document.getElementById('itdo-responsive-probe-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'itdo-responsive-probe-style';
      style.textContent = '* { transition: none !important; animation: none !important; }';
      document.head.appendChild(style);
    }
    if (${state === 'open' ? 'true' : 'false'}) sidebar.style.display = '';
    toggle.checked = ${state === 'open' ? 'true' : 'false'};
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    void document.documentElement.offsetWidth;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sidebarRect = sidebar.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const sidebarStyle = getComputedStyle(sidebar);
    const sidebarVisible = sidebarRect.width > 0 && sidebarRect.right > 0 && sidebarRect.left < window.innerWidth;
    return {
      state: ${JSON.stringify(state)},
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      sidebar: { left: sidebarRect.left, right: sidebarRect.right, width: sidebarRect.width },
      sidebarDisplay: sidebarStyle.display,
      sidebarCssWidth: sidebarStyle.width,
      sidebarClass: sidebar.className,
      printMedia: matchMedia('print').matches,
      sidebarVariable: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),
      wrapper: { left: wrapperRect.left, right: wrapperRect.right, width: wrapperRect.width },
      content: { left: contentRect.left, right: contentRect.right, width: contentRect.width },
      sidebarVisible,
      overlap: sidebarVisible && Math.min(sidebarRect.right, contentRect.right) - Math.max(sidebarRect.left, contentRect.left) > 1,
      bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  })()`;
}

function validateProbe(probe, viewport, state) {
  if (probe.viewportWidth !== viewport.width || probe.viewportHeight !== viewport.height) {
    throw new MdbookResponsiveError(
      `Chrome viewport mismatch: requested ${viewport.width}x${viewport.height}, ` +
        `observed ${probe.viewportWidth}x${probe.viewportHeight}`
    );
  }
  if (probe.content.width <= 0 || probe.wrapper.width <= 0) {
    throw new MdbookResponsiveError(
      `Content has no usable width at ${viewport.width}x${viewport.height}/${state}`
    );
  }
  if (state === 'open' && !probe.sidebarVisible) {
    throw new MdbookResponsiveError(
      `Sidebar did not become visible at ${viewport.width}x${viewport.height} ` +
        `(left=${probe.sidebar.left}, right=${probe.sidebar.right}, width=${probe.sidebar.width}, ` +
        `display=${probe.sidebarDisplay}, css-width=${probe.sidebarCssWidth}, ` +
        `class=${probe.sidebarClass}, print=${probe.printMedia}, ` +
        `--sidebar-width=${probe.sidebarVariable})`
    );
  }
  if (probe.overlap) {
    throw new MdbookResponsiveError(
      `Sidebar overlaps content at ${viewport.width}x${viewport.height}/${state}`
    );
  }
  if (state === 'closed' && probe.bodyOverflow) {
    throw new MdbookResponsiveError(
      `Closed layout overflows the viewport at ${viewport.width}x${viewport.height}`
    );
  }
}

async function runBrowserProbes(chrome, projectRoot, indexPath) {
  const browser = await launchChrome(chrome, projectRoot);
  try {
    const { targetId } = await browser.client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.client.send('Target.attachToTarget', {
      targetId,
      flatten: true
    });
    await browser.client.send('Page.enable', {}, sessionId);
    await browser.client.send('Runtime.enable', {}, sessionId);
    await browser.client.send('Emulation.setEmulatedMedia', { media: 'screen' }, sessionId);
    await browser.client.send('Page.navigate', { url: pathToFileURL(indexPath).href }, sessionId);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await browser.client.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      }, sessionId);
      if (response.result?.value === 'complete') break;
      if (attempt === 99) throw new MdbookResponsiveError('Built mdBook page did not finish loading.');
      await delay(100);
    }

    const probes = [];
    for (const viewport of MDBOOK_VIEWPORTS) {
      await browser.client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId);
      for (const state of ['closed', 'open']) {
        const response = await browser.client.send('Runtime.evaluate', {
          expression: probeExpression(state),
          awaitPromise: true,
          returnByValue: true
        }, sessionId);
        if (response.exceptionDetails || !response.result?.value) {
          throw new MdbookResponsiveError(
            `Chrome evaluation failed at ${viewport.width}x${viewport.height}/${state}`
          );
        }
        validateProbe(response.result.value, viewport, state);
        probes.push(response.result.value);
      }
    }
    await browser.client.send('Target.closeTarget', { targetId });
    return probes;
  } finally {
    await closeChrome(browser);
  }
}

export async function checkMdbookResponsive(projectDirectory, options = {}) {
  const projectRoot = path.resolve(projectDirectory);
  let stat;
  try {
    stat = await fs.lstat(projectRoot);
  } catch {
    throw new MdbookResponsiveError(`mdBook project does not exist: ${projectRoot}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new MdbookResponsiveError(`mdBook project must be a real directory: ${projectRoot}`);
  }

  const files = {};
  for (const relativePath of REQUIRED_PROJECT_FILES) {
    files[relativePath] = await requireRegularFile(projectRoot, relativePath);
  }
  const [bookToml, css, manifestSource, html] = await Promise.all([
    fs.readFile(files['book.toml'], 'utf8'),
    fs.readFile(files['theme/css/itdo-mdbook.css'], 'utf8'),
    fs.readFile(files['manifest.json'], 'utf8'),
    fs.readFile(files['book/index.html'], 'utf8')
  ]);
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    throw new MdbookResponsiveError('manifest.json is not valid JSON.');
  }
  inspectProjectContract(bookToml, css, manifest);
  inspectBuiltHtml(html);
  const builtLinks = await inspectBuiltLinks(path.join(projectRoot, 'book'));

  const probes = [];
  if (!options.staticOnly) {
    const chrome = options.chrome || findChrome();
    if (!chrome) {
      throw new MdbookResponsiveError(
        'Chrome is required for viewport geometry checks; set CHROME_BIN or use --static-only explicitly.'
      );
    }
    probes.push(...await runBrowserProbes(chrome, projectRoot, files['book/index.html']));
  }

  return {
    project: projectRoot,
    static: true,
    viewports: MDBOOK_VIEWPORTS.length,
    htmlFiles: builtLinks.htmlFiles,
    localLinks: builtLinks.localLinks,
    browserProbes: probes.length,
    probes
  };
}
