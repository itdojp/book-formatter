import fs from 'fs-extra';
import path from 'path';

/**
 * テンプレートエンジン - 設定に基づいてファイルを生成
 */
export class TemplateEngine {
  constructor() {
    this.templates = new Map();
    this.loadBuiltInTemplates();
  }

  /**
   * 組み込みテンプレートを読み込む
   */
  loadBuiltInTemplates() {
    // index.md テンプレート
    this.templates.set('index.md', `---
title: "{{title}}"
description: "{{description}}"
author: "{{author}}"
version: "{{version}}"
---

# {{title}}

{{description}}

## 目次

{{#if structure.chapters}}
{{#each structure.chapters}}
- [第{{@index}}章 {{title}}](src/chapter-{{id}}/index.md)
{{/each}}
{{/if}}

{{#if structure.appendices}}
## 付録
{{#each structure.appendices}}
- [付録{{@index}} {{title}}](src/appendices/{{id}}.md)
{{/each}}
{{/if}}

---

**著者:** {{author}}  
**バージョン:** {{version}}  
**最終更新:** {{currentDate}}
`);

    // chapter.md テンプレート
    this.templates.set('chapter.md', `---
title: "{{chapter.title}}"
chapter: {{chapter.id}}
---

# {{chapter.title}}

{{#if chapter.description}}
{{chapter.description}}
{{/if}}

## 概要

この章では以下の内容について説明します：

{{#if chapter.objectives}}
{{#each chapter.objectives}}
- {{this}}
{{/each}}
{{else}}
- （目標を記載してください）
{{/if}}

## 内容

（章の内容をここに記載してください）

## まとめ

（章のまとめをここに記載してください）

---

{{#if chapter.exercises}}
## 演習問題

{{#each chapter.exercises}}
### 演習 {{@index}}
{{this}}
{{/each}}
{{/if}}
`);

    // _config.yml テンプレート (Jekyll用)
    this.templates.set('_config.yml', `title: "{{title}}"
description: "{{description}}"
author: "{{author}}"
version: "{{version}}"
lang: "{{language}}"

# Jekyll設定
markdown: kramdown
highlighter: rouge
theme: minima

# プラグイン
plugins:
  - jekyll-feed
  - jekyll-sitemap
  - jekyll-seo-tag

# 除外ファイル
exclude:
  - node_modules/
  - package.json
  - package-lock.json
  - scripts/
  - tests/
  - "*.md"
  - "README.md"

# 日本語対応
kramdown:
  input: GFM
  syntax_highlighter: rouge
  
# GitHub Pages設定
{{#if repository.url}}
repository: "{{repository.owner}}/{{repository.name}}"
{{/if}}
`);

    // package.json テンプレート
    this.templates.set('package.json', `{
  "name": "{{packageName}}",
  "version": "{{version}}",
  "description": "{{description}}",
  "main": "index.md",
  "scripts": {
    "start": "jekyll serve --livereload",
    "build": "jekyll build",
    "test": "npm run lint && npm run check-links",
    "lint": "markdownlint src/**/*.md",
    "check-links": "markdown-link-check src/**/*.md",
    "deploy": "gh-pages -d _site"
  },
  "keywords": [
    "book",
    "documentation",
    "{{language}}"
  ],
  "author": "{{author}}",
  "license": "{{license}}",
  "devDependencies": {
    "markdownlint-cli": "^0.37.0",
    "markdown-link-check": "^3.11.2",
    "gh-pages": "^6.0.0"
  },
  "repository": {
    "type": "git",
    "url": "{{repository.url}}"
  }
}`);

    // README.md テンプレート
    this.templates.set('README.md', `# {{title}}

{{description}}

## 概要

この書籍は{{language}}で書かれており、以下の内容を含んでいます：

{{#if structure.chapters}}
## 章構成

{{#each structure.chapters}}
- **第{{@index}}章: {{title}}**
{{#if description}}  
  {{description}}
{{/if}}
{{/each}}
{{/if}}

{{#if structure.appendices}}
## 付録

{{#each structure.appendices}}
- **付録{{@index}}: {{title}}**
{{/each}}
{{/if}}

## 開発環境

### 必要なソフトウェア

- Node.js (v18以上)
- Jekyll (v4.0以上)

### セットアップ

\`\`\`bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm start

# ビルド
npm run build
\`\`\`

## 著者

{{author}}

## ライセンス

{{license}}

## バージョン

{{version}}
`);
  }

