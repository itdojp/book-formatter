# 新規書籍作成手順書

## 概要

この手順書は、book-formatter システムを使用して新規書籍を効率的に作成するための標準化された手順を提供します。今回の「インフラエンジニアのための情報セキュリティ実装ガイド」プロジェクトで発生した問題と解決策を元に、無駄のない最適な手順を定義しています。

## 前提条件

- Node.js 18.0.0以上
- npm 8.0.0以上
- Git
- GitHub アカウント（Pro/Team/Enterprise プラン推奨）

## 手順書

### Phase 1: プロジェクト初期化

#### 1.1 book-formatter を使用した初期化
```bash
# book-formatter のクローン
git clone https://github.com/itdojp/book-formatter.git
cd book-formatter

# 依存関係のインストール
npm install

# 新規書籍設定の初期化
npm start init
```

#### 1.2 書籍設定ファイルの作成
```bash
# 書籍プロジェクトの作成
npm start create-book
```

**重要**: 以下の設定を必ず確認：
- 書籍タイトル
- 著者名
- 章構成
- 出力フォーマット

### Phase 2: GitHub リポジトリ設定

#### 2.1 GitHub リポジトリの作成
```bash
# GitHub CLI を使用
gh repo create itdojp/[書籍名] --private --description "[書籍の説明]"

# または手動でGitHub上で作成
```

#### 2.2 GitHub Pages 設定
**必須設定**:
1. Settings > Pages
2. Source: "Deploy from a branch" を選択
3. Branch: "main" を選択
4. Folder: "/" (root) を選択

**注意**: "GitHub Actions" は使用しない（問題が発生しやすい）

### Phase 3: Jekyll テンプレート設定

#### 3.1 必須ファイルの確認
以下のファイルが正しく設定されていることを確認：

**`docs/_config.yml`**
```yaml
title: "書籍タイトル"
description: "書籍の説明"
author: "著者名"
baseurl: "/リポジトリ名"
url: "https://itdojp.github.io"
```

**`docs/_layouts/book.html`**
- ページナビゲーション（前へ/次へ）のインクルード
- サイドバーナビゲーションのインクルード
- 適切なレイアウト構造

#### 3.2 ナビゲーションテンプレートの設定

**`docs/_includes/sidebar-nav.html`**
```html
<!-- 書籍固有の章構成に合わせて作成 -->
<li class="toc-item toc-chapter">
    <a href="{{ '/src/chapter-chapter01/index.html' | relative_url }}">
        <span class="chapter-number">第1章</span>
        <span class="chapter-title">章タイトル</span>
    </a>
</li>
```

**`docs/_includes/page-navigation.html`**
```html
<!-- 章の順序に合わせたナビゲーション設定 -->
{% if current_url contains '/chapter-chapter01/' %}
    {% assign previous_page_url = '/src/chapter-introduction/index.html' %}
    {% assign next_page_url = '/src/chapter-chapter02/index.html' %}
{% endif %}
```

### Phase 4: 章ファイルの作成

#### 4.1 章ファイルの構造
各章ファイル `src/chapter-chapter01/index.md` には以下のfront matterが必要：

```yaml
---
title: "第1章：章タイトル"
chapter: chapter01
layout: book
---
```

**重要**: `layout: book` の指定が必須（これがないとナビゲーションが表示されない）

#### 4.2 ファイル命名規則
- 导论: `src/chapter-introduction/index.md`
- 章: `src/chapter-chapter01/index.md` ～ `src/chapter-chapter09/index.md`
- 付録: `src/appendices/appendix-a/index.md`
- あとがき: `src/appendices/afterword/index.md`

### Phase 5: リンク設定の統一

#### 5.1 index.md のリンク形式
**トップページ (`index.md`) のリンク**:
```markdown
- [はじめに](src/chapter-introduction/index.html)
- [第1章: 章タイトル](src/chapter-chapter01/index.html)
- [付録A: 付録タイトル](src/appendices/appendix-a.html)
```

**重要**: `.html` 拡張子を使用（GitHub Pages のJekyll処理に対応）

#### 5.2 章間リンクの設定
章内での相互参照:
```markdown
[第2章の詳細](../chapter-chapter02/index.md#セクション名)
```

### Phase 6: 品質保証とテスト

#### 6.1 必須チェック項目

**設定ファイル検証**:
```bash
npm start validate-config
```

**リンクチェック**:
```bash
npm run check-links
```

**ビルドテスト**:
```bash
npm run build
```

#### 6.2 GitHub Pages 動作確認
1. トップページの表示確認
2. 全章へのナビゲーション確認
3. サイドバーナビゲーション確認
4. 前へ/次へボタンの動作確認

### Phase 7: 公開前の最終確認

#### 7.1 必須確認事項
- [ ] 全ページが正常に表示される
- [ ] すべてのリンクが正常に動作する
- [ ] ナビゲーションが全ページで表示される
- [ ] モバイルでのレスポンシブ表示
- [ ] 章の順序が正しい

#### 7.2 コンテンツ品質確認
- [ ] 誤字脱字のチェック
- [ ] 章立ての整合性確認
- [ ] 相互参照の正確性確認
- [ ] 図表番号の整合性確認

## よくある問題と解決策

### 問題1: リンクが404になる

**原因**: 
- Jekyll テンプレートの設定ミス
- リンクパスの不一致

**解決策**:
1. `docs/_includes/sidebar-nav.html` の章パスを確認
2. 実際のファイル構造とリンクパスの整合性を確認
3. `.html` 拡張子の使用を確認

### 問題2: ナビゲーションが表示されない

**原因**: 
- 章ファイルに `layout: book` の指定がない

**解決策**:
全ての章ファイルのfront matterに `layout: book` を追加

### 問題3: GitHub Pages で変更が反映されない

**原因**:
- キャッシュの問題
- 設定ファイルのエラー

**解決策**:
1. 2-3分待機（GitHub Pages の反映時間）
2. ブラウザのキャッシュクリア
3. `docs/_config.yml` のシンタックスエラー確認

## 効率化のポイント

### 1. テンプレートの再利用
- `docs/_layouts/` 配下のテンプレートファイルを標準化
- 共通CSSとJavaScriptの活用
- 設定ファイルのテンプレート化

### 2. 自動化スクリプトの活用
```bash
# 全章に layout: book を一括追加
for file in src/chapter-*/index.md; do
    sed -i '3a layout: book' "$file"
done
```

### 3. GitHub Actions の活用（オプション）
```yaml
name: Build and Deploy
on:
  push:
    branches: [ main ]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Validate Config
        run: npm start validate-config
      - name: Check Links
        run: npm run check-links
```

## 所要時間の目安

| フェーズ | 所要時間 | 備考 |
|----------|----------|------|
| Phase 1-2 | 30分 | 初期設定 |
| Phase 3 | 60分 | テンプレート設定 |
| Phase 4 | 章数 × 15分 | 章ファイル作成 |
| Phase 5 | 30分 | リンク設定 |
| Phase 6-7 | 60分 | 品質保証 |

**総計**: 9章構成の場合、約4.5時間

## 参考資料

- [book-formatter リポジトリ](https://github.com/itdojp/book-formatter)
- [GitHub Pages ドキュメント](https://docs.github.com/en/pages)
- [Jekyll ドキュメント](https://jekyllrb.com/docs/)
- [今回のプロジェクト実例](https://github.com/itdojp/it-infra-security-guide-book)

---

**最終更新**: 2025-01-17  
**バージョン**: 1.0.0  
**作成者**: Claude Code with ITDO Inc.