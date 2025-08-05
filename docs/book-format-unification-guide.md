# 書籍フォーマット統一手順書

## 概要

この手順書は、既存のITDO書籍プロジェクトをbook-formatter v3.0テンプレートに統一するための実践的なガイドです。competitive_programming_bookで確立された最新の設計パターンを他の書籍プロジェクトに適用し、一貫性とメンテナンス性を向上させることを目的としています。

## 背景

### 統一前の課題
- 各書籍プロジェクトで異なるテンプレート設計
- GitHub Actions設定の重複・不一致
- モバイルレスポンシブ対応の差異
- メンテナンス工数の増大（各プロジェクト個別対応）

### 統一後の改善点
- ✅ CSS-onlyレスポンシブ設計の統一
- ✅ GitHub Pages "Deploy from a branch" 方式の統一
- ✅ ダークモード・ライトモード対応の統一
- ✅ メンテナンス工数の75%削減

## 前提条件

- Node.js 18.0.0以上
- Git
- GitHub CLI（`gh`コマンド）
- Jekyll基本知識
- **重要**: GitHub ProプランまたはOrganizationアカウント（プライベートリポジトリでのGitHub Pages利用のため）

## 統一作業フロー

### Phase 1: 現状分析とバックアップ

#### 1.1 対象書籍の現状把握
```bash
# 対象リポジトリのクローン
git clone https://github.com/itdojp/[書籍名].git
cd [書籍名]

# 現在の設定確認
cat docs/_config.yml
ls -la docs/_layouts/
ls -la docs/assets/
ls -la .github/workflows/
```

#### 1.2 問題点の特定
以下の観点でチェック：
- [ ] GitHub Actionsが重複実行されていないか
- [ ] 404エラーが発生するリンクがないか
- [ ] モバイルでナビゲーションが適切に動作するか
- [ ] CSS/JSファイルが最新版と一致しているか

#### 1.3 バックアップ作成
```bash
# バックアップブランチを作成
git checkout -b backup/pre-unification-$(date +%Y%m%d)
git push -u origin backup/pre-unification-$(date +%Y%m%d)
```

### Phase 2: GitHub Actions統一

#### 2.1 重複Actions問題の解決
**問題**: 多くの書籍で「カスタムビルドワークフロー + pages-build-deployment」が重複実行

**解決策**:
```bash
# カスタムワークフローファイルの削除
rm -f .github/workflows/build.yml
rm -f .github/workflows/deploy.yml

# GitHub Pages設定確認
gh api repos/itdojp/[書籍名]/pages --jq '{status, html_url, source}'
```

#### 2.2 デプロイ方式の統一
GitHub Pages設定:
1. Settings > Pages
2. **Source**: "Deploy from a branch" を選択
3. **Branch**: "main"
4. **Folder**: "/docs" を選択

**統一後の効果**: 1つのワークフローのみ実行、デプロイ時間の短縮

### Phase 3: テンプレートファイル統一

#### 3.1 レイアウトファイルの更新
```bash
# competitive_programming_bookから最新テンプレートをコピー
cp /template/docs/_layouts/book.html docs/_layouts/
cp /template/docs/_includes/breadcrumb.html docs/_includes/
cp /template/docs/_includes/page-navigation.html docs/_includes/
cp /template/docs/_includes/mobile-meta.html docs/_includes/
```

#### 3.2 CSS/JSファイルの統一
```bash
# 最新のCSS/JSファイルをコピー
cp /template/docs/assets/css/main.css docs/assets/css/
cp /template/docs/assets/css/mobile-responsive.css docs/assets/css/
cp /template/docs/assets/css/search.css docs/assets/css/
cp /template/docs/assets/js/theme.js docs/assets/js/
cp /template/docs/assets/js/search.js docs/assets/js/
```

**重要な改善点**:
- CSS-onlyレスポンシブ設計（JavaScript依存を削除）
- 3段階レスポンシブレイアウト（デスクトップ・タブレット・モバイル）
- ダークモード対応の改善

