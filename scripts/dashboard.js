#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 書籍管理ダッシュボード
 * 組織内のすべての書籍プロジェクトの状態を監視
 */
class BookDashboard {
  constructor() {
    this.books = [];
    this.stats = {
      total: 0,
      active: 0,
      needsUpdate: 0,
      errors: 0
    };
  }

  /**
   * GitHubから書籍リストを取得
   * @param {string} org - GitHub組織名
   */
  async fetchBooks(org = 'itdojp') {
    console.log(chalk.blue(`📚 Fetching books from ${org}...`));
    
    try {
      const { stdout } = await execAsync(
        `gh repo list ${org} --limit 100 --json name,description,url,updatedAt,isPrivate`
      );
      
      const repos = JSON.parse(stdout);
      
      // 書籍リポジトリをフィルタリング
      this.books = repos.filter(repo => 
        (repo.description && (repo.description.includes('book') || repo.description.includes('Book'))) ||
        repo.name.match(/(-book$|^book-|textbook)/) &&
        repo.name !== 'book-formatter'
      );
      
      this.stats.total = this.books.length;
      console.log(chalk.gray(`Found ${this.stats.total} book repositories`));
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to fetch repositories: ${error.message}`));
      throw error;
    }
  }

  /**
   * 各書籍の詳細情報を取得
   */
  async analyzeBooks() {
    console.log(chalk.blue('\n🔍 Analyzing book details...'));
    
    for (const book of this.books) {
      try {
        // GitHub Pages状態を確認
        const pagesStatus = await this.checkGitHubPages(book);
        book.githubPages = pagesStatus;
        
        // 最新のコミット情報を取得
        const latestCommit = await this.getLatestCommit(book);
        book.latestCommit = latestCommit;
        
        // ワークフロー状態を確認
        const workflowStatus = await this.checkWorkflows(book);
        book.workflows = workflowStatus;
        
        // book-config.jsonの存在を確認
        const hasConfig = await this.checkBookConfig(book);
        book.hasBookConfig = hasConfig;
        
        // 統計の更新
        if (pagesStatus.enabled) this.stats.active++;
        if (this.needsUpdate(book)) this.stats.needsUpdate++;
        if (workflowStatus.failing > 0) this.stats.errors++;
        
      } catch (error) {
        console.error(chalk.yellow(`⚠️  Failed to analyze ${book.name}: ${error.message}`));
        book.error = error.message;
        this.stats.errors++;
      }
    }
  }

  /**
   * GitHub Pagesの状態を確認
   * @param {Object} book - 書籍情報
   */
  async checkGitHubPages(book) {
    try {
      const { stdout } = await execAsync(
        `gh api repos/${book.name.includes('/') ? book.name : `itdojp/${book.name}`}/pages --jq '{status, html_url, source}'`
      );
      
      const pages = JSON.parse(stdout);
      return {
        enabled: true,
        url: pages.html_url,
        status: pages.status,
        source: pages.source
      };
    } catch (error) {
      return {
        enabled: false,
        status: 'not_enabled'
      };
    }
  }

  /**
   * 最新のコミット情報を取得
   * @param {Object} book - 書籍情報
   */
  async getLatestCommit(book) {
    try {
      const { stdout } = await execAsync(
        `gh api repos/${book.name.includes('/') ? book.name : `itdojp/${book.name}`}/commits?per_page=1 --jq '.[0] | {sha: .sha[0:7], message: .commit.message, date: .commit.author.date, author: .commit.author.name}'`
      );
      
      return JSON.parse(stdout);
    } catch (error) {
      return null;
    }
  }

  /**
   * ワークフローの状態を確認
   * @param {Object} book - 書籍情報
   */
  async checkWorkflows(book) {
    try {
      const { stdout } = await execAsync(
        `gh api repos/${book.name.includes('/') ? book.name : `itdojp/${book.name}`}/actions/runs?per_page=10 --jq '.workflow_runs | group_by(.conclusion) | map({conclusion: .[0].conclusion, count: length}) | from_entries'`
      );
      
      const runs = JSON.parse(stdout);
      return {
        success: runs.success || 0,
        failure: runs.failure || 0,
        cancelled: runs.cancelled || 0,
        failing: runs.failure || 0
      };
    } catch (error) {
      return {
        success: 0,
        failure: 0,
        cancelled: 0,
        failing: 0
      };
    }
  }

  /**
   * book-config.jsonの存在を確認
   * @param {Object} book - 書籍情報
   */
  async checkBookConfig(book) {
    try {
      await execAsync(
        `gh api repos/${book.name.includes('/') ? book.name : `itdojp/${book.name}`}/contents/book-config.json`
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 書籍が更新を必要とするか判定
   * @param {Object} book - 書籍情報
   */
  needsUpdate(book) {
    // book-config.jsonがない
    if (!book.hasBookConfig) return true;
    
    // 30日以上更新されていない
    const lastUpdate = new Date(book.updatedAt);
    const daysSinceUpdate = (Date.now() - lastUpdate) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 30) return true;
    
    // ワークフローが失敗している
    if (book.workflows && book.workflows.failing > 0) return true;
    
    return false;
  }

  /**
   * ダッシュボードを表示
   */
  displayDashboard() {
    console.clear();
    
    // ヘッダー
    console.log(chalk.bold.blue('\n📊 Book Management Dashboard'));
    console.log(chalk.gray('─'.repeat(80)));
    
    // サマリー
    console.log(chalk.bold('\n📈 Summary'));
    console.log(`Total Books: ${chalk.cyan(this.stats.total)}`);
    console.log(`Active (GitHub Pages): ${chalk.green(this.stats.active)}`);
    console.log(`Needs Update: ${chalk.yellow(this.stats.needsUpdate)}`);
    console.log(`Errors: ${chalk.red(this.stats.errors)}`);
    
    // 書籍リスト
    console.log(chalk.bold('\n📚 Books'));
    console.log(chalk.gray('─'.repeat(80)));
    
    const headers = ['Name', 'Status', 'Pages', 'Config', 'Last Update', 'Actions'];
    const colWidths = [25, 10, 8, 8, 25, 10];
    
    // ヘッダー行
    console.log(
      headers.map((h, i) => chalk.bold(h.padEnd(colWidths[i]))).join(' ')
    );
    console.log(chalk.gray('─'.repeat(80)));
    
    // 書籍行
    this.books.forEach(book => {
      const row = [
        book.name.substring(0, 24),
        this.getStatusBadge(book),
        book.githubPages?.enabled ? '✅' : '❌',
        book.hasBookConfig ? '✅' : '❌',
        book.latestCommit ? new Date(book.latestCommit.date).toLocaleDateString() : 'N/A',
        this.getActionsBadge(book)
      ];
      
      console.log(
        row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(' ')
      );
    });
    
    // 要対応リスト
    const needsAttention = this.books.filter(b => this.needsUpdate(b));
    if (needsAttention.length > 0) {
      console.log(chalk.bold('\n⚠️  Needs Attention'));
      console.log(chalk.gray('─'.repeat(80)));
      
      needsAttention.forEach(book => {
        console.log(chalk.yellow(`• ${book.name}`));
        if (!book.hasBookConfig) {
          console.log(chalk.gray('  - Missing book-config.json'));
        }
        if (book.workflows?.failing > 0) {
          console.log(chalk.gray(`  - ${book.workflows.failing} failing workflows`));
        }
        const lastUpdate = new Date(book.updatedAt);
        const daysSinceUpdate = Math.floor((Date.now() - lastUpdate) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate > 30) {
          console.log(chalk.gray(`  - Not updated for ${daysSinceUpdate} days`));
        }
      });
    }
    
    // フッター
    console.log(chalk.gray('\n─'.repeat(80)));
    console.log(chalk.gray(`Last updated: ${new Date().toLocaleString()}`));
  }

  /**
   * ステータスバッジを取得
   * @param {Object} book - 書籍情報
   */
  getStatusBadge(book) {
    if (book.error) return chalk.red('Error');
    if (this.needsUpdate(book)) return chalk.yellow('Update');
    if (book.workflows?.failing > 0) return chalk.red('Failing');
    return chalk.green('OK');
  }

  /**
   * アクションバッジを取得
   * @param {Object} book - 書籍情報
   */
  getActionsBadge(book) {
    if (!book.workflows) return 'N/A';
    
    const { success, failure } = book.workflows;
    if (failure > 0) return chalk.red(`${failure} ❌`);
    if (success > 0) return chalk.green(`${success} ✅`);
    return 'None';
  }

  /**
   * レポートを生成
   * @param {string} format - 出力形式 (json, markdown)
   */
  async generateReport(format = 'json') {
    const report = {
      generated: new Date().toISOString(),
      summary: this.stats,
      books: this.books
    };
    
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }
    
    if (format === 'markdown') {
      let md = '# Book Management Report\n\n';
      md += `Generated: ${new Date().toLocaleString()}\n\n`;
      
      md += '## Summary\n\n';
      md += `- Total Books: ${this.stats.total}\n`;
      md += `- Active (GitHub Pages): ${this.stats.active}\n`;
      md += `- Needs Update: ${this.stats.needsUpdate}\n`;
      md += `- Errors: ${this.stats.errors}\n\n`;
      
      md += '## Books\n\n';
      md += '| Name | Status | GitHub Pages | Config | Last Update |\n';
      md += '|------|--------|--------------|--------|-------------|\n';
      
      this.books.forEach(book => {
        md += `| ${book.name} `;
        md += `| ${this.needsUpdate(book) ? '⚠️ Update' : '✅ OK'} `;
        md += `| ${book.githubPages?.enabled ? '✅' : '❌'} `;
        md += `| ${book.hasBookConfig ? '✅' : '❌'} `;
        md += `| ${book.updatedAt ? new Date(book.updatedAt).toLocaleDateString() : 'N/A'} |\n`;
      });
      
      return md;
    }
    
    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * 自動更新モード
   * @param {number} interval - 更新間隔（秒）
   */
  async watchMode(interval = 300) {
    console.log(chalk.blue(`🔄 Watch mode enabled (updating every ${interval}s)`));
    
    const update = async () => {
      await this.fetchBooks();
      await this.analyzeBooks();
      this.displayDashboard();
    };
    
    await update();
    setInterval(update, interval * 1000);
  }
}

// CLIの設定
const program = new Command();

program
  .name('dashboard')
  .description('Book management dashboard')
  .version('1.0.0')
  .option('-o, --org <org>', 'GitHub organization', 'itdojp')
  .option('-w, --watch [interval]', 'Watch mode (update interval in seconds)', false)
  .option('-r, --report <format>', 'Generate report (json, markdown)')
  .option('-s, --save <file>', 'Save report to file')
  .action(async (options) => {
    const dashboard = new BookDashboard();
    
    try {
      // データの取得と分析
      await dashboard.fetchBooks(options.org);
      await dashboard.analyzeBooks();
      
      // レポート生成
      if (options.report) {
        const report = await dashboard.generateReport(options.report);
        
        if (options.save) {
          await fs.writeFile(options.save, report);
          console.log(chalk.green(`✅ Report saved to ${options.save}`));
        } else {
          console.log(report);
        }
        return;
      }
      
      // ウォッチモード
      if (options.watch) {
        const interval = typeof options.watch === 'number' ? options.watch : 300;
        await dashboard.watchMode(interval);
        return;
      }
      
      // 通常表示
      dashboard.displayDashboard();
      
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();

export { BookDashboard };