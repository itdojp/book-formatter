import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { inspectSharedSearchDocument } from '../src/SharedSearchLayoutGuard.js';
import { searchLayoutCases, searchLayoutPage } from './shared-search-layout-fixtures.js';

for (const value of [undefined, null, {}, { nodeType: 1 }, { nodeType: 9 }]) {
  test(`shared search preflight fails closed without Document: ${JSON.stringify(value)}`, () => {
    assert.throws(() => inspectSharedSearchDocument(value), /real browser Document/);
  });
}

test('guard serializes without Node imports or closure dependencies', () => {
  const fn = vm.runInNewContext(`(${inspectSharedSearchDocument.toString()})`);
  // This is a serialization/diagnostic probe, not evidence of browser geometry.
  const report = fn({ nodeType: 9, querySelectorAll: () => [] });
  assert.equal(report.passed, false);
  assert.equal(report.contractVersion, '1.0.0');
  assert.equal(report.findings.length, 3);
  assert.equal(report.minimumQueryLength, 2);
  const source = fs.readFileSync(new URL('../shared/assets/js/search.js', import.meta.url), 'utf8');
  assert.match(source, /const MIN_QUERY_LENGTH = 2;/, 're-audit guard when the shipped query contract changes');
});

test('native finite fixtures retain unsafe and safe layouts without remote targets', () => {
  assert.equal(new Set(searchLayoutCases.map(item => item.id)).size, searchLayoutCases.length);
  for (const id of ['results-ancestor', 'maxlength1', 'siblings-unlimited', 'siblings-maxlength2', 'siblings-maxlength64']) {
    assert.ok(searchLayoutCases.some(item => item.id === id), id);
  }
  for (const item of searchLayoutCases) {
    const html = searchLayoutPage(item.html);
    assert.ok(html.includes('default-src \'none\''));
    assert.doesNotMatch(html, /https?:\/\//);
  }
});

test('native search-layout gate is mandatory in the existing browser job', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:shared-search-layout-browser'], 'node tests/shared-search-layout-browser.js');
  assert.ok(pkg.scripts.test.includes('tests/SharedSearchLayoutGuard.test.js'));
  const workflow = fs.readFileSync(new URL('../.github/workflows/quality-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /npm run test:shared-search-layout-browser/);
});
