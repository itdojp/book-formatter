import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { BookGenerator } from '../src/BookGenerator.js';

describe('Navigation Auto-generation', () => {
  let generator;
  let tempDir;
  let testConfig;

  beforeEach(async () => {
    generator = new BookGenerator();
    tempDir = path.join(process.cwd(), 'temp-test-nav');
    await fs.ensureDir(tempDir);

    testConfig = {
      title: 'テスト書籍',
      description: 'ナビゲーションテスト用の書籍',
      author: 'Test Author',
      structure: {
        introduction: [
          {
            title: 'はじめに',
            path: '/src/introduction/index.html'
          }
        ],
        chapters: [
          {
            id: 1,
            title: '第1章 テスト章',
            path: '/src/chapter-1/index.html'
          },
          {
            id: 2,
            title: '第2章 次のテスト章',
            path: '/src/chapter-2/index.html'
          }
        ],
        conclusion: [
          {
            title: 'おわりに',
            path: '/src/conclusion/index.html'
          }
        ],
        appendices: [
          {
            title: '付録A',
            path: '/src/appendices/appendix-a.html'
          }
        ]
      }
    };
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('generateNavigationData', () => {
    it('should generate navigation data from structure when no custom order', async () => {
      await generator.generateNavigationData(testConfig, tempDir);

      const navigationFile = path.join(tempDir, '_data', 'navigation.json');
      assert(await fs.pathExists(navigationFile), 'Navigation file should be created');

      const navigationData = await fs.readJSON(navigationFile);
      
      // 自動生成された順序を確認
      assert(navigationData['src/introduction/index'], 'Introduction navigation should be defined');
      assert(navigationData['src/chapter-1/index'], 'Chapter 1 navigation should be defined');
      assert(navigationData['src/chapter-2/index'], 'Chapter 2 navigation should be defined');
      assert(navigationData['src/conclusion/index'], 'Conclusion navigation should be defined');
      assert(navigationData['src/appendices/appendix-a'], 'Appendix navigation should be defined');

      // ナビゲーションリンクが正しく設定されているか確認
      const chapter1Nav = navigationData['src/chapter-1/index'];
      assert.strictEqual(chapter1Nav.previous.path, '/src/introduction/index.html');
      assert.strictEqual(chapter1Nav.previous.title, 'はじめに');
      assert.strictEqual(chapter1Nav.next.path, '/src/chapter-2/index.html');
      assert.strictEqual(chapter1Nav.next.title, '第2章 次のテスト章');
    });

    it('should use custom navigation order when provided', async () => {
      const configWithCustomOrder = {
        ...testConfig,
        navigation: {
          order: [
            'src/chapter-2/index',
            'src/chapter-1/index',
            'src/introduction/index'
          ]
        }
      };

      await generator.generateNavigationData(configWithCustomOrder, tempDir);

      const navigationFile = path.join(tempDir, '_data', 'navigation.json');
      const navigationData = await fs.readJSON(navigationFile);

      // カスタム順序が適用されているか確認
      const chapter2Nav = navigationData['src/chapter-2/index'];
      assert.strictEqual(chapter2Nav.previous, null);
      assert.strictEqual(chapter2Nav.next.path, '/src/chapter-1/index.html');

      const chapter1Nav = navigationData['src/chapter-1/index'];
      assert.strictEqual(chapter1Nav.previous.path, '/src/chapter-2/index.html');
      assert.strictEqual(chapter1Nav.next.path, '/src/introduction/index.html');
    });

    it('should handle first and last pages correctly', async () => {
      await generator.generateNavigationData(testConfig, tempDir);

      const navigationFile = path.join(tempDir, '_data', 'navigation.json');
      const navigationData = await fs.readJSON(navigationFile);

      // 最初のページ（はじめに）
      const firstPage = navigationData['src/introduction/index'];
      assert.strictEqual(firstPage.previous, null);
      assert(firstPage.next, 'First page should have next link');

      // 最後のページ（付録A）
      const lastPage = navigationData['src/appendices/appendix-a'];
      assert(lastPage.previous, 'Last page should have previous link');
      assert.strictEqual(lastPage.next, null);
    });
  });

  describe('generateDefaultNavigationOrder', () => {
    it('should generate correct order from structure', () => {
      const order = generator.generateDefaultNavigationOrder(testConfig);
      
      assert.deepStrictEqual(order, [
        'src/introduction/index',
        'src/chapter-1/index',
        'src/chapter-2/index',
        'src/conclusion/index',
        'src/appendices/appendix-a'
      ]);
    });

    it('should handle missing structure sections', () => {
      const minimalConfig = {
        title: 'ミニマル書籍',
        structure: {
          chapters: [
            {
              id: 1,
              title: '第1章',
              path: '/src/chapter-1/index.html'
            }
          ]
        }
      };

      const order = generator.generateDefaultNavigationOrder(minimalConfig);
      assert.deepStrictEqual(order, ['src/chapter-1/index']);
    });
  });

  describe('getPageTitle', () => {
    it('should return correct title for existing pages', () => {
      const title = generator.getPageTitle(testConfig, 'src/chapter-1/index');
      assert.strictEqual(title, '第1章 テスト章');
    });

    it('should generate title from path for unknown pages', () => {
      const title = generator.getPageTitle(testConfig, 'src/unknown/page');
      assert.strictEqual(title, 'Src Unknown Page');
    });
  });
});