# 標準Markdownルール

## 1. 目的と適用範囲

この文書は、`book.yaml`が管理する正本原稿をWeb、Zenn、note、PDF、EPUBなどへ変換するための標準Markdown契約を定義します。正本は特定の公開先の記法を直接要求せず、公開先との差異はadapterが吸収します。

この契約の対象は、標準書籍フォーマットの`frontmatter/`、`manuscript/`、`backmatter/`にあるMarkdownです。既存のJekyll資産や過去の書籍を直ちに移行させる契約ではありません。

ルールの強さは次の3段階です。

| 区分 | 意味 | 違反時の扱い |
| --- | --- | --- |
| 必須 | 正本の可搬性または安全な変換に必要 | 検査可能な項目はCIで失敗させる |
| 推奨 | 可読性、アクセシビリティ、変換品質を高める | reviewで確認し、将来検査を追加できる |
| 禁止 | 公開先固有、曖昧、または安全に変換できない | 正本では使用せずadapterまたは素材へ分離する |

## 2. 正本の基本原則

### 2.1 必須

- UTF-8（BOMなし）、LF改行、末尾改行を使用します。
- 1ファイルを1つの論理的な章または前後付けとして扱います。
- ファイルごとにATX形式のh1を1つ置き、以降は見出しレベルを飛ばしません。
- コードブロックにはfenced code blockを使用し、言語名を指定します。
- 画像と書籍内リンクは、正本内で解決できる相対パスを使用します。
- 外部リンクは`https` URLを使用します。
- 出力先固有の記法を正本へ直接書きません。

### 2.2 推奨

- 1つの段落には1つの主題を置きます。
- 見出し文字列は同一ファイル内で重複させません。
- リンクテキストだけで遷移先の目的が分かるようにします。
- 表が長くなる場合は、箇条書きや定義リストへ分割できるか検討します。
- 数式には本文による意味の説明を併記します。

### 2.3 禁止

- Zennのmessage記法、note固有HTML、Jekyll Liquidなど、特定出力先だけが解釈する記法
- JavaScript URL、イベント属性、iframe、script、styleなどの実行可能なraw HTML
- HTMLコメントに保存した公開対象外本文
- 画像へ埋め込んだ唯一の説明、色だけに依存する意味付け
- calloutの入れ子、未知のcallout type、開始行に追加したtitle/options
- `paid`または`internal`という文字列だけに依存した公開境界

## 3. 要素別ルール

### 3.1 見出し

正本はATX形式を使用します。

```markdown
# 章タイトル

## 節タイトル

### 項タイトル
```

Setext形式、h1の複数使用、h2からh4への飛び越しは使用しません。`check-markdown-structure`は現在、複数h1と見出しレベル飛びをwarningとして報告します。h1欠落、見出し重複、生成anchor衝突は後続検査です。

### 3.2 コードブロック

3文字以上のbacktickまたはtilde fenceを使用し、開始fenceに言語名を指定します。内容に同じfenceが現れる場合は、外側のfenceを長くします。

````markdown
```bash
npm test
```
````

言語名のないfenceと未閉鎖fenceは既存検査の対象です。行番号、ファイル名、実行可否などの表示オプションは正本のfenceへ埋め込まず、本文またはadapter metadataで扱います。

### 3.3 画像

画像は代替テキストと相対パスを使用します。

```markdown
![標準原稿から各出力先へ変換する流れ](../assets/publishing-flow.svg)
```

代替テキストを空にできるのは装飾目的と明示できる場合だけです。幅、高さ、caption、srcsetなどの出力先固有属性はadapterが生成します。外部URLへのhotlink、base64 data URL、raw HTMLの`img`は正本では禁止します。

### 3.4 表

GFM互換のpipe tableを使用し、headerを必須とします。セル内改行、複雑な結合、raw HTML tableは使用しません。

```markdown
| 項目 | 正本での値 |
| --- | --- |
| 入力 | `manuscript/` |
| 出力 | adapter生成物 |
```

表の意味が画面幅に依存する場合、本文による要約を併記します。PDF/EPUBで収まらない表はadapterが分割またはリストへ変換します。

### 3.5 脚注

正本では参照と定義を組にした脚注記法を使用します。

```markdown
標準原稿は公開成果物と分離します。[^canonical]

[^canonical]: 正本は編集対象、公開成果物は再生成可能な出力です。
```

脚注IDはファイル内で一意にし、意味のある英数字とhyphenを使用します。noteなど脚注を同じ形で扱えない出力先では、adapterが末尾注または本文へ変換します。

### 3.6 注記（callout）

正本のcalloutは次の5種類だけを使用します。

