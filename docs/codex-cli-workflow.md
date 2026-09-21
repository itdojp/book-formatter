# IssueからPR・公開確認までの作業契約

この文書はCodex CLIなどのエージェントが本repositoryを保守する際の共通手順です。
モデル、CLI設定、別プロセスの起動手順ではありません。人間とエージェントのどちらも
同じ検証・review・権限境界を使用します。Issueの個別Runbookが優先されます。

## 1. 正本と所有範囲を確定する

1. AGENTS.md等の作業指示、Issue本文と全コメント、関連Issueを読む。
2. `pwd`、`git status --short --branch`、HEAD、remote、live main、Open PRを確認する。
3. dirty/non-main checkoutや他セッションのbranchを変更しない。許可されたworkspace内の
   専用clone/worktreeを、監査したmain SHAから用意する。既存担当PRがあれば重複作成しない。
4. 完了条件、対象外、変更file、検証、rollbackをIssueへ記録してから編集する。
5. 不明なSource/権利/公開範囲を推測で埋めない。private/paid本文やsecretをpublicな
   Issue、ログ、artifactへ載せない。複数書籍の無検証一括変更をしない。

新規書籍の正本は[標準format](standard-book-format.md)の`book.yaml`と
[標準Markdown](markdown-rules.md)です。`book-config.json` / Jekyllは
[legacy互換](../adapters/web-jekyll-legacy/README.md)です。形式を暗黙変換しません。
[visibility](paid-editions.md)、[target](output-targets.md)、[deploy](web-deployment.md)を
分離し、artifactがあることと公開できることを混同しません。

## 2. 依存関係と軽量source gate

以下はformatter rootで実行する例です。対応Node範囲は`package.json`のenginesを
正本とし、CIのNode matrixも確認します。lockfileを保持した`npm ci --ignore-scripts`を
使い、失敗を`|| true`で隠しません。必要なinstall scriptがある場合は別途監査します。
cache、TMPDIR、レポートは自分が所有するworkspace配下へ置きます。

```bash
set -euo pipefail
mkdir -p .cache/agent-tmp .cache/npm
export TMPDIR="$PWD/.cache/agent-tmp"
export npm_config_cache="$PWD/.cache/npm"
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run validate:standard-book -- examples/standard-book
# このexampleが宣言する公開editionすべて（internalは非公開）
for EDITION in free sample paid; do
  npm run check-visibility -- examples/standard-book --edition "$EDITION" --output ".cache/source-visibility-$EDITION.json"
done
npm run check-markdown-structure -- examples/standard-book --standard-callouts --fail-on warn --output .cache/source-markdown.json
```

これらは標準exampleのsource/schema検証です。実際の書籍ではbook pathを対象の正本へ置き換え、
`book.yaml`が宣言する`visibility != internal`の全edition IDを列挙します。
IDが`free`等であるとは限りません。source visibilityの成功は生成artifactの漏えい検査では
ありません。構造Markdown検査は事実確認や校正を代替しません。機密本文を扱う場合は
レポートも非公開に保持します。

## 3. 編集・検証

- 原則1 source Issue = 1 PR。本文、依存、build、formatter pin、公開設定の変更を
  無関係に混在させない。差分の大小ではなく責務とrollback単位で分ける。
- 狭い回帰testを先に実行し、既存仕様を変えるなら肯定例・否定例と移行判断を追加する。
- formatter rootの共通gate:

```bash
set -euo pipefail
npm test
npm run lint
npm run build
npm run check:node24-actions
git diff --check
git diff --stat
```

