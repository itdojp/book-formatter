import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { BookGenerator } from '../src/BookGenerator.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('BookGenerator', () => {
  let bookGenerator;
  let tempDir;
  let testConfigPath;

  beforeEach(async () => {
    bookGenerator = new BookGenerator();
    tempDir = await fs.mkdtemp(path.join(__dirname, 'tmp-'));
    
    // テスト用設定ファイルの作成
    const testConfig = {
      title: 'テスト書籍',
      description: 'これはテスト用の書籍です',
      author: 'テスト作成者',
      version: '1.0.0',
      language: 'ja',
      structure: {
        chapters: [
          {
            id: 'test-chapter',
            title: 'テスト章',
            description: 'テスト用の章です'
          }
        ],
        appendices: [
          {
            id: 'test-appendix',
            title: 'テスト付録'
          }
        ]
      },
      repository: {
        url: 'https://github.com/test/repo.git',
        branch: 'main'
      }
    };
    
    testConfigPath = path.join(tempDir, 'test-config.json');
    await fs.writeFile(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.remove(tempDir);
    }
  });

  describe('loadConfig', () => {
    test('JSON設定ファイルを正常に読み込む', async () => {
      const config = await bookGenerator.loadConfig(testConfigPath);
      
      assert.strictEqual(config.title, 'テスト書籍');
      assert.strictEqual(config.author, 'テスト作成者');
      assert.strictEqual(config.version, '1.0.0');
    });

    test('YAML設定ファイルを正常に読み込む', async () => {
      const yamlConfigPath = path.join(tempDir, 'test-config.yml');
      const yamlContent = `
title: "YAML書籍"
description: "YAML形式の設定ファイルです"
author: "YAML作成者"
version: "2.0.0"
language: "ja"
`;
      await fs.writeFile(yamlConfigPath, yamlContent);
      
      const config = await bookGenerator.loadConfig(yamlConfigPath);
      
      assert.strictEqual(config.title, 'YAML書籍');
      assert.strictEqual(config.author, 'YAML作成者');
      assert.strictEqual(config.version, '2.0.0');
    });

    test('存在しないファイルの場合エラーを投げる', async () => {
      await assert.rejects(
        bookGenerator.loadConfig('/nonexistent/config.json'),
        /ENOENT/
      );
    });

    test('サポートされていない形式の場合エラーを投げる', async () => {
      const unsupportedPath = path.join(tempDir, 'config.xml');
      await fs.writeFile(unsupportedPath, '<config></config>');
      
      await assert.rejects(
        bookGenerator.loadConfig(unsupportedPath),
        /サポートされていない設定ファイル形式/
      );
    });
  });

  describe('createBook', () => {
    test('新しい書籍を正常に作成する', async () => {
      const outputPath = path.join(tempDir, 'output');
      
      await bookGenerator.createBook(testConfigPath, outputPath);
      
      // 基本ディレクトリが作成されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'assets')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'templates')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_layouts')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_includes')), true);
      
      // 章ディレクトリが作成されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src', 'chapter-test-chapter')), true);
      
      // 付録ディレクトリが作成されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src', 'appendices')), true);
      
      // インデックスファイルが作成されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'index.md')), true);
      
      // 設定ファイルが作成されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'book-config.json')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_config.yml')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'package.json')), true);
      
      // テンプレートファイルがコピーされているかチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_layouts', 'default.html')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_layouts', 'book.html')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, '_includes', 'sidebar-nav.html')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'assets', 'css', 'main.css')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'assets', 'js', 'theme.js')), true);
    });

    test('章ファイルの内容が正しい', async () => {
      const outputPath = path.join(tempDir, 'output');
      
      await bookGenerator.createBook(testConfigPath, outputPath);
      
      const chapterPath = path.join(outputPath, 'src', 'chapter-test-chapter', 'index.md');
      const chapterContent = await fs.readFile(chapterPath, 'utf8');
      
      assert(chapterContent.includes('# テスト章'));
      assert(chapterContent.includes('chapter: test-chapter'));
    });

    test('設定ファイルの内容が正しい', async () => {
      const outputPath = path.join(tempDir, 'output');
      
      await bookGenerator.createBook(testConfigPath, outputPath);
      
      const bookConfigPath = path.join(outputPath, 'book-config.json');
      const bookConfig = JSON.parse(await fs.readFile(bookConfigPath, 'utf8'));
      
      assert.strictEqual(bookConfig.title, 'テスト書籍');
      assert.strictEqual(bookConfig.author, 'テスト作成者');
      assert.strictEqual(bookConfig.version, '1.0.0');
    });

    test('不正な設定ファイルの場合エラーを投げる', async () => {
      const invalidConfigPath = path.join(tempDir, 'invalid-config.json');
      await fs.writeFile(invalidConfigPath, '{}'); // 必須フィールドなし
      
      const outputPath = path.join(tempDir, 'output');
      
      await assert.rejects(
        bookGenerator.createBook(invalidConfigPath, outputPath),
        /必須フィールドが不足/
      );
    });
  });

  describe('updateBook', () => {
    test('既存の書籍を正常に更新する', async () => {
      const bookPath = path.join(tempDir, 'existing-book');
      
      // 既存の書籍を作成
      await bookGenerator.createBook(testConfigPath, bookPath);
      
      // 設定を更新
      const updatedConfig = {
        title: '更新されたテスト書籍',
        description: 'これは更新されたテスト用の書籍です',
        author: '更新された作成者',
        version: '2.0.0',
        language: 'ja',
        structure: {
          chapters: [
            {
              id: 'test-chapter',
              title: '更新されたテスト章',
              description: '更新されたテスト用の章です'
            },
            {
              id: 'new-chapter',
              title: '新しい章',
              description: '新しく追加された章です'
            }
          ]
        }
      };
      
      const updatedConfigPath = path.join(tempDir, 'updated-config.json');
      await fs.writeFile(updatedConfigPath, JSON.stringify(updatedConfig, null, 2));
      
      // 書籍を更新
      await bookGenerator.updateBook(updatedConfigPath, bookPath);
      
      // 新しい章が追加されているかチェック
      assert.strictEqual(await fs.pathExists(path.join(bookPath, 'src', 'chapter-new-chapter')), true);
      
      // 設定ファイルが更新されているかチェック
      const bookConfigPath = path.join(bookPath, 'book-config.json');
      const bookConfig = JSON.parse(await fs.readFile(bookConfigPath, 'utf8'));
      
      assert.strictEqual(bookConfig.title, '更新されたテスト書籍');
      assert.strictEqual(bookConfig.version, '2.0.0');
    });

    test('存在しない書籍パスの場合エラーを投げる', async () => {
      const nonExistentPath = path.join(tempDir, 'nonexistent-book');
      
      await assert.rejects(
        bookGenerator.updateBook(testConfigPath, nonExistentPath),
        /書籍ディレクトリが存在しません/
      );
    });
  });

  describe('generateBookStructure', () => {
    test('基本的なディレクトリ構造を作成する', async () => {
      const outputPath = path.join(tempDir, 'structure-test');
      const config = {
        title: '構造テスト',
        description: '構造テスト用',
        author: 'テスト',
        structure: {
          chapters: [
            { id: 'ch1', title: '章1' },
            { id: 'ch2', title: '章2' }
          ],
          appendices: [
            { id: 'app1', title: '付録1' }
          ]
        }
      };
      
      await bookGenerator.generateBookStructure(config, outputPath);
      
      // 基本ディレクトリのチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'assets')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'templates')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'scripts')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'tests')), true);
      
      // 章ディレクトリのチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src', 'chapter-ch1')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src', 'chapter-ch2')), true);
      
      // 付録ディレクトリのチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src', 'appendices')), true);
    });

    test('構造設定がない場合も基本ディレクトリを作成する', async () => {
      const outputPath = path.join(tempDir, 'no-structure-test');
      const config = {
        title: '構造なしテスト',
        description: '構造なしテスト用',
        author: 'テスト'
      };
      
      await bookGenerator.generateBookStructure(config, outputPath);
      
      // 基本ディレクトリのチェック
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'src')), true);
      assert.strictEqual(await fs.pathExists(path.join(outputPath, 'assets')), true);
    });
  });
});