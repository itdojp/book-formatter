# Book Formatter: Legacy Jekyll Setup Guide

This guide is retained for existing Jekyll / GitHub Pages books. New standard Web books use `book.yaml` and the `web-mdbook` adapter described in [the output target policy](./output-targets.md).

This guide describes the retained structure for maintaining or reconstructing an existing legacy Jekyll book repository:

- Restore `templates/starter/docs/_config.yml` only through the fixed-SHA block below (permalink: pretty, plugins, kramdown).
- Restore the managed `shared/includes/page-navigation.html` as `docs/_includes/page-navigation.html` through the same block.
- Top page (root) does NOT render prev/next navigation; chapters and appendices do.
- Prefer directory-style links (e.g., `/src/chapter-1/`) instead of `index.html`.
- Use `jekyll-redirect-from` (optional) to map old slugs when renaming chapters.

## Steps
1. In an isolated task branch or worktree for the existing legacy repository, confirm that `docs/` is its publication root.
2. Select `config` in the fixed-SHA restoration block for a missing `_config.yml`, then audit every metadata field against the existing consumer record in a separate reviewed change. Replace every `<...>` placeholder (`title`, `description`, `author`, `url`, `baseurl`, and `repository`) and explicitly confirm or replace the non-placeholder starter defaults for `version`, `lang`, `contact.email`, `license_text`, and `repository_branch`. Use the existing `book-config.json`, license file, default branch, release record, and publication contact as evidence; a starter default is not evidence that the value is correct.
3. Select `page-navigation` in that block for a missing `docs/_includes/page-navigation.html`.
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
  - `docs/_includes/page-navigation.html`（legacy scaffold snapshot。managed正本は`shared/includes/page-navigation.html`）
  - `docs/_includes/sidebar-nav.html`（テンプレ）
  - `docs/_data/navigation.yml`（最小スケルトン）
  - `docs/index.md`（トップ雛形。トップでは下部ナビを表示しません）

`docs/assets/js/safe-main.js`の復旧元はstarter snapshotではなく、legacy scaffoldの最終overlayと`BookGenerator.setupSafeJavaScript`がsourceにする`shared/assets/js/safe-main.js`である。

既存legacy書籍を再構築する手動手順（例）:

