import fs from 'fs-extra';
import path from 'path';
import os from 'os';

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

    try {
      // System environment checks
      await this.checkSystemEnvironment();
      
      // Node.js environment checks
      await this.checkNodeEnvironment();
      
      // Project structure checks
      await this.checkProjectStructure(projectPath);
      
      // Configuration file checks
      await this.checkConfigurationFiles(projectPath);
      
      // Dependencies checks
      await this.checkDependencies(projectPath);
      
      // Template files checks
      await this.checkTemplateFiles(projectPath);
      
      // Build system checks
      await this.checkBuildSystem(projectPath);
      
      // GitHub integration checks
      await this.checkGitHubIntegration(projectPath);
      
      // Performance checks
      await this.checkPerformance(projectPath);

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
  async checkNodeEnvironment() {
    console.log('⚡ Node.js環境をチェックしています...');

    // Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
    
    if (majorVersion < 16) {
      this.addResult('error', 'Node.jsバージョン', 
        `Node.js ${nodeVersion} は古すぎます。Node.js 16以上が必要です。`);
    } else if (majorVersion < 18) {
      this.addResult('warning', 'Node.jsバージョン', 
        `Node.js ${nodeVersion} は動作しますが、Node.js 18以上を推奨します。`);
    } else {
      this.addResult('pass', 'Node.jsバージョン', `Node.js ${nodeVersion} は対応バージョンです`);
    }

    // npm version
    try {
      const { execSync } = await import('child_process');
      const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
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
    const configExamples = ['example-config.json', 'example-config.yml'];
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
        '設定例ファイルが見つかりません（example-config.json など）');
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

    const templatePath = path.join(projectPath, 'shared');
    if (await fs.pathExists(templatePath)) {
      // Check for essential templates
      const templates = [
        'templates/_config.yml',
        'templates/index.md',
        'templates/chapter.md',
        'templates/package.json',
        'includes/page-navigation.html',
        'layouts/default.html'
      ];

      for (const template of templates) {
        const templateFile = path.join(templatePath, template);
        if (await fs.pathExists(templateFile)) {
          this.addResult('pass', `テンプレート ${template}`, '存在します');
        } else {
          this.addResult('warning', `テンプレート ${template}`, '見つかりません');
        }
      }

      // Check assets
      const assetsPath = path.join(templatePath, 'assets');
      if (await fs.pathExists(assetsPath)) {
        this.addResult('pass', 'アセット', 'assetsディレクトリが存在します');
        
        // Check for CSS and JS
        const cssPath = path.join(assetsPath, 'css');
        const jsPath = path.join(assetsPath, 'js');
        
        if (await fs.pathExists(cssPath)) {
          this.addResult('pass', 'CSS', 'CSSディレクトリが存在します');
        } else {
          this.addResult('warning', 'CSS', 'CSSディレクトリが見つかりません');
        }
        
        if (await fs.pathExists(jsPath)) {
          this.addResult('pass', 'JavaScript', 'JavaScriptディレクトリが存在します');
        } else {
          this.addResult('warning', 'JavaScript', 'JavaScriptディレクトリが見つかりません');
        }
      } else {
        this.addResult('warning', 'アセット', 'assetsディレクトリが見つかりません');
      }
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
      console.log('\n🎉 システムは正常に動作しています！');
    }

    // Add recommendations
    this.addRecommendations();
  }

  /**
   * Add recommendations based on check results
   */
  addRecommendations() {
    console.log('\n💡 推奨事項:');

    if (this.results.errors > 0 || this.results.criticalErrors > 0) {
      console.log('• エラーを修正してください');
      console.log('• npm install を実行して依存関係を確認してください');
      console.log('• 設定ファイルが正しく配置されているか確認してください');
    }

    if (this.results.warnings > 0) {
      console.log('• 警告項目を確認し、必要に応じて修正してください');
      console.log('• 不足しているファイルやディレクトリを追加してください');
    }

    console.log('• 定期的に npm test を実行してシステムをテストしてください');
    console.log('• GitHub Pages を使用する場合は validate-github-pages スクリプトを実行してください');
    console.log('• パフォーマンスを向上させるため、不要なファイルを削除してください');
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
        projectPath: process.cwd()
      }
    };

    await fs.writeJson(outputPath, resultsWithMetadata, { spaces: 2 });
    console.log(`\n📄 診断結果を ${outputPath} に保存しました`);
  }
}