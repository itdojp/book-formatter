# BOOTH commerce metadata / plan ZIP

## 状態と責任境界

`booth-plan-v1`は商品計画用のZIPと説明文を生成します。**実PDF/EPUBは同梱しません。販売・配布可能な完成商品ではありません。** `generated: false` / `ready_for_distribution: false`を維持します。実renderer・成果物の漏えい/互換性検証・EPUBCheck・端末/印刷検証は[#152](https://github.com/itdojp/book-formatter/issues/152)の別工程です。BOOTHへのupload、商品登録、ファイル差替え、価格設定API、店舗認証・決済・在庫は扱いません。

## 入力

正本は[`book.yaml`](standard-book-format.md)と`source.editions/booth.yaml`です。`source.editions`が`editions`なら[`examples/standard-book/editions/booth.yaml`](../examples/standard-book/editions/booth.yaml)が最小例になります。BOOTH以外のtargetではこのファイルは必須ではありません。

[`commerce.schema.json`](../shared/schema/commerce.schema.json) version1で未知key・不足・型・範囲を拒否します。

| field | 契約 |
| --- | --- |
| `schema_version` | `1` |
| `channel` / `currency` | 初版は`booth` / `JPY`のみ |
| `slug` | 小文字英数字・hyphen、先頭英数字、1〜100文字。ZIPのbasename |
| `sku` | 英数字・hyphen・underscore、先頭英数字、1〜100文字。更新時の識別子 |
| `price` | 0以上のsafe integer。文字列/小数は変換しない |
| `full_edition` | CLIで選択する`paid` visibilityのedition ID |
| `sample_edition` | fullと別の`free`または`sample` visibilityのedition ID |
| `summary` | 非空の計画説明文、最大2000文字 |
| `changelog` | 1〜50件。各versionは重複不可、先頭は`book.yaml`のversionと一致 |
| `changelog[].version` | 数値3要素＋任意のprerelease/build部分、最大80文字 |
| `changelog[].date` | 設定者が明示する有効な`YYYY-MM-DD`。実際の公開日は推定しない |
| `changelog[].changes` | 1〜20件の非空文字列、各最大2000文字 |

価格・通貨の検査はローカルmetadata契約です。BOOTHの最新販売価格制限や税務/販売条件の適合を保証しません。例の500円、日付、SKUはsynthetic fixtureであり、利用書籍の設定に置き換えてください。書名・版数・言語はbook.yamlから取得し、権利処理は`pending`のままです。licenseの記載は販売権の承認ではありません。

## 生成

```bash
set -euo pipefail
npm ci --ignore-scripts
npm start build -- \
  --book examples/standard-book \
  --target booth \
  --edition paid \
  --out-dir dist
```

`--out-dir`はtargetの親rootです。上例は`dist/booth`へ出力し、`dist/booth/booth`にはしません。`--dry-run`でも全設定とfull/sample visibilityを確認しますが、ファイルは作りません。

```text
dist/booth/
├── standard-book-example-0.1.0.zip
├── product-description.md
├── README.txt
├── CHANGELOG.md
├── booth-package-manifest.yaml
└── manifest.json
```

ZIPには4つの説明/計画ファイルのみ入ります。外側`manifest.json`は共通adapter契約、commerce SHA-256、ZIP名とSHA-256を持ち、自己参照hashを避けるためZIPへ入れません。予定`full/book-screen.pdf`・`full/book.epub`・`sample/book-sample.pdf`はpackage manifestの**予定名**であり、存在するファイルではありません。偽の`.pdf`/`.epub` placeholderは作りません。

## Visibility / I/O

- 初版は設定されたpaid full版だけを選択できます。free/sample/internal CLI選択は拒否し、有償計画をfree targetへ出しません。sample版を単独で商品化する機能ではありません。
- fullとsampleの両editionに既存visibility検査を実行します。internal等が不正に含まれる選択を出力前に拒否します。本文はこの初版ではコピーしません。
- 商品用metadata自体は公開可能な情報だけを記載してください。私有情報の自動分類器ではありません。任意文言はMarkdown上のliteralとしてentity encodeします。
- configは64KiB上限の[held-tree read](adapter-safe-io.md)で読み、YAML重複key/過剰aliasを拒否します。book.yamlとconfigのsnapshotをcommit前に再確認します。
- owned adapter manifestのある出力だけをstaging全置換し、unknown producer、source重複、symlinkを拒否します。兄弟targetは保持します。手動成果物をowned `booth/`内に置かないでください。
- 既存の同一UID hostile writer境界[#138](https://github.com/itdojp/book-formatter/issues/138)は別課題です。sandbox保証やrenderer安全性を付加したとは主張しません。

## 決定性と配布前gate

ZIP依存は[fflate0.8.3](https://github.com/101arrowz/fflate/tree/v0.8.3)をexact固定します。4つの固定entryを辞書順・STORE・DOS wall-clock `1980-01-01 00:00:00`・通常file0644で保存します。生成日時、絶対workspace path、乱数を商品ファイルに入れません。UTC/Tokyo/NewYorkとNode20/22/24を回帰対象とします。これは計画ZIPの決定性であり、将来のPDF/EPUBの決定性ではありません。

配布前にはrenderer、full/sample投影、本文/metadata/添付/画像の漏えい検証、版数/奥付/著作権/フォント、EPUB/PDF検証、実表示、権利/公開承認が別途必要です。購入者の再ダウンロード運用に使う正式version/SKU/changelogも確認します。計画ZIPをそのまま商品としてuploadしないでください。
