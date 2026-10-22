import assert from 'node:assert/strict';
import { parse } from 'parse5';

export const iconPaths = {
  icon: '/assets/favicon.ico',
  'apple-touch-icon': '/assets/apple-touch-icon.png'
};

export function iconLinks(html) {
  const result = [];
  function visit(node) {
    if (node.tagName === 'link') {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      if (Object.hasOwn(iconPaths, attrs.rel)) result.push(attrs);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return result;
}

// Inspect generated HTML, not Liquid. The executable Jekyll gate supplies the
// published file set independently from the layout under test.
export function assertIconLinks(html, { layout, baseurl, published }) {
  const expected = Object.entries(iconPaths).filter(([rel, file]) =>
    published.includes(file) && (layout === 'book' || rel === 'icon'));
  const links = iconLinks(html);
  assert.equal(links.length, expected.length, 'optional icon count');
  for (const [rel, file] of expected) {
    const matching = links.filter(link => link.rel === rel);
    assert.equal(matching.length, 1, `one ${rel}`);
    assert.equal(matching[0].href, `${baseurl}${file}`, `${rel} baseurl path`);
    if (rel === 'icon') assert.equal(matching[0].type, 'image/x-icon');
  }
  return links;
}
