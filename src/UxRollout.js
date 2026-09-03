import fs from 'fs-extra';
import path from 'path';
import YAML from 'yaml';
import chalk from 'chalk';
import { ConfigValidator } from './ConfigValidator.js';
import { FileSystemUtils } from './FileSystemUtils.js';
import { ComponentSync } from '../scripts/sync-components.js';
import { ConsumerMutationBoundary, ConsumerMutationError } from './ConsumerMutationBoundary.js';

const PROFILE_MUTATION_TOKEN = Symbol('profile-mutation-token');
const CORE_MUTATION_TOKEN = Symbol('core-mutation-token');

/**
 * 既存書籍にUX設定/共通コアを段階適用するロールアウトユーティリティ
 */
export class UxRollout {
  /**
   * @param {Object} options - 依存の初期化オプション
   */
  constructor(options = {}) {
    this.fsUtils = new FileSystemUtils();
    this.componentSync = options.componentSync || new ComponentSync();
    this.mutationBoundary = options.mutationBoundary || new ConsumerMutationBoundary({
      componentSync: this.componentSync
    });
    this.configValidator = new ConfigValidator();
  }

  /**
   * レジストリファイルを読み込む
   * @param {string} registryPath - レジストリのパス（json/yaml）
   * @returns {Promise<Object>} レジストリオブジェクト
   */
  async loadRegistry(registryPath) {
    const resolvedPath = path.resolve(registryPath);
    if (!(await this.fsUtils.exists(resolvedPath))) {
      throw new Error(`レジストリが見つかりません: ${resolvedPath}`);
    }

    const content = await fs.readFile(resolvedPath, 'utf8');
    return this.parseRegistryContent(content, resolvedPath);
  }

  /**
   * 固定済みレジストリ内容を拡張子に従って解析する。
   * @param {string|Buffer} content - レジストリ内容
   * @param {string} registryPath - レジストリpath
   * @returns {Object} レジストリオブジェクト
   */
  parseRegistryContent(content, registryPath) {
    const resolvedPath = path.resolve(registryPath);
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    const ext = path.extname(resolvedPath).toLowerCase();

    if (ext === '.yml' || ext === '.yaml') {
      return YAML.parse(text);
    }

    if (ext === '.json') {
      return JSON.parse(text);
    }

    throw new Error(`サポートされていないレジストリ形式: ${ext}`);
  }

