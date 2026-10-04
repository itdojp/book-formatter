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

export function headerPage({ profile = profiles[0], theme = 'light', fontSize = 16, css } = {}) {
  const mobile = fs.readFileSync(`${root}shared/assets/css/mobile-responsive.css`, 'utf8');
  css ??= fs.readFileSync(`${root}shared/assets/css/main.css`, 'utf8');
  css = css.replace('@import url(\'./mobile-responsive.css\');', () => mobile);
  let header = layout.match(/<header class="book-header">[\s\S]*?<\/header>/)?.[0];
  if (!header) throw new Error('shipped header is absent');
  header = header.replace('{{ site.title | escape }}', escape(profile.title))
    .replaceAll(/\{\{[^}]+\}\}/g, '#content');
  if (profile.extra) header = header.replace('</div>\n        </header>', '<a class="fixture-edit" href="#content">Edit</a></div>\n        </header>');
  const themeScript = fs.readFileSync(`${root}shared/assets/js/theme.js`, 'utf8');
  return `<!doctype html><html lang="ja" data-theme="${theme}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}\nhtml { font-size: ${fontSize}px; ${profile.inset ? '--book-safe-area-left: 20px; --book-safe-area-right: 28px;' : ''} }</style>
</head><body><input type="checkbox" id="sidebar-toggle-checkbox" class="sidebar-toggle-checkbox" aria-hidden="true">
<div class="book-layout">${header}<aside class="book-sidebar"></aside><main class="book-main" id="content"><article class="page-content"><h2>合成教材</h2><p style="min-height:1600px">Offline fixture with normal page scrolling.</p></article></main></div>
<script>
${profile.localized ? `document.querySelector('.theme-toggle').append(document.createTextNode('表示テーマを切り替える長いラベル'));
document.querySelector('.github-link').append(document.createTextNode('書籍リポジトリの変更履歴を確認する'));
document.querySelector('.fixture-edit').textContent = 'このページの原稿を編集する';` : ''}
${headerScript}
</script><script>${themeScript}</script></body></html>`;
}
