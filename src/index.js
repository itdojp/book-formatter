#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { BookGenerator } from './BookGenerator.js';
import { ConfigValidator } from './ConfigValidator.js';
import { FileSystemUtils } from './FileSystemUtils.js';

const program = new Command();
const bookGenerator = new BookGenerator();
const configValidator = new ConfigValidator();
const fsUtils = new FileSystemUtils();

// バージョン情報
program
  .name('book-formatter')
  .description('設定駆動型のブック生成システム')
  .version('1.0.0');

// create-book コマンド
program
  .command('create-book')
  .description('新しい書籍を作成します')
  .option('-c, --config <path>', '設定ファイルのパス', './book-config.json')
  .option('-o, --output <path>', '出力ディレクトリのパス', './output')
  .option('-f, --force', '既存のディレクトリを上書きします', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('📚 新しい書籍を作成しています...'));
      
      // 設定ファイルの存在チェック
      if (!(await fsUtils.exists(options.config))) {
        console.error(chalk.red(`❌ 設定ファイルが見つかりません: ${options.config}`));
        process.exit(1);
      }

      // 出力ディレクトリの存在チェック
      if (await fsUtils.exists(options.output)) {
        if (!options.force) {
          console.error(chalk.red(`❌ 出力ディレクトリが既に存在します: ${options.output}`));
          console.log(chalk.yellow('上書きする場合は --force オプションを使用してください'));
          process.exit(1);
        }
        console.log(chalk.yellow(`⚠️  既存のディレクトリを上書きします: ${options.output}`));
      }

      // 書籍の作成
      await bookGenerator.createBook(options.config, options.output);
      
      console.log(chalk.green('✅ 書籍の作成が完了しました!'));
      console.log(chalk.blue(`📁 出力先: ${path.resolve(options.output)}`));
      
    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// update-book コマンド
program
  .command('update-book')
  .description('既存の書籍を更新します')
  .option('-c, --config <path>', '設定ファイルのパス', './book-config.json')
  .option('-b, --book <path>', '書籍のパス', './book')
  .option('--no-backup', 'バックアップを作成しません', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('📚 書籍を更新しています...'));
      
      // 設定ファイルの存在チェック
      if (!(await fsUtils.exists(options.config))) {
        console.error(chalk.red(`❌ 設定ファイルが見つかりません: ${options.config}`));
        process.exit(1);
      }

      // 書籍ディレクトリの存在チェック
      if (!(await fsUtils.exists(options.book))) {
        console.error(chalk.red(`❌ 書籍ディレクトリが見つかりません: ${options.book}`));
        process.exit(1);
      }

      // 書籍の更新
      await bookGenerator.updateBook(options.config, options.book);
      
      console.log(chalk.green('✅ 書籍の更新が完了しました!'));
      
    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// validate-config コマンド
