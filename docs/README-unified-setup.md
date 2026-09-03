# Book Formatter: Legacy Jekyll Setup Guide

This guide is retained for existing Jekyll / GitHub Pages books. New standard Web books use `book.yaml` and the `web-mdbook` adapter described in [the output target policy](./output-targets.md).

This guide describes the retained structure for maintaining or reconstructing an existing legacy Jekyll book repository:

- Use `templates/_config.yml` as the starting point (permalink: pretty, plugins, kramdown).
- Copy `docs/includes/page-navigation.html` as `docs/_includes/page-navigation.html`.
- Top page (root) does NOT render prev/next navigation; chapters and appendices do.
- Prefer directory-style links (e.g., `/src/chapter-1/`) instead of `index.html`.
- Use `jekyll-redirect-from` (optional) to map old slugs when renaming chapters.

## Steps
1. In an isolated task branch or worktree for the existing legacy repository, confirm that `docs/` is its publication root.
2. Restore a missing `_config.yml` from `templates/_config.yml` and preserve the consumer-specific `title`, `baseurl`, and `repository` values.
3. Restore a missing `docs/_includes/page-navigation.html` from `docs/includes/page-navigation.html`.
4. Ensure `defaults.layout: book` and `permalink: pretty`.
5. For renamed pages, use redirect-from in the destination page:

```yaml
redirect_from:
  - /src/chapter-old/
```


## 既存legacy書籍の再構築に使うスターターテンプレート

`templates/starter/`は、既存Jekyll書籍で欠けた構成を隔離worktree上で再構築する場合のlegacy参照用である。新規Web書籍の作成には使用せず、`book.yaml`と`web-mdbook`を使用する。

- 収録物:
  - `docs/_config.yml`（permalink: pretty、Pages対応plugins、kramdown、layout: book）
  - `docs/_includes/page-navigation.html`（canonical）
  - `docs/_includes/sidebar-nav.html`（テンプレ）
  - `docs/_data/navigation.yml`（最小スケルトン）
  - `docs/index.md`（トップ雛形。トップでは下部ナビを表示しません）

既存legacy書籍を再構築する手動手順（例）:

```bash
# いずれも絶対pathを指定する
: "${FORMATTER_ROOT:?set the absolute path to the clean formatter worktree}"
: "${CONSUMER_ROOT:?set the absolute path to the isolated consumer worktree}"
: "${AUDITED_FORMATTER_SHA:?set the audited 40-character formatter SHA}"
test "${FORMATTER_ROOT#/}" != "$FORMATTER_ROOT"
test "${CONSUMER_ROOT#/}" != "$CONSUMER_ROOT"
test "$(git -C "$FORMATTER_ROOT" rev-parse HEAD)" = "$AUDITED_FORMATTER_SHA"
test -z "$(git -C "$FORMATTER_ROOT" status --porcelain)"

# 例: 欠損したnavigationだけを監査済みformatterからconsumerへ復旧する
install -D -m 0644 \
  "$FORMATTER_ROOT/templates/starter/docs/_data/navigation.yml" \
  "$CONSUMER_ROOT/docs/_data/navigation.yml"
git -C "$CONSUMER_ROOT" add -N -- docs/_data/navigation.yml
git -C "$CONSUMER_ROOT" diff -- docs/_data/navigation.yml
git -C "$CONSUMER_ROOT" reset -- docs/_data/navigation.yml
```

## スキャフォールドスクリプトの利用

`scripts/scaffold-new-book.sh`は[#128](https://github.com/itdojp/book-formatter/issues/128)が完了するまで利用しないでください。

- `--create`なしでは、表示される一時出力先がscript終了時に削除されます。
- `--create`では、`gh repo create --source`の前にlocal Git repositoryを初期化・commitしないため、GitHub repositoryを作成できません。
- 既存legacy書籍の再構築が必要な場合は、前節の手動copyを隔離worktreeで行い、consumer固有値と全差分を監査します。新規Web書籍はこのscriptやstarterではなく標準`web-mdbook`経路で作成します。

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
