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
[[ "$AUDITED_CONSUMER_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$(git -C "$CONSUMER_ROOT" rev-parse --verify "$AUDITED_CONSUMER_SHA^{commit}")" = \
  "$AUDITED_CONSUMER_SHA"
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
  if git -C "$CONSUMER_ROOT" ls-files --error-unmatch -- "$DEST_REL" >/dev/null 2>&1; then
    echo "destination must be absent from the consumer index: $DEST_REL" >&2
    exit 1
  fi
  if git -C "$CONSUMER_ROOT" cat-file -e \
    "$AUDITED_CONSUMER_SHA:$DEST_REL" 2>/dev/null
  then
    echo "destination must be absent from the audited consumer commit: $DEST_REL" >&2
    exit 1
  fi
  if git -C "$CONSUMER_ROOT" check-ignore --quiet -- "$DEST_REL"; then
    echo "destination must not be ignored by the consumer: $DEST_REL" >&2
    exit 1
  else
    IGNORE_STATUS=$?
    if [ "$IGNORE_STATUS" -ne 1 ]; then
      echo "failed to inspect consumer ignore rules: $DEST_REL" >&2
      exit "$IGNORE_STATUS"
    fi
  fi
  DEST_PARENT=$CONSUMER_ROOT
  DEST_REMAINDER=$DEST_REL
  DEST_ANCESTOR_REL=
  while [[ "$DEST_REMAINDER" == */* ]]; do
    DEST_COMPONENT=${DEST_REMAINDER%%/*}
    DEST_REMAINDER=${DEST_REMAINDER#*/}
    DEST_PARENT="$DEST_PARENT/$DEST_COMPONENT"
    if [ -z "$DEST_ANCESTOR_REL" ]; then
      DEST_ANCESTOR_REL=$DEST_COMPONENT
    else
      DEST_ANCESTOR_REL="$DEST_ANCESTOR_REL/$DEST_COMPONENT"
    fi
    INDEX_MODE=$(git -C "$CONSUMER_ROOT" ls-files --stage -- \
      "$DEST_ANCESTOR_REL" | \
      awk -v target="$DEST_ANCESTOR_REL" '$4 == target { print $1; exit }')
    COMMIT_MODE=$(git -C "$CONSUMER_ROOT" ls-tree \
      "$AUDITED_CONSUMER_SHA" -- "$DEST_ANCESTOR_REL" | \
      awk 'NR == 1 { print $1 }')
    if [ -n "$INDEX_MODE" ] && [ "$INDEX_MODE" != 040000 ]; then
      echo "destination ancestor must be a directory in the consumer index: $DEST_ANCESTOR_REL ($INDEX_MODE)" >&2
      exit 1
    fi
    if [ -n "$COMMIT_MODE" ] && [ "$COMMIT_MODE" != 040000 ]; then
      echo "destination ancestor must be a tree in the audited consumer commit: $DEST_ANCESTOR_REL ($COMMIT_MODE)" >&2
      exit 1
    fi
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

`RESTORE_ITEMS`には上の有限集合から、同じ監査単位で復旧する項目を空白区切りで1件以上指定する（例: `RESTORE_ITEMS="config page-navigation navigation index"`）。全sourceをnon-symlinkのregular fileかつ監査済みformatter SHAのblob一致として照合し、全destinationのignore規則、全ancestorのindex / commit modeとworktree typeもcopy前に検査して、重複項目、ignored path、既存file、gitlink、symlink、通常directoryでないancestor、consumer indexまたは監査済みconsumer commitに存在するdestinationを拒否する。これにより、clean statusに現れないsparse checkoutやskip-worktreeの欠損を「未作成」と誤認した上書き、ignored fileが監査差分から脱落する不完全な復旧、submoduleや通常fileと衝突するdirectory内へ書いた差分がdestination限定監査から脱落する不完全な復旧を防ぐ。変更が必要な既存fileは通常のconsumer task branchで別途差分を作成・レビューする。

`navigation`と`index`はconsumer固有値を持たないstarter skeletonであり、copyだけでは復旧完了にならない。`navigation`では例示の章・付録titleを置換し、各pathをconsumerのcanonical route inventoryと照合して、不一致のpathを置換し、不要な行を削除する。`/introduction/`や`/chapters/chapter-01/`等はconsumerのcanonical routeと一致する場合があるため、それ自体をstarter markerとはみなさず、consumerのBook QA / local link checkで全destinationの存在を検証する。`index`ではfront matterと見出しの`<BOOK TITLE>`を実際の書名へ置換し、概要・対象読者・到達目標・読書経路を含む全例示本文を書き換える。次の検査で既知のstarter markerが0件となり、consumerのBook QA / local link checkで全navigation destinationが存在することを確認するまではcommitまたは公開しない。

```bash
(
set -euo pipefail
: "${CONSUMER_ROOT:?set the absolute path to the isolated consumer worktree}"
: "${RESTORE_ITEMS:?select the same items used by the restoration step}"
CHECKED_SKELETON_FILES=0
read -r -a RESTORE_ITEM_LIST <<< "$RESTORE_ITEMS"
for RESTORE_ITEM in "${RESTORE_ITEM_LIST[@]}"; do
  case "$RESTORE_ITEM" in
    index)      RESTORED_REL=docs/index.md ;;
    navigation) RESTORED_REL=docs/_data/navigation.yml ;;
    config|page-navigation|sidebar-navigation|safe-main) continue ;;
    *) echo "unsupported RESTORE_ITEM: $RESTORE_ITEM" >&2; exit 1 ;;
  esac
  test -f "$CONSUMER_ROOT/$RESTORED_REL"
  CHECKED_SKELETON_FILES=$((CHECKED_SKELETON_FILES + 1))
  if grep -nE '(<BOOK TITLE>|第[12]章 タイトル|付録[AB] タイトル|ここに概要や書誌情報|（例）|目次はサイドバー|章ページは /chapters/|付録は /appendices/)' \
    "$CONSUMER_ROOT/$RESTORED_REL"
  then
    echo "starter title markers remain: $RESTORED_REL" >&2
    exit 1
  fi
done
printf 'customized skeleton files checked: %s\n' "$CHECKED_SKELETON_FILES"
# 続けてconsumer固有のBook QAとlocal link checkを実行する。
)
```

## スキャフォールドスクリプトの利用

`scripts/scaffold-new-book.sh`は、既存Jekyll互換の雛形を**新しい明示出力先**へ展開する補助scriptです。新規Web書籍の標準経路は引き続き`book.yaml`と`web-mdbook`であり、このscriptは標準mdBook書籍を生成しません。

localだけに永続的な雛形を作る場合:

```bash
mkdir -p ../generated-books
./scripts/scaffold-new-book.sh itdojp sample-book \
  --output ../generated-books/sample-book
```

- `--output`は必須です。親directoryは事前に存在し、指定先自体はfile、directory、symlinkのいずれも存在してはいけません。
- scriptはcallerのcurrent directoryではなく、自身のformatter checkoutにある`templates/starter/`、`templates/.github/`、`shared/`を参照します。
- 成功したlocal-only出力はprocess終了後も残ります。既存pathの暗黙上書きやmergeは行いません。

GitHub repositoryの作成と初回pushまで行う場合:

```bash
./scripts/scaffold-new-book.sh itdojp sample-book \
  --output ../generated-books/sample-book \
  --create
```

`--create`は出力を作る前に、Git author name/email、`gh auth status`、対象remoteの不存在を確認します。その後、localで`main` branch、initial commit、clean status、remote未設定を成立させてから、`gh repo create --source ... --remote origin --push`を1回だけ実行します。remote作成は冪等ではないため、自動retryしません。

作成またはpushが途中失敗した場合、cleanなlocal repositoryは`--output`に保持されます。次を確認するまで同じ処理を再実行したり、local出力を削除したりしないでください。

```bash
gh repo view itdojp/sample-book
git -C ../generated-books/sample-book remote -v
git -C ../generated-books/sample-book status --short --branch
```

remoteが既に存在する場合はその状態と権限を確認し、必要なpushだけを明示的に行います。remoteが存在せず`origin`もない場合は、保持されたlocal repositoryを`--source`として手動で作成できます。既存legacy書籍の再構築では、前節の隔離worktree・consumer固有値・差分監査も引き続き必要です。

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