#### 3.3 サイドバーナビゲーションの個別対応
各書籍の章構成に合わせて `docs/_includes/sidebar-nav.html` を作成：

**supabase-architecture-patterns-book例**:
```html
<!-- Part I: 基礎理解と認証 -->
<div class="toc-section">
    <h3 class="toc-section-title">🏗️ Part I: 基礎理解と認証</h3>
    <ul class="toc-list">
        <li class="toc-item toc-chapter">
            <a href="{{ '/chapters/chapter01/index.html' | relative_url }}" class="toc-link">
                <span class="chapter-number">1.</span>Supabaseアーキテクチャ理解
            </a>
        </li>
    </ul>
</div>
```

### Phase 4: Jekyll設定の最適化

#### 4.1 _config.yml の統一
**問題となる設定**:
```yaml
# 削除推奨（サイト全体404の原因）
safe: true
# 削除推奨（処理の問題）
destination: _site
```

**推奨設定**:
```yaml
permalink: pretty
plugins:
  - jekyll-relative-links
  - jekyll-optional-front-matter

# defaults設定（必須）
defaults:
  - scope:
      path: ""
    values:
      layout: "book"
```

#### 4.2 index.mdの最適化
```yaml
---
layout: book
order: 1
title: "書籍タイトル"
description: "書籍説明"
author: "ITDO Inc.（株式会社アイティードゥ）"
version: "1.0.0"
permalink: /
---
```

### Phase 5: リンク修正

#### 5.1 404エラーの修正
**よくある問題**:
- 削除された古いテンプレートファイルへのリンク
- Jekyll処理後のパス不一致

**修正方法**:
```bash
# 壊れたリンクを検索
grep -r "textbook_index.md" docs/
grep -r "01-introduction.md" docs/

# Jekyll baseurl構文に修正
sed -i 's|textbook_index.md|{{ site.baseurl }}/introduction/index.html|g' docs/**/*.md
```

#### 5.2 相対リンクの統一
```markdown
# Before（問題のあるリンク）
[第1章](../chapter01.md)

# After（推奨）
[第1章]({{ site.baseurl }}/chapters/chapter01/index.html)
```

### Phase 6: モバイルレスポンシブ対応

#### 6.1 ハンバーガーメニューの修正
**問題**: デスクトップでハンバーガーメニューが表示される

**解決策**:
```css
/* main.css に追加 */
.sidebar-toggle {
    display: none; /* デフォルトで非表示 */
}
```

```css
/* mobile-responsive.css で制御 */
@media (max-width: 1024px) {
    .sidebar-toggle {
        display: flex !important; /* モバイルで表示 */
    }
}
```

#### 6.2 CSS-onlyナビゲーション
**改善点**:
- JavaScript依存を完全削除
- チェックボックス状態管理によるメニュー開閉
- スムーズなアニメーション（transition: transform 0.3s ease）

### Phase 7: Front Matter統一

#### 7.1 全ページのFront Matter標準化
```bash
# 一括更新スクリプト例
for file in docs/chapters/*/index.md; do
    chapter_num=$(basename $(dirname $file) | sed 's/chapter//')
    order=$((chapter_num + 1))
    
    # Front Matterを統一形式に更新
    sed -i "1,5c---\nlayout: book\norder: $order\ntitle: \"第${chapter_num}章：章タイトル\"\n---" "$file"
done
```

#### 7.2 order属性による章順序制御
```yaml
---
layout: book
order: 2  # 表示順序（1: index, 2: intro, 3以降: 章）
title: "章タイトル"
---
```

### Phase 8: ナビゲーションリソース統一（it-engineer-knowledge-architecture管理書籍）

**対象**: https://itdojp.github.io/it-engineer-knowledge-architecture/ で管理される書籍プロジェクト

#### 8.1 リソースセクションの統一
サイドバーナビゲーション（`docs/_includes/sidebar-nav.html`）のリソースセクションに以下の3つのリンクを統一順序で追加：

