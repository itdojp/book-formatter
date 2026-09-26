import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { ConfigValidator } from './ConfigValidator.js';
import { validateStandardBook } from './StandardBookValidator.js';
import { TemplateEngine } from './TemplateEngine.js';
import { FORMATTER_ROOT, detectDiagnosticTarget, matchesNodeEngine, requireDiagnosticFile } from './DiagnosticContracts.js';

/**
 * Comprehensive diagnostic tool for book-formatter
 * Provides system health checks, configuration validation, and troubleshooting
 */

export class DiagnosticTool {
  constructor() {
    this.checks = [];
    this.results = {
      passed: 0,
      warnings: 0,
      errors: 0,
      criticalErrors: 0,
      details: []
    };
  }

  /**
   * Run all diagnostic checks
   * @param {string} projectPath - Path to the book project
   * @returns {Object} Diagnostic results
   */
  async runDiagnostics(projectPath = process.cwd()) {
    console.log('🔍 Book Formatter 診断ツールを開始します...\n');

    // Reset results
    this.results = {
      passed: 0,
      warnings: 0,
      errors: 0,
      criticalErrors: 0,
      details: []
    };

    this.projectPath = path.resolve(projectPath);
    this.target = null;
    try {
      this.target = await detectDiagnosticTarget(this.projectPath);
    } catch (error) {
      this.addResult('error', '診断対象 / package.json', error.message);
      this.generateSummary();
      return this.results;
    }
    projectPath = this.target.root;

    try {
      this.addResult('info', '診断対象形式', this.target.kind);
      // System environment checks
      await this.checkSystemEnvironment();
      
      // Node.js environment checks
      await this.checkNodeEnvironment();
      
      if (this.target.kind === 'formatter') {
        await this.checkProjectStructure(projectPath);
        await this.checkConfigurationFiles(projectPath);
        await this.checkDependencies(projectPath);
        await this.checkTemplateFiles(projectPath);
        await this.checkBuildSystem(projectPath);
        await this.checkGitHubIntegration(projectPath);
        await this.checkPerformance(projectPath);
      } else {
        await this.checkBookTarget(this.target);
      }

      // Generate summary
      this.generateSummary();
      
      return this.results;
      
    } catch (error) {
      this.addResult('critical', 'システムエラー', `診断中に予期しないエラーが発生しました: ${error.message}`, {
        error: error.stack
      });
      return this.results;
    }
  }

  /**
   * Check system environment
   */
  async checkSystemEnvironment() {
    console.log('📊 システム環境をチェックしています...');

    // Operating system
    const platform = os.platform();
    const arch = os.arch();
    const release = os.release();
    
    this.addResult('info', 'オペレーティングシステム', 
      `${platform} ${arch} (${release})`, { platform, arch, release });

    // Memory usage
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;

    if (memoryUsagePercent > 90) {
      this.addResult('warning', 'メモリ使用量', 
        `メモリ使用量が高いです: ${memoryUsagePercent.toFixed(1)}%`);
    } else {
      this.addResult('pass', 'メモリ使用量', 
        `正常です: ${memoryUsagePercent.toFixed(1)}% 使用中`);
    }

    // Disk space (for the current directory)
    try {
      const stats = await fs.stat(process.cwd());
      this.addResult('pass', 'ディスクアクセス', 'ファイルシステムへのアクセスが正常です');
    } catch (error) {
      this.addResult('error', 'ディスクアクセス', 
        `ファイルシステムアクセスエラー: ${error.message}`);
    }
  }