program
  .command('validate-config')
  .description('設定ファイルをバリデーションします')
  .option('-c, --config <path>', '設定ファイルのパス', './book-config.json')
  .option('-v, --verbose', '詳細な結果を表示します', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔍 設定ファイルをバリデーションしています...'));
      
      // 設定ファイルの存在チェック
      if (!(await fsUtils.exists(options.config))) {
        console.error(chalk.red(`❌ 設定ファイルが見つかりません: ${options.config}`));
        process.exit(1);
      }

      // 設定ファイルの読み込み
      const config = await bookGenerator.loadConfig(options.config);
      
      if (options.verbose) {
        // 詳細なバリデーション
        const details = configValidator.getValidationDetails(config);
        
        if (details.isValid) {
          console.log(chalk.green('✅ 設定ファイルは有効です'));
        } else {
          console.log(chalk.red('❌ 設定ファイルにエラーがあります'));
          details.errors.forEach(error => {
            console.log(chalk.red(`  - ${error}`));
          });
        }
        
        if (details.warnings.length > 0) {
          console.log(chalk.yellow('⚠️  警告:'));
          details.warnings.forEach(warning => {
            console.log(chalk.yellow(`  - ${warning}`));
          });
        }
      } else {
        // 基本的なバリデーション
        configValidator.validate(config);
        console.log(chalk.green('✅ 設定ファイルは有効です'));
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ バリデーションエラー: ${error.message}`));
      process.exit(1);
    }
  });

// sync-all-books コマンド
program
  .command('sync-all-books')
  .description('複数の書籍を一括で同期します')
  .option('-d, --directory <path>', '書籍ディレクトリのパス', './books')
  .option('-p, --pattern <pattern>', '設定ファイルのパターン', '**/book-config.json')
  .option('--dry-run', '実際には実行せず、実行予定の操作を表示します', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔄 書籍を一括同期しています...'));
      
      // 書籍ディレクトリの存在チェック
      if (!(await fsUtils.exists(options.directory))) {
        console.error(chalk.red(`❌ 書籍ディレクトリが見つかりません: ${options.directory}`));
        process.exit(1);
      }

      // 設定ファイルの検索
      const configFiles = await fsUtils.listDirectory(options.directory, {
        recursive: true,
        pattern: options.pattern,
        filesOnly: true
      });

      if (configFiles.length === 0) {
        console.log(chalk.yellow('⚠️  設定ファイルが見つかりませんでした'));
        return;
      }

      console.log(chalk.blue(`📁 ${configFiles.length} 個の設定ファイルが見つかりました`));

      // 各書籍の処理
      const results = [];
      for (const configFile of configFiles) {
        const configPath = path.join(options.directory, configFile);
        const bookPath = path.dirname(configPath);
        
        try {
          console.log(chalk.blue(`\n📚 処理中: ${configFile}`));
          
          if (options.dryRun) {
            console.log(chalk.yellow(`  [DRY RUN] 更新予定: ${bookPath}`));
          } else {
            await bookGenerator.updateBook(configPath, bookPath);
            console.log(chalk.green(`  ✅ 更新完了: ${bookPath}`));
          }
          
          results.push({ path: configFile, success: true });
        } catch (error) {
          console.error(chalk.red(`  ❌ 更新失敗: ${error.message}`));
          results.push({ path: configFile, success: false, error: error.message });
        }
      }

      // 結果の表示
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(chalk.blue('\n📊 同期結果:'));
      console.log(chalk.green(`  成功: ${successful}`));
      if (failed > 0) {
        console.log(chalk.red(`  失敗: ${failed}`));
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// init コマンド
program
  .command('init')
  .description('サンプル設定ファイルを作成します')
  .option('-o, --output <path>', '出力ファイルのパス', './book-config.json')
  .option('-f, --force', '既存のファイルを上書きします', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('📝 サンプル設定ファイルを作成しています...'));
      
      // 既存ファイルのチェック
      if (await fsUtils.exists(options.output)) {
        if (!options.force) {
          console.error(chalk.red(`❌ 設定ファイルが既に存在します: ${options.output}`));
          console.log(chalk.yellow('上書きする場合は --force オプションを使用してください'));
          process.exit(1);
        }
      }

      // サンプル設定の作成
      const sampleConfig = {
        title: 'サンプル書籍',
        description: 'この書籍はbook-formatterで作成されたサンプルです',
        author: '著者名',
        version: '1.0.0',
        language: 'ja',
        license: 'MIT',
        repository: {
          url: 'https://github.com/user/repo.git',
          branch: 'main'
        },
        structure: {
          chapters: [
            {
              id: 'introduction',
              title: 'はじめに',
              description: 'この書籍について説明します'
            },
            {
              id: 'getting-started',
              title: 'はじめ方',
              description: '基本的な使い方を説明します'
            }
          ],
          appendices: [
            {
              id: 'references',
              title: '参考文献'
            }
          ]
        }
      };

      await fsUtils.writeFileSafe(options.output, JSON.stringify(sampleConfig, null, 2));
      
      console.log(chalk.green('✅ サンプル設定ファイルを作成しました!'));
      console.log(chalk.blue(`📁 出力先: ${path.resolve(options.output)}`));
      console.log(chalk.yellow('設定ファイルを編集してから create-book コマンドを実行してください'));
      
    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// エラーハンドリング
program.on('command:*', () => {
  console.error(chalk.red('❌ 不明なコマンドです'));
  program.help();
});

// パースして実行
program.parse(process.argv);

// 引数がない場合はヘルプを表示
if (!process.argv.slice(2).length) {
  program.help();
}