  /**
   * レジストリの形式を正規化する
   * @param {Object} registry - レジストリ
   * @returns {Object} 正規化後のレジストリ
   */
  normalizeRegistry(registry) {
    if (!registry || typeof registry !== 'object') {
      throw new Error('レジストリ形式が不正です');
    }

    if (!registry.books) {
      throw new Error('レジストリに books がありません');
    }

    if (Array.isArray(registry.books)) {
      const mapped = {};
      for (const entry of registry.books) {
        if (!entry || typeof entry !== 'object') continue;
        const key = entry.name || entry.repo || entry.repository;
        if (key) {
          mapped[key.replace(/^itdojp\//, '')] = entry;
        }
      }
      registry.books = mapped;
    }

    return registry;
  }

  /**
   * 書籍一覧を取得する
   * @param {string} directory - 探索ルート
   * @param {string} pattern - book-config.json のパターン
   * @returns {Promise<string[]>} 書籍ディレクトリ配列
   */
  async listBooks(directory, pattern) {
    const configFiles = await this.fsUtils.listDirectory(directory, {
      recursive: true,
      pattern,
      filesOnly: true
    });

    return configFiles
      .map(configFile => path.dirname(path.join(directory, configFile)))
      .filter(dir => !dir.includes('book-formatter'));
  }

  /**
   * レジストリエントリを解決する
   * @param {string} bookPath - 書籍パス
   * @param {Object|null} config - book-config の内容
   * @param {Object} registry - レジストリ
   * @param {string|null} consumerId - 監査済みplanのconsumer ID
   * @returns {{key: string, entry: Object}|null} 解決結果
   */
  resolveRegistryEntry(bookPath, config, registry, consumerId = null) {
    const books = registry.books || {};
    const bookName = path.basename(bookPath);

    if (consumerId) {
      if (books[consumerId]) {
        return { key: consumerId, entry: books[consumerId] };
      }
      console.warn(
        chalk.yellow(`  ⚠️  監査済みconsumer IDのレジストリエントリがありません: ${consumerId}`)
      );
      return null;
    }

    if (books[bookName]) {
      return { key: bookName, entry: books[bookName] };
    }

    const repoName = this.extractRepoName(config?.repository?.url);
    if (repoName && books[repoName]) {
      return { key: repoName, entry: books[repoName] };
    }

    for (const [key, entry] of Object.entries(books)) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.repo && typeof entry.repo === 'string') {
        const normalized = entry.repo.replace(/^itdojp\//, '');
        if (normalized === bookName || normalized === repoName) {
          return { key, entry };
        }
      }
    }

    const repoUrl = config?.repository?.url;
    const repoInfo = repoUrl ? `, repository URL="${repoUrl}"` : '';
    console.warn(
      chalk.yellow(
        `  ⚠️  レジストリエントリが見つかりません: bookPath="${bookPath}", bookName="${bookName}"${repoInfo}`
      )
    );
    return null;
  }

  /**
   * リポジトリURLからリポジトリ名を抽出する
   * @param {string} repoUrl - リポジトリURL
   * @returns {string|null} リポジトリ名
   */
  extractRepoName(repoUrl) {
    if (!repoUrl || typeof repoUrl !== 'string') return null;
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    return match[2].replace(/\.git$/, '');
  }

  /**
   * book-config.json に ux 情報を反映する
   * @param {string} bookPath - 書籍パス
   * @param {Object} entry - レジストリエントリ
   * @param {Object} options - 実行オプション
   * @returns {Promise<{updated: boolean, skipped: boolean}>} 結果
   */
  async updateBookConfig(bookPath, entry, options = {}) {
    if (options.mutationToken !== PROFILE_MUTATION_TOKEN) {
      throw new ConsumerMutationError(
        'UX profile writes require the audited consumer transaction'
      );
    }
    const configPath = path.join(bookPath, 'book-config.json');
    if (!(await this.fsUtils.exists(configPath))) {
      throw new ConsumerMutationError(`book-config.json is required: ${bookPath}`);
    }

    const config = await fs.readJson(configPath);
    const nextUx = {
      profile: entry.profile,
      modules: entry.modules
    };

    try {
      // レジストリ由来の ux 設定を事前に検証し、無効な設定を書き込まない。
      this.configValidator.validateUx({ ux: nextUx });
    } catch (error) {
      throw new ConsumerMutationError(
        `Legacy UX registry entry is invalid: ${error.message}`,
        { cause: error }
      );
    }

    const currentUx = config.ux || null;
    const isSame = currentUx && JSON.stringify(currentUx) === JSON.stringify(nextUx);
    if (isSame) {
      console.log(chalk.gray('  - ux 設定は既に最新です'));
      return { updated: false, skipped: true };
    }

    if (options.dryRun) {
      console.log(chalk.yellow(`  [DRY RUN] ux を更新します: ${configPath}`));
      console.log(chalk.gray(`    profile: ${currentUx?.profile || '未設定'} -> ${nextUx.profile}`));
      return { updated: false, skipped: false };
    }

    const updatedConfig = { ...config, ux: nextUx };
    await fs.writeJson(configPath, updatedConfig, { spaces: 2 });
    console.log(chalk.green(`  ✅ ux を更新しました: ${configPath}`));
    return { updated: true, skipped: false };
  }

  /**
   * 共通コア（layouts/includes/assets）を適用する
   * @param {string} bookPath - 書籍パス
   * @param {Object} options - 実行オプション
   * @returns {Promise<void>}
   */
  async applyUxCore(bookPath, options = {}) {
    if (options.mutationToken !== CORE_MUTATION_TOKEN) {
      throw new ConsumerMutationError(
        'UX core writes require the audited consumer transaction'
      );
    }
    if (options.dryRun) {
      await this.componentSync.checkDiff(bookPath, { components: ['layouts', 'includes', 'assets'] });
      return;
    }

    await this.componentSync.syncToBook(bookPath, { components: ['layouts', 'includes', 'assets'] });
  }

  /**
   * ロールアウトを実行する
   * @param {Object} options - 実行オプション
   * @returns {Promise<void>}
   */
  async rollout(options) {
    const {
      plan,
      consumers,
      registryPath,
      applyUxCore,
      applyUxProfile,
      dryRun
    } = options;

    if (!applyUxCore && !applyUxProfile) {
      throw new Error('--apply-ux-core もしくは --apply-ux-profile を指定してください');
    }
    if (!plan || !Array.isArray(consumers) || consumers.length === 0) {
      throw new ConsumerMutationError(
        'rollout requires a finite audited plan and explicit consumer selection'
      );
    }
    if (!dryRun && consumers.length !== 1) {
      throw new ConsumerMutationError(
        'UX rollout write mode requires exactly one consumer target'
      );
    }
    const expectedOperation = applyUxCore && applyUxProfile
      ? 'rollout-ux-core-profile'
      : applyUxCore
        ? 'rollout-ux-core'
        : 'rollout-ux-profile';
    if (plan.operation !== expectedOperation) {
      throw new ConsumerMutationError(
        `rollout does not accept plan.operation=${plan.operation}; expected ${expectedOperation}`
      );
    }

    let registry = null;
    if (applyUxProfile) {
      const pinnedRegistry = await this.mutationBoundary.loadPinnedRegistry(plan, registryPath);
      registry = this.normalizeRegistry(
        this.parseRegistryContent(pinnedRegistry.content, pinnedRegistry.path)
      );
    } else if (registryPath) {
      throw new ConsumerMutationError('--registry is only valid with --apply-ux-profile');
    }

    if (applyUxCore) {
      await this.componentSync.loadVersion();
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const consumer of consumers) {
      const bookPath = consumer.worktree;
      const bookName = path.basename(bookPath);
      console.log(chalk.blue(`\n📚 処理中: ${bookName}`));

      const config = await this.componentSync.loadBookConfig(bookPath);
      if (!config) {
        throw new ConsumerMutationError(`book-config.json is required for ${consumer.id}`);
      }

      let registryEntry = null;
      if (registry) {
        const resolved = this.resolveRegistryEntry(
          bookPath,
          config,
          registry,
          consumer.id
        );
        if (resolved) {
          registryEntry = resolved.entry;
        } else {
          throw new ConsumerMutationError(
            `Legacy UX registry entry is required for ${consumer.id}`
          );
        }
      }
      if (applyUxProfile && registryEntry) {
        try {
          this.configValidator.validateUx({
            ux: {
              profile: registryEntry.profile,
              modules: registryEntry.modules
            }
          });
        } catch (error) {
          throw new ConsumerMutationError(
            `Legacy UX registry entry is invalid for ${consumer.id}: ${error.message}`,
            { cause: error }
          );
        }
      }

      const managedPaths = new Set();
      if (applyUxProfile) managedPaths.add('book-config.json');
      if (applyUxCore) {
        const components = this.componentSync.determineComponents(config, {
          components: ['layouts', 'includes', 'assets']
        });
        const syncPlan = this.componentSync.createSyncPlan(bookPath, components);
        managedPaths.add('book-config.json');
        for (const entry of syncPlan) managedPaths.add(entry.destRel.split(path.sep).join('/'));
      }

      const mutationResult = await this.mutationBoundary.run({
        plan,
        consumer,
        managedPaths: [...managedPaths],
        dryRun,
        mutate: async () => {
          if (applyUxProfile && registryEntry) {
            await this.updateBookConfig(bookPath, registryEntry, {
              dryRun: false,
              backup: false,
              mutationToken: PROFILE_MUTATION_TOKEN
            });
          }
          if (applyUxCore) {
            await this.applyUxCore(bookPath, {
              dryRun: false,
              mutationToken: CORE_MUTATION_TOKEN
            });
          }
        }
      });

      if (dryRun) {
        console.log(chalk.yellow(
          `  [DRY RUN] ${mutationResult.managedPaths.length} managed path(s)を検証しました`
        ));
        for (const managedPath of mutationResult.managedPaths) {
          console.log(chalk.gray(`    - ${managedPath}`));
        }
        updatedCount++;
      } else if (mutationResult.changedPaths.length > 0) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(chalk.blue('\n📊 ロールアウト結果:'));
    console.log(chalk.green(`  ${dryRun ? '更新(予定)' : '更新'}: ${updatedCount}`));
    console.log(chalk.gray(`  スキップ: ${skippedCount}`));
  }
}
