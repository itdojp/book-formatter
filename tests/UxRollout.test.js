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
});
