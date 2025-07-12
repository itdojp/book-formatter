#!/usr/bin/env node

/**
 * Book Formatter Troubleshooting Script
 * Interactive troubleshooting and problem resolution
 */

import { DiagnosticTool } from '../src/DiagnosticTool.js';
import fs from 'fs-extra';
import path from 'path';

class TroubleshootingTool {
  constructor() {
    this.diagnostic = new DiagnosticTool();
    this.solutions = new Map();
    this.initializeSolutions();
  }

  /**
   * Initialize common solutions for known problems
   */
  initializeSolutions() {
    this.solutions.set('node_modules', {
      problem: 'node_modulesが見つかりません',
      solution: 'npm install を実行してください',
      command: 'npm install',
      description: '依存関係をインストールします'
    });

    this.solutions.set('package.json', {
      problem: 'package.jsonが見つかりません',
      solution: 'npm init を実行するか、package.jsonを作成してください',
      command: 'npm init -y',
      description: '新しいpackage.jsonを作成します'
    });

    this.solutions.set('test_script', {
      problem: 'テストスクリプトが定義されていません',
      solution: 'package.jsonにテストスクリプトを追加してください',
      manual: true,
      description: 'package.jsonの"scripts"セクションに"test": "node --test tests/*.test.js"を追加'
    });

    this.solutions.set('build_script', {
      problem: 'ビルドスクリプトが定義されていません',
      solution: 'package.jsonにビルドスクリプトを追加してください',
      manual: true,
      description: 'package.jsonの"scripts"セクションに"build": "your-build-command"を追加'
    });

    this.solutions.set('src_directory', {
      problem: 'srcディレクトリが見つかりません',
      solution: 'srcディレクトリを作成してください',
      command: 'mkdir src',
      description: 'ソースコード用のディレクトリを作成します'
    });

    this.solutions.set('tests_directory', {
      problem: 'testsディレクトリが見つかりません',
      solution: 'testsディレクトリを作成してください',
      command: 'mkdir tests',
      description: 'テストファイル用のディレクトリを作成します'
    });

    this.solutions.set('shared_directory', {
      problem: 'sharedディレクトリが見つかりません',
      solution: 'sharedディレクトリを作成してください',
      command: 'mkdir shared',
      description: '共有リソース用のディレクトリを作成します'
    });

    this.solutions.set('github_pages', {
      problem: 'GitHub Pages関連ファイルが見つかりません',
      solution: 'GitHub Pages統合を有効にしてください',
      command: 'npm run validate-deploy',
      description: 'GitHub Pages統合の検証と設定を行います'
    });
  }

  /**
   * Run interactive troubleshooting
   */
  async runTroubleshooting(projectPath = process.cwd()) {
    console.log('🔧 Book Formatter トラブルシューティングツールを開始します...\n');

    try {
      // Run diagnostics first
      console.log('📊 まず診断を実行します...\n');
      const results = await this.diagnostic.runDiagnostics(projectPath);

      // Analyze results and suggest solutions
      const problems = this.analyzeProblems(results);

      if (problems.length === 0) {
        console.log('\n🎉 問題は検出されませんでした！システムは正常に動作しています。');
        return;
      }

      console.log('\n🔍 検出された問題と解決策:\n');

      for (const [index, problem] of problems.entries()) {
        console.log(`${index + 1}. ${problem.description}`);
        console.log(`   カテゴリ: ${problem.category}`);
        
        const solution = this.findSolution(problem);
        if (solution) {
          console.log(`   💡 解決策: ${solution.solution}`);
          
          if (solution.command && !solution.manual) {
            console.log(`   🚀 コマンド: ${solution.command}`);
            console.log(`   📝 説明: ${solution.description}`);
          } else if (solution.manual) {
            console.log(`   ✋ 手動設定: ${solution.description}`);
          }
        } else {
          console.log('   ❓ 自動解決策が見つかりません。手動で確認してください。');
        }
        console.log('');
      }

      // Ask if user wants to apply automatic fixes
      if (process.stdout.isTTY && !process.argv.includes('--auto')) {
        console.log('自動修正を実行しますか？ (y/n): ');
        
        // In a real interactive environment, you'd use readline
        // For now, we'll just show what would be done
        console.log('(--auto フラグを使用すると自動的に修正を実行します)\n');
        
        console.log('自動修正可能な問題:');
        const autoFixable = problems.filter(p => {
          const solution = this.findSolution(p);
          return solution && solution.command && !solution.manual;
        });

        if (autoFixable.length > 0) {
          for (const problem of autoFixable) {
            const solution = this.findSolution(problem);
            console.log(`• ${problem.description} → ${solution.command}`);
          }
        } else {
          console.log('• 自動修正可能な問題はありません');
        }
      }

      // Auto-fix if requested
      if (process.argv.includes('--auto')) {
        await this.autoFix(problems, projectPath);
      }

      // Generate troubleshooting report
      await this.generateTroubleshootingReport(problems, projectPath);

    } catch (error) {
      console.error('❌ トラブルシューティング中にエラーが発生しました:', error.message);
      throw error;
    }
  }

  /**
   * Analyze diagnostic results to identify problems
   */
  analyzeProblems(results) {
    const problems = [];

    for (const detail of results.details) {
      if (detail.type === 'error' || detail.type === 'critical') {
        problems.push({
          description: detail.message,
          category: detail.check,
          type: detail.type,
          details: detail.details
        });
      }
    }

    return problems;
  }

