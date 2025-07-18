# Book Formatter トラブルシューティングガイド

このドキュメントは、Book Publishing Template v3.0を使用して書籍を生成・公開する際に遭遇する可能性のある問題と解決方法をまとめたものです。

## 目次

1. [GitHub Pages関連の問題](#github-pages関連の問題)
2. [ナビゲーション関連の問題](#ナビゲーション関連の問題)
3. [JavaScript関連の問題](#javascript関連の問題)
4. [レイアウト・デザイン関連の問題](#レイアウトデザイン関連の問題)
5. [設定ファイル関連の問題](#設定ファイル関連の問題)
6. [Markdown記法・コードブロック関連の問題](#markdown記法コードブロック関連の問題)

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

## Markdown記法・コードブロック関連の問題

### 問題：コードブロックが正しく表示されない / 内容が外部に漏れる

**症状:**
- コードブロック内のコメントやテキストが通常のテキストとして表示される
- 「ワークロード分析の例」などのコメントがコードブロック外に表示される
- 見出しやテキストがコードブロック内に含まれてしまう

**原因:**
- 単一バックティック（`）と3つのバックティック（```）の混在
- 言語指定の記法が不完全（例：`python ではなく ```python）
- コードブロックの開始・終了タグの不整合

**診断方法:**
```bash
# 単一バックティック + 言語名のパターンを検索
grep -n "`[a-z]" docs/chapter-*/index.md

# 開始・終了タグの不整合を確認
grep -n "^```" docs/chapter-*/index.md | sort
```

**解決手順:**
1. **単一バックティック問題の修正**
   ```bash
   # 修正前
   `python
   # コード例
   
   # 修正後
   ```python
   # コード例
   ```

2. **言語指定の統一**
   - `python` → ````python`
   - `bash` → ````bash`
   - `yaml` → ````yaml`
   - `json` → ````json`

3. **開始・終了タグの対応確認**
   ```bash
   # 各章で開始・終了タグの数を確認
   grep -c "^```" docs/chapter-*/index.md
   ```

**予防策:**
- コードブロックは必ず3つのバックティックで開始・終了する
- 言語指定は一貫した記法を使用する
- 大量のコードブロックがある場合は、作成後に一括チェックを実行する

### 問題：フォントサイズ・スタイリングの不整合

**症状:**
- h3見出しが異常に大きく表示される
- 太字テキストのフォントサイズが不適切
- コードブロック内のテキストが大きすぎる

**原因:**
- CSS継承の問題
- 単一バックティック使用による誤った要素認識
- スタイルシートの競合

**診断方法:**
```bash
# フォントサイズ関連のCSS確認
grep -n "font-size" docs/assets/css/*.css

# 太字テキストの設定確認
grep -n "font-weight.*bold" docs/assets/css/*.css
```

**解決手順:**
1. **CSS階層の修正**
   ```css
   /* 太字テキストの継承修正 */
   strong, b {
       font-weight: 600;
       font-size: inherit !important;
       color: inherit;
   }
   
   /* コードブロックのフォントサイズ統一 */
   code, pre, .highlight * {
       font-size: 0.75rem !important;
   }
   ```

2. **Markdown記法の統一**
   - 単一バックティックを3つのバックティックに統一
   - 適切な見出しレベルを使用

**予防策:**
- 初期テンプレート設定時にフォントサイズを明示的に定義
- コードブロックとインラインコードの記法を統一
- 定期的にライブサイトでの表示確認を実施

### 問題：Jekyll Liquid構文競合

**症状:**
- Infrastructure as Code（Terraform、Ansible）のサンプルコードでビルドエラー
- テンプレート変数（`${variable}`、`{{ variable }}`）が原因でJekyllが失敗
- GitHub Actionsのワークフローサンプルが正しく表示されない

**原因:**
- JekyllがInfrastructure as Codeのテンプレート変数をLiquid構文として解釈
- 特に`{{ }}`や`{% %}`を含むコードブロックでの問題

**診断方法:**
```bash
# 問題となりうるパターンを検索
grep -n "{{" docs/chapter-*/index.md
grep -n "{%" docs/chapter-*/index.md
grep -n "${" docs/chapter-*/index.md
```

**解決手順:**
1. **rawタグで囲む**
   ```markdown
   {% raw %}
   ```terraform
   resource "aws_instance" "web" {
     ami           = "${var.ami_id}"
     instance_type = "${var.instance_type}"
   }
   ```
   {% endraw %}
   ```

2. **一括修正スクリプトの作成**
   ```bash
   # 競合修正スクリプト
   #!/bin/bash
   find docs/chapter-* -name "*.md" -exec sed -i 's/`terraform/```terraform/g' {} \;
   find docs/chapter-* -name "*.md" -exec sed -i 's/`ansible/```ansible/g' {} \;
   ```

**予防策:**
- Infrastructure as Codeのサンプルコードは事前に`{% raw %}`タグで囲む
- CI/CDパイプラインでJekyllビルドテストを実施
- テンプレート変数を含むコードブロックは特に注意深く確認

## 作業効率化のためのヒント

### 一括修正のためのスクリプト例

```bash
#!/bin/bash
# code-block-fix.sh - コードブロック記法の一括修正

echo "コードブロック記法の修正を開始..."

# 単一バックティック + 言語名を3つのバックティックに修正
find docs/chapter-* -name "*.md" -exec sed -i 's/`python/```python/g' {} \;
find docs/chapter-* -name "*.md" -exec sed -i 's/`bash/```bash/g' {} \;
find docs/chapter-* -name "*.md" -exec sed -i 's/`yaml/```yaml/g' {} \;
find docs/chapter-* -name "*.md" -exec sed -i 's/`json/```json/g' {} \;

echo "修正完了"

# 修正箇所の確認
echo "修正箇所の確認:"
grep -n "^```" docs/chapter-*/index.md | wc -l
```

### 品質確認のためのチェックリスト

- [ ] コードブロックの開始・終了タグが対応している
- [ ] 言語指定が一貫している
- [ ] Infrastructure as Codeサンプルが`{% raw %}`で囲まれている
- [ ] フォントサイズが適切に表示されている
- [ ] 太字テキストのサイズが正常
- [ ] ローカルでのJekyllビルドが成功する
- [ ] GitHub Pagesでの表示が正常

### 定期メンテナンスの推奨

```bash
# 月次実行推奨のチェックスクリプト
#!/bin/bash
echo "書籍品質チェックを実行..."

# Markdown記法チェック
echo "1. Markdown記法チェック"
grep -r "`[a-z]" docs/chapter-* && echo "警告: 単一バックティック+言語名が検出されました"

# Jekyll構文競合チェック
echo "2. Jekyll構文競合チェック"
grep -r "{{" docs/chapter-* | grep -v "{% raw %}" && echo "警告: 未保護のLiquid構文が検出されました"

# コードブロック整合性チェック
echo "3. コードブロック整合性チェック"
for file in docs/chapter-*/index.md; do
    count=$(grep -c "^```" "$file")
    if [ $((count % 2)) -ne 0 ]; then
        echo "警告: $file でコードブロックの開始・終了が不整合です"
    fi
done

echo "チェック完了"
```

## 関連リソース

- [Jekyll公式ドキュメント](https://jekyllrb.com/docs/)
- [GitHub Pages公式ドキュメント](https://docs.github.com/pages)
- [GitHub Actions公式ドキュメント](https://docs.github.com/actions)

---

このトラブルシューティングガイドは継続的に更新されます。新しい問題や解決方法を発見した場合は、このドキュメントに追加してください。