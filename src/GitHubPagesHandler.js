import fs from 'fs-extra';
import path from 'path';

/**
 * GitHub Pages deployment and configuration handler
 * Provides enhanced GitHub Pages integration features
 */

export class GitHubPagesHandler {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
  }

  /**
   * Setup GitHub Pages configuration and files
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async setupGitHubPages(config, outputPath) {
    return this.errorHandler.safeExecute(async () => {
      const deployment = config.deployment || {};
      
      // Generate GitHub Pages essential files
      await this.generateNoJekyllFile(outputPath);
      await this.generateGemfile(outputPath, deployment);
      await this.generate404Page(config, outputPath);
      await this.generateRobotsTxt(config, outputPath);
      
      // Generate CNAME if custom domain specified
      if (deployment.customDomain) {
        await this.generateCNameFile(deployment.customDomain, outputPath);
      }
      
      // Generate GitHub Actions workflow if using actions deployment
      if (deployment.method === 'actions') {
        await this.generateWorkflow(config, outputPath);
      }
      
      console.log('✅ GitHub Pages configuration completed');
      
    }, 'setupGitHubPages');
  }

  /**
   * Generate .nojekyll file to prevent Jekyll processing issues
   * @param {string} outputPath - Output directory path
   */
  async generateNoJekyllFile(outputPath) {
    const nojekyllPath = path.join(outputPath, '.nojekyll');
    await fs.writeFile(nojekyllPath, '');
    console.log('📝 Generated .nojekyll file');
  }

  /**
   * Generate Gemfile for GitHub Pages gem dependencies
   * @param {string} outputPath - Output directory path
   * @param {Object} deployment - Deployment configuration
   */
  async generateGemfile(outputPath, deployment) {
    
    const gemfileContent = `source "https://rubygems.org"

# GitHub Pages gem
gem "github-pages", group: :jekyll_plugins

# Additional plugins
group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.12"
  gem "jekyll-sitemap"
  gem "jekyll-seo-tag"
  gem "jekyll-relative-links"
  gem "jekyll-optional-front-matter"
end

# Windows and JRuby specific gems
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1.1", :platforms => [:mingw, :x64_mingw, :mswin]

# HTTP server for testing
gem "webrick", "~> 1.7"
`;

    const gemfilePath = path.join(outputPath, 'Gemfile');
    await fs.writeFile(gemfilePath, gemfileContent);
    console.log('📝 Generated Gemfile');
  }

  /**
   * Generate custom 404 page
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generate404Page(config, outputPath) {
    
    const page404Content = `---
layout: default
title: ページが見つかりません
permalink: /404.html
---

<div class="page-not-found">
  <h1>404 - ページが見つかりません</h1>
  
  <p>申し訳ございませんが、お探しのページは見つかりませんでした。</p>
  
  <div class="suggestions">
    <h2>以下をお試しください:</h2>
    <ul>
      <li><a href="{{ site.baseurl }}/">ホームページ</a>に戻る</li>
      <li>URLのスペルを確認する</li>
      <li>サイトマップから目的のページを探す</li>
    </ul>
  </div>
  
  <div class="book-info">
    <h3>${config.title || 'この書籍について'}</h3>
    <p>${config.description || ''}</p>
    <p>著者: ${config.author || ''}</p>
  </div>
</div>

<style>
.page-not-found {
  max-width: 600px;
  margin: 2rem auto;
  padding: 2rem;
  text-align: center;
}

.page-not-found h1 {
  color: #e74c3c;
  margin-bottom: 1rem;
}

.suggestions {
  margin: 2rem 0;
  text-align: left;
}

.suggestions ul {
  list-style-type: disc;
  margin-left: 2rem;
}

.book-info {
  margin-top: 2rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 0.5rem;
}
</style>
`;

    const page404Path = path.join(outputPath, '404.html');
    await fs.writeFile(page404Path, page404Content);
    console.log('📝 Generated 404.html page');
  }

  /**
   * Generate robots.txt file
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generateRobotsTxt(config, outputPath) {
    
    const deployment = config.deployment || {};
    const baseUrl = deployment.customDomain 
      ? `https://${deployment.customDomain}`
      : `https://${config.repository?.owner || 'user'}.github.io/${config.repository?.name || 'repo'}`;
    
    const robotsContent = `User-agent: *
Allow: /

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml

# Disallow build directories
Disallow: /_site/
Disallow: /.sass-cache/
Disallow: /.jekyll-cache/
Disallow: /node_modules/
`;

    const robotsPath = path.join(outputPath, 'robots.txt');
    await fs.writeFile(robotsPath, robotsContent);
    console.log('📝 Generated robots.txt');
  }

  /**
   * Generate CNAME file for custom domain
   * @param {string} customDomain - Custom domain name
   * @param {string} outputPath - Output directory path
   */
  async generateCNameFile(customDomain, outputPath) {
    
    const cnamePath = path.join(outputPath, 'CNAME');
    await fs.writeFile(cnamePath, customDomain);
    console.log(`📝 Generated CNAME file for ${customDomain}`);
  }

  /**
   * Generate GitHub Actions workflow for deployment
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generateWorkflow(config, outputPath) {
    
    const workflowContent = `name: Deploy to GitHub Pages

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.1'
          bundler-cache: true

      - name: Setup Pages
        id: pages
        uses: actions/configure-pages@v4

      - name: Build with Jekyll
        run: bundle exec jekyll build --baseurl "\${{ steps.pages.outputs.base_path }}"
        env:
          JEKYLL_ENV: production

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3

  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master'
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

    const workflowDir = path.join(outputPath, '.github', 'workflows');
    await fs.ensureDir(workflowDir);
    
    const workflowPath = path.join(workflowDir, 'deploy-pages.yml');
    await fs.writeFile(workflowPath, workflowContent);
    console.log('📝 Generated GitHub Actions workflow');
  }

  /**
   * Enhanced Jekyll configuration for GitHub Pages
   * @param {Object} config - Book configuration
   * @returns {Object} Enhanced Jekyll config
   */
  enhanceJekyllConfig(config) {
    const deployment = config.deployment || {};
    const repository = config.repository || {};
    
    // Calculate baseurl for project pages
    let baseurl = '';
    if (deployment.baseurl) {
      baseurl = deployment.baseurl;
    } else if (!deployment.customDomain && repository.name) {
      baseurl = `/${repository.name}`;
    }
    
    // Calculate site URL
    let url = '';
    if (deployment.customDomain) {
      url = `https://${deployment.customDomain}`;
    } else if (repository.owner) {
      url = `https://${repository.owner}.github.io`;
    }

    const enhancedConfig = {
      // Basic site information
      title: config.title,
      description: config.description,
      author: config.author,
      
      // GitHub Pages specific settings
      url: url,
      baseurl: baseurl,
      
      // GitHub repository information
      repository: repository.url ? `${repository.owner}/${repository.name}` : null,
      github_username: repository.owner,
      
      // Jekyll settings optimized for GitHub Pages
      markdown: 'kramdown',
      highlighter: 'rouge',
      theme: 'minima',
      
      // Plugins compatible with GitHub Pages
      plugins: [
        'jekyll-feed',
        'jekyll-sitemap',
        'jekyll-seo-tag',
        'jekyll-relative-links',
        'jekyll-optional-front-matter'
      ],
      
      // Build settings
      source: '.',
      destination: './_site',
      safe: true,
      exclude: [
        'node_modules/',
        'package.json',
        'package-lock.json',
        'Gemfile',
        'Gemfile.lock',
        'README.md',
        'LICENSE',
        '.gitignore',
        '.github/',
        'src/',
        'tests/',
        'scripts/'
      ],
      
      // Relative links settings
      relative_links: {
        enabled: true,
        collections: true
      },
      
      // Optional front matter
      optional_front_matter: {
        remove_originals: true
      },
      
      // Kramdown settings
      kramdown: {
        input: 'GFM',
        hard_wrap: false,
        auto_ids: true,
        footnote_nr: 1,
        entity_output: 'as_char',
        toc_levels: '1..6',
        smart_quotes: 'lsquo,rsquo,ldquo,rdquo',
        enable_coderay: false
      },
      
      // Collections for chapters
      collections: {
        chapters: {
          output: true,
          permalink: '/:collection/:name/'
        }
      },
      
      // Default front matter
      defaults: [
        {
          scope: {
            path: '',
            type: 'posts'
          },
          values: {
            layout: 'post',
            author: config.author
          }
        },
        {
          scope: {
            path: '',
            type: 'chapters'
          },
          values: {
            layout: 'chapter'
          }
        }
      ],
      
      // SEO settings
      lang: config.language || 'ja',
      timezone: 'Asia/Tokyo'
    };

    return enhancedConfig;
  }

  /**
   * Validate GitHub Pages compatibility
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   * @returns {Object} Validation results
   */
  async validateGitHubPagesCompatibility(config, outputPath) {
    return this.errorHandler.safeExecute(async () => {
      
      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        suggestions: []
      };

      // Check for .nojekyll file
      const nojekyllPath = path.join(outputPath, '.nojekyll');
      if (!(await fs.pathExists(nojekyllPath))) {
        validation.warnings.push('.nojekyll ファイルが見つかりません');
        validation.suggestions.push('.nojekyll ファイルを生成してJekyll処理の問題を回避してください');
      }

      // Check for Gemfile
      const gemfilePath = path.join(outputPath, 'Gemfile');
      if (!(await fs.pathExists(gemfilePath))) {
        validation.warnings.push('Gemfile が見つかりません');
        validation.suggestions.push('GitHub Pages gem用のGemfileを生成してください');
      }

      // Check repository configuration
      if (!config.repository || !config.repository.owner || !config.repository.name) {
        validation.warnings.push('リポジトリ情報が不完全です');
        validation.suggestions.push('config.repository.owner と config.repository.name を設定してください');
      }

      // Check deployment configuration
      const deployment = config.deployment || {};
      if (!deployment.method) {
        validation.warnings.push('デプロイ方式が指定されていません');
        validation.suggestions.push('config.deployment.method を "branch" または "actions" に設定してください');
      }

      // Check for large files (GitHub has 100MB limit)
      try {
        const stats = await this.checkFileSizes(outputPath);
        const largeFiles = stats.filter(file => file.size > 50 * 1024 * 1024); // 50MB threshold
        
        if (largeFiles.length > 0) {
          validation.warnings.push(`大きなファイルが検出されました: ${largeFiles.map(f => f.name).join(', ')}`);
          validation.suggestions.push('GitHub Pagesは100MBを超えるファイルをサポートしていません');
        }
      } catch (error) {
        // File size check failed, but not critical
        validation.warnings.push('ファイルサイズチェックに失敗しました');
      }

      // Check for Liquid syntax conflicts
      try {
        const conflicts = await this.checkLiquidConflicts(outputPath);
        if (conflicts.length > 0) {
          validation.errors.push(`Liquid構文の競合が検出されました: ${conflicts.join(', ')}`);
          validation.isValid = false;
        }
      } catch (error) {
        validation.warnings.push('Liquid構文チェックに失敗しました');
      }

      return validation;
    }, 'validateGitHubPagesCompatibility');
  }

  /**
   * Check file sizes in output directory
   * @param {string} outputPath - Output directory path
   * @returns {Array} Array of file information with sizes
   */
  async checkFileSizes(outputPath) {
    
    const files = [];
    
    async function scanDirectory(dir) {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory()) {
          await scanDirectory(fullPath);
        } else {
          files.push({
            name: path.relative(outputPath, fullPath),
            size: stats.size
          });
        }
      }
    }
    
    await scanDirectory(outputPath);
    return files;
  }

  /**
   * Check for Liquid syntax conflicts
   * @param {string} outputPath - Output directory path
   * @returns {Array} Array of files with conflicts
   */
  async checkLiquidConflicts(outputPath) {
    
    const conflicts = [];
    const liquidPatterns = [
      /\{\{[^}]*\}\}/g,  // {{ variable }}
      /\{%[^%]*%\}/g     // {% tag %}
    ];
    
    async function scanForConflicts(dir) {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory() && !item.startsWith('.')) {
          await scanForConflicts(fullPath);
        } else if (item.endsWith('.md') || item.endsWith('.html')) {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            
            for (const pattern of liquidPatterns) {
              if (pattern.test(content)) {
                conflicts.push(path.relative(outputPath, fullPath));
                break;
              }
            }
          } catch (error) {
            // Skip files that can't be read
          }
        }
      }
    }
    
    await scanForConflicts(outputPath);
    return conflicts;
  }
}