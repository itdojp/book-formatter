import { test, describe } from 'node:test';
import assert from 'node:assert';
import { UnicodeChecker } from '../src/UnicodeChecker.js';

describe('UnicodeChecker', () => {
  test('REPLACEMENT CHARACTER (U+FFFD) を error として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\uFFFDb', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'error');
    assert.strictEqual(issues[0].codepoint, 'U+FFFD');
    assert.strictEqual(issues[0].line, 1);
    assert.strictEqual(issues[0].column, 2);
  });

  test('不可視文字（ZERO WIDTH SPACE）を error として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\u200Bb', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'error');
    assert.strictEqual(issues[0].codepoint, 'U+200B');
  });

  test('異体字セレクタ（VS16）を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\uFE0Fb', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+FE0F');
  });

  test('CJK互換漢字を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const compat = String.fromCodePoint(0xf900);
    const issues = checker.scanText('a' + compat + 'b', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+F900');
  });

  test('全角英数字を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\uFF11b', 'sample.md'); // FULLWIDTH DIGIT ONE

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+FF11');
  });

  test('allowlist（global）で指定した codepoint を除外する', () => {
    const checker = new UnicodeChecker({ allowlist: { global: ['U+FE0F'] } });
    const issues = checker.scanText('a\uFE0Fb', 'sample.md');

    assert.strictEqual(issues.length, 0);
  });

  test('allowlist（files）で指定した codepoint を対象ファイルのみ除外する', () => {
    const checker = new UnicodeChecker({
      allowlist: {
        files: {
          'a.md': ['U+FE0F']
        }
      }
    });

    assert.strictEqual(checker.scanText('a\uFE0Fb', 'a.md').length, 0);
    assert.strictEqual(checker.scanText('a\uFE0Fb', 'b.md').length, 1);
  });
});
