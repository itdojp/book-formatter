import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ConfigValidator } from '../src/ConfigValidator.js';

describe('ConfigValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  describe('validate', () => {
    test('有効な設定を正常にバリデーションする', () => {
      const validConfig = {
        title: '有効な書籍',
        description: '有効な説明',
        author: '有効な作成者',
        version: '1.0.0',
        language: 'ja',
        structure: {
          chapters: [
            {
              id: 'chapter1',
              title: '第1章'
            }
          ]
        }
      };

      assert.doesNotThrow(() => {
        validator.validate(validConfig);
      });
    });

    test('必須フィールドが不足している場合エラーを投げる', () => {
      const invalidConfig = {
        description: '説明のみ'
      };

      assert.throws(() => {
        validator.validate(invalidConfig);
      }, /必須フィールドが不足しています/);
    });

    test('設定がオブジェクトでない場合エラーを投げる', () => {
      assert.throws(() => {
        validator.validate(null);
      }, /設定ファイルが正しくありません/);

      assert.throws(() => {
        validator.validate('string');
      }, /設定ファイルが正しくありません/);
    });
  });

  describe('validateDataTypes', () => {
    test('タイトルが文字列でない場合エラーを投げる', () => {
      const config = {
        title: 123,
        description: '説明',
        author: '作成者'
      };

      assert.throws(() => {
        validator.validate(config);
      }, /title は文字列である必要があります/);
    });

    test('タイトルが長すぎる場合エラーを投げる', () => {
      const config = {
        title: 'a'.repeat(101),
        description: '説明',
        author: '作成者'
      };

      assert.throws(() => {
        validator.validate(config);
      }, /タイトルは100文字以内で入力してください/);
    });

    test('説明が長すぎる場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: 'a'.repeat(501),
        author: '作成者'
      };

      assert.throws(() => {
        validator.validate(config);
      }, /説明は500文字以内で入力してください/);
    });

    test('無効なバージョン形式の場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        version: '1.0'
      };

      assert.throws(() => {
        validator.validate(config);
      }, /バージョンは semantic versioning 形式で入力してください/);
    });
  });

  describe('validateStructure', () => {
    test('章の設定が配列でない場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {
          chapters: 'not an array'
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /chapters は配列である必要があります/);
    });

    test('章にIDがない場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {
          chapters: [
            {
              title: '章タイトル'
            }
          ]
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /章 1: id が必要です/);
    });

    test('章にタイトルがない場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {
          chapters: [
            {
              id: 'chapter1'
            }
          ]
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /章 1: title が必要です/);
    });

    test('章のIDが無効な形式の場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {
          chapters: [
            {
              id: 'Chapter_1!',
              title: '章タイトル'
            }
          ]
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /章 1: id は英小文字、数字、ハイフンのみ使用できます/);
    });

    test('付録の設定が配列でない場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {
          appendices: 'not an array'
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /appendices は配列である必要があります/);
    });
  });

  describe('validateRepository', () => {
    test('リポジトリURLが無効な場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        repository: {
          url: 'invalid-url'
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /repository\.url は有効なURL形式である必要があります/);
    });

    test('リポジトリブランチが文字列でない場合エラーを投げる', () => {
      const config = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        repository: {
          url: 'https://github.com/user/repo.git',
          branch: 123
        }
      };

      assert.throws(() => {
        validator.validate(config);
      }, /repository\.branch は文字列である必要があります/);
    });
  });

  describe('isValidVersion', () => {
    test('有効なsemverバージョンを認識する', () => {
      assert.strictEqual(validator.isValidVersion('1.0.0'), true);
      assert.strictEqual(validator.isValidVersion('0.1.0'), true);
      assert.strictEqual(validator.isValidVersion('1.2.3'), true);
      assert.strictEqual(validator.isValidVersion('1.0.0-alpha'), true);
      assert.strictEqual(validator.isValidVersion('1.0.0+build.1'), true);
    });

    test('無効なバージョンを拒否する', () => {
      assert.strictEqual(validator.isValidVersion('1.0'), false);
      assert.strictEqual(validator.isValidVersion('v1.0.0'), false);
      assert.strictEqual(validator.isValidVersion('1.0.0.0'), false);
      assert.strictEqual(validator.isValidVersion(''), false);
      assert.strictEqual(validator.isValidVersion('latest'), false);
    });
  });

  describe('isValidUrl', () => {
    test('有効なURLを認識する', () => {
      assert.strictEqual(validator.isValidUrl('https://example.com'), true);
      assert.strictEqual(validator.isValidUrl('http://example.com'), true);
      assert.strictEqual(validator.isValidUrl('https://github.com/user/repo.git'), true);
    });

    test('無効なURLを拒否する', () => {
      assert.strictEqual(validator.isValidUrl('not-a-url'), false);
      assert.strictEqual(validator.isValidUrl('ftp://example.com'), true); // ftp is valid
      assert.strictEqual(validator.isValidUrl(''), false);
      assert.strictEqual(validator.isValidUrl('example.com'), false);
    });
  });

  describe('getValidationDetails', () => {
    test('有効な設定の詳細を返す', () => {
      const validConfig = {
        title: '有効な書籍',
        description: '有効な説明',
        author: '有効な作成者',
        version: '1.0.0',
        structure: {
          chapters: [
            {
              id: 'chapter1',
              title: '第1章'
            }
          ]
        },
        repository: {
          url: 'https://github.com/user/repo.git'
        }
      };

      const details = validator.getValidationDetails(validConfig);

      assert.strictEqual(details.isValid, true);
      assert.strictEqual(details.errors.length, 0);
      assert.strictEqual(details.warnings.length, 0);
    });

    test('無効な設定のエラーを返す', () => {
      const invalidConfig = {
        description: '説明のみ'
      };

      const details = validator.getValidationDetails(invalidConfig);

      assert.strictEqual(details.isValid, false);
      assert(details.errors.length > 0);
      assert(details.errors[0].includes('必須フィールドが不足'));
    });

    test('警告を適切に返す', () => {
      const configWithWarnings = {
        title: 'タイトル',
        description: '説明',
        author: '作成者',
        structure: {} // 空の構造
        // version, chapters, repository が不足
      };

      const details = validator.getValidationDetails(configWithWarnings);

      assert.strictEqual(details.isValid, true);
      assert(details.warnings.length > 0);
      assert(details.warnings.some(w => w.includes('章の設定がありません')));
      assert(details.warnings.some(w => w.includes('バージョンが設定されていません')));
      assert(details.warnings.some(w => w.includes('リポジトリ情報が設定されていません')));
    });
  });
});