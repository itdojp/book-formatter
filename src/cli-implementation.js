#!/usr/bin/env node

import bootstrapApi from './ConsumerDependencyBootstrap.cjs';

const {
  assertFreshDependencyRuntimePresent,
  isLegacyMutationInvocation
} = bootstrapApi;

if (isLegacyMutationInvocation(process.argv.slice(2))) {
  // The supported src/index.js entrypoint establishes this state through an
  // in-process, module-private capability after rebuilding dependencies.
  // Direct invocation of this internal implementation must fail before
  // Commander dispatches a command.
  assertFreshDependencyRuntimePresent(process.cwd());
}

const [
  { Command },
  { default: chalk },
  { default: path },
  { BookGenerator },
  { ConfigValidator },
  { FileSystemUtils },
  { UxRollout },
  { AdapterBuildError, buildStandardBookAdapter },
  { VisibilityValidationError },
  { StandardBookValidationError },
  { loadConsumerMutationPlan, selectConsumers }
] = await Promise.all([
  import('commander'),
  import('chalk'),
  import('node:path'),
  import('./BookGenerator.js'),
  import('./ConfigValidator.js'),
  import('./FileSystemUtils.js'),
  import('./UxRollout.js'),
  import('./AdapterBuild.js'),
  import('./VisibilityChecker.js'),
  import('./StandardBookValidator.js'),
  import('./ConsumerMutationBoundary.js')
]);

const program = new Command();
const bookGenerator = new BookGenerator();
const configValidator = new ConfigValidator();
const fsUtils = new FileSystemUtils();
const uxRollout = new UxRollout();

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
  .requiredOption('--plan <path>', '監査済みconsumer mutation plan')
  .option('--target <consumer-id>', 'writeする単一consumer ID')
  .option('--dry-run', 'preflightとmanaged pathの表示だけを行います', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('📚 書籍を更新しています...'));

      const plan = await loadConsumerMutationPlan(options.plan, {
        expectedOperation: 'update-book'
      });
      const consumers = selectConsumers(plan, {
        targetId: options.target,
        dryRun: options.dryRun
      });
      for (const consumer of consumers) {
        console.log(chalk.blue(`\n📚 処理中: ${consumer.id}`));
        await bookGenerator.updateBook(plan, consumer, { dryRun: options.dryRun });
      }

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
  .description('有限planの書籍を検査し、write時は1冊だけ更新します')
  .requiredOption('--plan <path>', '監査済みconsumer mutation plan')
  .option('--target <consumer-id>', 'writeする単一consumer ID')
  .option('--dry-run', '実際には実行せず、実行予定の操作を表示します', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔄 有限consumer planを検査しています...'));
      const plan = await loadConsumerMutationPlan(options.plan, {
        expectedOperation: 'sync-all-books'
      });
      const consumers = selectConsumers(plan, {
        targetId: options.target,
        dryRun: options.dryRun
      });
      const results = [];
      for (const consumer of consumers) {
        console.log(chalk.blue(`\n📚 処理中: ${consumer.id}`));
        const result = await bookGenerator.updateBook(plan, consumer, {
          dryRun: options.dryRun
        });
        results.push({ id: consumer.id, result });
      }

      console.log(chalk.blue('\n📊 同期結果:'));
      console.log(chalk.green(`  ${options.dryRun ? '検査' : '更新'}: ${results.length}`));
      if (!options.dryRun) {
        console.log(chalk.yellow('  次のconsumerはreview gate完了後に別実行で明示してください'));
      }

    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// rollout-ux コマンド
program
  .command('rollout-ux')
  .description('レジストリに基づき既存書籍へUX設定/共通コアを段階適用します')
  .requiredOption('--plan <path>', '監査済みconsumer mutation plan')
  .option('--target <consumer-id>', 'writeする単一consumer ID')
  .option('-r, --registry <path>', 'book-registry のパス（json/yaml）')
  .option('--apply-ux-core', '共通コア（layouts/includes/assets）を適用します', false)
  .option('--apply-ux-profile', 'book-config に ux.profile/modules を付与します', false)
  .option('--dry-run', '実際には実行せず、予定のみ表示します', false)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🧭 UX ロールアウトを開始します...'));

      if (!options.applyUxCore && !options.applyUxProfile) {
        throw new Error('--apply-ux-core もしくは --apply-ux-profile を指定してください');
      }
      const operation = options.applyUxCore && options.applyUxProfile
        ? 'rollout-ux-core-profile'
        : options.applyUxCore
          ? 'rollout-ux-core'
          : 'rollout-ux-profile';
      const plan = await loadConsumerMutationPlan(options.plan, {
        expectedOperation: operation
      });
      const consumers = selectConsumers(plan, {
        targetId: options.target,
        dryRun: options.dryRun
      });

      await uxRollout.rollout({
        plan,
        consumers,
        registryPath: options.registry,
        applyUxCore: options.applyUxCore,
        applyUxProfile: options.applyUxProfile,
        dryRun: options.dryRun
      });

      console.log(chalk.green('✅ UX ロールアウトが完了しました'));
    } catch (error) {
      console.error(chalk.red(`❌ エラーが発生しました: ${error.message}`));
      process.exit(1);
    }
  });

// build コマンド
program
  .command('build')
  .description('標準書籍を出力先adapter向けに検証し、manifestを生成します')
  .requiredOption('-b, --book <path>', 'book.yamlを含む標準書籍ディレクトリ')
  .requiredOption('-t, --target <target>', '出力先adapter target')
  .requiredOption('-e, --edition <id>', 'book.yamlで宣言したedition ID')
  .option('-o, --out-dir <path>', 'target別ディレクトリを配置する出力root')
  .option('--dry-run', '検証結果とmanifestを表示し、ファイルを書き込みません', false)
  .action(async (options) => {
    try {
      const result = await buildStandardBookAdapter({
        bookDirectory: options.book,
        target: options.target,
        editionId: options.edition,
        outputRoot: options.outDir,
        dryRun: options.dryRun
      });

      process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
      if (result.written) {
        console.error(chalk.green(`✅ adapter manifestを出力しました: ${result.manifestPath}`));
      } else {
        console.error(chalk.blue(`🔎 dry-run: 書き込みなし (${result.manifestPath})`));
      }
    } catch (error) {
      if (
        error instanceof AdapterBuildError ||
        error instanceof VisibilityValidationError ||
        error instanceof StandardBookValidationError
      ) {
        console.error(chalk.red(`❌ adapter build failed: ${error.message}`));
      } else {
        console.error(chalk.red(`❌ unexpected adapter build failure: ${error.message}`));
      }
      process.exitCode = 1;
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
        license: 'CC BY-NC-SA 4.0',
        repository: {
          url: 'https://github.com/user/repo.git',
          branch: 'main'
        },
        ux: {
          profile: 'A',
          modules: {
            quickStart: true,
            readingGuide: true,
            checklistPack: false,
            troubleshootingFlow: false,
            conceptMap: true,
            figureIndex: false,
            legalNotice: false,
            glossary: true
          }
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
await program.parseAsync(process.argv);

// 引数がない場合はヘルプを表示
if (!process.argv.slice(2).length) {
  program.help();
}
