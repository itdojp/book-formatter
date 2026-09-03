# web-mdbook adapter

実装状態: implemented (`web-mdbook-v1`)

標準書籍フォーマットから、mdBook 0.5.4で検証する静的Web projectを生成します。GitHub PagesやCloudflare Pagesへの実デプロイは、このadapterの責務外です。

## 生成契約

`repository.url` は `github.com` の HTTPS repository root URL に限定する。
`https://github.com/owner/repository.git` の clone URL は
`https://github.com/owner/repository` へ正規化し、mdBook の repository link に
使用する。GitHub 以外の host、repository root より深い path、
dot segment、空delimiterを含む query/fragment、非標準 port は、誤ったGitHub
repository linkを生成しないようdry-runと実buildの双方でfail closedに拒否する。

`web-mdbook-v1`は`edit-url-template`を生成しない。adapterがcanonical sourceを
mdBook projectの`src/`配下へstagingするため、mdBookの`{path}`だけではrepository内の
正本pathへ決定的に戻せないためである。repository iconは正規化済みroot URLを提供する。

```bash
export BOOK_ROOT=examples/standard-book
export BOOK_EDITION=free
export BOOK_OUTPUT_ROOT=dist
npm start build -- \
  --book "$BOOK_ROOT" \
  --target web-mdbook \
  --edition "$BOOK_EDITION" \
  --out-dir "$BOOK_OUTPUT_ROOT"
```

`--out-dir`は#94で定義したoutput rootです。上のcommandは`dist/web-mdbook/`へ次を生成します。

- `book.toml`: `create-missing = false`、build先`book/`、共通`additional-css`
- `src/SUMMARY.md`: editionの`documents`順に生成した目次
- `src/<canonical path>`: visibilityを適用し、標準calloutを変換したMarkdown
- `src/book.yaml`: 公開に必要な書誌とeditionだけを含むsanitized metadata
- `theme/css/itdo-mdbook.css`: 組み込みthemeを置換しない共通追加CSS
- `manifest.json`: redacted visibility判断とadapter契約

既存の`web-mdbook`出力は、同targetの有効なadapter manifestがある場合だけstaging出力で置き換えます。これによりstale fileを残さず、別producerのdirectoryを上書きしません。

## VisibilityとMarkdown

document/blockのvisibilityを生成前に適用します。`note`、`tip`、`warning`はaccessibleなMarkdown blockquoteへ変換し、対象editionで除外された`paid`、`internal`のdelimiterと本文は出力しません。生成後は共通`check-visibility --artifact`を`book/`へ実行します。

Web正本のreader-visible raw HTMLはfail closedで禁止します。fenced code内の説明例はreader-visible markupとして解釈しません。この有限契約により、declarative Shadow DOM、`slot`、`iframe[srcdoc]`、HTML data URLなどのcomposed/nested documentをadapterが生成することを禁止し、共通checkerでbrowser DOMを再実装しません。

相対linkは、同じeditionに含まれるMarkdown、生成した`book.yaml`、または宣言済み`assets/`内の実fileだけを許可します。assetは参照されたfileだけを複製し、画像、font、audio/video、有限なtext/data形式のpassive extension allowlistへ限定します。HTML/XHTML/XMLなどのactive document形式はcopyしません。SVGはcopy前に有限なactive-content検査を行い、script、event handler、foreign content、animation、style、外部参照を拒否します。外部linkは資格情報を含まないHTTPSだけを許可し、外部画像hotlinkと危険schemeを拒否します。structure titleは`SUMMARY.md`へdisplay textとして出力し、HTMLの`&`、`<`、`>`とMarkdown labelのbackslash/bracketをescapeします。

mdBookと監査parserで参照ラベルのUnicode正規化が一致しないため、`web-mdbook-v1`はMarkdownのreference definition（`[label]: destination`）をfail closedで拒否します。linkはinline形式（`[label](destination)`）を使用してください。footnote definitionはこの制限の対象外です。

mdBookの`{{#include ...}}`、`{{#rustdoc_include ...}}`、file-backed `{{#playground ...}}`は、fenced code内でもpreprocessorがlocal fileを読み得るため使用禁止です。editionで選択済みの文書と宣言済みassetだけを生成物へ入れる境界を迂回させません。構文を説明する場合もdirective文字列をそのまま正本へ置かず、通常の文章へ書き換えます。

## Buildとレスポンシブ検証

mdBook `0.5.4`を使用します。CIとLinux x86_64のローカル検証では、公式release archiveを次の固定URLから取得し、展開前にSHA-256を検証します。別OS / architectureのarchiveはこのdigestの対象ではないため、同じ値を流用しません。

