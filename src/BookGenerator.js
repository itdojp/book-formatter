import fs from 'fs-extra';
import path from 'path';
import YAML from 'yaml';
import { ConfigValidator } from './ConfigValidator.js';
import { TemplateEngine } from './TemplateEngine.js';
import { FileSystemUtils } from './FileSystemUtils.js';
import { ErrorHandler } from './ErrorHandler.js';
import { GitHubPagesHandler } from './GitHubPagesHandler.js';
import { MobileOptimizer } from './MobileOptimizer.js';

/**
 * 設定駆動型のブック生成システムのメインクラス
 */
export class BookGenerator {
  constructor() {
    this.validator = new ConfigValidator();
    this.templateEngine = new TemplateEngine();
    this.fsUtils = new FileSystemUtils();
    this.errorHandler = new ErrorHandler();
    this.gitHubPagesHandler = new GitHubPagesHandler(this.errorHandler);
    this.mobileOptimizer = new MobileOptimizer();
    
    // Safe file system wrapper
    this.safeFs = this.errorHandler.createSafeFileSystem(fs);
  }

  /**
   * 設定ファイルを読み込み、新しい書籍を生成する
   * @param {string} configPath - 設定ファイルのパス
   * @param {string} outputPath - 出力ディレクトリのパス
   */
  async createBook(configPath, outputPath) {
    this.errorHandler.reset();
    this.errorHandler.setContext('createBook');
    
    return this.errorHandler.safeExecute(async () => {
      // Input validation
      this.errorHandler.validateInput({ configPath, outputPath }, {
        configPath: { required: true, type: 'string' },
        outputPath: { required: true, type: 'string' }
      });

      // 設定ファイルの読み込み
      const config = await this.errorHandler.safeExecute(
        () => this.loadConfig(configPath),
        'loading configuration',
        {
          fallback: () => {
            throw new Error(`設定ファイルを読み込めませんでした: ${configPath}`);
          }
        }
      );
      
      // 設定ファイルのバリデーション
      await this.errorHandler.safeExecute(
        () => this.validator.validate(config),
        'validating configuration'
      );
      
      // 出力ディレクトリの作成
      await this.errorHandler.safeExecute(
        () => this.safeFs.ensureDir(outputPath),
        'creating output directory',
        { retries: 2 }
      );
      
      // ブック構造の生成
      await this.errorHandler.safeExecute(
        () => this.generateBookStructure(config, outputPath),
        'generating book structure',
        { timeout: 10000 }
      );
      
      // ファイルの生成
      await this.errorHandler.safeExecute(
        () => this.generateFiles(config, outputPath),
        'generating files',
        { timeout: 30000 }
      );
      
      const stats = this.errorHandler.getStats();
      if (stats.hasWarnings) {
        console.log(`⚠️  書籍が生成されましたが、${stats.warnings}件の警告があります`);
      }
      
      console.log(`✅ 書籍 "${config.title}" が正常に生成されました`);
      return { success: true, stats };
      
    }, 'book creation', {
      fallback: (error) => {
        const userMessage = this.errorHandler.formatUserError(error);
        console.error('❌ 書籍生成中にエラーが発生しました:', userMessage);
        throw error;
      }
    });
  }

  /**
   * 既存の書籍を更新する
   * @param {string} configPath - 設定ファイルのパス
   * @param {string} bookPath - 書籍のパス
   */
  async updateBook(configPath, bookPath) {
    try {
      const config = await this.loadConfig(configPath);
      this.validator.validate(config);
      
      // 書籍ディレクトリの存在確認
      if (!(await this.fsUtils.exists(bookPath))) {
        throw new Error(`書籍ディレクトリが存在しません: ${bookPath}`);
      }
      
      // 既存ファイルのバックアップ
      await this.fsUtils.createBackup(bookPath);
      
      // 構造の更新
      await this.updateBookStructure(config, bookPath);
      
      // ファイルの更新
      await this.updateFiles(config, bookPath);
      
      console.log(`✅ 書籍 "${config.title}" が正常に更新されました`);
      return true;
    } catch (error) {
      console.error('❌ 書籍更新中にエラーが発生しました:', error.message);
      throw error;
    }
  }

  /**
   * 設定ファイルを読み込む
   * @param {string} configPath - 設定ファイルのパス
   * @returns {Object} 設定オブジェクト
   */
  async loadConfig(configPath) {
    const configContent = await fs.readFile(configPath, 'utf8');
    const ext = path.extname(configPath).toLowerCase();
    
    switch (ext) {
    case '.json':
      return JSON.parse(configContent);
    case '.yml':
    case '.yaml':
      return YAML.parse(configContent);
    default:
      throw new Error(`サポートされていない設定ファイル形式: ${ext}`);
    }
  }

