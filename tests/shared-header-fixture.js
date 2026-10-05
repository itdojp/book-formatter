// Bounded native fixtures project the shipped header, not a second DOM layout.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const layout = fs.readFileSync(`${root}shared/layouts/book.html`, 'utf8');
const start = layout.indexOf('// HEADER_LAYOUT_START:');
const end = layout.indexOf('// HEADER_LAYOUT_END', start);
export const headerScript = start >= 0 && end > start ? layout.slice(layout.indexOf('\n', start) + 1, end) : '';
if (!headerScript) throw new Error('shipped header measurement script is absent');

export const widths = [320, 360, 375, 390, 412, 480, 768, 1024, 1366];
export const profiles = [
  { id: 'short', title: 'Linux', localized: false, extra: false, inset: false },
  { id: 'japanese', title: '合成教材：クラウド・ネットワーク・コンテナ基盤の設計と運用を学ぶ実践ガイド', localized: false, extra: true, inset: false },
  { id: 'unbroken', title: 'SyntheticCloudInfrastructureArchitectureAndOperations'.repeat(4), localized: false, extra: true, inset: false },
  { id: 'localized-insets', title: '合成教材：長い書名と操作ラベル', localized: true, extra: true, inset: true }
];

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function headerPage({ profile = profiles[0], theme = 'light', fontSize = 16, css, search = false } = {}) {
  const mobile = fs.readFileSync(`${root}shared/assets/css/mobile-responsive.css`, 'utf8');
  css ??= fs.readFileSync(`${root}shared/assets/css/main.css`, 'utf8');
  css = css.replace('@import url(\'./mobile-responsive.css\');', () => mobile);
  let header = layout.match(/<header class="book-header">[\s\S]*?<\/header>/)?.[0];
  if (!header) throw new Error('shipped header is absent');
  header = header.replace('{{ site.title | escape }}', escape(profile.title))
    .replaceAll(/\{\{[^}]+\}\}/g, '#content');
  if (profile.extra) header = header.replace('</div>\n        </header>', '<a class="fixture-edit" href="#content">Edit</a></div>\n        </header>');
  const themeScript = fs.readFileSync(`${root}shared/assets/js/theme.js`, 'utf8');
  const searchScript = search ? fs.readFileSync(`${root}shared/assets/js/search.js`, 'utf8') : '';
  const searchContent = search ? Array.from({ length: 14 }, (_, index) =>
    `<p data-fixture-index="${index}">学習 ${index}: SyntheticOfflineLearningFixtureWithoutSpaces — 合成教材の検索と操作の確認。</p>`).join('') : '';
  return `<!doctype html><html lang="ja" data-theme="${theme}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}\nhtml { font-size: ${fontSize}px; ${profile.inset ? '--book-safe-area-left: 20px; --book-safe-area-right: 28px;' : ''} }</style>
</head><body><input type="checkbox" id="sidebar-toggle-checkbox" class="sidebar-toggle-checkbox" aria-hidden="true">
<div class="book-layout">${header}<aside class="book-sidebar"></aside><main class="book-main" id="content"><article class="page-content"><h2>合成教材</h2>${searchContent}<p style="min-height:1600px">Offline fixture with normal page scrolling.</p></article></main></div>
<script>
${profile.localized ? `document.querySelector('.theme-toggle').append(document.createTextNode('表示テーマを切り替える長いラベル'));
document.querySelector('.github-link').append(document.createTextNode('書籍リポジトリの変更履歴を確認する'));
document.querySelector('.fixture-edit').textContent = 'このページの原稿を編集する';` : ''}
${headerScript}
</script><script>${themeScript}</script><script>${searchScript}</script></body></html>`;
}

// Read native geometry only: no emulation of CSS layout or search behavior.
// Shared with the separate real-browser-zoom probe.
export function searchPanelProbe() {
  const header = document.querySelector('.book-header');
  const panel = document.querySelector('#search-results');
  const list = panel.querySelector('.search-results-list');
  const box = panel.getBoundingClientRect();
  const controls = [...header.querySelectorAll('a,button,input,[tabindex]')].map(element => {
    const rect = element.getBoundingClientRect();
    if (getComputedStyle(element).display === 'none') return true;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  });
  return {
    active: panel.classList.contains('active'), count: panel.querySelectorAll('.search-result-item').length,
    top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height,
    headerBottom: header.getBoundingClientRect().bottom, viewportHeight: innerHeight,
    belowHeader: box.top >= header.getBoundingClientRect().bottom,
    fits: box.height > 0 && box.bottom <= innerHeight - 4 && box.left >= 4 && box.right <= document.documentElement.clientWidth - 4,
    controlsReachable: controls.every(Boolean),
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth && panel.scrollWidth <= panel.clientWidth,
    outerScrollable: panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY === 'auto',
    innerScrollable: !!list && list.scrollHeight > list.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(list).overflowY)
  };
}
