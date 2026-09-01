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
npm start build -- \
  --book examples/standard-book \
  --target web-mdbook \
  --edition free \
  --out-dir dist
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

mdBookの`{{#include ...}}`、`{{#rustdoc_include ...}}`、file-backed `{{#playground ...}}`は、fenced code内でもpreprocessorがlocal fileを読み得るため使用禁止です。editionで選択済みの文書と宣言済みassetだけを生成物へ入れる境界を迂回させません。構文を説明する場合もdirective文字列をそのまま正本へ置かず、通常の文章へ書き換えます。

## Buildとレスポンシブ検証

mdBook `0.5.4`を使用します。CIは公式releaseのLinux x86_64 archiveをSHA-256 `3f28de05dafca9d0f2eab99c662116b0e37b89b1d96a08f8f430b9eeae958cd7`で検証してから実行します。

```bash
mdbook build dist/web-mdbook
npm run check-mdbook-responsive -- --book dist/web-mdbook
npm run check-visibility -- \
  examples/standard-book \
  --edition free \
  --artifact dist/web-mdbook/book
```

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
