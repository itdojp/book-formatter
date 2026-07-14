#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { pathToFileURL } from 'url';
import { FileSystemUtils } from '../src/FileSystemUtils.js';

/**
 * 共通コンポーネント同期ツール
 * shared/ ディレクトリのコンポーネントを各書籍プロジェクトに同期
 */
class ComponentSync {
  constructor() {
    this.fsUtils = new FileSystemUtils();
    this.sharedDir = path.join(process.cwd(), 'shared');
    this.version = null;
  }

  /**
   * Map shared component paths to the canonical Jekyll-on-GitHub-Pages layout.
   *
   * shared/ uses neutral folders (layouts/includes/assets) but book repos store
   * them under docs/ with Jekyll conventions (_layouts/_includes/assets).
   */
  mapDestRelativePath(sharedRelPath) {
    const p = String(sharedRelPath).replace(/\\/g, '/');

    if (p.startsWith('layouts/')) {
      return path.join('docs', '_layouts', path.basename(p));
    }
    if (p.startsWith('includes/')) {
      return path.join('docs', '_includes', path.basename(p));
    }
    if (p.startsWith('assets/')) {
      return path.join('docs', p);
    }

    // Fallback (keep relative path)
    return p;
  }

  /**
   * 共通コンポーネントのバージョン情報を読み込む
   */
  async loadVersion() {
    const versionPath = path.join(this.sharedDir, 'version.json');
    
    if (!(await this.fsUtils.exists(versionPath))) {
      throw new Error('shared/version.json が見つかりません');
    }
    
    this.version = await fs.readJson(versionPath);
    console.log(chalk.blue(`📦 Shared components version: ${this.version.version}`));
  }

  /**
   * 書籍の設定を読み込む
   * @param {string} bookPath - 書籍のパス
   */
  async loadBookConfig(bookPath) {
    const configPath = path.join(bookPath, 'book-config.json');
    
    if (!(await this.fsUtils.exists(configPath))) {
      console.log(chalk.yellow(`⚠️  book-config.json が見つかりません: ${bookPath}`));
      return null;
    }
    
    return await fs.readJson(configPath);
  }

  /**
   * 単一の書籍にコンポーネントを同期
   * @param {string} bookPath - 書籍のパス
   * @param {Object} options - オプション
   */
  async syncToBook(bookPath, options = {}) {
    console.log(chalk.blue(`\n📚 同期中: ${path.basename(bookPath)}`));
    
    // 書籍の設定を読み込む
    const bookConfig = await this.loadBookConfig(bookPath);
    if (!bookConfig) return false;
    
    // 同期する コンポーネントを決定
    const componentsToSync = this.determineComponents(bookConfig, options);
    
    // 各コンポーネントを同期
    let componentsChanged = false;
    for (const [component, config] of Object.entries(componentsToSync)) {
      if (config === true || (typeof config === 'object' && Object.values(config).some(v => v))) {
        componentsChanged = (await this.syncComponent(component, bookPath, config)) || componentsChanged;
      }
    }

    // 実ファイルまたは共有component versionが変わった場合だけ同期時刻を更新する。
    // これにより、同一内容への再同期でtimestampだけのPRが作られることを防ぐ。
    const versionChanged = bookConfig.shared?.version !== this.version.version;
    if (componentsChanged || versionChanged) {
      await this.updateBookVersion(bookPath);
    } else {
      console.log(chalk.green('  ✅ 変更はありません'));
    }
    
    console.log(chalk.green(`✅ 同期完了: ${path.basename(bookPath)}`));
    return true;
  }

  /**
   * 同期するコンポーネントを決定
   * @param {Object} bookConfig - 書籍設定
   * @param {Object} options - オプション
   */
  determineComponents(bookConfig, options) {
    // デフォルト設定
    const defaults = {
      layouts: true,
      includes: true,
      assets: { css: true, js: true },
      templates: false
    };
    
    // CLIオプションを明示した場合は、書籍側設定より優先して対象を限定する
    if (options.components) {
      const specified = {};
      options.components.forEach(comp => {
        specified[comp] = true;
      });
      return specified;
    }

    // 書籍の設定を優先
    if (bookConfig.shared?.components) {
      return { ...defaults, ...bookConfig.shared.components };
    }
    
    return defaults;
  }

  /**
   * コンポーネントを同期
   * @param {string} component - コンポーネント名
   * @param {string} bookPath - 書籍パス
   * @param {boolean|Object} config - 設定
   */
  async syncComponent(component, bookPath, config) {
    console.log(chalk.gray(`  同期中: ${component}...`));
    
    const componentInfo = this.version.components[component];
    if (!componentInfo) {
      console.log(chalk.yellow(`  ⚠️  不明なコンポーネント: ${component}`));
      return false;
    }
    
    // ファイルリストを取得
    const files = componentInfo.files || [];
    
    let changed = false;
    for (const file of files) {
      // サブコンポーネントの設定を確認
      if (typeof config === 'object') {
        const subComponent = path.basename(path.dirname(file));
        if (config[subComponent] === false) {
          console.log(chalk.gray(`    スキップ: ${file}`));
          continue;
        }
      }
      
      const sourcePath = path.join(this.sharedDir, file);
      const destRel = this.mapDestRelativePath(file);
      const destPath = path.join(bookPath, destRel);
      
      if (!(await this.fsUtils.exists(sourcePath))) {
        console.log(chalk.yellow(`    ⚠️  ソースファイルが見つかりません: ${file}`));
        continue;
      }

      if (await this.filesAreEqual(sourcePath, destPath)) {
        console.log(chalk.gray(`    ↔ 変更なし: ${destRel}`));
        continue;
      }
      
      // ディレクトリを作成
      await this.fsUtils.ensureDir(path.dirname(destPath));
      
      // ファイルをコピー
      await fs.copy(sourcePath, destPath, { overwrite: true });
      changed = true;
      console.log(chalk.gray(`    ✅ ${destRel}`));
    }

    return changed;
  }