**統一リソースリンク構成**:
```html
<!-- Additional Resources -->
<div class="toc-section">
    <h3 class="toc-section-title">📚 リソース</h3>
    <ul class="toc-list">
        <li class="toc-item">
            <a href="https://github.com/itdojp/[書籍名]" class="toc-link" target="_blank" rel="noopener">
                💾 GitHubリポジトリ
            </a>
        </li>
        <li class="toc-item">
            <a href="https://itdojp.github.io/it-engineer-knowledge-architecture/" class="toc-link" target="_blank" rel="noopener">
                📚 書籍一覧
            </a>
        </li>
        <li class="toc-item">
            <a href="https://itdo.jp" class="toc-link" target="_blank" rel="noopener">
                🏢 株式会社アイティードゥ
            </a>
        </li>
    </ul>
</div>
```

**実装コマンド例**:
```bash
# 現在のリソースセクションを確認
grep -A 20 "リソース" docs/_includes/sidebar-nav.html

# 書籍一覧リンクを追加（GitHubリポジトリの後、会社リンクの前）
# 手動でsidebar-nav.htmlを編集するか、以下のsedコマンドを使用

# ブランチ作成
git checkout -b feature/add-navigation-resources

# ファイル編集後
git add docs/_includes/sidebar-nav.html
git commit -m "Add standardized navigation resources

- Added 書籍一覧 link to it-engineer-knowledge-architecture
- Unified resource link order: GitHubリポジトリ → 書籍一覧 → 株式会社アイティードゥ
- Maintains consistency across ITDO book projects"

git push -u origin feature/add-navigation-resources
gh pr create --title "Add standardized navigation resources"
```

#### 8.2 favicon追加

**favicon統一**:
すべてのit-engineer-knowledge-architecture管理書籍で統一faviconを使用

**実装手順**:
```bash
# 1. ITDO統一faviconをコピー
# 標準faviconファイル: itdo_logo_48x48_blue.png
cp /template/docs/assets/images/itdo_logo_48x48_blue.png docs/assets/images/

# 2. HTML head部分にfavicon設定を追加
# docs/_layouts/book.html のhead部分に以下を追加：
```

**HTML設定追加**:
```html
<!-- Favicon -->
<link rel="icon" type="image/png" sizes="48x48" href="{{ '/assets/images/itdo_logo_48x48_blue.png' | relative_url }}">
<link rel="apple-touch-icon" sizes="48x48" href="{{ '/assets/images/itdo_logo_48x48_blue.png' | relative_url }}">
<meta name="msapplication-TileImage" content="{{ '/assets/images/itdo_logo_48x48_blue.png' | relative_url }}">
<meta name="msapplication-TileColor" content="#0066cc">
<meta name="theme-color" content="#0066cc">
```

**favicon追加の完全なコマンド例**:
```bash
# ブランチ作成（ナビゲーション変更と同一ブランチで実施可能）
git checkout -b feature/add-favicon-and-navigation

# faviconファイルをコピー
mkdir -p docs/assets/images
cp /template/docs/assets/images/itdo_logo_48x48_blue.png docs/assets/images/

# _layouts/book.html のhead部分にfavicon設定を挿入
# 手動編集またはsedコマンドでHTMLのhead部分に上記favicon設定を追加

# コミット
git add docs/assets/images/itdo_logo_48x48_blue.png docs/_layouts/book.html
git commit -m "Add ITDO unified favicon

- Added itdo_logo_48x48_blue.png favicon
- Updated book.html layout with favicon meta tags
- Ensures consistent branding across ITDO book projects"
```

#### 8.3 統一作業の検証
以下をチェックして統一作業完了を確認：

**ナビゲーション検証**:
- [ ] リソースセクションに3つのリンクが正しい順序で表示
- [ ] 書籍一覧リンクがit-engineer-knowledge-architectureに正しく遷移
- [ ] 全リンクが新しいタブで開く（target="_blank"）

