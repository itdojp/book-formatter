import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { assertIconLinks, iconLinks } from './shared-icons-fixture.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const present = '<link rel="icon" type="image/x-icon" href="/book/assets/favicon.ico">';
const options = { layout: 'book', baseurl: '/book', published: ['/assets/favicon.ico'] };

test('icon output oracle preserves HTML attribute decoding and unrelated links', () => {
  const html = '<link rel="stylesheet" href="/main.css">' + present.replace('/book/', '/book&amp;guide/');
  assertIconLinks(html, { ...options, baseurl: '/book&guide' });
  assert.deepEqual(iconLinks('<html><head></head></html>'), []);
});
for (const [name, html, expected] of [
  ['absent asset emitted', present, { ...options, published: [] }],
  ['present asset omitted', '', options],
  ['baseurl lost', present.replace('/book/', '/'), options],
  ['duplicate icon', present + present, options],
  ['external URL substituted', present.replace('/book/', 'https://asset.example/'), options]
]) test(`icon output oracle rejects ${name}`, () => {
  assert.throws(() => assertIconLinks(html, expected));
});

test('both shipped layouts gate optional paths on published static files', () => {
  for (const layout of ['book', 'default']) {
    const text = read(`shared/layouts/${layout}.html`);
    assert.match(text, /assign shared_favicon_file = site\.static_files \| where: 'path', '\/assets\/favicon\.ico' \| first/);
    assert.match(text, /if shared_favicon_file %}[\s\S]*?<link rel="icon"[^>]+relative_url \| escape[^>]+>[\s\S]*?endif/);
    if (layout === 'book') {
      assert.match(text, /assign shared_touch_icon_file = site\.static_files \| where: 'path', '\/assets\/apple-touch-icon\.png' \| first/);
      assert.match(text, /if shared_touch_icon_file %}[\s\S]*?<link rel="apple-touch-icon"[^>]+relative_url \| escape[^>]+>[\s\S]*?endif/);
    }
  }
});

test('optional consumer icons are not managed branding assets', () => {
  const version = JSON.parse(read('shared/version.json'));
  assert.ok(version.components.layouts.files.includes('layouts/book.html'));
  assert.ok(version.components.layouts.files.includes('layouts/default.html'));
  assert.match(version.components.layouts.version, /^\d+\.\d+\.\d+$/);
  assert.ok(version.components.assets.files.every(file => !/favicon|apple-touch-icon/.test(file)));
});

test('real Jekyll oracle has an explicit mandatory CI gate', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:shared-icons-jekyll'], 'node tests/shared-icons-jekyll.js');
  const workflow = read('.github/workflows/quality-check.yml');
  const step = workflow.match(/- name: Test shared optional icons with Jekyll\n([\s\S]*?)(?=\n {6}- name:)/)?.[1];
  assert.ok(step);
  assert.match(step, /BUNDLE_GEMFILE:.*test-book\/Gemfile/);
  assert.match(step, /run: npm run test:shared-icons-jekyll/);
  assert.doesNotMatch(step, /continue-on-error|\|\||if:/);
});