  /**
   * ブック構造を生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateBookStructure(config, outputPath) {
    const structure = config.structure || {};
    
    // 基本ディレクトリの作成
    const directories = [
      'src',
      'assets',
      'assets/css',
      'assets/js',
      'assets/images',
      '_layouts',
      '_includes',
      'templates',
      'scripts',
      'tests'
    ];
    
    for (const dir of directories) {
      await this.fsUtils.ensureDir(path.join(outputPath, dir));
    }
    
    // 章ディレクトリの作成
    if (structure.chapters) {
      for (const chapter of structure.chapters) {
        const chapterDir = path.join(outputPath, 'src', `chapter-${chapter.id}`);
        await this.fsUtils.ensureDir(chapterDir);
      }
    }
    
    // 付録ディレクトリの作成
    if (structure.appendices) {
      const appendixDir = path.join(outputPath, 'src', 'appendices');
      await this.fsUtils.ensureDir(appendixDir);
    }
  }

  /**
   * ファイルを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateFiles(config, outputPath) {
    // メインのインデックスファイル
    await this.generateIndexFile(config, outputPath);
    
    // 設定ファイル
    await this.generateConfigFiles(config, outputPath);
    
    // 章ファイル
    await this.generateChapterFiles(config, outputPath);
    
    // ナビゲーションデータの生成
    await this.generateNavigationData(config, outputPath);
    
    // パッケージファイル
    await this.generatePackageFile(config, outputPath);
    
    // GitHub Pages設定
    if (config.deployment?.platform === 'github-pages') {
      await this.gitHubPagesHandler.setupGitHubPages(config, outputPath);
    }
    
    // モバイル最適化
    if (config.mobile?.enabled !== false) {
      await this.mobileOptimizer.optimizeForMobile(config, outputPath);
    }
    
    // Safe JavaScript設定
    await this.setupSafeJavaScript(config, outputPath);
    
    // テンプレートファイルをコピー
    await this.copyTemplateFiles(outputPath);
  }

  /**
   * インデックスファイルを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateIndexFile(config, outputPath) {
    const indexContent = this.templateEngine.render('index.md', config);
    await fs.writeFile(path.join(outputPath, 'index.md'), indexContent);
  }

  /**
   * 設定ファイルを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateConfigFiles(config, outputPath) {
    // book-config.json
    const bookConfig = {
      title: config.title,
      description: config.description,
      author: config.author,
      version: config.version || '1.0.0',
      structure: config.structure
    };
    
    await fs.writeFile(
      path.join(outputPath, 'book-config.json'),
      JSON.stringify(bookConfig, null, 2)
    );
    
    // _config.yml (Jekyll用) - GitHub Pages用に拡張
    let jekyllConfig;
    if (config.deployment?.platform === 'github-pages') {
      jekyllConfig = this.gitHubPagesHandler.enhanceJekyllConfig(config);
    } else {
      jekyllConfig = this.templateEngine.render('_config.yml', config);
    }
    
    await fs.writeFile(
      path.join(outputPath, '_config.yml'),
      typeof jekyllConfig === 'string' ? jekyllConfig : this.formatYaml(jekyllConfig)
    );
  }

  /**
   * オブジェクトをYAML形式に変換する
   * @param {Object} obj - 変換するオブジェクト
   * @returns {string} YAML文字列
   */
  formatYaml(obj) {
    return YAML.stringify(obj, {
      indent: 2,
      lineWidth: 0,
      quotingType: '"',
      defaultKeyType: null,
      defaultStringType: 'PLAIN'
    });
  }

