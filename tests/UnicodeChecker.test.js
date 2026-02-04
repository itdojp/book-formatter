import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { UnicodeChecker } from '../src/UnicodeChecker.js';

describe('UnicodeChecker', () => {
  let originalConsole;

  beforeEach(() => {
    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn
    };
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  });

  afterEach(() => {
    if (!originalConsole) return;
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
  });

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

  test('NULL文字 (U+0000) を error として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\u0000b', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'error');
    assert.strictEqual(issues[0].kind, 'null-character');
    assert.strictEqual(issues[0].codepoint, 'U+0000');
    assert.strictEqual(issues[0].line, 1);
    assert.strictEqual(issues[0].column, 2);
  });

  test('異体字セレクタ（Variation Selector Supplement）を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const vs = String.fromCodePoint(0xe0100); // VS17
    const issues = checker.scanText('a' + vs + 'b', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+E0100');
  });

  test('CJK互換漢字を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const compat = String.fromCodePoint(0xf900);
    const issues = checker.scanText('a' + compat + 'b', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+F900');
  });

  test('CJK互換漢字（サロゲートペア領域）を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const compat = String.fromCodePoint(0x2f800);
    const issues = checker.scanText('a' + compat + 'b', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+2F800');
  });

  test('全角英数字を warning として検出する', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\uFF11b', 'sample.md'); // FULLWIDTH DIGIT ONE

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].severity, 'warning');
    assert.strictEqual(issues[0].codepoint, 'U+FF11');
  });

  test('allowlist（global）で指定した codepoint を除外する', () => {
    const checker = new UnicodeChecker({ allowlist: { global: ['U+E0100'] } });
    const vs = String.fromCodePoint(0xe0100);
    const issues = checker.scanText('a' + vs + 'b', 'sample.md');

    assert.strictEqual(issues.length, 0);
  });

  test('allowlist（files）で指定した codepoint を対象ファイルのみ除外する', () => {
    const checker = new UnicodeChecker({
      allowlist: {
        files: {
          'a.md': ['U+E0100']
        }
      }
    });

    const vs = String.fromCodePoint(0xe0100);
    assert.strictEqual(checker.scanText('a' + vs + 'b', 'a.md').length, 0);
    assert.strictEqual(checker.scanText('a' + vs + 'b', 'b.md').length, 1);
  });

  test('allowlist（files）はパス区切り（\\\\ /）を正規化して評価する', () => {
    const checker = new UnicodeChecker({
      allowlist: {
        files: {
          'a/b.md': ['U+E0100']
        }
      }
    });

    const vs = String.fromCodePoint(0xe0100);
    assert.strictEqual(checker.scanText('a' + vs + 'b', 'a\\b.md').length, 0);
  });

  test('改行を跨いだ場合の行/列が正しく計測される', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\n\uFFFD', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].line, 2);
    assert.strictEqual(issues[0].column, 1);
  });

  test('CRLF改行を跨いだ場合の行/列が正しく計測される', () => {
    const checker = new UnicodeChecker();
    const issues = checker.scanText('a\r\n\uFFFD', 'sample.md');

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].line, 2);
    assert.strictEqual(issues[0].column, 1);
  });

  test('問題がないテキストは 0 件', () => {
    const checker = new UnicodeChecker();
    assert.strictEqual(checker.scanText('plain text', 'sample.md').length, 0);
  });

  test('空文字列は 0 件', () => {
    const checker = new UnicodeChecker();
    assert.strictEqual(checker.scanText('', 'sample.md').length, 0);
  });
});
