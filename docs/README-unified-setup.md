# Book Formatter: Unified Setup Guide

This guide describes the canonical structure for new book repos:

- Use `templates/_config.yml` as the starting point (permalink: pretty, plugins, kramdown).
- Copy `docs/includes/page-navigation.html` as `docs/_includes/page-navigation.html`.
- Top page (root) does NOT render prev/next navigation; chapters and appendices do.
- Prefer directory-style links (e.g., `/src/chapter-1/`) instead of `index.html`.
- Use `jekyll-redirect-from` (optional) to map old slugs when renaming chapters.

## Steps
1. Create repo with `docs/` root.
2. Place `_config.yml` from `templates/_config.yml` (customize `title`, `baseurl`, `repository`).
3. Add `docs/_includes/page-navigation.html` from `docs/includes/page-navigation.html`.
4. Ensure `defaults.layout: book` and `permalink: pretty`.
5. For renamed pages, use redirect-from in the destination page:

```yaml
redirect_from:
  - /src/chapter-old/
```


## スターターテンプレートの利用

新規書籍は `templates/starter/` の雛形をコピーして開始できます。

- 収録物:
  - `docs/_config.yml`（permalink: pretty、Pages対応plugins、kramdown、layout: book）
  - `docs/_includes/page-navigation.html`（canonical）
  - `docs/_includes/sidebar-nav.html`（テンプレ）
  - `docs/_data/navigation.yml`（最小スケルトン）
  - `docs/index.md`（トップ雛形。トップでは下部ナビを表示しません）

手動手順（例）:

```bash
# 任意の作業ディレクトリで
cp -R templates/starter/docs ./docs
# _config.yml の <owner>/<repo> 等を自書籍に合わせて置換
```

## スキャフォールドスクリプトの利用

`scripts/scaffold-new-book.sh` で雛形のコピーと基本置換を自動化できます。

```bash
# 乾燥実行（ローカルに雛形を展開）
./scripts/scaffold-new-book.sh <owner> <repo>

# GitHub上に新規リポを作成して初回pushまで実施
./scripts/scaffold-new-book.sh <owner> <repo> --create
```

- 展開場所は一時ディレクトリに表示されます。`docs/_config.yml` の `title/description/author` を編集し、章/付録ディレクトリを追加してください。
- 章/付録のURLはディレクトリ形式（末尾 /）で統一してください。

## 章スラッグ変更時のリダイレクト

`jekyll-redirect-from`（Pages標準）を推奨します。到達先ページのfront matterに旧URLを列挙してください。

```yaml
---
layout: book
title: 新しい章タイトル
redirect_from:
  - /src/chapter-old/
---
```

スタブ方式にする場合は、旧URL側の `index.md/html` に front matter を付与して Liquid を評価させるか、絶対URLで `meta refresh` を指定してください（docs/examples/redirect-from-sample.md を参照）。