  /**
   * Find solution for a given problem
   */
  findSolution(problem) {
    // Try to match problem category to known solutions
    const categoryLower = problem.category.toLowerCase();
    
    if (categoryLower.includes('node_modules')) {
      return this.solutions.get('node_modules');
    }
    
    if (categoryLower.includes('package.json')) {
      return this.solutions.get('package.json');
    }
    
    if (categoryLower.includes('src') && problem.description.includes('ディレクトリ')) {
      return this.solutions.get('src_directory');
    }
    
    if (categoryLower.includes('tests') && problem.description.includes('ディレクトリ')) {
      return this.solutions.get('tests_directory');
    }
    
    if (categoryLower.includes('shared') && problem.description.includes('ディレクトリ')) {
      return this.solutions.get('shared_directory');
    }
    
    if (categoryLower.includes('テストスクリプト')) {
      return this.solutions.get('test_script');
    }
    
    if (categoryLower.includes('ビルドスクリプト')) {
      return this.solutions.get('build_script');
    }
    
    if (categoryLower.includes('github')) {
      return this.solutions.get('github_pages');
    }

    return null;
  }

  /**
   * Apply automatic fixes
   */
  async autoFix(problems, projectPath) {
    console.log('🔧 自動修正を開始します...\n');

    const { execSync } = await import('child_process');

    for (const problem of problems) {
      const solution = this.findSolution(problem);
      
      if (solution && solution.command && !solution.manual) {
        try {
          console.log(`修正中: ${problem.description}`);
          console.log(`実行: ${solution.command}`);
          
          execSync(solution.command, { 
            cwd: projectPath, 
            stdio: 'inherit' 
          });
          
          console.log(`✅ 修正完了: ${solution.description}\n`);
          
        } catch (error) {
          console.log(`❌ 修正失敗: ${error.message}\n`);
        }
      }
    }

    console.log('🔧 自動修正が完了しました。再度診断を実行することをお勧めします。');
  }

  /**
   * Generate troubleshooting report
   */
  async generateTroubleshootingReport(problems, projectPath) {
    const reportPath = path.join(projectPath, 'troubleshooting-report.md');
    
    let report = `# Book Formatter トラブルシューティングレポート

生成日時: ${new Date().toLocaleString('ja-JP')}
プロジェクトパス: ${projectPath}

## 検出された問題

`;

    if (problems.length === 0) {
      report += '問題は検出されませんでした。🎉\n';
    } else {
      for (const [index, problem] of problems.entries()) {
        report += `### ${index + 1}. ${problem.description}

- **カテゴリ**: ${problem.category}
- **重要度**: ${problem.type === 'critical' ? '🚨 重大' : '❌ エラー'}

`;

        const solution = this.findSolution(problem);
        if (solution) {
          report += `**解決策**: ${solution.solution}

`;
          
          if (solution.command && !solution.manual) {
            report += `**コマンド**: \`${solution.command}\`

`;
          }
          
          if (solution.description) {
            report += `**説明**: ${solution.description}

`;
          }
        }

        report += '---\n\n';
      }
    }

    report += `## 推奨事項

1. **定期的な診断**: \`npm run diagnose\` を定期的に実行してシステムの健全性を確認してください
2. **テストの実行**: \`npm test\` を実行してすべてのテストが通ることを確認してください
3. **依存関係の更新**: 定期的に \`npm update\` を実行して依存関係を最新に保ってください
4. **ドキュメントの確認**: 問題が解決しない場合は、プロジェクトドキュメントを確認してください

## サポート

問題が解決しない場合は、以下を確認してください：

- [トラブルシューティングガイド](./CLAUDE_TROUBLESHOOTING.md)
- [プロジェクトドキュメント](./README.md)
- [GitHub Issues](https://github.com/itdojp/book-formatter/issues)

---

*このレポートは Book Formatter トラブルシューティングツールによって自動生成されました。*
`;

    await fs.writeFile(reportPath, report);
    console.log(`\n📄 トラブルシューティングレポートを ${reportPath} に保存しました`);
  }
}

async function runTroubleshooting() {
  const troubleshooter = new TroubleshootingTool();
  
  try {
    const projectPath = process.argv[2] || process.cwd();
    await troubleshooter.runTroubleshooting(projectPath);
  } catch (error) {
    console.error('❌ トラブルシューティングツールでエラーが発生しました:', error.message);
    process.exit(1);
  }
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Book Formatter トラブルシューティングツール

使用方法:
  npm run troubleshoot [プロジェクトパス] [オプション]

オプション:
  --auto      自動修正を実行（対話的プロンプトをスキップ）
  --help, -h  このヘルプを表示

例:
  npm run troubleshoot
  npm run troubleshoot /path/to/book-project
  npm run troubleshoot --auto
  npm run troubleshoot /path/to/project --auto

このツールは以下を行います：
1. システム診断を実行
2. 検出された問題を分析
3. 解決策を提案
4. 自動修正可能な問題を修正（--autoフラグ使用時）
5. トラブルシューティングレポートを生成
`);
  process.exit(0);
}

// Run troubleshooting if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTroubleshooting();
}

export { runTroubleshooting, TroubleshootingTool };