  /**
   * テンプレートをレンダリングする
   * @param {string} templateName - テンプレート名
   * @param {Object} data - レンダリングに使用するデータ
   * @returns {string} レンダリング結果
   */
  render(templateName, data) {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`テンプレート "${templateName}" が見つかりません`);
    }

    // データの前処理
    const processedData = this.preprocessData(data);

    // テンプレートのレンダリング
    return this.renderTemplate(template, processedData);
  }

  /**
   * データの前処理を行う
   * @param {Object} data - 元のデータ
   * @returns {Object} 処理済みデータ
   */
  preprocessData(data) {
    const processed = { ...data };

    // デフォルト値の設定
    processed.version = processed.version || '1.0.0';
    processed.language = processed.language || 'ja';
    processed.license = processed.license || 'MIT';
    processed.currentDate = new Date().toISOString().split('T')[0];

    // パッケージ名の生成
    if (processed.title) {
      processed.packageName = processed.title
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    // リポジトリ情報の処理
    if (processed.repository?.url) {
      const match = processed.repository.url.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (match) {
        processed.repository.owner = match[1];
        processed.repository.name = match[2].replace(/\.git$/, '');
      }
    }

    return processed;
  }

  /**
   * テンプレートをレンダリングする（簡易版Handlebars風）
   * @param {string} template - テンプレート文字列
   * @param {Object} data - データ
   * @returns {string} レンダリング結果
   */
  renderTemplate(template, data) {
    let result = template;

    // 条件分岐 {{#if condition}}...{{/if}}
    result = result.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
      const value = this.getValueByPath(data, condition.trim());
      return value ? content : '';
    });

    // 配列の繰り返し {{#each array}}...{{/each}}
    result = result.replace(/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayPath, content) => {
      const array = this.getValueByPath(data, arrayPath.trim());
      if (!Array.isArray(array)) return '';

      return array.map((item, index) => {
        let itemContent = content;
        
        // @indexの置換
        itemContent = itemContent.replace(/\{\{@index\}\}/g, index + 1);
        
        // アイテムのプロパティ置換
        itemContent = itemContent.replace(/\{\{([^}@]+)\}\}/g, (itemMatch, key) => {
          const trimmedKey = key.trim();
          if (trimmedKey === 'this') {
            return item;
          }
          return this.getValueByPath(item, trimmedKey) || '';
        });

        return itemContent;
      }).join('');
    });

    // else句の処理 {{else}}
    result = result.replace(/\{\{else\}\}([\s\S]*?)(?=\{\{\/)/g, (match, content) => {
      return content;
    });

    // 変数の置換 {{variable}} (最後に実行)
    result = result.replace(/\{\{([^}#/@]+)\}\}/g, (match, key) => {
      return this.getValueByPath(data, key.trim()) || '';
    });

    return result;
  }

  /**
   * オブジェクトのパスから値を取得する
   * @param {Object} obj - オブジェクト
   * @param {string} path - パス（例: "structure.chapters"）
   * @returns {*} 値
   */
  getValueByPath(obj, path) {
    if (!obj || typeof obj !== 'object') return undefined;
    
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    
    return current;
  }

  /**
   * カスタムテンプレートを追加する
   * @param {string} name - テンプレート名
   * @param {string} template - テンプレート文字列
   */
  addTemplate(name, template) {
    this.templates.set(name, template);
  }

  /**
   * ファイルからテンプレートを読み込む
   * @param {string} templatePath - テンプレートファイルのパス
   */
  async loadTemplateFromFile(templatePath) {
    const name = path.basename(templatePath);
    const template = await fs.readFile(templatePath, 'utf8');
    this.addTemplate(name, template);
  }

  /**
   * 利用可能なテンプレート一覧を取得する
   * @returns {Array<string>} テンプレート名の配列
   */
  getAvailableTemplates() {
    return Array.from(this.templates.keys());
  }
}