  /**
   * Check Node.js environment
   */
  async checkNodeEnvironment(nodeVersion = process.version) {
    console.log('⚡ Node.js環境をチェックしています...');

    // Read the running formatter's contract, never the consumer's engines.
    try {
      const { engines } = await fs.readJson(path.join(FORMATTER_ROOT, 'package.json'));
      const supported = matchesNodeEngine(nodeVersion, engines?.node);
      this.addResult(supported ? 'pass' : 'error', 'Node.jsバージョン',
        `Node.js ${nodeVersion}: formatter engines.node = ${engines?.node}`);
    } catch (error) {
      this.addResult('error', 'Node.jsバージョン', `対応範囲を判定できません: ${error.message}`);
    }

    // npm version
    try {
      const { execSync } = await import('child_process');
      const npmVersion = execSync('npm --version', { encoding: 'utf8', timeout: 10000 }).trim();
      this.addResult('pass', 'npmバージョン', `npm ${npmVersion} が利用可能です`);
    } catch (error) {
      this.addResult('warning', 'npmバージョン', 'npmバージョンの確認に失敗しました');
    }

    // Environment variables
    const envVars = ['NODE_ENV', 'PATH'];
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        this.addResult('pass', `環境変数 ${envVar}`, '設定されています');
      } else {
        this.addResult('info', `環境変数 ${envVar}`, '設定されていません（必須ではありません）');
      }
    }
  }

  /**
   * Check project structure
   */
  async checkProjectStructure(projectPath) {
    console.log('📁 プロジェクト構造をチェックしています...');

    const expectedDirs = [
      { path: 'src', required: true, description: 'ソースコード' },
      { path: 'tests', required: true, description: 'テストファイル' },
      { path: 'shared', required: true, description: '共有リソース' },
      { path: 'scripts', required: false, description: 'スクリプト' },
      { path: 'docs', required: false, description: 'ドキュメント' }
    ];

    for (const dir of expectedDirs) {
      const dirPath = path.join(projectPath, dir.path);
      
      if (await fs.pathExists(dirPath)) {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          this.addResult('pass', `ディレクトリ ${dir.path}`, 
            `${dir.description}ディレクトリが存在します`);
        } else {
          this.addResult('error', `ディレクトリ ${dir.path}`, 
            `${dir.path} はディレクトリではありません`);
        }
      } else if (dir.required) {
        this.addResult('error', `ディレクトリ ${dir.path}`, 
          `必須の${dir.description}ディレクトリが見つかりません`);
      } else {
        this.addResult('info', `ディレクトリ ${dir.path}`, 
          `オプションの${dir.description}ディレクトリが見つかりません`);
      }
    }

    // Check for common files
    const expectedFiles = [
      { path: 'package.json', required: true, description: 'パッケージ設定' },
      { path: 'README.md', required: false, description: 'プロジェクト説明' },
      { path: '.gitignore', required: false, description: 'Git除外設定' }
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(projectPath, file.path);
      
      if (await fs.pathExists(filePath)) {
        this.addResult('pass', `ファイル ${file.path}`, 
          `${file.description}ファイルが存在します`);
      } else if (file.required) {
        this.addResult('error', `ファイル ${file.path}`, 
          `必須の${file.description}ファイルが見つかりません`);
      } else {
        this.addResult('info', `ファイル ${file.path}`, 
          `${file.description}ファイルが見つかりません`);
      }
    }
  }

  /**
   * Check configuration files
   */
  async checkConfigurationFiles(projectPath) {
    console.log('⚙️  設定ファイルをチェックしています...');

    // Check package.json
    const packagePath = path.join(projectPath, 'package.json');
    if (await fs.pathExists(packagePath)) {
      try {
        const packageData = await fs.readJson(packagePath);
        
        // Check required fields
        const requiredFields = ['name', 'version', 'description'];
        for (const field of requiredFields) {
          if (packageData[field]) {
            this.addResult('pass', `package.json ${field}`, '設定されています');
          } else {
            this.addResult('warning', `package.json ${field}`, '設定されていません');
          }
        }

        // Check scripts
        if (packageData.scripts) {
          const importantScripts = ['test', 'build'];
          for (const script of importantScripts) {
            if (packageData.scripts[script]) {
              this.addResult('pass', `npm script ${script}`, '定義されています');
            } else {
              this.addResult('warning', `npm script ${script}`, '定義されていません');
            }
          }
        } else {
          this.addResult('warning', 'npm scripts', 'スクリプトが定義されていません');
        }

        // Check dependencies
        const deps = { ...packageData.dependencies, ...packageData.devDependencies };
        const importantDeps = ['fs-extra', 'yaml'];
        for (const dep of importantDeps) {
          if (deps[dep]) {
            this.addResult('pass', `依存関係 ${dep}`, '定義されています');
          } else {
            this.addResult('warning', `依存関係 ${dep}`, '定義されていません');
          }
        }

      } catch (error) {
        this.addResult('error', 'package.json 解析', 
          `package.jsonの解析に失敗しました: ${error.message}`);
      }
    }

    // Check for book configuration examples
    const configExamples = ['examples/standard-book/book.yaml'];
    let foundExample = false;
    
    for (const example of configExamples) {
      const examplePath = path.join(projectPath, example);
      if (await fs.pathExists(examplePath)) {
        this.addResult('pass', `設定例 ${example}`, '設定例ファイルが存在します');
        foundExample = true;
      }
    }

    if (!foundExample) {
      this.addResult('warning', '設定例ファイル', 
        '標準書籍の設定例 examples/standard-book/book.yaml が見つかりません');
    }
  }

  /**
   * Check dependencies
   */
  async checkDependencies(projectPath) {
    console.log('📦 依存関係をチェックしています...');

    // Check node_modules
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    if (await fs.pathExists(nodeModulesPath)) {
      this.addResult('pass', 'node_modules', 'node_modulesディレクトリが存在します');
      
      // Check specific important modules
      const importantModules = ['fs-extra', 'yaml'];
      for (const module of importantModules) {
        const modulePath = path.join(nodeModulesPath, module);
        if (await fs.pathExists(modulePath)) {
          this.addResult('pass', `モジュール ${module}`, 'インストールされています');
        } else {
          this.addResult('error', `モジュール ${module}`, 'インストールされていません');
        }
      }
    } else {
      this.addResult('error', 'node_modules', 
        'node_modulesが見つかりません。npm installを実行してください。');
    }

    // Check package-lock.json
    const lockPath = path.join(projectPath, 'package-lock.json');
    if (await fs.pathExists(lockPath)) {
      this.addResult('pass', 'package-lock.json', 'ロックファイルが存在します');
    } else {
      this.addResult('warning', 'package-lock.json', 
        'ロックファイルが見つかりません。依存関係が不安定な可能性があります。');
    }
  }

  /**
   * Check template files
   */
  async checkTemplateFiles(projectPath) {
    console.log('📄 テンプレートファイルをチェックしています...');

    const resources = [
      'src/TemplateEngine.js',
      'shared/layouts/default.html', 'shared/layouts/book.html',
      'shared/includes/page-navigation.html', 'shared/includes/sidebar-nav.html',
      'shared/assets/css/main.css', 'shared/assets/js/search.js',
      'shared/schema/book.schema.json', 'shared/schemas/book-config.schema.json',
      'templates/starter/docs/_config.yml', 'templates/starter/docs/index.md'
    ];
    await this.checkResourceFiles(projectPath, resources);
    // Never execute an external checkout's JS or attest to it with this module's result.
    if (await fs.realpath(projectPath) !== await fs.realpath(FORMATTER_ROOT)) {
      this.addResult('error', '組み込みテンプレート検証',
        '別 checkout の組み込みテンプレートは未検証です。その checkout の診断CLIを実行してください');
      return;
    }
    // Built-ins live in JS, not the obsolete shared/templates directory.
    const names = new TemplateEngine().getAvailableTemplates();
    for (const name of ['_config.yml', 'index.md', 'chapter.md', 'package.json']) {
      this.addResult(names.includes(name) ? 'pass' : 'error', `組み込みテンプレート ${name}`,
        '実行中 formatter の TemplateEngine を確認');
    }
  }

  async checkResourceFiles(root, resources) {
    for (const resource of resources) {
      try {
        await requireDiagnosticFile(root, resource);
        this.addResult('pass', `テンプレート ${resource}`, '通常ファイルが存在します（内容・描画は未検証）');
      } catch (error) {
        this.addResult('error', `テンプレート ${resource}`, error.message);
      }
    }
  }

  async checkBookTarget({ root, kind }) {
    try {
      if (kind === 'standard') {
        await validateStandardBook(root);
        this.addResult('pass', 'book.yaml', '標準メタデータと宣言されたソースを検証しました');
        this.addResult('info', '標準書籍テンプレート',
          '出力先は adapter ごとに異なります。legacy Jekyll / formatter 開発用ファイルは要求しません');
        return;
      }
      const configFile = await requireDiagnosticFile(root, 'book-config.json');
      new ConfigValidator().validate(await fs.readJson(configFile));
      this.addResult('pass', 'book-config.json', '既存 legacy ConfigValidator で検証しました');
      const projections = [];
      for (const prefix of ['', 'docs/']) {
        try {
          await fs.lstat(path.join(root, `${prefix}_config.yml`));
          projections.push(prefix);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (projections.length !== 1) {
        throw new Error('legacy 公開元を特定できません。root または docs/ の一方だけに _config.yml が必要です。自動変換は行いません');
      }
      await this.checkResourceFiles(root, ['_config.yml', 'index.md', '_layouts/default.html',
        '_includes/page-navigation.html', 'assets/css/main.css'].map(file => projections[0] + file));
      this.addResult('info', 'legacy 公開範囲',
        'ファイル存在のみ。Jekyll build、リンク、Pages 設定、公開 HTTP は別途検証してください');
    } catch (error) {
      this.addResult('error', `${kind} 書籍契約`, error.message);
    }
  }

  /**
   * Check build system
   */
  async checkBuildSystem(projectPath) {
    console.log('🔨 ビルドシステムをチェックしています...');

    // Check if tests can run
    const packagePath = path.join(projectPath, 'package.json');
    if (await fs.pathExists(packagePath)) {
      try {
        const packageData = await fs.readJson(packagePath);
        
        if (packageData.scripts && packageData.scripts.test) {
          this.addResult('pass', 'テストスクリプト', 'テストスクリプトが定義されています');
        } else {
          this.addResult('warning', 'テストスクリプト', 'テストスクリプトが定義されていません');
        }
        
        if (packageData.scripts && packageData.scripts.build) {
          this.addResult('pass', 'ビルドスクリプト', 'ビルドスクリプトが定義されています');
        } else {
          this.addResult('warning', 'ビルドスクリプト', 'ビルドスクリプトが定義されていません');
        }
      } catch (error) {
        this.addResult('error', 'ビルドシステム', 
          `ビルド設定の確認に失敗しました: ${error.message}`);
      }
    }

    // Check test files
    const testsPath = path.join(projectPath, 'tests');
    if (await fs.pathExists(testsPath)) {
      try {
        const testFiles = await fs.readdir(testsPath);
        const testFileCount = testFiles.filter(file => file.endsWith('.test.js')).length;
        
        if (testFileCount > 0) {
          this.addResult('pass', 'テストファイル', 
            `${testFileCount}個のテストファイルが見つかりました`);
        } else {
          this.addResult('warning', 'テストファイル', 'テストファイルが見つかりません');
        }
      } catch (error) {
        this.addResult('warning', 'テストファイル', 'テストディレクトリの読み込みに失敗しました');
      }
    }
  }

  /**
   * Check GitHub integration
   */
  async checkGitHubIntegration(projectPath) {
    console.log('🐙 GitHub統合をチェックしています...');

    // Check .git directory
    const gitPath = path.join(projectPath, '.git');
    if (await fs.pathExists(gitPath)) {
      this.addResult('pass', 'Gitリポジトリ', 'Gitリポジトリが初期化されています');
    } else {
      this.addResult('info', 'Gitリポジトリ', 'Gitリポジトリが見つかりません');
    }

    // Check GitHub workflows
    const workflowsPath = path.join(projectPath, '.github', 'workflows');
    if (await fs.pathExists(workflowsPath)) {
      try {
        const workflows = await fs.readdir(workflowsPath);
        const workflowCount = workflows.filter(file => file.endsWith('.yml') || file.endsWith('.yaml')).length;
        
        if (workflowCount > 0) {
          this.addResult('pass', 'GitHub Actions', 
            `${workflowCount}個のワークフローが見つかりました`);
        } else {
          this.addResult('info', 'GitHub Actions', 'ワークフローファイルが見つかりません');
        }
      } catch (error) {
        this.addResult('warning', 'GitHub Actions', 'ワークフローディレクトリの読み込みに失敗しました');
      }
    } else {
      this.addResult('info', 'GitHub Actions', 'GitHub Actionsワークフローが見つかりません');
    }

    // Check GitHub Pages files
    const githubPagesFiles = ['.nojekyll', 'CNAME', '404.html'];
    let pagesFileCount = 0;
    
    for (const file of githubPagesFiles) {
      const filePath = path.join(projectPath, file);
      if (await fs.pathExists(filePath)) {
        pagesFileCount++;
      }
    }
    
    if (pagesFileCount > 0) {
      this.addResult('pass', 'GitHub Pages', 
        `${pagesFileCount}個のGitHub Pagesファイルが見つかりました`);
    } else {
      this.addResult('info', 'GitHub Pages', 'GitHub Pages関連ファイルが見つかりません');
    }
  }

  /**
   * Check performance indicators
   */
  async checkPerformance(projectPath) {
    console.log('⚡ パフォーマンスをチェックしています...');

    // Check project size
    try {
      const projectSize = await this.calculateDirectorySize(projectPath);
      const sizeInMB = projectSize / (1024 * 1024);
      
      if (sizeInMB > 100) {
        this.addResult('warning', 'プロジェクトサイズ', 
          `プロジェクトサイズが大きいです: ${sizeInMB.toFixed(1)}MB`);
      } else {
        this.addResult('pass', 'プロジェクトサイズ', 
          `適切なサイズです: ${sizeInMB.toFixed(1)}MB`);
      }
    } catch (error) {
      this.addResult('warning', 'プロジェクトサイズ', 'サイズの計算に失敗しました');
    }

    // Check file count
    try {
      const fileCount = await this.countFiles(projectPath);
      
      if (fileCount > 1000) {
        this.addResult('warning', 'ファイル数', 
          `ファイル数が多いです: ${fileCount}個`);
      } else {
        this.addResult('pass', 'ファイル数', `適切な数です: ${fileCount}個`);
      }
    } catch (error) {
      this.addResult('warning', 'ファイル数', 'ファイル数の計算に失敗しました');
    }
  }

  /**
   * Add a check result
   */
  addResult(type, check, message, details = {}) {
    const result = {
      type,
      check,
      message,
      details,
      timestamp: new Date().toISOString()
    };

    this.results.details.push(result);

    switch (type) {
    case 'pass':
      this.results.passed++;
      break;
    case 'warning':
      this.results.warnings++;
      break;
    case 'error':
      this.results.errors++;
      break;
    case 'critical':
      this.results.criticalErrors++;
      break;
    default:
      // info type doesn't count in statistics
      break;
    }
  }

  /**
   * Generate summary report
   */
  generateSummary() {
    console.log('\n📋 診断結果サマリー:');
    console.log(`✅ 合格: ${this.results.passed}件`);
    console.log(`⚠️  警告: ${this.results.warnings}件`);
    console.log(`❌ エラー: ${this.results.errors}件`);
    console.log(`🚨 重大なエラー: ${this.results.criticalErrors}件`);

    const total = this.results.passed + this.results.warnings + this.results.errors + this.results.criticalErrors;
    const healthScore = total > 0 ? (this.results.passed / total * 100).toFixed(1) : 0;
    
    console.log(`\n🏥 システムヘルススコア: ${healthScore}%`);

    if (this.results.criticalErrors > 0) {
      console.log('\n🚨 重大な問題があります。すぐに対処が必要です。');
    } else if (this.results.errors > 0) {
      console.log('\n❌ エラーがあります。修正を推奨します。');
    } else if (this.results.warnings > 0) {
      console.log('\n⚠️  警告があります。確認することをお勧めします。');
    } else {
      console.log('\n診断範囲内のエラーはありません。ビルド・公開成功を保証するものではありません。');
    }

    // Add recommendations
    this.addRecommendations();
  }

  /**
   * Add recommendations based on check results
   */
  addRecommendations() {
    console.log('\n💡 推奨事項:');

    console.log('• 対象形式と各診断メッセージを確認してください。未知の形式は変換・修復しません');
    console.log('• この診断は test/build/Pages/公開 HTTP を実行しません。各専用 gate を別途実行してください');
    if (this.target?.kind === 'formatter') {
      console.log('• formatter 本体では npm test / npm run lint / npm run build を実行してください');
    }

  }

  /**
   * Calculate directory size recursively
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item === 'node_modules' || item === '.git') continue; // Skip large directories
        
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          totalSize += await this.calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Ignore errors for inaccessible directories
    }

    return totalSize;
  }

  /**
   * Count files in directory recursively
   */
  async countFiles(dirPath) {
    let fileCount = 0;

    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        if (item === 'node_modules' || item === '.git') continue; // Skip large directories
        
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          fileCount += await this.countFiles(itemPath);
        } else {
          fileCount++;
        }
      }
    } catch (error) {
      // Ignore errors for inaccessible directories
    }

    return fileCount;
  }

  /**
   * Export results to JSON file
   */
  async exportResults(outputPath) {
    const resultsWithMetadata = {
      ...this.results,
      metadata: {
        timestamp: new Date().toISOString(),
        platform: os.platform(),
        nodeVersion: process.version,
        projectPath: this.projectPath || process.cwd(),
        targetKind: this.target?.kind || 'unknown'
      }
    };

    await fs.writeJson(outputPath, resultsWithMetadata, { spaces: 2 });
    console.log(`\n📄 診断結果を ${outputPath} に保存しました`);
  }
}
