import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import fs from 'fs-extra';

import {
  checkMdbookResponsive,
  MDBOOK_VIEWPORTS,
  MdbookResponsiveError,
  removeChromeProfile
} from '../src/MdbookResponsiveChecker.js';

const ROOT = process.cwd();
const temporaryDirectories = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(ROOT, 'tests/tmp-mdbook-responsive-'));
  temporaryDirectories.push(root);
  await fs.ensureDir(path.join(root, 'src'));
  await fs.ensureDir(path.join(root, 'theme/css'));
  await fs.ensureDir(path.join(root, 'book/theme/css'));
  await fs.writeFile(
    path.join(root, 'book.toml'),
    '[build]\nbuild-dir = "book"\ncreate-missing = false\n' +
      '[output.html]\nadditional-css = ["theme/css/itdo-mdbook.css"]\n'
  );
  await fs.writeFile(path.join(root, 'src/SUMMARY.md'), '# Summary\n\n- [One](one.md)\n');
  await fs.writeFile(path.join(root, 'src/book.yaml'), 'id: fixture\n');
  await fs.copyFile(
    path.join(ROOT, 'shared/mdbook/theme/css/itdo-mdbook.css'),
    path.join(root, 'theme/css/itdo-mdbook.css')
  );
  await fs.writeJson(path.join(root, 'manifest.json'), {
    kind: 'book-formatter.adapter-build',
    adapter: {
      target: 'web-mdbook',
      implementation: 'web-mdbook-v1',
      verified_mdbook_version: '0.5.4'
    }
  });
  await fs.writeFile(
    path.join(root, 'book/index.html'),
    '<!doctype html><html><head>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="stylesheet" href="theme/css/itdo-mdbook-a1b2.css">' +
      '</head><body>' +
      '<input id="mdbook-sidebar-toggle-anchor">' +
      '<nav id="mdbook-sidebar"></nav>' +
      '<div id="mdbook-page-wrapper"><div id="mdbook-menu-bar"></div>' +
      '<div id="mdbook-content"></div></div>' +
      '</body></html>\n'
  );
  await fs.writeFile(path.join(root, 'book/theme/css/itdo-mdbook-a1b2.css'), 'body {}\n');
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('MdbookResponsiveChecker', () => {
  test('固定6 viewportと静的project/DOM/CSS契約を検証する', async () => {
    assert.deepStrictEqual(MDBOOK_VIEWPORTS, [
      { width: 390, height: 844 },
      { width: 480, height: 900 },
      { width: 768, height: 1024 },
      { width: 820, height: 1180 },
      { width: 1024, height: 1366 },
      { width: 1366, height: 768 }
    ]);
    const root = await fixture();
    const report = await checkMdbookResponsive(root, { staticOnly: true });
    assert.strictEqual(report.static, true);
    assert.strictEqual(report.viewports, 6);
    assert.strictEqual(report.htmlFiles, 1);
    assert.strictEqual(report.responsivePages, 1);
    assert.strictEqual(report.localLinks, 1);
    assert.strictEqual(report.expectedBrowserProbes, 12);
    assert.strictEqual(report.browserProbes, 0);
  });

  test('全generated HTML pageを各viewportのopen/closed browser probeへ渡す', async () => {
    const root = await fixture();
    await fs.copyFile(
      path.join(root, 'book/index.html'),
      path.join(root, 'book/chapter.html')
    );
    await fs.writeFile(path.join(root, 'book/toc.html'), '<html><body>support page</body></html>\n');
    let receivedPages = [];
    const report = await checkMdbookResponsive(root, {
      chrome: 'synthetic-chrome',
      browserProbeRunner: async (_chrome, projectRoot, _buildRoot, htmlFiles) => {
        receivedPages = htmlFiles.map((file) => path.relative(projectRoot, file));
        return Array.from({ length: htmlFiles.length * MDBOOK_VIEWPORTS.length * 2 }, () => ({}));
      }
    });

    assert.deepStrictEqual(receivedPages, ['book/chapter.html', 'book/index.html']);
    assert.strictEqual(report.htmlFiles, 3);
    assert.strictEqual(report.responsivePages, 2);
    assert.strictEqual(report.expectedBrowserProbes, 24);
    assert.strictEqual(report.browserProbes, 24);
  });

  test('一部pageだけをprobeしたbrowser runnerをfail-closedで拒否する', async () => {
    const root = await fixture();
    await fs.copyFile(
      path.join(root, 'book/index.html'),
      path.join(root, 'book/chapter.html')
    );
    await assert.rejects(
      checkMdbookResponsive(root, {
        chrome: 'synthetic-chrome',
        browserProbeRunner: async () => Array.from({ length: 12 }, () => ({}))
      }),
      /Browser probe coverage mismatch: expected 24, observed 12/
    );
  });

  test('Chrome profile cleanupは一時的なENOTEMPTYをbounded retryする', async () => {
    let attempts = 0;
    const waits = [];
    await removeChromeProfile('/synthetic/chrome-profile', {
      remove: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('profile is still being released');
          error.code = 'ENOTEMPTY';
          throw error;
        }
      },
      wait: async (milliseconds) => waits.push(milliseconds),
      maxAttempts: 3,
      retryDelayMs: 25
    });

    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(waits, [25, 50]);
  });

  test('mdBook DOMとadditional CSS契約のdriftを拒否する', async () => {
    const missingDom = await fixture();
    await fs.writeFile(path.join(missingDom, 'book/index.html'), '<html><body></body></html>');
    await assert.rejects(
      checkMdbookResponsive(missingDom, { staticOnly: true }),
      (error) => error instanceof MdbookResponsiveError && /missing required IDs/.test(error.message)
    );

    const wrongCss = await fixture();
    await fs.writeFile(path.join(wrongCss, 'theme/css/itdo-mdbook.css'), 'body {}\n');
    await assert.rejects(
      checkMdbookResponsive(wrongCss, { staticOnly: true }),
      /Shared CSS is missing the responsive marker/
    );
  });

  test('built HTMLのbroken local fileとanchorを拒否する', async () => {
    const brokenFile = await fixture();
    await fs.appendFile(
      path.join(brokenFile, 'book/index.html'),
      '<a href="missing.html">missing</a>\n'
    );
    await assert.rejects(
      checkMdbookResponsive(brokenFile, { staticOnly: true }),
      /Broken local URL/
    );

    const brokenAnchor = await fixture();
    await fs.appendFile(
      path.join(brokenAnchor, 'book/index.html'),
      '<a href="#missing">missing</a>\n'
    );
    await assert.rejects(
      checkMdbookResponsive(brokenAnchor, { staticOnly: true }),
      /Broken local anchor/
    );
  });
});
