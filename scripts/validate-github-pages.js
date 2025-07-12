#!/usr/bin/env node

/**
 * GitHub Pages deployment validation script
 * Validates configuration and files before deployment
 */

import fs from 'fs-extra';
import path from 'path';
import { GitHubPagesHandler } from '../src/GitHubPagesHandler.js';

async function validateGitHubPages() {
  try {
    console.log('🔍 GitHub Pages デプロイメント検証を開始します...\n');

    // Load configuration
    const configPath = path.join(process.cwd(), 'book-config.json');
    if (!(await fs.pathExists(configPath))) {
      console.error('❌ book-config.json が見つかりません');
      process.exit(1);
    }

    const config = await fs.readJson(configPath);
    const outputPath = process.cwd();

    // Initialize GitHub Pages handler
    const errorHandler = {
      safeExecute: async (fn) => await fn()
    };
    const githubPagesHandler = new GitHubPagesHandler(errorHandler);

    // Run validation
    const validation = await githubPagesHandler.validateGitHubPagesCompatibility(config, outputPath);

    // Display results
    console.log('📋 検証結果:\n');

    if (validation.isValid) {
      console.log('✅ GitHub Pages 互換性: 合格');
    } else {
      console.log('❌ GitHub Pages 互換性: 失敗');
    }

    if (validation.errors.length > 0) {
      console.log('\n🚨 エラー:');
      validation.errors.forEach(error => {
        console.log(`  • ${error}`);
      });
    }

    if (validation.warnings.length > 0) {
      console.log('\n⚠️  警告:');
      validation.warnings.forEach(warning => {
        console.log(`  • ${warning}`);
      });
    }

    if (validation.suggestions.length > 0) {
      console.log('\n💡 推奨事項:');
      validation.suggestions.forEach(suggestion => {
        console.log(`  • ${suggestion}`);
      });
    }

    // Check Jekyll configuration
    const jekyllConfigPath = path.join(outputPath, '_config.yml');
    if (await fs.pathExists(jekyllConfigPath)) {
      console.log('\n✅ Jekyll設定ファイル (_config.yml) が見つかりました');
    } else {
      console.log('\n❌ Jekyll設定ファイル (_config.yml) が見つかりません');
      validation.isValid = false;
    }

    // Check for GitHub Pages essential files
    const essentialFiles = [
      { file: '.nojekyll', description: 'Jekyll処理回避ファイル' },
      { file: 'Gemfile', description: 'Ruby依存関係ファイル' },
      { file: '404.html', description: 'カスタム404ページ' },
      { file: 'robots.txt', description: 'ロボット制御ファイル' }
    ];

    console.log('\n📁 必須ファイルチェック:');
    for (const { file, description } of essentialFiles) {
      const filePath = path.join(outputPath, file);
      if (await fs.pathExists(filePath)) {
        console.log(`  ✅ ${file} (${description})`);
      } else {
        console.log(`  ❌ ${file} (${description}) - 見つかりません`);
      }
    }

    // Check deployment configuration
    console.log('\n🚀 デプロイメント設定:');
    const deployment = config.deployment || {};
    
    if (deployment.platform === 'github-pages') {
      console.log('  ✅ プラットフォーム: GitHub Pages');
      
      if (deployment.method) {
        console.log(`  ✅ デプロイ方式: ${deployment.method}`);
      } else {
        console.log('  ⚠️  デプロイ方式が未設定');
      }
      
      if (deployment.customDomain) {
        console.log(`  ✅ カスタムドメイン: ${deployment.customDomain}`);
        
        // Check CNAME file
        const cnamePath = path.join(outputPath, 'CNAME');
        if (await fs.pathExists(cnamePath)) {
          console.log('  ✅ CNAME ファイルが設定されています');
        } else {
          console.log('  ❌ CNAME ファイルが見つかりません');
        }
      }
    } else {
      console.log('  ⚠️  GitHub Pages用の設定がありません');
    }

    // Final summary
    console.log('\n📊 検証サマリー:');
    console.log(`  エラー: ${validation.errors.length}件`);
    console.log(`  警告: ${validation.warnings.length}件`);
    console.log(`  推奨事項: ${validation.suggestions.length}件`);

    if (validation.isValid && validation.errors.length === 0) {
      console.log('\n🎉 GitHub Pages デプロイメントの準備が完了しています！');
      process.exit(0);
    } else {
      console.log('\n❌ 修正が必要な問題があります。上記のエラーと警告を確認してください。');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ 検証中にエラーが発生しました:', error.message);
    process.exit(1);
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateGitHubPages();
}

export { validateGitHubPages };