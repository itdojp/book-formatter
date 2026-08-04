import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { UxRollout } from '../src/UxRollout.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('UxRollout', () => {
  let rollout;
  let tempDir;
  let originalConsole;

  beforeEach(async () => {
    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn
    };
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    rollout = new UxRollout();
    tempDir = await fs.mkdtemp(path.join(__dirname, 'tmp-ux-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.remove(tempDir);
    }
    if (originalConsole) {
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
    }
  });

  test('normalizeRegistry は books 配列をオブジェクトに変換する', () => {
    const registry = {
      books: [
        { name: 'sample-book', profile: 'A', modules: { quickStart: true } }
      ]
    };

    const normalized = rollout.normalizeRegistry(registry);
    assert.strictEqual(typeof normalized.books, 'object');
    assert.ok(normalized.books['sample-book']);
  });

  test('extractRepoName はリポジトリ名を抽出する', () => {
    const repoName = rollout.extractRepoName('https://github.com/itdojp/sample-book.git');
    assert.strictEqual(repoName, 'sample-book');
  });

  test('resolveRegistryEntry は bookName で一致する', () => {
    const registry = {
      books: {
        'sample-book': { profile: 'A', modules: { quickStart: true } }
      }
    };
    const result = rollout.resolveRegistryEntry('/tmp/sample-book', null, registry);
    assert.ok(result);
    assert.strictEqual(result.key, 'sample-book');
  });

  test('updateBookConfig は ux を書き込む', async () => {
    const bookPath = path.join(tempDir, 'book');
    await fs.ensureDir(bookPath);
    const configPath = path.join(bookPath, 'book-config.json');
    await fs.writeJson(configPath, { title: 'Test', description: 'Desc', author: 'Author' });

    const entry = {
      profile: 'B',
      modules: {
        quickStart: false,
        readingGuide: false,
        checklistPack: true,
        troubleshootingFlow: true,
        conceptMap: false,
        figureIndex: true,
        legalNotice: false,
        glossary: false
      }
    };

    const result = await rollout.updateBookConfig(bookPath, entry, { dryRun: false, backup: false });
    assert.strictEqual(result.updated, true);

    const updated = await fs.readJson(configPath);
    assert.strictEqual(updated.ux.profile, 'B');
    assert.strictEqual(updated.ux.modules.checklistPack, true);
  });

  test('loadRegistry は JSON/YAML を読み込む', async () => {
    const jsonPath = path.join(tempDir, 'registry.json');
    const yamlPath = path.join(tempDir, 'registry.yml');

    await fs.writeJson(jsonPath, { books: {} });
    await fs.writeFile(yamlPath, 'books: {}');

    const jsonRegistry = await rollout.loadRegistry(jsonPath);
    const yamlRegistry = await rollout.loadRegistry(yamlPath);

    assert.deepStrictEqual(jsonRegistry.books, {});
    assert.deepStrictEqual(yamlRegistry.books, {});
  });

  test('mobile sidebarの未選択ruleは後続base ruleより高いspecificityを持つ', async () => {
    const mainCss = await fs.readFile(
      path.resolve('shared/assets/css/main.css'),
      'utf8'
    );
    const responsiveCss = await fs.readFile(
      path.resolve('shared/assets/css/mobile-responsive.css'),
      'utf8'
    );
    const layout = await fs.readFile(
      path.resolve('shared/layouts/book.html'),
      'utf8'
    );

    const importIndex = mainCss.indexOf(
      '@import url(\'./mobile-responsive.css\')'
    );
    const baseSidebarIndex = mainCss.indexOf('.book-sidebar {');
    assert.ok(importIndex >= 0, 'main.css must import mobile-responsive.css');
    assert.ok(
      baseSidebarIndex > importIndex,
      'the base sidebar rule must remain after the responsive import'
    );

    assert.match(
      responsiveCss,
      /@media \(max-width: 1024px\)[\s\S]*?\.book-layout \.book-sidebar\s*\{[\s\S]*?transform:\s*translateX\(-100%\);/
    );
    assert.match(
      responsiveCss,
      /\.sidebar-toggle-checkbox:checked ~ \.book-layout \.book-sidebar\s*\{[\s\S]*?transform:\s*translateX\(0\) !important;/
    );
    assert.doesNotMatch(
      responsiveCss,
      /^[\t ]*\.book-sidebar[\t ]*\{/m
    );
    assert.match(
      responsiveCss,
      /\.book-sidebar-overlay\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/
    );
    assert.match(
      responsiveCss,
      /\.sidebar-toggle-checkbox:checked ~ \.book-sidebar-overlay\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/
    );
    assert.match(
      responsiveCss,
      /@media \(min-width: 1025px\)[\s\S]*?\.sidebar-toggle\s*\{[\s\S]*?display:\s*none !important;/
    );

    const checkboxIndex = layout.indexOf('class="sidebar-toggle-checkbox"');
    const layoutIndex = layout.indexOf('class="book-layout"');
    const overlayIndex = layout.indexOf('class="book-sidebar-overlay"');
    assert.ok(checkboxIndex >= 0, 'book layout must include the sidebar checkbox');
    assert.ok(
      layoutIndex > checkboxIndex,
      'book layout must follow the sidebar checkbox for the sibling selector'
    );
    assert.ok(
      overlayIndex > layoutIndex,
      'sidebar overlay must follow the book layout for the sibling selector'
    );
  });
});