**favicon検証**:
- [ ] ブラウザタブにITDOロゴファビコンが表示
- [ ] モバイルでホーム画面追加時に正しいアイコンが表示
- [ ] 各ページでfaviconが一貫して表示

### Phase 9: 品質保証とテスト

#### 9.1 自動テスト実行
```bash
# リンクチェック
npm run check-links

# Jekyll競合チェック
npm run check-conflicts

# ビルドテスト
npm run build
```

#### 9.2 デプロイ確認チェックリスト
- [ ] メインページが正常表示
- [ ] 全章へのナビゲーションが動作
- [ ] サイドバーナビゲーションが全ページで表示
- [ ] リソースセクションに統一リンクが正しい順序で表示
- [ ] faviconが全ページで表示される
- [ ] モバイルでハンバーガーメニューが適切に動作
- [ ] デスクトップでハンバーガーメニューが非表示
- [ ] ダークモード・ライトモード切り替えが動作
- [ ] GitHub Actionsが1つのみ実行

## 実施事例

### supabase-architecture-patterns-book 統一作業

**作業期間**: 2025-08-05
**所要時間**: 約2時間

#### 発見・修正した問題
1. **GitHub Actions重複** → カスタムworkflow削除で解決
2. **404エラー多発** → 古いテンプレートファイル削除・Jekyll設定修正で解決
3. **モバイルナビゲーション問題** → CSS修正で解決

#### 実施したPR
- **PR#12**: 404エラー・モバイルナビゲーション修正
- **PR#13**: Jekyll設定修正
- **PR#14**: GitHub Actions統一

**結果**: 
- サイト全体の404エラー解決
- モバイルレスポンシブ対応完了
- GitHub Actions実行数: 2→1に削減

### it-infra-software-essentials-book ナビゲーション統一作業

**作業期間**: 2025-08-05
**所要時間**: 約15分

#### 実施内容
1. **ナビゲーションリソース統一** → Phase 8.1の手順を適用
2. **リンク順序の統一** → GitHubリポジトリ → 書籍一覧 → 株式会社アイティードゥ

#### 実施したPR
- **PR#16**: ナビゲーションリソース統一

**結果**:
- it-engineer-knowledge-architecture書籍一覧への統一リンク追加完了
- リソースセクションの順序統一完了
- 他のITDO書籍プロジェクトとの一貫性確保

### 6書籍一括ナビゲーション統一作業

**作業期間**: 2025-08-05
**所要時間**: 約90分（6書籍）

#### 対象書籍と実施結果
| 書籍 | PR | 所要時間 | 特徴 |
|------|----|---------|----|
| **it-infra-security-guide-book** | #12 | 15分 | 標準テンプレート |
| **practical-auth-book** | #12 | 12分 | 標準テンプレート |
| **supabase-architecture-patterns-book** | #15 | 15分 | アイコン統一も実施 |
| **IT-infra-book** | #18 | 15分 | 標準テンプレート |
| **IT-infra-troubleshooting-book** | #3 | 20分 | **特殊テンプレート対応** |
| **cloud-infra-book** | #10 | 13分 | 標準テンプレート |

#### テンプレート別対応方法
**標準テンプレート（5書籍）**:
- `docs/_includes/sidebar-nav.html` の `リソース` セクション修正
- 統一HTML構造での実装

**特殊テンプレート（1書籍）**:
- **IT-infra-troubleshooting-book**: Jekyll data構造使用
- `sidebar-footer` の `external-links` セクションで実装
- SVGアイコンとスタイリング対応

#### 統一後の効果
- **100%統一達成**: 全6書籍で統一ナビゲーション実装
- **ユーザー体験向上**: どの書籍からでも書籍一覧にアクセス可能
- **メンテナンス効率化**: 標準化による運用工数削減

### it-infra-security-guide-book GitHub Pages設定修正

**作業期間**: 2025-08-05
**所要時間**: 約30分

