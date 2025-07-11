# Book Formatter 改善提案

実際のプロジェクトでBook Formatterを使用した経験から、以下の改善を提案します。

## 1. ナビゲーション自動生成の改善

### 現状の問題
- ページ順序が自動的に決定されない
- 前へ/次へリンクが正しく生成されない

### 提案する改善

#### 1.1 設定ファイルでの順序定義

`book-config.json`に順序情報を追加:
```json
{
  "navigation": {
    "order": [
      "introduction/preface",
      "chapter-1/index",
      "chapter-2/index",
      "chapter-3/index",
      "chapter-4/index",
      "chapter-5/index",
      "chapter-6/index",
      "appendices/templates",
      "appendices/case-studies",
      "appendices/reading-list"
    ]
  }
}
```

#### 1.2 BookGeneratorでのナビゲーション生成

```javascript
// src/BookGenerator.js に追加
async generateNavigationData(config) {
    const navOrder = config.navigation?.order || [];
    const navigationData = {};
    
    navOrder.forEach((path, index) => {
        const prevPath = index > 0 ? navOrder[index - 1] : null;
        const nextPath = index < navOrder.length - 1 ? navOrder[index + 1] : null;
        
        navigationData[path] = {
            previous: prevPath,
            next: nextPath,
            index: index
        };
    });
    
    // _data/navigation.json として出力
    await this.fileUtils.writeFile(
        path.join(this.outputPath, '_data', 'navigation.json'),
        JSON.stringify(navigationData, null, 2)
    );
}
```

## 2. エラーハンドリングの強化

### 現状の問題
- JavaScriptエラーでページがハングする
- エラーメッセージが不親切

### 提案する改善

#### 2.1 安全なJavaScriptテンプレート

```javascript
// shared/assets/js/safe-main.js
(function() {
    'use strict';
    
    // エラーハンドリングラッパー
    function safeExecute(fn, fallback) {
        try {
            return fn();
        } catch (error) {
            console.error('Error in', fn.name, ':', error);
            if (fallback) fallback(error);
        }
    }
    
    // 各機能を安全に実行
    safeExecute(initSmoothScrolling);
    safeExecute(initSidebar);
    safeExecute(initTheme);
})();
```

#### 2.2 設定検証の強化

```javascript
// src/ConfigValidator.js の改善
validateNavigation(config) {
    const errors = [];
    
    if (config.navigation?.order) {
        const order = config.navigation.order;
        const uniquePaths = new Set(order);
        
        if (uniquePaths.size !== order.length) {
            errors.push('navigation.order contains duplicate paths');
        }
        
        // 各パスが実際に存在するか確認
        order.forEach(path => {
            const fullPath = path.join(this.basePath, 'src', `${path}.md`);
            if (!fs.existsSync(fullPath)) {
                errors.push(`Navigation path not found: ${path}`);
            }
        });
    }
    
    return errors;
}
```

## 3. GitHub Pages統合の改善

### 現状の問題
- GitHub Pages設定が手動
- ビルドタイプの選択が不明確

### 提案する改善

#### 3.1 初期設定スクリプト

```javascript
// scripts/setup-github-pages.js
const { execSync } = require('child_process');

async function setupGitHubPages(owner, repo) {
    console.log('Setting up GitHub Pages...');
    
    // GitHub Actions workflowを作成
    const workflowContent = `...`; // pages.yml の内容
    fs.writeFileSync('.github/workflows/pages.yml', workflowContent);
    
    // Gemfileを作成
    const gemfileContent = `
source "https://rubygems.org"
gem "github-pages", group: :jekyll_plugins
gem "jekyll-feed", "~> 0.12"
`;
    fs.writeFileSync('Gemfile', gemfileContent);
    
    // GitHub Pages設定
    execSync(`gh api -X PUT repos/${owner}/${repo}/pages --field build_type=workflow`);
    
    console.log('GitHub Pages setup complete!');
}
```

#### 3.2 設定ファイルテンプレートの改善

