# Book Formatter トラブルシューティングガイド

このドキュメントは、Book Publishing Template v3.0を使用して書籍を生成・公開する際に遭遇する可能性のある問題と解決方法をまとめたものです。

## 目次

1. [GitHub Pages関連の問題](#github-pages関連の問題)
2. [ナビゲーション関連の問題](#ナビゲーション関連の問題)
3. [JavaScript関連の問題](#javascript関連の問題)
4. [レイアウト・デザイン関連の問題](#レイアウトデザイン関連の問題)
5. [設定ファイル関連の問題](#設定ファイル関連の問題)

## GitHub Pages関連の問題

### 問題: ページが表示されない、404エラーになる

**原因**: 
- GitHub Pagesの設定が正しくない
- ビルドタイプが不適切
- パスの設定ミス

**解決方法**:
1. GitHub Pagesの設定を確認
```bash
gh api repos/[owner]/[repo]/pages --jq '{status, html_url, source, build_type}'
```

2. ビルドタイプを`workflow`に変更（推奨）
```bash
gh api -X PUT repos/[owner]/[repo]/pages --field build_type=workflow
```

3. GitHub Actions workflowファイルを追加
```yaml
# .github/workflows/pages.yml
name: Deploy Jekyll with GitHub Pages dependencies preinstalled

on:
  push:
    branches: ["main"]
  workflow_dispatch:

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
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Build with Jekyll
        uses: actions/jekyll-build-pages@v1
        with:
          source: ./
          destination: ./_site
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 問題: ビルドは成功するが、最新の変更が反映されない

**原因**: ブラウザキャッシュ

**解決方法**:
- ブラウザキャッシュをクリア（Ctrl+Shift+Delete）
- ハードリフレッシュ（Ctrl+F5 または Cmd+Shift+R）
- シークレット/プライベートブラウジングで確認

## ナビゲーション関連の問題

### 問題: サイドバーナビゲーションが表示されない

**原因**: 
- レイアウトファイルが正しく設定されていない
- _config.ymlの構造設定が不足

**解決方法**:

1. _config.ymlに`structure`セクションを追加（ただし、動的に生成される場合は不要）
2. sidebar-nav.htmlを静的なリンクに変更

```html
<!-- _includes/sidebar-nav.html の例 -->
<div class="toc-section">
    <h4 class="toc-section-title">本編</h4>
    <ul class="toc-list">
        <li class="toc-item toc-chapter">
            <a href="{{ '/src/chapter-1/index.html' | relative_url }}" class="toc-link">
                <span class="chapter-number">第1章</span>
                <span class="chapter-title">タイトル</span>
            </a>
        </li>
        <!-- 他の章も同様に -->
    </ul>
</div>
```

3. 各ページのレイアウトを確認
```yaml
# 各Markdownファイルのフロントマター
---
layout: book  # defaultではなくbook
---
```

### 問題: ページナビゲーション（前へ/次へ）のリンクが正しくない

**原因**: 動的なページ順序の計算が失敗

**解決方法**: 
page-navigation.htmlで静的な順序を定義

```liquid
{% if current_url contains '/chapter-1/' %}
    {% assign previous_page_url = '/src/introduction/preface.html' %}
    {% assign previous_page_title = 'まえがき' %}
    {% assign next_page_url = '/src/chapter-2/index.html' %}
    {% assign next_page_title = '第2章 タイトル' %}
{% elsif current_url contains '/chapter-2/' %}
    <!-- 以下同様に続く -->
{% endif %}
```

### 問題: 付録などのリンクが404エラーになる

**原因**: ファイルが存在しない

**解決方法**: 
必要なファイルを作成
```bash
mkdir -p src/appendices
touch src/appendices/templates.md
touch src/appendices/case-studies.md
touch src/appendices/reading-list.md
```

## JavaScript関連の問題

### 問題: ページ読み込み時にブラウザがハングする

**原因**: 
- 複雑な正規表現処理
- 無限ループの可能性
- 重いDOM操作

**解決方法**:

1. 問題のあるJavaScriptファイルを特定して無効化
```html
<!-- _layouts/book.html -->
<!-- 一時的に無効化 -->
<!-- <script src="{{ '/assets/js/main.js' | relative_url }}"></script> -->
```

2. 正規表現を簡素化
```javascript
// 変更前（重い）
.replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf]+/g, '-')

// 変更後（軽い）
.replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+/g, '-')
.substring(0, 50); // 長さ制限
```

3. 重い処理を遅延実行
```javascript
function init() {
    addStyles();
    initSmoothScrolling();
    
    // 重い処理は遅延実行
    setTimeout(() => {
        addHeadingIds();
        generateTOC();
        handleExternalLinks();
        enhanceImages();
    }, 100);
}
```

## レイアウト・デザイン関連の問題

### 問題: モバイル表示が崩れる

**原因**: 
- viewportメタタグの設定不足
- レスポンシブCSS不足

**解決方法**:

1. viewportメタタグを適切に設定
```html
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
```

2. レスポンシブブレークポイントを統一
```css
/* モバイル対応 */
@media (max-width: 768px) {
    /* モバイル用スタイル */
}

/* デスクトップ */
@media (min-width: 769px) {
    /* デスクトップ用スタイル */
}
```

### 問題: ダークモードが機能しない

**原因**: CSS変数の設定不足

**解決方法**: 
CSS変数を使用した実装を確認
```css
:root {
    --bg-primary: #ffffff;
    --text-primary: #333333;
}

[data-theme="dark"] {
    --bg-primary: #1a1a1a;
    --text-primary: #e0e0e0;
}
```

## 設定ファイル関連の問題

### 問題: CSSファイルが読み込まれない

**原因**: パスの不一致

**解決方法**:
1. レイアウトファイルのCSS参照を確認
```html
<!-- _layouts/default.html -->
<link rel="stylesheet" href="{{ '/assets/css/main.css' | relative_url }}">
```

2. 実際のCSSファイルパスと一致することを確認

### 問題: Jekyllの設定が反映されない

**原因**: _config.ymlの構文エラー

**解決方法**:
1. YAMLの構文を検証
2. インデントの統一（スペース2つまたは4つ）
3. 特殊文字のエスケープ

## ベストプラクティス

### 1. 開発環境での確認

ローカルでJekyllを実行して確認（要Ruby環境）:
```bash
bundle install
bundle exec jekyll serve
```

### 2. デバッグ情報の活用

GitHubのビルドログを確認:
```bash
gh run list --limit 5
gh run view [RUN_ID] --log
```

### 3. 段階的な変更

大きな変更は段階的に実施し、各段階で動作確認を行う。

### 4. バックアップ

重要な変更前にはブランチを作成:
```bash
git checkout -b feature/major-change
```

## 関連リソース

- [Jekyll公式ドキュメント](https://jekyllrb.com/docs/)
- [GitHub Pages公式ドキュメント](https://docs.github.com/pages)
- [GitHub Actions公式ドキュメント](https://docs.github.com/actions)

## negotiation-for-engineers プロジェクト実施時の追加知見

### 問題: ブラウザハングアップ（Chapter読み込み時に応答しなくなる）

**原因**: 
- `main.js`のヘディングID生成処理で無限ループが発生
- `search.js`の検索インデックス構築処理が重い
- `code-copy.js`の過剰なDOM操作

**症状**:
- 特定の章（特に第1章）でブラウザがフリーズ
- コンソールエラーは出ないが、ページが応答しなくなる
- モバイルブラウザでも同様の問題が発生

**解決方法**:
問題のあるJavaScriptファイルを一時的に無効化
```javascript
// assets/js/main.js
console.log('Main.js loaded but functionality disabled for performance');
// 元の機能をすべてコメントアウト

// assets/js/search.js  
console.log('Search.js loaded but functionality disabled for performance');
// 検索機能を無効化

// assets/js/code-copy.js
console.log('Code-copy.js loaded but functionality disabled for performance');
// コードコピー機能を無効化
```

**予防策**:
- JavaScriptの処理でDOM要素数が多い場合は、バッチ処理や遅延実行を使用
- 無限ループを防ぐための上限値設定
- パフォーマンス重要なページでは必要最小限の機能のみ有効化

### 問題: パンくずリストが不要だが表示される

**原因**: 
- book.htmlレイアウトでパンくずリストが自動生成される
- 他の書籍との一貫性のためパンくずリストを削除したい場合

**解決方法**:
1. `_includes/breadcrumb.html`を無効化
```html
<!-- Breadcrumb navigation is disabled for this book -->
<!-- To maintain consistent design, this component is left empty -->
```

2. `_layouts/book.html`からパンくず表示部分を削除
```html
<!-- Breadcrumb removed for this book -->
```

### 問題: サイドバーナビゲーションに目次が表示されない

**原因**: 
- `_config.yml`のサイト構造設定が不適切
- `site.structure`ではなく`structure`として設定する必要がある

**解決方法**:
`_config.yml`を正しい構造に修正
```yaml
# サイト構造設定
structure:
  introduction:
    - title: "はじめに：なぜエンジニアこそ交渉力が必要か"
      path: "/src/introduction/index.html"
  
  chapters:
    - id: 1
      title: "コードは雄弁に語る - 技術的根拠による説得術"
      path: "/src/chapter-1/index.html"
    # ... 他の章
  
  conclusion:
    - title: "おわりに：継続的インテグレーション"
      path: "/src/conclusion/index.html"
  
  appendices:
    - title: "実践ツールキット"
      path: "/src/appendices/toolkit.html"
```

### 問題: ページナビゲーション（前へ/次へ）のリンクが正しくない

**原因**: 
- 自動生成されるページ順序が意図と異なる
- ページのorder属性やファイル名による自動ソートが期待通りでない

**解決方法**:
`_includes/page-navigation.html`で手動でページ順序を定義
```liquid
<!-- Define page order manually -->
{% if current_url contains '/introduction/' %}
    {% assign next_page_url = '/src/chapter-1/index.html' %}
    {% assign next_page_title = '第1章 コードは雄弁に語る' %}
{% elsif current_url contains '/chapter-1/' %}
    {% assign previous_page_url = '/src/introduction/index.html' %}
    {% assign previous_page_title = 'はじめに' %}
    {% assign next_page_url = '/src/chapter-2/index.html' %}
    {% assign next_page_title = '第2章 ステークホルダー・インターフェース設計' %}
<!-- ... 他のページの定義 -->
{% endif %}
```

### 問題: トップページにナビゲーションが表示されない

**原因**: 
- `index.md`のレイアウトが`default`になっている
- `book`レイアウトでないとサイドバーナビゲーションが表示されない

**解決方法**:
`index.md`のfront matterを修正
```yaml
---
title: "書籍タイトル"
layout: book  # defaultからbookに変更
---
```

### 実装時のベストプラクティス

1. **段階的テスト**: 各章を個別にテストして、特定の章で問題が発生しないか確認
2. **JavaScript最小化**: パフォーマンス重要なページでは不要なJavaScript機能を無効化
3. **ナビゲーション手動設定**: 自動生成に頼らず、明示的にページ順序を定義
4. **レイアウト統一**: すべてのページで`book`レイアウトを使用してナビゲーション一貫性を保つ
5. **構造設定確認**: `_config.yml`の構造設定が他の書籍と同じ形式になっているか確認

---

このトラブルシューティングガイドは継続的に更新されます。新しい問題や解決方法を発見した場合は、このドキュメントに追加してください。