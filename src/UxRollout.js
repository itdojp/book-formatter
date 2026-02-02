import fs from 'fs-extra';
import path from 'path';
import YAML from 'yaml';
import chalk from 'chalk';
import { FileSystemUtils } from './FileSystemUtils.js';
import { ComponentSync } from '../scripts/sync-components.js';

export class UxRollout {
  constructor() {
    this.fsUtils = new FileSystemUtils();
    this.componentSync = new ComponentSync();
  }

  async loadRegistry(registryPath) {
    const resolvedPath = path.resolve(registryPath);
    if (!(await this.fsUtils.exists(resolvedPath))) {
      throw new Error(`レジストリが見つかりません: ${resolvedPath}`);
    }

    const content = await fs.readFile(resolvedPath, 'utf8');
    const ext = path.extname(resolvedPath).toLowerCase();

    if (ext === '.yml' || ext === '.yaml') {
      return YAML.parse(content);
    }

    if (ext === '.json') {
      return JSON.parse(content);
    }

    throw new Error(`サポートされていないレジストリ形式: ${ext}`);
  }

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

  resolveRegistryEntry(bookPath, config, registry) {
    const books = registry.books || {};
    const bookName = path.basename(bookPath);

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

    return null;
  }

  extractRepoName(repoUrl) {
    if (!repoUrl || typeof repoUrl !== 'string') return null;
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    return match[2].replace(/\.git$/, '');
  }

  async updateBookConfig(bookPath, entry, options) {
    const configPath = path.join(bookPath, 'book-config.json');
    if (!(await this.fsUtils.exists(configPath))) {
      console.log(chalk.yellow(`⚠️  book-config.json が見つかりません: ${bookPath}`));
      return { updated: false, skipped: true };
    }

    const config = await fs.readJson(configPath);
    const nextUx = {
      profile: entry.profile,
      modules: entry.modules
    };

    const currentUx = config.ux || null;
    const isSame = currentUx && JSON.stringify(currentUx) === JSON.stringify(nextUx);
    if (isSame) {
      console.log(chalk.gray(`  - ux 設定は既に最新です`));
      return { updated: false, skipped: true };
    }

    if (options.dryRun) {
      console.log(chalk.yellow(`  [DRY RUN] ux を更新します: ${configPath}`));
      console.log(chalk.gray(`    profile: ${currentUx?.profile || '未設定'} -> ${nextUx.profile}`));
      return { updated: false, skipped: false };
    }

    if (options.backup !== false) {
      await this.fsUtils.createBackup(configPath);
    }

    const updatedConfig = { ...config, ux: nextUx };
    await fs.writeJson(configPath, updatedConfig, { spaces: 2 });
    console.log(chalk.green(`  ✅ ux を更新しました: ${configPath}`));
    return { updated: true, skipped: false };
  }

  async applyUxCore(bookPath, options) {
    if (options.dryRun) {
      await this.componentSync.checkDiff(bookPath, { components: ['layouts', 'includes', 'assets'] });
      return;
    }

    await this.componentSync.syncToBook(bookPath, { components: ['layouts', 'includes', 'assets'] });
  }

  async rollout(options) {
    const { directory, pattern, registryPath, applyUxCore, applyUxProfile, dryRun } = options;

    if (!applyUxCore && !applyUxProfile) {
      throw new Error('--apply-ux-core もしくは --apply-ux-profile を指定してください');
    }

    let registry = null;
    if (registryPath) {
      registry = this.normalizeRegistry(await this.loadRegistry(registryPath));
    } else if (applyUxProfile) {
      throw new Error('--apply-ux-profile を指定する場合は --registry が必要です');
    }

    const books = await this.listBooks(directory, pattern);
    if (books.length === 0) {
      console.log(chalk.yellow('⚠️  対象書籍が見つかりませんでした'));
      return;
    }

    if (applyUxCore) {
      await this.componentSync.loadVersion();
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let missingRegistry = 0;

    for (const bookPath of books) {
      const bookName = path.basename(bookPath);
      console.log(chalk.blue(`\n📚 処理中: ${bookName}`));

      const configPath = path.join(bookPath, 'book-config.json');
      const config = await (await this.fsUtils.exists(configPath) ? fs.readJson(configPath) : null);

      let registryEntry = null;
      if (registry) {
        const resolved = this.resolveRegistryEntry(bookPath, config, registry);
        if (resolved) {
          registryEntry = resolved.entry;
        } else {
          console.log(chalk.yellow('  ⚠️  レジストリに該当エントリがありません。スキップします。'));
          missingRegistry++;
          skippedCount++;
          continue;
        }
      }

      if (applyUxProfile && registryEntry) {
        const result = await this.updateBookConfig(bookPath, registryEntry, {
          backup: options.backup,
          dryRun
        });
        if (result.updated) updatedCount++;
        if (result.skipped) skippedCount++;
      }

      if (applyUxCore) {
        await this.applyUxCore(bookPath, { dryRun });
      }
    }

    console.log(chalk.blue('\n📊 ロールアウト結果:'));
    console.log(chalk.green(`  更新: ${updatedCount}`));
    console.log(chalk.gray(`  スキップ: ${skippedCount}`));
    if (registry && missingRegistry > 0) {
      console.log(chalk.yellow(`  レジストリ未登録: ${missingRegistry}`));
    }
  }
}