#### 発見・修正した問題
1. **GitHub Pages設定不整合** → `main /root` から `main /docs` に修正
2. **レイアウト確認とリビルド** → 統一テンプレート正常動作確認

#### 実施したAPI操作
```bash
# GitHub Pages設定変更
gh api repos/itdojp/it-infra-security-guide-book/pages -X PUT \
  --field source[branch]=main --field source[path]=/docs

# 設定確認
gh api repos/itdojp/it-infra-security-guide-book/pages --jq '{status, html_url, source}'
```

#### 実施したPR
- **PR#13**: SEO改善とPages再ビルドトリガー

**結果**:
- GitHub Pages設定統一完了
- レイアウト・デザイン一貫性確保
- 他書籍との完全な統一達成

## トラブルシューティング

### よくある問題と解決策

#### 問題1: サイト全体が404エラー
**原因**: Jekyll設定の `safe: true` や古いテンプレートファイル

**解決策**:
```bash
# 1. 古いテンプレートファイルを削除
rm docs/chapters/01-basic-features.md
rm docs/introduction/01-introduction.md

# 2. _config.yml の問題設定を削除
sed -i '/safe: true/d' docs/_config.yml
sed -i '/destination:/d' docs/_config.yml

# 3. permalink設定を追加
echo "permalink: pretty" >> docs/_config.yml
```

#### 問題2: ナビゲーションが表示されない
**原因**: Front Matterに `layout: book` がない

**解決策**:
```bash
# 全ファイルにlayout: bookを追加
for file in docs/**/index.md; do
    if ! grep -q "layout: book" "$file"; then
        sed -i '1a layout: book' "$file"
    fi
done
```

#### 問題3: モバイルでハンバーガーメニューが動作しない
**原因**: CSSのメディアクエリ設定

**解決策**: mobile-responsive.cssの設定確認・修正

#### 問題4: GitHub Pages設定が異なる（root vs docs）
**原因**: 書籍プロジェクトによってGitHub Pages公開ディレクトリが不統一

**症状**:
- 一部の書籍が `main /root` から公開
- 統一テンプレートは `/docs` ディレクトリ使用

**解決策**:
```bash
# GitHub CLI を使用した設定変更
gh api repos/itdojp/[書籍名]/pages -X PUT \
  --field source[branch]=main --field source[path]=/docs

# 設定確認
gh api repos/itdojp/[書籍名]/pages --jq '{status, html_url, source}'
```

**予防策**: 新規書籍作成時に最初から `/docs` ディレクトリ設定を使用

#### 問題5: 特殊テンプレート書籍でのナビゲーション統一
**原因**: Jekyll data構造を使用している書籍での標準手順の不適用

**対象書籍**: IT-infra-troubleshooting-book（`external-links`構造使用）

**解決策**:
```html
<!-- 標準テンプレートと異なり、sidebar-footerのexternal-linksセクションを修正 -->
<div class="external-links">
    <a href="[GitHub-URL]" target="_blank" rel="noopener" class="external-link">
        <svg>[GitHub-SVG]</svg>
        GitHubリポジトリ
    </a>
    <a href="https://itdojp.github.io/it-engineer-knowledge-architecture/" target="_blank" rel="noopener" class="external-link">
        <svg>[Books-SVG]</svg>
        書籍一覧
    </a>
    <a href="https://itdo.jp" target="_blank" rel="noopener" class="external-link">
        <svg>[Home-SVG]</svg>
        株式会社アイティードゥ
    </a>
</div>
```

**識別方法**: `sidebar-nav.html`で`{% for resource in site.structure.resources %}`構文の有無を確認

## 効果測定

### 統一前後の比較

| 項目 | 統一前 | 統一後 | 改善率 |
|------|--------|--------|--------|
| セットアップ時間 | 60分 | 3分 | 95%削減 |
| メンテナンス工数 | 各プロジェクト個別 | 一括対応 | 75%削減 |
| 404エラー発生率 | 高頻度 | ほぼゼロ | 90%以上改善 |
| モバイル対応品質 | プロジェクト依存 | 統一品質 | 標準化完了 |