```bash
(
set -euo pipefail
# いずれも絶対pathを指定する
: "${FORMATTER_ROOT:?set the absolute path to the clean formatter worktree}"
: "${CONSUMER_ROOT:?set the absolute path to the isolated consumer worktree}"
: "${AUDITED_FORMATTER_SHA:?set the audited 40-character formatter SHA}"
: "${AUDITED_CONSUMER_SHA:?set the audited 40-character consumer SHA}"
: "${RESTORE_ITEMS:?select one or more space-separated items: config page-navigation sidebar-navigation navigation index safe-main}"
test "${FORMATTER_ROOT#/}" != "$FORMATTER_ROOT"
test "${CONSUMER_ROOT#/}" != "$CONSUMER_ROOT"
test "$(git -C "$FORMATTER_ROOT" rev-parse --show-toplevel)" = "$FORMATTER_ROOT"
test "$(git -C "$FORMATTER_ROOT" rev-parse HEAD)" = "$AUDITED_FORMATTER_SHA"
test -z "$(git -C "$FORMATTER_ROOT" status --porcelain)"
test "$(git -C "$CONSUMER_ROOT" rev-parse --show-toplevel)" = "$CONSUMER_ROOT"
test "$(git -C "$CONSUMER_ROOT" rev-parse HEAD)" = "$AUDITED_CONSUMER_SHA"
test -z "$(git -C "$CONSUMER_ROOT" status --porcelain)"

read -r -a RESTORE_ITEM_LIST <<< "$RESTORE_ITEMS"
test "${#RESTORE_ITEM_LIST[@]}" -gt 0
SOURCE_RELS=()
DEST_RELS=()

for RESTORE_ITEM in "${RESTORE_ITEM_LIST[@]}"; do
  case "$RESTORE_ITEM" in
    config)             SOURCE_REL=templates/starter/docs/_config.yml; DEST_REL=docs/_config.yml ;;
    page-navigation)    SOURCE_REL=shared/includes/page-navigation.html; DEST_REL=docs/_includes/page-navigation.html ;;
    sidebar-navigation) SOURCE_REL=shared/includes/sidebar-nav.html; DEST_REL=docs/_includes/sidebar-nav.html ;;
    navigation)         SOURCE_REL=templates/starter/docs/_data/navigation.yml; DEST_REL=docs/_data/navigation.yml ;;
    index)              SOURCE_REL=templates/starter/docs/index.md; DEST_REL=docs/index.md ;;
    safe-main)          SOURCE_REL=shared/assets/js/safe-main.js; DEST_REL=docs/assets/js/safe-main.js ;;
    *) echo "unsupported RESTORE_ITEM: $RESTORE_ITEM" >&2; exit 1 ;;
  esac
  for EXISTING_DEST in "${DEST_RELS[@]}"; do
    if [ "$EXISTING_DEST" = "$DEST_REL" ]; then
      echo "duplicate RESTORE_ITEM: $RESTORE_ITEM" >&2
      exit 1
    fi
  done
  SOURCE_RELS+=("$SOURCE_REL")
  DEST_RELS+=("$DEST_REL")
done

# 全項目を先に検査し、後続項目の不備による部分復旧を避ける。
for INDEX in "${!SOURCE_RELS[@]}"; do
  SOURCE_REL=${SOURCE_RELS[$INDEX]}
  DEST_REL=${DEST_RELS[$INDEX]}
  git -C "$FORMATTER_ROOT" ls-files --error-unmatch "$SOURCE_REL" >/dev/null
  test -f "$FORMATTER_ROOT/$SOURCE_REL"
  test ! -L "$FORMATTER_ROOT/$SOURCE_REL"
  test "$(git -C "$FORMATTER_ROOT" hash-object -- "$SOURCE_REL")" = \
    "$(git -C "$FORMATTER_ROOT" rev-parse "$AUDITED_FORMATTER_SHA:$SOURCE_REL")"
  DEST_PARENT=$CONSUMER_ROOT
  DEST_REMAINDER=$DEST_REL
  while [[ "$DEST_REMAINDER" == */* ]]; do
    DEST_COMPONENT=${DEST_REMAINDER%%/*}
    DEST_REMAINDER=${DEST_REMAINDER#*/}
    DEST_PARENT="$DEST_PARENT/$DEST_COMPONENT"
    if [ -L "$DEST_PARENT" ]; then
      echo "destination ancestor must not be a symbolic link: $DEST_PARENT" >&2
      exit 1
    fi
    if [ -e "$DEST_PARENT" ]; then
      test -d "$DEST_PARENT"
    fi
  done
  test ! -e "$CONSUMER_ROOT/$DEST_REL"
  test ! -L "$CONSUMER_ROOT/$DEST_REL"
done

for INDEX in "${!SOURCE_RELS[@]}"; do
  install -D -m 0644 \
    "$FORMATTER_ROOT/${SOURCE_RELS[$INDEX]}" \
    "$CONSUMER_ROOT/${DEST_RELS[$INDEX]}"
done
git -C "$CONSUMER_ROOT" add -N -- "${DEST_RELS[@]}"
git -C "$CONSUMER_ROOT" diff -- "${DEST_RELS[@]}"
git -C "$CONSUMER_ROOT" reset -- "${DEST_RELS[@]}"
)
```

`RESTORE_ITEMS`には上の有限集合から、同じ監査単位で復旧する項目を空白区切りで1件以上指定する（例: `RESTORE_ITEMS="config page-navigation navigation index"`）。全sourceをnon-symlinkのregular fileかつ監査済みformatter SHAのblob一致として照合し、全destination / symlink境界もcopy前に検査して、重複項目と既存fileを拒否する。これにより、clean statusに現れないskip-worktree変更もconsumerへcopyしない。変更が必要な既存fileは通常のconsumer task branchで別途差分を作成・レビューする。

`navigation`と`index`はconsumer固有値を持たないstarter skeletonであり、copyだけでは復旧完了にならない。`navigation`では例示の章・付録titleと`/introduction/`、`/chapters/chapter-01/`等のpathをconsumerのcanonical route inventoryへ置換し、不要な行を削除する。`index`ではfront matterと見出しの`<BOOK TITLE>`を実際の書名へ置換し、概要・対象読者・到達目標・読書経路を含む全例示本文を書き換える。次の検査で既知のstarter markerが0件となり、consumerのBook QA / local link checkで全navigation destinationが存在することを確認するまではcommitまたは公開しない。

```bash
CHECKED_SKELETON_FILES=0
for RESTORED_REL in docs/index.md docs/_data/navigation.yml; do
  test -f "$CONSUMER_ROOT/$RESTORED_REL" || continue
  CHECKED_SKELETON_FILES=$((CHECKED_SKELETON_FILES + 1))
  if grep -nE '(<BOOK TITLE>|第[12]章 タイトル|付録[AB] タイトル|ここに概要や書誌情報|（例）|目次はサイドバー|章ページは /chapters/|付録は /appendices/)' \
    "$CONSUMER_ROOT/$RESTORED_REL"
  then
    echo "starter title markers remain: $RESTORED_REL" >&2
    exit 1
  fi
done
test "$CHECKED_SKELETON_FILES" -gt 0
# 続けてconsumer固有のBook QAとlocal link checkを実行する。
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