```bash
(
set -euo pipefail
: "${BOOK_ROOT:?set the same book directory used by adapter build}"
: "${BOOK_EDITION:?set the same edition ID used by adapter build}"
: "${BOOK_OUTPUT_ROOT:?set the same output root used by adapter build}"
MDBOOK_PROJECT_DIR="$BOOK_OUTPUT_ROOT/web-mdbook"
MDBOOK_VERSION=0.5.4
MDBOOK_TARGET=x86_64-unknown-linux-gnu
MDBOOK_ARCHIVE="mdbook-v${MDBOOK_VERSION}-${MDBOOK_TARGET}.tar.gz"
MDBOOK_URL="https://github.com/rust-lang/mdBook/releases/download/v${MDBOOK_VERSION}/${MDBOOK_ARCHIVE}"
MDBOOK_SHA256=3f28de05dafca9d0f2eab99c662116b0e37b89b1d96a08f8f430b9eeae958cd7
MDBOOK_TOOL_ROOT="$PWD/.work/tools"

test -f "$BOOK_ROOT/book.yaml"
npm run validate:standard-book -- "$BOOK_ROOT"
npm start build -- \
  --book "$BOOK_ROOT" \
  --target web-mdbook \
  --edition "$BOOK_EDITION" \
  --out-dir "$BOOK_OUTPUT_ROOT"
test -f "$MDBOOK_PROJECT_DIR/book.toml"
test -f "$MDBOOK_PROJECT_DIR/manifest.json"
test ! -L "$PWD/.work"
test ! -L "$MDBOOK_TOOL_ROOT"
mkdir -p "$MDBOOK_TOOL_ROOT"
test -d "$MDBOOK_TOOL_ROOT"
test ! -L "$MDBOOK_TOOL_ROOT"
MDBOOK_TOOL_DIR=$(mktemp -d \
  "$MDBOOK_TOOL_ROOT/mdbook-v${MDBOOK_VERSION}-${MDBOOK_TARGET}.XXXXXXXX")
cleanup_mdbook() {
  test -n "${MDBOOK_TOOL_DIR:-}" && rm -rf -- "$MDBOOK_TOOL_DIR"
}
trap cleanup_mdbook EXIT
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$MDBOOK_TOOL_DIR/$MDBOOK_ARCHIVE" \
  "$MDBOOK_URL"
(
  cd "$MDBOOK_TOOL_DIR"
  printf '%s  %s\n' "$MDBOOK_SHA256" "$MDBOOK_ARCHIVE" | \
    sha256sum --check --strict
  test "$(tar -tzf "$MDBOOK_ARCHIVE")" = mdbook
  tar -xzf "$MDBOOK_ARCHIVE"
)
MDBOOK_BIN="$MDBOOK_TOOL_DIR/mdbook"
test -x "$MDBOOK_BIN"
test "$("$MDBOOK_BIN" --version)" = "mdbook v${MDBOOK_VERSION}"
"$MDBOOK_BIN" build "$MDBOOK_PROJECT_DIR"

# 生成時のsource snapshotからartifact検査時までに入力が変わっていないことを、
# 同じ入力からの決定的なadapter再生成で確認する。mdBookのbuild出力だけは比較から除く。
RECHECK_OUTPUT_ROOT="$MDBOOK_TOOL_DIR/source-recheck"
npm start build -- \
  --book "$BOOK_ROOT" \
  --target web-mdbook \
  --edition "$BOOK_EDITION" \
  --out-dir "$RECHECK_OUTPUT_ROOT"
diff --recursive --brief --exclude=book -- \
  "$MDBOOK_PROJECT_DIR" \
  "$RECHECK_OUTPUT_ROOT/web-mdbook"
npm run check-mdbook-responsive -- --book "$MDBOOK_PROJECT_DIR"
npm run check-visibility -- \
  "$BOOK_ROOT" \
  --edition "$BOOK_EDITION" \
  --artifact "$MDBOOK_PROJECT_DIR/book"
)
```

`BOOK_ROOT`、`BOOK_EDITION`、`BOOK_OUTPUT_ROOT`はadapter project生成時に設定した同じ値を維持する。このself-contained blockは既存projectを信用せず同じ入力からadapter projectを再生成し、mdBook build後にも別の一時出力へ決定的に再生成して、`book/`以外のproject/manifestが一致することを確認する。その後、同じsource/editionからprotected fragmentを抽出してartifactを検査するため、別のsample書籍や生成後に変更されたsourceでvisibility検査を代用しない。URLは[mdBook v0.5.4の公式GitHub release](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)に属するassetである。digestの正本はこのadapter contractとCIの一致で管理する。各buildはworkspace内の新しい一時directoryへarchiveを取得・検証・展開し、同じfail-fast block内でbuildと公開前検査まで完了してからdirectoryを削除する。展開済みbinaryや既存tool directoryを再利用せず、version文字列だけを根拠に既存`PATH`上のbinaryを信用しない。

responsive checkerは生成project/HTML/CSS契約に加え、利用可能なChromeで全generated content pageに対し、次のviewportのsidebar/content非重複とhidden状態のbody overflowを検証します。mdBook 0.5.4のsidebar support pageであるroot `toc.html`だけを有限に除外し、他のHTMLでresponsive DOM IDが欠けた場合はfail closedです。

- 390x844
- 480x900
- 768x1024
- 820x1180
- 1024x1366
- 1366x768

共通CSSはmdBook 0.5.4の実DOMである`#mdbook-sidebar`、`#mdbook-page-wrapper`、`#mdbook-menu-bar`へ限定した追加CSSです。組み込みthemeの全面copyやrenderer emulationは行いません。

## 同期

adapter実装、共通CSS、検証scriptはformatterの監査済みcommit SHAで同期します。mutableな`main`参照や手動copyを正本にしません。全書籍へのrolloutと配信設定は後続Issueで行います。
