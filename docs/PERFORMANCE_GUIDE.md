# book-formatter パフォーマンス最適化ガイド

## 概要

book-formatterで作成した書籍サイトにおけるパフォーマンス問題の原因と対処法をまとめたガイドです。特にJavaScriptの重い処理によるブラウザフリーズ問題について詳しく解説します。

## 主要な問題と解決策

### 1. JavaScriptパフォーマンス問題

#### 問題の症状
- ページ間の移動時にブラウザが数秒間フリーズする
- 特に長いコンテンツページで顕著に発生
- CPU使用率が一時的に大幅に上昇

#### 原因
- `main.js`の`addHeadingIds()`関数が全ての見出しを同期的に処理
- 正規表現の複雑な処理が大量の見出しで実行される
- DOM操作が一度に大量実行される

#### 解決策

**1. 即座の対処（緊急時）**
```html
<!-- 重いスクリプトを一時的に無効化 -->
<!-- <script src="{{ '/assets/js/main.js' | relative_url }}"></script> -->
<!-- <script src="{{ '/assets/js/search.js' | relative_url }}"></script> -->
<!-- <script src="{{ '/assets/js/code-copy.js' | relative_url }}"></script> -->
```

**2. 根本的な解決（v3.1.0で対応済み）**
- 非同期処理による段階的初期化
- 見出し処理数の制限（最大50個）
- 正規表現の最適化
- エラーハンドリングの追加

### 2. レイアウト問題

#### 問題の症状
- ページ下部に大きな空白が表示される
- ページナビゲーション（前へ/次へ）が表示されない
- コンテンツの高さが不自然

#### 解決策

**CSS改善（v3.1.0で対応済み）**
```css
/* ページレイアウトの最適化 */
.page-content {
    min-height: 60vh;
    margin-bottom: 2rem;
}

.book-content {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - var(--header-height));
}

.page-navigation {
    margin-top: auto;
    padding-top: 3rem;
}
```

**レイアウトテンプレートの修正**
```html
<!-- 常にページナビゲーションを表示 -->
<nav class="page-navigation" aria-label="Page navigation">
    {% include page-navigation.html %}
</nav>
```

## パフォーマンステスト手順

### 1. ブラウザパフォーマンス確認

```bash
# 開発サーバーの起動
npm run serve

# ブラウザの開発者ツールでパフォーマンスタブを開いて確認
# - ページ読み込み時間
# - JavaScript実行時間
# - DOM操作の頻度
```

### 2. 自動テスト

```bash
# リンクチェック
npm run check-links

# パフォーマンステスト（Lighthouse）
npm run lighthouse
```

## 設定による最適化

### 1. _config.ymlの推奨設定

```yaml
# デフォルトレイアウトの指定
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

# 重いプラグインの無効化（必要に応じて）
plugins:
  - jekyll-feed
  - jekyll-sitemap
  # - jekyll-seo-tag  # 重い場合は無効化
```

### 2. パフォーマンス重視の設定

```yaml
# 開発時のパフォーマンス最適化
incremental: true
livereload: true

# プロダクション用の最適化
compress_html:
  clippings: all
  comments: ["<!-- ", " -->"]
  endings: [html, head, body]
```

## トラブルシューティング

### Q: ページが真っ白になる
**A**: JavaScriptエラーが原因の可能性があります。ブラウザの開発者ツールのConsoleタブでエラーを確認してください。

### Q: ナビゲーションが表示されない
**A**: `page-navigation.html`のインクルードパスと条件分岐を確認してください。

### Q: スタイルが適用されない
**A**: CSSファイルのパスとbaseurl設定を確認してください。

## 監視とメンテナンス

### 定期的な確認項目

1. **ページサイズの監視**
   - HTML/CSS/JSファイルのサイズ
   - 画像の最適化状況

2. **Core Web Vitalsの測定**
   - LCP (Largest Contentful Paint)
   - FID (First Input Delay)  
   - CLS (Cumulative Layout Shift)

3. **ユーザー体験の確認**
   - モバイルでの表示確認
   - 低速回線での読み込み確認

## 更新履歴

- **v3.1.0** (2025-07-19): JavaScriptパフォーマンス改善、レイアウト問題修正
- **v3.0.0** (2025-07-01): 初回リリース

## 関連ドキュメント

- [book-creation-guide.md](./book-creation-guide.md)
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
- [IMPROVEMENT_PROPOSALS.md](./IMPROVEMENT_PROPOSALS.md)