| type | 用途 | 公開境界との関係 |
| --- | --- | --- |
| `note` | 補足、前提、参照情報 | 通常の公開本文 |
| `tip` | 推奨手順、効率化の助言 | 通常の公開本文 |
| `warning` | 危険、制約、停止条件 | 通常の公開本文 |
| `paid` | 有償edition候補の範囲 | visibility contract version 1で包含判断 |
| `internal` | 編集・運用上の内部範囲 | visibility contract version 1で公開物から除外 |

構文は開始delimiter、本文、終了delimiterです。delimiterは行頭に置き、typeは小文字で指定します。

```markdown
:::warning
公開先へ変換する前に検証を完了してください。
:::
```

calloutを入れ子にしません。開始行へtitleやoptionを追加しません。delimiterの前後には空行を置くことを推奨します。`paid`と`internal`は見た目の装飾ではなく、[visibility model](paid-editions.md)が検証する構造マーカーです。markerはaccess controlではなく、adapterが包含判断を適用し生成artifactを再検査する必要があります。

有限構文と検査契約の詳細は[`shared/markdown/README.md`](../shared/markdown/README.md)を参照してください。

### 3.7 数式

inline mathは`$...$`、display mathは独立行の`$$`で囲むLaTeX表現を使用します。

```markdown
変換対象数を $n$ とします。

$$
n_{output} = n_{source} - n_{excluded}
$$
```

数式だけで要件を説明せず、変数と結論を本文でも定義します。Web/mdBookはMathJaxまたはKaTeX、PDFは組版系、noteは画像または読み替え可能な本文へadapterが変換します。複雑なmacroや出力先固有extensionは正本では禁止します。

### 3.8 リンク

書籍内リンクは相対パス、外部リンクは`https`を使用します。リンクテキストに「こちら」だけを使わず、遷移先を説明します。

```markdown
[標準書籍フォーマット](standard-book-format.md)
```

branchに依存するGitHub blob URL、短縮URL、認証情報を含むURL、`javascript:`や`data:` schemeは禁止します。adapterは公開先での拡張子、anchor、base pathを解決します。

### 3.9 Front Matterとraw HTML

標準書籍の書誌・構造metadataは`book.yaml`を正本とします。個別MarkdownのYAML Front Matterは新規標準原稿では使用しません。既存checkerのFront Matter検査はlegacy原稿の互換性確認として維持します。

raw HTMLは公開先間で意味が変わるため、原則禁止します。表現できない要件がある場合は、正本の標準構文またはadapter契約を別Issueで追加し、出力先固有HTMLを直接埋め込みません。

## 4. 出力先別変換ポリシー

正本をそのまま投稿するのではなく、adapterが次の差異を変換します。表の「変換」は実装済みを意味せず、#94以降のadapter契約です。

| 要素 | Web / mdBook | Jekyll legacy | Zenn | note | PDF / EPUB |
| --- | --- | --- | --- | --- | --- |
| 見出し | anchorとnavigationを生成 | layout/front matterを生成 | chapter制約へ変換 | 投稿単位へ分割 | 章番号・目次へ変換 |
| code fence | highlightingへ変換 | Rouge等へ変換 | 対応言語名へ正規化 | Markdown/HTMLへ変換 | 等幅fontと改ページを調整 |
| 画像 | responsive属性とbase pathを生成 | Pages base pathを生成 | assetsへ複製 | upload manifestを生成 | 解像度・captionを調整 |
| 表 | responsive wrapperを生成 | responsive wrapperを生成 | pipe tableを維持 | HTMLまたはlistへ変換 | 幅に応じ分割・回転 |
| 脚注 | 対応rendererへ渡す | plugin契約へ変換 | 対応記法へ変換 | 末尾注または本文へ変換 | footnote/endnoteへ変換 |
| callout | theme componentへ変換 | include/classへ変換 | message等へ変換 | 見出し付きblockへ変換 | boxまたは見出し付き段落へ変換 |
| 数式 | MathJax/KaTeXへ変換 | plugin契約へ変換 | 対応数式へ変換 | 画像または本文へ変換 | 組版数式へ変換 |
| リンク | base path/拡張子を解決 | `relative_url`相当を生成 | chapter/assets pathへ変換 | 公開URLへ変換 | 内部参照・外部URLを分離 |
| `paid`/`internal` | edition出力前に除外・検査 | 同左 | 同左 | 有料line/除外manifestへ変換 | edition別に包含・除外 |

変換後の構文と可視性はadapterが検証します。`paid`/`internal`のsource-level包含判断はvisibility contract version 1を使い、共通adapter CLIは#94、個別出力は#95から#101で実装します。

## 5. 検査方針

### 5.1 `check-markdown-structure`で現在検出する項目

