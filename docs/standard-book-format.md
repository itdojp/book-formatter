# 標準書籍フォーマット

## 目的

標準書籍フォーマットは、単一の正本からWeb、Zenn、note、Kindle、BOOTH、PDFなどの出力を生成するための入力契約である。出力先のファイルや設定を正本とは扱わない。

この文書はIssue [#90](https://github.com/itdojp/book-formatter/issues/90)で導入した`schema_version: 1`を説明する。schemaの機械可読な正本は[`shared/schema/book.schema.json`](../shared/schema/book.schema.json)、最小例は[`examples/standard-book/`](../examples/standard-book/)にある。

## 標準ディレクトリ

```text
standard-book/
├── book.yaml
├── manuscript/
│   ├── 01-introduction.md
│   └── 02-workflow.md
├── assets/
│   └── README.md
├── frontmatter/
│   └── preface.md
├── backmatter/
│   └── afterword.md
└── editions/
    └── README.md
```

| path | 責務 | 正本に含めないもの |
| --- | --- | --- |
| `book.yaml` | 書誌、source path、原稿順、editionを宣言する | adapter固有のbuild結果 |
| `manuscript/` | 本文の章原稿 | ZennやJekyllだけで使う生成済みページ |
| `assets/` | 複数出力で共有する図版・添付素材 | adapterのcacheや変換後画像 |
| `frontmatter/` | はじめに、凡例など本文より前の原稿 | Web layout |
| `backmatter/` | おわりに、付録、索引など本文より後の原稿 | 電子書籍の生成済み目次 |
| `editions/` | edition固有の補助定義を置く予約領域 | adapterの出力directory |

ディレクトリ名は`book.yaml`の`source`で明示する。標準validatorは宣言された5ディレクトリが実在し、相互に異なることを要求する。`book.yaml`、宣言したsource directory、`structure`から参照する原稿pathでは、途中のpath componentを含めてsymbolic linkを禁止する。canonical pathが書籍root外へ解決される入力は受理しない。

## `book.yaml` version 1

最上位では次のfieldをすべて必須とする。未定義fieldは、schemaを更新せずに追加できない。

| field | 意味 |
| --- | --- |
| `schema_version` | metadata契約のversion。初版は整数`1` |
| `id` | repositoryや出力先に依存しない書籍識別子 |
| `title` | 書籍名 |
| `language` | BCP 47形式を基準にした主言語tag |
| `authors` | 1名以上の著者名と任意のHTTPS URL |
| `publisher` | 発行者名と任意のHTTPS URL |
| `repository` | 管理repositoryのHTTPS URLと、symbolic `HEAD`ではないdefault branch |
| `source` | 5つの正本directoryの相対path |
| `structure` | frontmatter、chapter、backmatterの順序、原稿path、任意のvisibility |
| `editions` | edition ID、表示名、有限の状態、任意のvisibilityとdocument選択 |
| `license` | SPDX identifierまたは明示的なproject license表現 |
| `version` | 正本のSemantic Version |

`structure.frontmatter`、`structure.chapters`、`structure.backmatter`の配列順が正本の読書順である。各要素の`id`と`path`は書籍内で一意でなければならない。chapterは1件以上必要であり、各pathは対応する`source` directory配下の実在するMarkdown fileを指す。

`editions[].status`は`draft`、`published`、`archived`のいずれかである。visibilityを有効にする場合は、structure entryとeditionで`free`、`sample`、`paid`、`internal`を明示し、editionの`documents`で対象IDを列挙する。詳しい包含matrixと漏えい検査は[Edition visibilityと有償本文の混入防止](paid-editions.md)を参照する。販売価格や出力adapterの設定はversion 1の必須情報ではない。

Web provider、base path、canonical public URL、deploy outputは、将来の
`deployment_profiles`案で表す。この案は
[Web出力のデプロイ契約](web-deployment.md#deploy-profile案未実装)で管理する。
これは現行schema version 1のfieldではない。`book.yaml`へ先行追加すると
validatorが拒否する。採用時はschema versionとconsumer migrationを独立Issueで更新する。

## 検証

Node.jsの対応versionはrepositoryの`package.json#engines`に従う。2026-09-01時点ではNode.js `^20.19.0 || ^22.13.0 || >=24.0.0`である。

```bash
npm ci --ignore-scripts
npm run validate:standard-book -- examples/standard-book
```

validatorはJSON Schemaによるmetadata検査に加え、次をfail closedで確認する。

- source directoryが書籍root配下にあり、実directoryである
- `book.yaml`、source directory、宣言した原稿pathにsymbolic linkがない
- source directory同士がcanonical pathで同じ場所を指さない
- structureのIDとpathが重複しない
- 各原稿が対応するsource directory配下にあり、実fileである
- edition IDが重複しない
- visibility付きeditionのdocument IDが実在するstructure entryを参照する
- URLが資格情報を含まない有効なHTTPS URLであり、default branchがGit ref規則を満たす

schema自体がJSONとして読めることは次の最小commandでも確認できる。

```bash
node -e "JSON.parse(require('fs').readFileSync('shared/schema/book.schema.json','utf8')); console.log('schema ok')"
```

## 既存configとの関係

新旧の契約は同じ用途ではない。暗黙変換やfallbackは行わない。

| 契約 | path | 用途 | 現在のcommand |
| --- | --- | --- | --- |
| 標準正本metadata | `book.yaml` / `shared/schema/book.schema.json` | マルチチャネル出力へ渡す正本を宣言する | `npm run validate:standard-book -- <book-dir>` |
| 既存生成config | `book-config.json`など / `shared/schemas/book-config.schema.json` | 現行Jekyll寄りの`create-book`、`update-book`を設定する | `npm start -- validate-config` |

既存の`ConfigValidator`、`validate-config`、`create-book`、`update-book`、`shared/schemas/book-config.schema.json`は維持する。既存書籍は本Issueだけでは移行されず、`book.yaml`がないことを理由に現行処理を失敗させない。

標準正本を出力先へ変換するCLIとadapterはIssue [#94](https://github.com/itdojp/book-formatter/issues/94)で定義する。既存Jekyll資産の移管はIssue [#96](https://github.com/itdojp/book-formatter/issues/96)の責務である。

## version変更

`schema_version`はmetadataの読み手が解釈可能な契約を選ぶための識別子である。field追加、意味変更、必須条件変更を行う場合は、互換性を評価してschemaとvalidatorを同じPRで更新する。visibility fieldは既存version 1との互換性を保つoptional extensionであり、`check-visibility`を実行する書籍では明示必須とする。既存のversion 1書籍を無言で別の意味に読み替えてはならない。