  /**
   * 章ファイルを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateChapterFiles(config, outputPath) {
    if (!config.structure?.chapters) return;
    
    for (const chapter of config.structure.chapters) {
      const chapterContent = this.templateEngine.render('chapter.md', {
        ...config,
        chapter
      });
      
      const chapterPath = path.join(
        outputPath,
        'src',
        `chapter-${chapter.id}`,
        'index.md'
      );
      
      await fs.writeFile(chapterPath, chapterContent);
    }
  }

  /**
   * パッケージファイルを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generatePackageFile(config, outputPath) {
    // Enhanced package.json with GitHub Pages deployment scripts
    const packageData = {
      name: config.repository?.name || 'book',
      version: config.version || '1.0.0',
      description: config.description || '',
      author: config.author || '',
      license: 'MIT',
      scripts: {
        'build': 'bundle exec jekyll build',
        'serve': 'bundle exec jekyll serve --livereload',
        'deploy': 'npm run build && gh-pages -d _site',
        'deploy-setup': 'gh-pages-clean',
        'validate-deploy': 'node scripts/validate-github-pages.js',
        'pages-status': 'node scripts/check-pages-status.js'
      },
      devDependencies: {
        'gh-pages': '^6.0.0'
      },
      repository: config.repository?.url ? {
        type: 'git',
        url: config.repository.url
      } : undefined,
      homepage: config.deployment?.customDomain 
        ? `https://${config.deployment.customDomain}`
        : config.repository?.owner 
          ? `https://${config.repository.owner}.github.io/${config.repository.name || 'repo'}`
          : undefined
    };

    await fs.writeFile(
      path.join(outputPath, 'package.json'),
      JSON.stringify(packageData, null, 2)
    );
  }

  /**
   * 書籍構造を更新する
   * @param {Object} config - 設定オブジェクト
   * @param {string} bookPath - 書籍のパス
   */
  async updateBookStructure(config, bookPath) {
    // 新しい章が追加された場合の処理
    if (config.structure?.chapters) {
      for (const chapter of config.structure.chapters) {
        const chapterDir = path.join(bookPath, 'src', `chapter-${chapter.id}`);
        if (!(await fs.pathExists(chapterDir))) {
          await this.fsUtils.ensureDir(chapterDir);
          await this.generateChapterFiles(config, bookPath);
        }
      }
    }
  }

  /**
   * ファイルを更新する
   * @param {Object} config - 設定オブジェクト
   * @param {string} bookPath - 書籍のパス
   */
  async updateFiles(config, bookPath) {
    // 設定ファイルの更新
    await this.generateConfigFiles(config, bookPath);
    
    // インデックスファイルの更新
    await this.generateIndexFile(config, bookPath);
    
    // テンプレートファイルを更新
    await this.copyTemplateFiles(bookPath);
  }

  /**
   * テンプレートファイルをコピーする
   * @param {string} outputPath - 出力パス
   */
  async copyTemplateFiles(outputPath) {
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    const sharedPath = path.join(moduleDir, '..', 'shared');
    
    // レイアウトファイルをコピー
    const layoutsSource = path.join(sharedPath, 'layouts');
    const layoutsDest = path.join(outputPath, '_layouts');
    if (await this.fsUtils.exists(layoutsSource)) {
      await this.fsUtils.copyDir(layoutsSource, layoutsDest);
    }
    
    // インクルードファイルをコピー
    const includesSource = path.join(sharedPath, 'includes');
    const includesDest = path.join(outputPath, '_includes');
    if (await this.fsUtils.exists(includesSource)) {
      await this.fsUtils.copyDir(includesSource, includesDest);
    }
    
    // アセットファイルをコピー
    const assetsSource = path.join(sharedPath, 'assets');
    const assetsDest = path.join(outputPath, 'assets');
    if (await this.fsUtils.exists(assetsSource)) {
      await this.fsUtils.copyDir(assetsSource, assetsDest);
    }
  }

