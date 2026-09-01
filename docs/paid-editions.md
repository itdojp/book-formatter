# Edition visibilityと有償本文の混入防止

## 目的

標準書籍の正本は、無料公開本文、有償本文、内部確認情報を同じrepositoryで
管理できる。一方、markerやfile名だけではaccess controlにならない。この文書は
`book.yaml`、標準callout、`check-visibility`が共有するvisibility contract
version 1を定義する。

DRM、暗号化、販売platformの権限設定、自然言語から有償性を推測する処理は
対象外である。private情報やcredentialを正本・report・test fixtureへ記録しては
ならない。

## 有限visibility

visibilityは次の4値に限定する。

```text
free < sample < paid < internal
```

| visibility | 用途 | editionが包含できる範囲 |
| --- | --- | --- |
| `free` | 無料公開する正本 | `free` |
| `sample` | サンプル公開する正本 | `free`, `sample` |
| `paid` | 購入者向け正本 | `free`, `sample`, `paid` |
| `internal` | 公開前確認・内部運用 | 全visibility |

この順序はversion 1のpublication policyであり、組織の情報分類や法的な秘密区分を置き換えない。

## `book.yaml`契約

document-level visibilityは`structure`の各entryで宣言する。editionは自身の
visibilityと、変換前に選択するdocument IDを宣言する。

```yaml
structure:
  chapters:
    - id: introduction
      title: はじめに
      path: manuscript/01-introduction.md
      visibility: free
    - id: advanced
      title: 応用編
      path: manuscript/02-advanced.md
      visibility: paid
editions:
  - id: free
    title: 無料公開版
    status: draft
    visibility: free
    documents:
      - introduction
  - id: paid
    title: 有償版
    status: draft
    visibility: paid
    documents:
      - introduction
      - advanced
```

`visibility`と`documents`はversion 1 schemaへのoptional extensionである。
これらを使わない既存metadataは`validate:standard-book`で引き続き検証できる。
一方、`check-visibility`は次をfail closedで要求する。

- 選択editionに`visibility`と`documents`がある
- 全canonical structure entryにvisibilityがある
- document IDが重複せず、実在するstructure IDを参照する
- editionより高いvisibilityのdocumentを選択していない
- `free`、`sample`、`paid`、`internal`をedition IDに使う場合は同名visibilityである

この分離により既存version 1 metadataを無言で再解釈せず、公開検査を有効にする書籍だけに明示契約を要求する。

## block-level visibility

1つのdocument内で境界を分ける場合は、標準callout grammar version 1の`paid`と`internal`を使う。

```markdown
:::paid
有償editionだけに含める本文です。
:::

:::internal
公開成果物へ含めない内部確認本文です。
:::
```

delimiterはcolumn 1に置き、入れ子、title、option、attributeを追加しない。
fenced code block内の同じ文字列は構文例であり、visibility markerではない。
`note`、`tip`、`warning`は表示上のcalloutであり、visibilityを変更しない。

blockはdocumentのvisibilityを下げない。例えば`paid` documentをfree editionへ
含めることは、内部にfree相当の段落があっても許可しない。free document内の
`paid`/`internal` blockはedition planで明示的に除外する。

## source checkとartifact check

source checkはcanonical sourceを変更せず、選択editionの包含・除外manifestを
作る。明示されたprotected blockの存在自体はerrorではない。曖昧な境界、
未知marker、入れ子、未閉鎖、incompatible document inclusionをerrorにする。

```bash
npm run check-visibility -- examples/standard-book \
  --edition free \
  --output tmp-reports/visibility/free.json
```

generated artifactがある場合は追加検査できる。

```bash
npm run check-visibility -- examples/standard-book \
  --edition free \
  --artifact dist/web-mdbook \
  --output tmp-reports/visibility/free-artifact.json
```

artifact checkは次を拒否する。

- fenced code block外に残ったraw `:::paid` / `:::internal` marker
- editionで除外したsource regionと、Unicode NFC・改行・空白正規化後も同一なtext fragment
- standard callout、fenced code、list、inline Markdown、HTML tag/entityの有限wrapperを除いたreader-visible text fragment
- 指定artifact path自体、その親path component、artifact tree内のsymbolic link

directory指定時は既知のtext artifact extensionだけを検査する。PDF、EPUB、
画像などのbinary内容と、adapterが大きく書き換えた本文はtarget-specific checkerで
検査する。

## JSON report

reportは決定論的なversioned objectで、次を含む。

- book ID、edition ID、edition visibility
- document ID、path、visibility、include/exclude判断
- protected regionの開始・終了行、visibility、SHA-256 digest
- artifact file一覧とfinding
- summaryとsafe判定

`documents`は、include対象をeditionの宣言順で先に並べ、exclude対象をcanonical
structure順で後に並べる。adapterはinclude対象の順序を無言でcanonical順へ戻してはならない。

有償本文・internal本文そのものはreportへ複製しない。reportをpublic artifactに
してよいという意味ではなく、repositoryのvisibilityとCI artifact retentionを
別途確認する。

unsafe判定時はCLIがexit code 1を返す。引数・edition・schemaが不正な場合も成功扱いにしない。

## adapterへのhandoff

Issue #94以降のadapterは次の順序を守る。

1. `validate:standard-book`を実行する。
2. 選択editionのvisibility planを取得する。
3. `documents`とblock decisionを適用してから出力する。
4. target固有構文へ変換する。
5. generated artifactを再検査する。
6. target固有のbinary・投稿・販売境界を検査する。

source checkの成功だけで「漏えいしない」と主張してはならない。adapterが
manifestを無視した場合、markerを削除して本文だけを別表現へ変換した場合、
または未列挙fileをglobで追加した場合は、adapter側の契約違反である。

## 検出できない条件

version 1は完全な情報漏えい対策ではない。

- markerのない本文が意味的に有償・内部情報かは判定しない
- paraphrase、翻訳、HTML構造化など大きく変換された本文の同一性は判定しない
- binary artifact内部は共通checkerで判定しない
- DRM、repository access、販売platform accessを設定しない
- `structure`にないfileをadapterが独自に取り込む動作を許可しないが、adapter実装前には検証できない

これらを理由にregexや自然言語推定を無制限に追加しない。target-specificな残存リスクは各adapter Issueで有限contractとして扱う。

## 最小検証

```bash
npm run validate:standard-book -- examples/standard-book
npm run check-markdown-structure -- examples/standard-book \
  --pattern '{frontmatter,manuscript,backmatter}/**/*.md' \
  --standard-callouts \
  --fail-on warn
npm run check-visibility -- examples/standard-book --edition free
npm run check-visibility -- examples/standard-book --edition sample
npm run check-visibility -- examples/standard-book --edition paid
npm run check-visibility -- examples/standard-book --edition internal
```

公開対象editionはすべて検査する。1 editionの成功を他editionへ流用しない。
