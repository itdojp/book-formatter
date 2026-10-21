// Finite projection of shipped markup/controller. Not a Liquid renderer.
import assert from 'node:assert/strict';
import { layout, headerPage, profiles } from './shared-header-fixture.js';

const start = layout.indexOf('// SIDEBAR_CONTROLLER_START:');
const end = layout.indexOf('// SIDEBAR_CONTROLLER_END', start);
assert.ok(start >= 0 && end > start, 'shipped sidebar controller boundaries');
export const sidebarScript = layout.slice(layout.indexOf('\n', start) + 1, end);
export const checkbox = layout.match(/<input[^>]+id="sidebar-toggle-checkbox"[^>]*>/)?.[0];
const overlay = layout.match(/<label[^>]+id="sidebar-overlay"[^>]*><\/label>/)?.[0];
assert.ok(checkbox && overlay, 'shipped checkbox and overlay');

export function sidebarPage({ theme = 'light', profile = profiles[0], script = sidebarScript } = {}) {
  return headerPage({ theme, profile })
    .replace(/<input[^>]+id="sidebar-toggle-checkbox"[^>]*>/, () => checkbox)
    .replace('<aside class="book-sidebar"></aside>', `<aside class="book-sidebar" id="sidebar"><nav aria-label="Main navigation">
<a class="toc-link" href="#content">First synthetic chapter</a>
<div style="height:1200px" aria-hidden="true"></div>
<a class="toc-link active" href="#content">Active synthetic chapter</a>
</nav></aside>`)
    .replace('<h2>合成教材</h2>', '<h2>合成教材</h2><a id="after-sidebar" href="#content">Continue reading</a>')
    .replace('</body>', () => `${overlay}<script>${script}</script></body>`);
}
