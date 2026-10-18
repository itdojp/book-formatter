import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { BookGenerator } from '../src/BookGenerator.js';
import { parseFragment } from 'parse5';

// Bounded markup composition, not a Liquid interpreter. Actual Jekyll output
// is checked separately; these probes bind the shipped wrapper/include shape.
const sharedLayout = await fs.readFile(new URL('../shared/layouts/book.html', import.meta.url), 'utf8');
const pageNavigation = await fs.readFile(new URL('../shared/includes/page-navigation.html', import.meta.url), 'utf8');

function assertPageNavigationLandmark(layout, include) {
  const marker = /\{%\s*include page-navigation\.html\s*%\}/g;
  assert.strictEqual([...layout.matchAll(marker)].length, 1, 'exactly one page-navigation include');
  const wrapper = layout.match(/<(nav|div)\b[^>]*class="page-navigation"[^>]*>\s*\{%\s*include page-navigation\.html\s*%\}\s*<\/\1>/);
  assert(wrapper, 'explicit page-navigation wrapper');
  const root = parseFragment(wrapper[0].replace(marker, () => include));
  const elements = [];
  const visit = node => {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  const attr = (node, name) => node.attrs.find(attribute => attribute.name === name)?.value;
  const landmarks = elements.filter(node => node.tagName === 'nav' || attr(node, 'role') === 'navigation');
  assert.strictEqual(landmarks.length, 1, 'one page-bottom navigation landmark');
  assert.strictEqual(attr(landmarks[0], 'class'), 'book-navigation');
  assert.strictEqual(attr(landmarks[0], 'aria-label'), 'Chapter navigation', 'named chapter navigation');
  assert.strictEqual(elements[0].tagName, 'div', 'non-landmark styling wrapper');
  assert.strictEqual(attr(elements[0], 'class'), 'page-navigation');
}

describe('Shared page-bottom navigation landmark', () => {
  it('retains one named include landmark within the styling wrapper', () => {
    assertPageNavigationLandmark(sharedLayout, pageNavigation);
  });

  for (const [name, mutateLayout, mutateInclude, reason] of [
    ['nested nav wrapper', text => text.replace('<div class="page-navigation">', '<nav class="page-navigation">').replace('{% include page-navigation.html %}\n                </div>', '{% include page-navigation.html %}\n                </nav>'), text => text, /one page-bottom/],
    ['navigation role on wrapper', text => text.replace('<div class="page-navigation">', '<div class="page-navigation" role="navigation">'), text => text, /one page-bottom/],
    ['unnamed inner landmark', text => text, text => text.replace(' aria-label="Chapter navigation"', ''), /named chapter navigation/],
    ['missing inner landmark', text => text, text => text.replace('<nav class="book-navigation"', '<div class="book-navigation"').replace('</nav>', '</div>'), /one page-bottom/],
    ['duplicate inner landmark', text => text, text => text + '<nav aria-label="Duplicate"></nav>', /one page-bottom/]
  ]) {
    it(`rejects ${name}`, () => {
      assert.throws(() => assertPageNavigationLandmark(mutateLayout(sharedLayout), mutateInclude(pageNavigation)), reason);
    });
  }
});

describe('Navigation Auto-generation', () => {
  let generator;
  let tempDir;
  let testConfig;

  beforeEach(async () => {
    generator = new BookGenerator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'book-navigation-test-'));

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
    if (tempDir) await fs.remove(tempDir);
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