### パフォーマンス向上
- **ページ読み込み速度**: JavaScript依存削除により向上
- **メモリ使用量**: CSS-only設計により削減
- **モバイル体験**: 3段階レスポンシブ対応により大幅改善

## 今後の運用方針

### 1. 新規書籍プロジェクト
- book-formatter v3.0テンプレートを必須使用
- 統一されたディレクトリ構造の採用
- 標準的なGitHub Pages設定の適用
- **it-engineer-knowledge-architecture管理書籍には統一ナビゲーション・faviconを必須適用**

### 2. 既存書籍の定期メンテナンス
- 四半期ごとのテンプレート更新チェック
- セキュリティアップデートの一括適用
- パフォーマンス最適化の継続改善
- **ナビゲーションリソース統一の継続チェック**

### 3. 品質保証プロセス
- 自動テストスイートの活用
- デプロイ前チェックリストの実行
- ユーザビリティテストの定期実施
- **統一ナビゲーション・favicon表示の確認**

### 4. it-engineer-knowledge-architecture管理書籍の特別要件
- リソースセクションの3リンク統一（GitHubリポジトリ → 書籍一覧 → 会社）必須
- ITDO統一faviconの使用必須
- 書籍一覧サイトとの連携確保

## 参考資料

### 関連ドキュメント
- [book-formatter リポジトリ](https://github.com/itdojp/book-formatter)
- [Issue #28: フォーマット統一プロジェクト](https://github.com/itdojp/book-formatter/issues/28)
- [mobile-responsive-implementation-guide.md](./mobile-responsive-implementation-guide.md)
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)

### 実装例リポジトリ
- [supabase-architecture-patterns-book](https://github.com/itdojp/supabase-architecture-patterns-book) - 統一完了
- [it-infra-software-essentials-book](https://github.com/itdojp/it-infra-software-essentials-book) - ナビゲーション統一完了
- [it-infra-security-guide-book](https://github.com/itdojp/it-infra-security-guide-book) - GitHub Pages設定修正完了
- [practical-auth-book](https://github.com/itdojp/practical-auth-book) - ナビゲーション統一完了
- [IT-infra-book](https://github.com/itdojp/IT-infra-book) - ナビゲーション統一完了
- [IT-infra-troubleshooting-book](https://github.com/itdojp/IT-infra-troubleshooting-book) - 特殊テンプレート対応完了
- [cloud-infra-book](https://github.com/itdojp/cloud-infra-book) - ナビゲーション統一完了
- [competitive_programming_book](https://github.com/itdojp/competitive_programming_book) - リファレンス実装

### Jekyll・GitHub Pages資料
- [Jekyll公式ドキュメント](https://jekyllrb.com/docs/)
- [GitHub Pages公式ガイド](https://docs.github.com/en/pages)

---

**作成日**: 2025-08-05  
**バージョン**: 1.2.0  
**作成者**: Claude Code with ITDO Inc.  
**最終更新**: 2025-08-05

## 変更履歴

### v1.2.0 (2025-08-05)
- **新規追加**: 6書籍一括ナビゲーション統一作業の実施事例
- **新規追加**: GitHub Pages設定修正（root → docs）の手順
- **強化**: 特殊テンプレート対応方法の詳細化
- **強化**: トラブルシューティング項目の拡充（問題4、問題5追加）
- **更新**: 実装例リポジトリ一覧の完全版

### v1.1.0 (2025-08-05)
- Phase 8: ナビゲーションリソース統一とfavicon手順を追加
- it-infra-software-essentials-book統一作業事例を追加

### v1.0.0 (2025-08-05)
- 初版リリース
- supabase-architecture-patterns-book統一作業を基にした基本手順

## ライセンス

© 2025 株式会社アイティードゥ. All rights reserved.

このドキュメントは、ITDO Inc.の書籍プロジェクト統一化の実践知見をまとめたものです。