| 項目 | severity | 備考 |
| --- | --- | --- |
| 不正・未閉鎖Front Matter | error | column 1（末尾space/tab可）のdelimiterを使うlegacy互換検査 |
| 見出しレベル飛び、複数h1 | warning | 移行可能性を保つためwarning |
| 言語名のないcode fence | warning | 新規標準原稿では必須 |
| 未閉鎖code fence | error | markerと長さを考慮 |
| backtickを含む不正なbacktick fence info | error | 本文をfenceとして誤って除外しない |
| 未知・不正なcallout delimiter | error | `--standard-callouts`指定時に5種類だけ許可 |
| calloutの入れ子・孤立close・未閉鎖 | error | 明示検査時。fence内の構文例は検査しない |
| indentされたcallout delimiter | error | 明示検査時。top-level限定 |

### 5.2 後続Issueで追加する検査

| 検査 | 所有Issue / 実装段階 | このIssueで実装しない理由 |
| --- | --- | --- |
| h1欠落、anchor重複、画像alt、table/footnote/math整合 | #103または検査強化Issue | ASTまたはrendererの意味論が必要 |
| target変換後の`paid`/`internal`再検査 | #94–#101 | 共通visibility検査だけではtarget固有変換を保証できない |
| 出力先固有記法への変換と変換後validation | #94–#101 | adapter責務 |
| 内部リンク、asset、公開base pathの解決 | 個別adapter | 出力先のpath contractが必要 |
| raw HTMLの安全性と実行可能属性 | #103またはsecurity検査Issue | parserを伴う共通方針が必要 |
| 数式macroとrenderer互換性 | PDF/Web adapter | renderer選定後に確定する |

### 5.3 ルールとenforcementの対応

文書上の必須・禁止は、すべてが現時点で自動検査されるという意味ではありません。自動検査がない規則はreviewで確認し、標準formatのCI統合時に#103または担当adapterへ移します。

| ルール領域 | 現在のenforcement | 次の機械検査owner |
| --- | --- | --- |
| UTF-8、BOMなし、LF、末尾改行 | review。既存Unicode検査は疑わしい文字を別途検出 | #103 |
| ATX h1が1つ、level非飛越、Setext禁止、anchor一意 | 複数h1とlevel飛越のみwarning。その他はreview | #103 |
| fence言語名と閉鎖 | `check-markdown-structure` | 現行checker |
| 画像alt、相対path、hotlink/data URL/raw HTML禁止 | link/layout検査の一部とreview | #103、個別adapter |
| GFM pipe table、header、HTML table・複雑結合禁止 | layout検査の列数確認とreview | #103、PDF/Web adapter |
| 脚注ID、参照・定義の対応 | review | #103、個別adapter |
| 5種類のcalloutとdelimiter構造 | 明示optionを指定した`check-markdown-structure` | 現行checker |
| 数式delimiter、変数説明、macro制限 | review | Web/PDF adapter |
| 相対内部link、外部HTTPS、危険scheme・短縮URL禁止 | link検査の一部とreview | #103、個別adapter |
| raw HTML、HTML comment、公開先固有構文の禁止 | review | #103、security検査 |
| `paid`/`internal`の包含・除外とbounded artifact scan | `check-visibility` | #94–#101のtarget固有検査 |
| 出力先別の構文・path・asset変換 | 未実装であることを明示 | #94–#101 |

## 6. 移行と互換性

この規則は標準書籍フォーマットversion 1向けです。既存書籍を一括で失敗させず、次の順序で移行します。

1. 正本候補へcheckerを`--fail-on error`で適用します。
2. warningを棚卸しし、標準原稿では解消します。
3. visibility modelとadapterが利用可能になってから公開成果物を比較します。
4. pilotで差分、リンク、可視性、アクセシビリティを確認します。
5. 移行済み書籍だけにより厳しいgateを適用します。

既存Jekyll原稿にFront MatterやLiquidがあることを理由に、今回のルールで直ちに破壊的変更を行いません。legacy資産の隔離と変換は#96および#102で扱います。

## 7. 最小検証

標準サンプルは次のコマンドで検証します。reportはworkspace配下の一時領域へ保存してください。

```bash
npm run check-markdown-structure -- examples/standard-book \
  --pattern '{frontmatter,manuscript,backmatter}/**/*.md' \
  --standard-callouts \
  --fail-on warn \
  --output markdown-structure-report.json
```

`markdown-structure-report.json`はrepositoryの`.gitignore`対象です。標準callout検査は`--standard-callouts`を指定した場合だけ有効です。patternはこの契約の正本範囲に限定します。未移行のlegacy書籍では既存の`:::`記法を直ちにerrorにしないため、`book.yaml`の有無にかかわらず暗黙には有効化しません。

この検査の成功は、出力先での表示、可視性、安全性、販売条件を保証しません。それらは対応するadapterとvisibility検査の完了条件です。