`npm test`はpackage scriptsに明示したsuiteです。repository中の全test fileを自動列挙
する契約ではありません。単一testは`node --test tests/BookGenerator.test.js`等を使います。
未定義の`test:coverage`は呼びません。既存gate外のlegacy suiteと確認済みの失敗は
[#164](https://github.com/itdojp/book-formatter/issues/164)で所有範囲・復旧を追跡しています。lintはtestの一時file cleanupが終わってから実行します。
既知warning、gate外test、skip、未実施を成功件数に混ぜず、対象SHAと理由を記録します。

### target別の追加gate

| 変更範囲 | 追加確認 |
| --- | --- |
| Web mdBook | [固定binaryのbuild・responsive・artifact visibility](../adapters/web-mdbook/README.md#buildとレスポンシブ検証) |
| Jekyll consumer | [fresh依存bootstrap/固定SHA/allowlist/rollback](legacy-consumer-mutation.md)、Book QA、Pages、HTTP・marker |
| shared JS | 単体DOM検証と`npm run test:shared-dom-browser`。native Chrome必須、短い所有TMPDIRが必要 |
| Zenn/note | 各adapterの生成物/漏えいgate。[Zenn](../adapters/zenn/README.md)、[note](../adapters/note/README.md)。投稿・価格設定・ログアウト表示は別確認 |
| Kindle/PDF/BOOTH | [plan-only境界](pdf-epub-kindle.md)と[commerce](commerce.md)。実書籍のrender/権利/端末確認が未実施なら配布承認しない |
| isolated publication | [隔離toolchain](../toolchains/publication/README.md)と[合成EPUB gate](../toolchains/publication/tests/epub/README.md)。root依存に重いrendererを混ぜない |

## 4. CIの責務とコスト

`Quality Check`の既存`Validate Templates` jobにschema/visibility/Markdownの軽量CLI検査を
集約します。外部認証、PDF生成、ブラウザの新規依存はこの3検査には不要です。
CIは検証済みmetadataの`editions`を列挙し、IDやstatusではなくvisibilityが
`internal`以外の全edition（free/sample/paid、draftを含む）を個別検査します。
レポートは`visibility-<id>.json`です。CLIの非zero exitはjob失敗にします。外部サービスの不調と内容違反を区別して記録します。

既存のWeb mdBook/Chrome、Windows held-tree、CodeQL、隔離Publicationの検証gateを
この整理のために削除・skip・optional化しません。Publicationには限定合成EPUBの実生成が
ありますが、一般のbook/edition rendererやPDF、販売可能性の証明ではありません。
今後の重いPDF/全書籍/実機検証は独立job/手動検証として設計し、共通の高速source gateに
外部認証や実書籍本文を持ち込みません。

## 5. PRとreview

Draft PR本文に次を記録します。

- source Issue、対象main SHA、正本/変更fileと理由、非互換の有無
- 最終head SHA、実行command・環境・結果、CI run URL/ID
- source/visibilityと生成artifactの対象範囲、未実施と既知warning
- review本文、inline、suggestion、suppressed指摘、threadの採否・返信
- follow-up、rollback、公開/非公開境界、merge/main検証checklist

独立reviewは正確なheadへ依頼し、更新後は古いheadの承認だけで完了としません。
全レビュー本文と全threadを取得し、未解決・件数不整合・欠落review IDを0にします。
無関係な追加提案は理由と追跡Issueを明示して切り分けます。Ready遷移で自動reviewが走る
repositoryでは、その終了と追加指摘を確認します。check greenとreview完了は別条件です。

## 6. Merge・公開・終了

mergeの権限が作業指示にある場合だけ、exact-head条件付きの通常mergeを行います。
main直push、force push、無断rebase、admin bypass、保護規則変更はしません。
merge commitとreview対象の内容、main CI、CodeQLの結果を再確認します。
npm audit0、CodeQL解析正常、CodeQL未解決alert0は別の観測です。

Web consumerはPages/deploymentの対象SHA、HTTP、タイトル/marker、navigation、リンク、
desktop/mobileを確認します。formatterの文書変更だけでconsumer公開成功を主張しません。
IssueをcloseするのはDoDとmerge後gateを満たした場合のみです。

最後にowned branch/worktree、一時build、cacheを棚卸しして安全にcleanupします。
他セッション、dirty checkout、未分類のfileは削除しません。再現用ログと次工程は
Task Ledger/Issueへ保存し、blockerは原因・影響・owner・再開条件を具体化します。
[archive計画](archive-plan.md)のunknownやactive資産は、参照文字列0だけで移動しません。