  /**
   * 2つのファイルがbyte単位で同一か確認する。
   * @param {string} sourcePath - 同期元ファイル
   * @param {string} destPath - 同期先ファイル
   */
  async filesAreEqual(sourcePath, destPath) {
    if (!(await this.fsUtils.exists(destPath))) {
      return false;
    }

    const [sourceStat, destStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(destPath)
    ]);
    if (sourceStat.size !== destStat.size) {
      return false;
    }

    const [source, dest] = await Promise.all([
      fs.readFile(sourcePath),
      fs.readFile(destPath)
    ]);
    return source.equals(dest);
  }

  /**
   * 書籍のバージョン情報を更新
   * @param {string} bookPath - 書籍パス
   */
  async updateBookVersion(bookPath) {
    const configPath = path.join(bookPath, 'book-config.json');
    const config = await fs.readJson(configPath);
    
    // shared セクションを更新
    config.shared = config.shared || {};
    config.shared.version = this.version.version;
    config.shared.lastSync = new Date().toISOString();
    
    await fs.writeJson(configPath, config, { spaces: 2 });
  }

  /**
   * すべての書籍に同期
   * @param {Object} options - オプション
   */
  async syncAllBooks(options = {}) {
    const { directory = '..' } = options;
    
    console.log(chalk.blue('🔍 書籍プロジェクトを検索中...'));
    
    // book-config.json を持つディレクトリを検索
    const bookConfigs = await this.fsUtils.listDirectory(directory, {
      pattern: '**/book-config.json',
      recursive: true
    });
    
    const books = bookConfigs
      .map(config => path.dirname(path.join(directory, config)))
      .filter(dir => !dir.includes('book-formatter')); // 自身は除外
    
    console.log(chalk.gray(`${books.length} 個の書籍プロジェクトが見つかりました`));
    
    let successCount = 0;
    
    for (const book of books) {
      try {
        const success = await this.syncToBook(book, options);
        if (success) successCount++;
      } catch (error) {
        console.error(chalk.red(`❌ エラー (${path.basename(book)}): ${error.message}`));
      }
    }
    
    console.log(chalk.bold(`\n📊 同期結果: ${successCount}/${books.length} 成功`));
  }

  /**
   * 差分を確認（dry run）
   * @param {string} bookPath - 書籍パス
   */
  async checkDiff(bookPath, options = {}) {
    console.log(chalk.blue(`\n🔍 差分確認: ${path.basename(bookPath)}`));
    
    const bookConfig = await this.loadBookConfig(bookPath);
    if (!bookConfig) return;
    
    const currentVersion = bookConfig.shared?.version || 'なし';
    console.log(chalk.gray(`  現在のバージョン: ${currentVersion}`));
    console.log(chalk.gray(`  最新バージョン: ${this.version.version}`));
    
    if (currentVersion === this.version.version) {
      console.log(chalk.green('  ✅ 最新です'));
      return;
    }
    
    // 変更されるファイルをリスト
    console.log(chalk.yellow('  📝 変更されるファイル:'));
    
    const componentsToSync = this.determineComponents(bookConfig, options);
    
    for (const [component, config] of Object.entries(componentsToSync)) {
      if (config === true || (typeof config === 'object' && Object.values(config).some(v => v))) {
        const componentInfo = this.version.components[component];
          if (componentInfo) {
            componentInfo.files.forEach(file => {
            console.log(chalk.gray(`    - ${this.mapDestRelativePath(file)}`));
            });
          }
      }
    }
  }
}

// CLIの設定
const program = new Command();

program
  .name('sync-components')
  .description('Sync shared components to book projects')
  .version('1.0.0')
  .option('-b, --book <path>', 'Sync to specific book')
  .option('-a, --all', 'Sync to all books')
  .option('-d, --directory <path>', 'Root directory to search for books', '..')
  .option('-c, --components <components...>', 'Specific components to sync')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action(async (options) => {
    const sync = new ComponentSync();
    
    try {
      // バージョン情報を読み込む
      await sync.loadVersion();
      
      if (options.dryRun) {
        // Dry runモード
        if (options.book) {
          await sync.checkDiff(options.book, options);
        } else if (options.all) {
          const bookConfigs = await sync.fsUtils.listDirectory(options.directory, {
            pattern: '**/book-config.json',
            recursive: true
          });
          
          const books = bookConfigs
            .map(config => path.dirname(path.join(options.directory, config)))
            .filter(dir => !dir.includes('book-formatter'));
          
          for (const book of books) {
            await sync.checkDiff(book, options);
          }
        } else {
          console.error(chalk.red('❌ --book または --all を指定してください'));
          process.exit(1);
        }
      } else {
        // 実際の同期
        if (options.book) {
          await sync.syncToBook(options.book, options);
        } else if (options.all) {
          await sync.syncAllBooks(options);
        } else {
          console.error(chalk.red('❌ --book または --all を指定してください'));
          process.exit(1);
        }
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ エラー: ${error.message}`));
      process.exit(1);
    }
  });

const cliPath = process.argv[1];
const isDirectExecution = cliPath ? import.meta.url === pathToFileURL(cliPath).href : false;
if (isDirectExecution) {
  program.parse();
}

export { ComponentSync };
