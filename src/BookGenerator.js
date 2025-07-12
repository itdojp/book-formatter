import fs from 'fs-extra';
import path from 'path';
import YAML from 'yaml';
import { ConfigValidator } from './ConfigValidator.js';
import { TemplateEngine } from './TemplateEngine.js';
import { FileSystemUtils } from './FileSystemUtils.js';
import { GitHubPagesHandler } from './GitHubPagesHandler.js';

/**
 * 設定駆動型のブック生成システムのメインクラス
 */
export class BookGenerator {
  constructor() {
    this.validator = new ConfigValidator();
    this.templateEngine = new TemplateEngine();
    this.fsUtils = new FileSystemUtils();
    this.gitHubPagesHandler = new GitHubPagesHandler();
  }

  /**
   * 設定ファイルを読み込み、新しい書籍を生成する
   * @param {string} configPath - 設定ファイルのパス
   * @param {string} outputPath - 出力ディレクトリのパス
   */
  async createBook(configPath, outputPath) {
    try {
      // 設定ファイルの読み込み
      const config = await this.loadConfig(configPath);
      
      // 設定ファイルのバリデーション
      this.validator.validate(config);
      
      // 出力ディレクトリの作成
      await this.fsUtils.ensureDir(outputPath);
      
      // ブック構造の生成
      await this.generateBookStructure(config, outputPath);
      
      // ファイルの生成
      await this.generateFiles(config, outputPath);
      
      console.log(`✅ 書籍 "${config.title}" が正常に生成されました`);
      return true;
    } catch (error) {
      console.error('❌ 書籍生成中にエラーが発生しました:', error.message);
      throw error;
    }
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
    
    // パッケージファイル
    await this.generatePackageFile(config, outputPath);
    
    // GitHub Pages設定
    if (config.deployment?.platform === 'github-pages') {
      await this.gitHubPagesHandler.setupGitHubPages(config, outputPath);
    }
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
  }
}