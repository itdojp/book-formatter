#!/usr/bin/env node

/**
 * GitHub Pages status checker script
 * Checks the current deployment status of GitHub Pages
 */

import fs from 'fs-extra';
import path from 'path';

async function checkGitHubPagesStatus() {
  try {
    console.log('📊 GitHub Pages ステータスをチェックしています...\n');

    // Load configuration
    const configPath = path.join(process.cwd(), 'book-config.json');
    if (!(await fs.pathExists(configPath))) {
      console.error('❌ book-config.json が見つかりません');
      process.exit(1);
    }

    const config = await fs.readJson(configPath);
    const repository = config.repository;

    if (!repository || !repository.owner || !repository.name) {
      console.error('❌ リポジトリ情報が設定されていません');
      console.log('設定例:');
      console.log(JSON.stringify({
        repository: {
          owner: 'your-username',
          name: 'your-repo',
          url: 'https://github.com/your-username/your-repo'
        }
      }, null, 2));
      process.exit(1);
    }

    // Check if gh CLI is available
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(spawn);

    try {
      console.log('🔍 GitHub CLI の確認...');
      await new Promise((resolve, reject) => {
        const child = spawn('gh', ['--version'], { stdio: 'pipe' });
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('GitHub CLI が見つかりません'));
          }
        });
        child.on('error', reject);
      });
      console.log('✅ GitHub CLI が利用可能です\n');
    } catch (error) {
      console.log('❌ GitHub CLI が見つかりません');
      console.log('GitHub CLI をインストールしてください: https://cli.github.com/');
      console.log('または、GitHub の Web インターフェースで確認してください\n');
    }

    // GitHub API URLs
    const apiBase = 'https://api.github.com';
    const repoApiUrl = `${apiBase}/repos/${repository.owner}/${repository.name}`;
    const pagesApiUrl = `${repoApiUrl}/pages`;
    const buildsApiUrl = `${repoApiUrl}/pages/builds/latest`;

    console.log('📍 リポジトリ情報:');
    console.log(`  Owner: ${repository.owner}`);
    console.log(`  Repository: ${repository.name}`);
    console.log(`  API URL: ${repoApiUrl}\n`);

    // Try to fetch GitHub Pages information using gh CLI
    try {
      console.log('🔄 GitHub Pages 設定を取得中...');
      
      const pagesInfo = await new Promise((resolve, reject) => {
        const child = spawn('gh', ['api', `repos/${repository.owner}/${repository.name}/pages`], 
          { stdio: ['pipe', 'pipe', 'pipe'] });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout));
            } catch (e) {
              reject(new Error('GitHub Pages 情報の解析に失敗しました'));
            }
          } else {
            reject(new Error(stderr || 'GitHub Pages 情報の取得に失敗しました'));
          }
        });
      });

      console.log('✅ GitHub Pages 設定:');
      console.log(`  URL: ${pagesInfo.html_url || 'N/A'}`);
      console.log(`  Status: ${pagesInfo.status || 'N/A'}`);
      console.log(`  Source: ${pagesInfo.source?.branch || 'N/A'} / ${pagesInfo.source?.path || 'N/A'}`);
      console.log(`  Custom Domain: ${pagesInfo.cname || 'なし'}`);
      console.log(`  HTTPS: ${pagesInfo.https_enforced ? '有効' : '無効'}\n`);

      // Get latest build information
      try {
        console.log('🔄 最新ビルド情報を取得中...');
        
        const buildInfo = await new Promise((resolve, reject) => {
          const child = spawn('gh', ['api', `repos/${repository.owner}/${repository.name}/pages/builds/latest`], 
            { stdio: ['pipe', 'pipe', 'pipe'] });
          
          let stdout = '';
          let stderr = '';
          
          child.stdout.on('data', (data) => {
            stdout += data.toString();
          });
          
          child.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          
          child.on('close', (code) => {
            if (code === 0) {
              try {
                resolve(JSON.parse(stdout));
              } catch (e) {
                reject(new Error('ビルド情報の解析に失敗しました'));
              }
            } else {
              reject(new Error(stderr || 'ビルド情報の取得に失敗しました'));
            }
          });
        });

        console.log('📦 最新ビルド:');
        console.log(`  Status: ${buildInfo.status || 'N/A'}`);
        console.log(`  Commit: ${buildInfo.commit || 'N/A'}`);
        console.log(`  Created: ${buildInfo.created_at || 'N/A'}`);
        console.log(`  Updated: ${buildInfo.updated_at || 'N/A'}`);
        
        if (buildInfo.error && buildInfo.error.message) {
          console.log(`  Error: ${buildInfo.error.message}`);
        }
        
      } catch (buildError) {
        console.log('⚠️  ビルド情報の取得に失敗しました:', buildError.message);
      }

    } catch (pagesError) {
      console.log('⚠️  GitHub Pages 情報の取得に失敗しました:', pagesError.message);
      console.log('\n💡 考えられる原因:');
      console.log('  • GitHub Pages が有効になっていない');
      console.log('  • リポジトリがプライベートで適切な権限がない');
      console.log('  • GitHub CLI の認証が必要');
      console.log('\n🔧 解決方法:');
      console.log('  1. GitHub CLI でログイン: gh auth login');
      console.log('  2. リポジトリの Settings > Pages で GitHub Pages を有効化');
      console.log('  3. 適切な権限があることを確認');
    }

    // Check expected URLs
    console.log('\n🌐 予想される URL:');
    const deployment = config.deployment || {};
    
    if (deployment.customDomain) {
      console.log(`  カスタムドメイン: https://${deployment.customDomain}`);
    } else {
      console.log(`  GitHub Pages URL: https://${repository.owner}.github.io/${repository.name}`);
    }

    // Local file checks
    console.log('\n📁 ローカルファイル状況:');
    const checkFiles = [
      { file: '.nojekyll', description: 'Jekyll処理回避' },
      { file: '_config.yml', description: 'Jekyll設定' },
      { file: 'Gemfile', description: 'Ruby依存関係' },
      { file: 'CNAME', description: 'カスタムドメイン設定' },
      { file: '404.html', description: 'カスタム404ページ' }
    ];

    for (const { file, description } of checkFiles) {
      const filePath = path.join(process.cwd(), file);
      if (await fs.pathExists(filePath)) {
        console.log(`  ✅ ${file} (${description})`);
      } else {
        console.log(`  ❌ ${file} (${description}) - 見つかりません`);
      }
    }

    console.log('\n🎯 次のステップ:');
    console.log('  1. npm run validate-deploy - デプロイメント前の検証');
    console.log('  2. npm run deploy - GitHub Pages へのデプロイ');
    console.log('  3. GitHub の Settings > Pages でステータス確認');

  } catch (error) {
    console.error('❌ ステータス確認中にエラーが発生しました:', error.message);
    process.exit(1);
  }
}

// Run status check if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  checkGitHubPagesStatus();
}

export { checkGitHubPagesStatus };