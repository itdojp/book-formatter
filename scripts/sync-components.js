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
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    const configDestination = await this.assertManagedDestination(
      consumerRoot,
      'book-config.json'
    );

    if (!configDestination.exists) {
      console.log(chalk.yellow(`⚠️  book-config.json が見つかりません: ${consumerRoot}`));
      return null;
    }

    return await fs.readJson(configDestination.absolutePath);
  }

  /**
   * lstat対象が存在しない場合だけnullを返す。
   * dangling symlinkはlstatできるため、存在する境界として呼出側で拒否する。
   * @param {string} targetPath - 検査対象
   * @returns {Promise<import('node:fs').Stats|null>}
   */
  async lstatIfExists(targetPath) {
    try {
      return await fs.lstat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * consumer rootを実在する通常directoryとして確定する。
   * @param {string} bookPath - consumer root候補
   * @returns {Promise<string>} 絶対consumer root
   */
  async assertConsumerRoot(bookPath) {
    if (typeof bookPath !== 'string' || bookPath.trim() === '') {
      throw new Error('Consumer root must be a non-empty path');
    }

    const consumerRoot = path.resolve(bookPath);
    const rootStat = await this.lstatIfExists(consumerRoot);
    if (!rootStat) {
      throw new Error(`Consumer root does not exist: ${consumerRoot}`);
    }
    if (rootStat.isSymbolicLink()) {
      throw new Error(`Consumer root must not be a symbolic link: ${consumerRoot}`);
    }
    if (!rootStat.isDirectory()) {
      throw new Error(`Consumer root must be a directory: ${consumerRoot}`);
    }

    return await fs.realpath(consumerRoot);
  }

  /**
   * managed relative pathをconsumer root配下の絶対pathへ解決する。
   * @param {string} consumerRoot - 検証済みconsumer root
   * @param {string} relativePath - managed relative path
   * @returns {{ relativePath: string, absolutePath: string }}
   */
  resolveManagedDestination(consumerRoot, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || relativePath.includes('\0')) {
      throw new Error('Managed destination must be a non-empty relative path');
    }

    const portablePath = relativePath.replace(/\\/g, '/');
    const pathSegments = portablePath.split('/');
    if (
      path.isAbsolute(relativePath)
      || path.win32.isAbsolute(relativePath)
      || pathSegments.includes('..')
    ) {
      throw new Error(`Managed destination must stay below the consumer root: ${relativePath}`);
    }

    const normalizedRelativePath = path.normalize(relativePath);
    const absolutePath = path.resolve(consumerRoot, normalizedRelativePath);
    const relativeFromRoot = path.relative(consumerRoot, absolutePath);
    if (
      relativeFromRoot === ''
      || relativeFromRoot === '..'
      || relativeFromRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeFromRoot)
    ) {
      throw new Error(`Managed destination escapes the consumer root: ${relativePath}`);
    }

    return {
      relativePath: normalizedRelativePath,
      absolutePath
    };
  }

  /**
   * managed destinationの既存ancestorとfinal pathをlstatし、write境界を検証する。
   * @param {string} bookPath - consumer root
   * @param {string} relativePath - managed relative path
   * @param {{ mustExist?: boolean }} options - final path存在要件
   * @returns {Promise<{ consumerRoot: string, relativePath: string, absolutePath: string, exists: boolean }>}
   */
  async assertManagedDestination(bookPath, relativePath, options = {}) {
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    const destination = this.resolveManagedDestination(consumerRoot, relativePath);
    const relativeFromRoot = path.relative(consumerRoot, destination.absolutePath);
    const segments = relativeFromRoot.split(path.sep);
    let currentPath = consumerRoot;
    let finalStat = null;

    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const currentStat = await this.lstatIfExists(currentPath);
      const isFinal = index === segments.length - 1;

      if (!currentStat) continue;
      if (currentStat.isSymbolicLink()) {
        throw new Error(`Managed destination must not contain a symbolic link: ${relativePath}`);
      }
      if (!isFinal && !currentStat.isDirectory()) {
        throw new Error(`Managed destination ancestor must be a directory: ${relativePath}`);
      }
      if (isFinal) {
        finalStat = currentStat;
        if (!currentStat.isFile()) {
          throw new Error(`Managed destination must be a regular file: ${relativePath}`);
        }
        if (currentStat.nlink > 1) {
          throw new Error(`Managed destination must not be hard-linked: ${relativePath}`);
        }
      }
    }

    if (options.mustExist && !finalStat) {
      throw new Error(`Managed destination does not exist: ${relativePath}`);
    }

    return {
      consumerRoot,
      ...destination,
      exists: Boolean(finalStat)
    };
  }

  /**
   * 単一の書籍にコンポーネントを同期
   * @param {string} bookPath - 書籍のパス
   * @param {Object} options - オプション
   */
  async syncToBook(bookPath, options = {}) {
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    console.log(chalk.blue(`\n📚 同期中: ${path.basename(consumerRoot)}`));
    
    // 書籍の設定を読み込む
    const bookConfig = await this.loadBookConfig(consumerRoot);
    if (!bookConfig) return false;
    
    // 同期する コンポーネントを決定
    const componentsToSync = this.determineComponents(bookConfig, options);
    const syncPlan = this.createSyncPlan(consumerRoot, componentsToSync);

    // 1件目を書き込む前に、選択された全destinationとconfigを検査する。
    await this.preflightSyncPlan(consumerRoot, syncPlan);
    const componentsChanged = await this.executeSyncPlan(consumerRoot, syncPlan);

    // 実ファイルまたは共有component versionが変わった場合だけ同期時刻を更新する。
    // これにより、同一内容への再同期でtimestampだけのPRが作られることを防ぐ。
    const versionChanged = bookConfig.shared?.version !== this.version.version;
    if (componentsChanged || versionChanged) {
      await this.updateBookVersion(consumerRoot);
    } else {
      console.log(chalk.green('  ✅ 変更はありません'));
    }
    
    console.log(chalk.green(`✅ 同期完了: ${path.basename(consumerRoot)}`));
    return true;
  }

  /**
   * component設定から同期対象fileを一意に選択する。
   * @param {string} component - component名
   * @param {boolean|Object} config - component設定
   * @returns {Array<string>}
   */
  selectComponentFiles(component, config) {
    const componentInfo = this.version.components[component];
    if (!componentInfo) {
      console.log(chalk.yellow(`  ⚠️  不明なコンポーネント: ${component}`));
      return [];
    }

    return (componentInfo.files || []).filter((file) => {
      if (typeof config !== 'object') return true;
      const subComponent = path.basename(path.dirname(file));
      if (config[subComponent] === false) {
        console.log(chalk.gray(`    スキップ: ${file}`));
        return false;
      }
      return true;
    });
  }

  /**
   * 同期選択と書込みで共有する有限planを作る。
   * @param {string} consumerRoot - consumer root
   * @param {Object} componentsToSync - component設定
   * @returns {Array<Object>}
   */
  createSyncPlan(consumerRoot, componentsToSync) {
    const syncPlan = [];
    const destinations = new Set();

    for (const [component, config] of Object.entries(componentsToSync)) {
      const enabled = config === true
        || (typeof config === 'object' && Object.values(config).some((value) => value));
      if (!enabled) continue;

      for (const file of this.selectComponentFiles(component, config)) {
        const destination = this.resolveManagedDestination(
          consumerRoot,
          this.mapDestRelativePath(file)
        );
        if (destinations.has(destination.relativePath)) {
          throw new Error(`Duplicate managed destination: ${destination.relativePath}`);
        }
        destinations.add(destination.relativePath);
        syncPlan.push({
          component,
          file,
          sourcePath: path.join(this.sharedDir, file),
          destRel: destination.relativePath,
          destPath: destination.absolutePath
        });
      }
    }

    return syncPlan;
  }

  /**
   * 全destinationを最初のwrite前に検査する。
   * @param {string} consumerRoot - consumer root
   * @param {Array<Object>} syncPlan - 同期plan
   */
  async preflightSyncPlan(consumerRoot, syncPlan) {
    await this.assertManagedDestination(consumerRoot, 'book-config.json', { mustExist: true });
    for (const entry of syncPlan) {
      await this.assertManagedDestination(consumerRoot, entry.destRel);
    }
  }

  /**
   * 検査済みplanを実行する。各write直前にも同じ境界を再検査する。
   * @param {string} consumerRoot - consumer root
   * @param {Array<Object>} syncPlan - 同期plan
   * @returns {Promise<boolean>}
   */
  async executeSyncPlan(consumerRoot, syncPlan) {
    let changed = false;
    let currentComponent = null;

    for (const entry of syncPlan) {
      if (entry.component !== currentComponent) {
        currentComponent = entry.component;
        console.log(chalk.gray(`  同期中: ${entry.component}...`));
      }

      if (!(await this.fsUtils.exists(entry.sourcePath))) {
        console.log(chalk.yellow(`    ⚠️  ソースファイルが見つかりません: ${entry.file}`));
        continue;
      }

      await this.assertManagedDestination(consumerRoot, entry.destRel);
      if (await this.filesAreEqual(entry.sourcePath, entry.destPath)) {
        console.log(chalk.gray(`    ↔ 変更なし: ${entry.destRel}`));
        continue;
      }

      await this.fsUtils.ensureDir(path.dirname(entry.destPath));
      await this.assertManagedDestination(consumerRoot, entry.destRel);
      await fs.copy(entry.sourcePath, entry.destPath, { overwrite: true });
      changed = true;
      console.log(chalk.gray(`    ✅ ${entry.destRel}`));
    }

    return changed;
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
    
    // 書籍の設定を優先する。assetsの部分指定ではschemaの下位既定値を保持する。
    const bookComponents = bookConfig.shared?.components || {};
    const configured = { ...defaults, ...bookComponents };
    if (
      bookComponents.assets
      && typeof bookComponents.assets === 'object'
      && !Array.isArray(bookComponents.assets)
    ) {
      configured.assets = { ...defaults.assets, ...bookComponents.assets };
    }

    // CLIオプションは同期対象を上位component単位で限定するだけで、
    // 書籍側のopt-out（例: assets.js=false、layouts=false）は上書きしない。
    if (options.components) {
      const specified = {};
      options.components.forEach(comp => {
        specified[comp] = Object.prototype.hasOwnProperty.call(configured, comp)
          ? configured[comp]
          : true;
      });
      return specified;
    }

    return configured;
  }

  /**
   * コンポーネントを同期
   * @param {string} component - コンポーネント名
   * @param {string} bookPath - 書籍パス
   * @param {boolean|Object} config - 設定
   */
  async syncComponent(component, bookPath, config) {
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    const syncPlan = this.createSyncPlan(consumerRoot, { [component]: config });
    await this.preflightSyncPlan(consumerRoot, syncPlan);
    return await this.executeSyncPlan(consumerRoot, syncPlan);
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
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    const configDestination = await this.assertManagedDestination(
      consumerRoot,
      'book-config.json',
      { mustExist: true }
    );
    const config = await fs.readJson(configDestination.absolutePath);
    
    // shared セクションを更新
    config.shared = config.shared || {};
    config.shared.version = this.version.version;
    config.shared.lastSync = new Date().toISOString();
    
    await this.assertManagedDestination(consumerRoot, 'book-config.json', { mustExist: true });
    await fs.writeJson(configDestination.absolutePath, config, { spaces: 2 });
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
    const consumerRoot = await this.assertConsumerRoot(bookPath);
    console.log(chalk.blue(`\n🔍 差分確認: ${path.basename(consumerRoot)}`));
    
    const bookConfig = await this.loadBookConfig(consumerRoot);
    if (!bookConfig) return;

    const componentsToSync = this.determineComponents(bookConfig, options);
    const syncPlan = this.createSyncPlan(consumerRoot, componentsToSync);
    await this.preflightSyncPlan(consumerRoot, syncPlan);

    const currentVersion = bookConfig.shared?.version || 'なし';
    console.log(chalk.gray(`  現在のバージョン: ${currentVersion}`));
    console.log(chalk.gray(`  最新バージョン: ${this.version.version}`));
    
    if (currentVersion === this.version.version) {
      console.log(chalk.green('  ✅ 最新です'));
      return;
    }
    
    // 変更されるファイルをリスト
    console.log(chalk.yellow('  📝 変更されるファイル:'));
    
    for (const entry of syncPlan) {
      console.log(chalk.gray(`    - ${entry.destRel}`));
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