```yaml
# templates/_config.yml の改善
# デフォルト設定（すべてのページにbookレイアウトを適用）
defaults:
  - scope:
      path: ""
      type: "pages"
    values:
      layout: "book"
  - scope:
      path: "src"
    values:
      layout: "book"
```

## 4. モバイル対応の改善

### 現状の問題
- モバイル表示の設定が不完全
- タッチターゲットサイズが不適切

### 提案する改善

#### 4.1 レスポンシブ設定の標準化

```css
/* shared/assets/css/responsive.css */
:root {
    --mobile-breakpoint: 768px;
    --tablet-breakpoint: 1024px;
    --desktop-breakpoint: 1280px;
}

/* モバイルファースト設計 */
.container {
    width: 100%;
    padding: 1rem;
}

@media (min-width: 768px) {
    .container {
        max-width: 720px;
        margin: 0 auto;
    }
}

/* タッチターゲット最小サイズ保証 */
button, a, input, select, textarea {
    min-height: 44px;
    min-width: 44px;
}
```

## 5. 診断ツールの追加

### 提案する新機能

#### 5.1 ヘルスチェックコマンド

```javascript
// src/commands/healthcheck.js
class HealthCheck {
    async run(projectPath) {
        const checks = [];
        
        // 必須ファイルの存在確認
        checks.push(this.checkRequiredFiles(projectPath));
        
        // 設定ファイルの妥当性確認
        checks.push(this.validateConfig(projectPath));
        
        // リンクの有効性確認
        checks.push(this.checkLinks(projectPath));
        
        // パフォーマンス問題の検出
        checks.push(this.checkPerformance(projectPath));
        
        return this.generateReport(checks);
    }
}
```

#### 5.2 デバッグモード

```javascript
// BookGenerator に追加
async generate(config, options = {}) {
    if (options.debug) {
        console.log('Debug mode enabled');
        this.enableVerboseLogging();
    }
    
    // 各ステップの実行時間を計測
    const timer = new PerformanceTimer();
    
    timer.start('validation');
    await this.validateConfig(config);
    timer.end('validation');
    
    if (options.debug) {
        console.log(`Validation took: ${timer.get('validation')}ms`);
    }
    
    // 以下同様...
}
```

## 6. テンプレートカスタマイズの容易化

### 提案する改善

#### 6.1 テーマシステム

```javascript
// themes/default/theme.json
{
  "name": "default",
  "version": "1.0.0",
  "colors": {
    "primary": "#007bff",
    "secondary": "#6c757d"
  },
  "fonts": {
    "body": "system-ui, -apple-system, sans-serif",
    "heading": "Georgia, serif"
  },
  "layouts": {
    "sidebar": "left",
    "toc": "right"
  }
}
```

#### 6.2 コンポーネント化

```
shared/
  components/
    navigation/
      sidebar.html
      breadcrumb.html
      page-nav.html
    content/
      toc.html
      code-block.html
    ui/
      button.html
      card.html
```

## 7. パフォーマンス最適化

### 提案する改善

#### 7.1 アセット最適化

```javascript
// scripts/optimize-assets.js
const imagemin = require('imagemin');
const terser = require('terser');
const cssnano = require('cssnano');

async function optimizeAssets(outputPath) {
    // 画像最適化
    await imagemin([`${outputPath}/assets/images/*.{jpg,png}`], {
        destination: `${outputPath}/assets/images`,
        plugins: [/* ... */]
    });
    
    // JavaScript最小化
    const jsFiles = glob.sync(`${outputPath}/assets/js/*.js`);
    for (const file of jsFiles) {
        const minified = await terser.minify(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, minified.code);
    }
    
    // CSS最小化
    // ...
}
```

## 実装優先順位

1. **高優先度**
   - ナビゲーション自動生成（問題解決に直結）
   - エラーハンドリング強化（安定性向上）
   - GitHub Pages統合改善（セットアップ簡素化）

2. **中優先度**
   - モバイル対応改善
   - 診断ツール追加
   - テンプレートカスタマイズ

3. **低優先度**
   - パフォーマンス最適化（現状でも十分高速）

これらの改善により、Book Formatterはより使いやすく、エラーに強いツールになると考えられます。