  /**
   * ナビゲーションデータを生成する
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async generateNavigationData(config, outputPath) {
    try {
      // _dataディレクトリを作成
      const dataDir = path.join(outputPath, '_data');
      await this.fsUtils.ensureDir(dataDir);

      let navigationOrder = [];

      // config.navigation.order が設定されている場合はそれを使用
      if (config.navigation?.order) {
        navigationOrder = config.navigation.order;
      } else {
        // 設定されていない場合は、構造から自動生成
        navigationOrder = this.generateDefaultNavigationOrder(config);
      }

      // ナビゲーションデータを生成
      const navigationData = {};
      navigationOrder.forEach((pagePath, index) => {
        const prevPath = index > 0 ? navigationOrder[index - 1] : null;
        const nextPath = index < navigationOrder.length - 1 ? navigationOrder[index + 1] : null;
        
        navigationData[pagePath] = {
          previous: prevPath ? {
            path: `/${prevPath}.html`,
            title: this.getPageTitle(config, prevPath)
          } : null,
          next: nextPath ? {
            path: `/${nextPath}.html`, 
            title: this.getPageTitle(config, nextPath)
          } : null,
          index: index,
          total: navigationOrder.length
        };
      });

      // navigation.jsonとして出力
      const navigationFile = path.join(dataDir, 'navigation.json');
      await fs.writeFile(navigationFile, JSON.stringify(navigationData, null, 2));
      
      console.log(`✅ ナビゲーションデータを生成しました: ${navigationOrder.length}ページ`);
    } catch (error) {
      console.error('❌ ナビゲーションデータ生成中にエラーが発生しました:', error.message);
      throw error;
    }
  }

  /**
   * デフォルトのナビゲーション順序を生成する
   * @param {Object} config - 設定オブジェクト
   * @returns {Array} ナビゲーション順序の配列
   */
  generateDefaultNavigationOrder(config) {
    const order = [];
    const structure = config.structure || {};

    // はじめに
    if (structure.introduction) {
      structure.introduction.forEach(intro => {
        if (intro.path) {
          // パスから先頭の "/" を除去し、".html" も除去
          const cleanPath = intro.path.replace(/^\//, '').replace(/\.html$/, '');
          order.push(cleanPath);
        }
      });
    }

    // 各章
    if (structure.chapters) {
      structure.chapters.forEach(chapter => {
        if (chapter.path) {
          const cleanPath = chapter.path.replace(/^\//, '').replace(/\.html$/, '');
          order.push(cleanPath);
        }
      });
    }

    // おわりに
    if (structure.conclusion) {
      structure.conclusion.forEach(concl => {
        if (concl.path) {
          const cleanPath = concl.path.replace(/^\//, '').replace(/\.html$/, '');
          order.push(cleanPath);
        }
      });
    }

    // 付録
    if (structure.appendices) {
      structure.appendices.forEach(appendix => {
        if (appendix.path) {
          const cleanPath = appendix.path.replace(/^\//, '').replace(/\.html$/, '');
          order.push(cleanPath);
        }
      });
    }

    return order;
  }

  /**
   * ページのタイトルを取得する
   * @param {Object} config - 設定オブジェクト
   * @param {string} pagePath - ページパス
   * @returns {string} ページタイトル
   */
  getPageTitle(config, pagePath) {
    const structure = config.structure || {};
    
    // すべてのセクションを検索
    const allSections = [
      ...(structure.introduction || []),
      ...(structure.chapters || []),
      ...(structure.conclusion || []),
      ...(structure.appendices || [])
    ];

    for (const item of allSections) {
      if (item.path) {
        const cleanPath = item.path.replace(/^\//, '').replace(/\.html$/, '');
        if (cleanPath === pagePath) {
          return item.title || pagePath;
        }
      }
    }

    // タイトルが見つからない場合はパスから推測
    return pagePath.replace(/[-_/]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Safe JavaScriptの設定とファイル生成
   * @param {Object} config - 設定オブジェクト
   * @param {string} outputPath - 出力パス
   */
  async setupSafeJavaScript(config, outputPath) {
    return this.errorHandler.safeExecute(async () => {
      const jsDir = path.join(outputPath, 'shared', 'assets', 'js');
      await this.safeFs.ensureDir(jsDir);
      
      // safe-main.jsをコピー
      const safeMainSource = path.join(process.cwd(), 'shared', 'assets', 'js', 'safe-main.js');
      const safeMainDest = path.join(jsDir, 'safe-main.js');
      
      if (await this.safeFs.pathExists(safeMainSource)) {
        await this.safeFs.copy(safeMainSource, safeMainDest);
        console.log('✅ Safe JavaScript file copied');
      } else {
        this.errorHandler.logWarning('safe-main.js not found in source directory');
      }
      
      // 既存のJavaScriptファイルをチェックして問題のあるものを無効化
      const mainJsPath = path.join(jsDir, 'main.js');
      if (await this.safeFs.pathExists(mainJsPath)) {
        const content = await this.safeFs.readFile(mainJsPath);
        
        // 危険なパターンをチェック
        const dangerousPatterns = [
          /while\s*\(\s*true\s*\)/g,
          /for\s*\(\s*;;\s*\)/g,
          /setInterval\s*\([^,]*,\s*[0-9]+\s*\)/g,
          /setTimeout\s*\([^,]*,\s*0\s*\)/g
        ];
        
        let hasDangerousCode = false;
        for (const pattern of dangerousPatterns) {
          if (pattern.test(content)) {
            hasDangerousCode = true;
            break;
          }
        }
        
        if (hasDangerousCode) {
          const backupPath = path.join(jsDir, 'main.js.backup');
          await this.safeFs.copy(mainJsPath, backupPath);
          this.errorHandler.logWarning('Potentially problematic JavaScript detected and backed up');
          
          // main.jsを無効化
          await this.safeFs.writeFile(
            mainJsPath,
            '// This file was disabled due to potentially problematic code\n// Original backed up as main.js.backup\n// Using safe-main.js instead\nconsole.log("Using safe JavaScript implementation");'
          );
        }
      }
    }, 'setupSafeJavaScript');
  }
}