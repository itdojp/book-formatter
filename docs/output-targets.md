# 出力target方針

## 目的

標準書籍フォーマットから生成する新規成果物と、既存書籍を保守するlegacy経路を区別する。target名が存在すること、adapterが実装済みであること、成果物を公開できることはそれぞれ別の状態である。

## Target registry

| target | 用途 | 状態 | 選択基準 | 実装Issue |
| --- | --- | --- | --- | --- |
| `web-mdbook` | 新規標準Web出力 | `web-mdbook-v1` | 新規書籍のWeb出力で使用 | [#95](https://github.com/itdojp/book-formatter/issues/95) |
| `web-jekyll-legacy` | 既存Jekyll / GitHub Pages互換 | skeleton / legacy support contract | 既存consumerの互換保守に限定 | [#96](https://github.com/itdojp/book-formatter/issues/96) |
| `zenn` | Zenn book | skeleton | adapter実装後に選択 | [#98](https://github.com/itdojp/book-formatter/issues/98) |
| `note` | note投稿用成果物 | skeleton | adapter実装後に選択 | [#99](https://github.com/itdojp/book-formatter/issues/99) |
| `kindle` | EPUB / Kindle | skeleton | adapter実装後に選択 | [#100](https://github.com/itdojp/book-formatter/issues/100) |
| `booth` | BOOTH販売package | skeleton | adapter実装後に選択 | [#101](https://github.com/itdojp/book-formatter/issues/101) |
| `pdf` | screen / print PDF | skeleton | adapter実装後に選択 | [#100](https://github.com/itdojp/book-formatter/issues/100) |

`implementation: skeleton`のmanifestは、入力schema、edition visibility、target選択を検証したbuild planである。target固有成果物の生成、公開可能性、deploy成功を示さない。

## Web出力の判断

### 新規書籍

1. [`book.yaml` version 1](./standard-book-format.md)を正本metadataとする。
2. 標準Markdownとedition visibilityを検証する。
3. Web出力は`web-mdbook`を選ぶ。
4. adapterが生成したprojectをmdBookの固定versionでbuildし、responsive / link / visibilityを検証する。
5. deploy方式はadapter buildと分離して決定する。

```bash
(
set -euo pipefail
npm run validate:standard-book -- ./my-book
npm start build -- \
  --book ./my-book \
  --target web-mdbook \
  --edition free \
  --out-dir dist
MDBOOK_BIN="$PWD/.work/tools/mdbook-v0.5.4-x86_64-unknown-linux-gnu/mdbook"
test -x "$MDBOOK_BIN"
test "$("$MDBOOK_BIN" --version)" = "mdbook v0.5.4"
"$MDBOOK_BIN" build dist/web-mdbook
npm run check-visibility -- \
  ./my-book \
  --edition free \
  --artifact dist/web-mdbook/book
npm run check-mdbook-responsive -- --book dist/web-mdbook
)
```

command blockは1つのsubshellとして実行し、いずれかのgateが失敗した時点で後続処理を停止する。先に[`web-mdbook` adapter contract](../adapters/web-mdbook/README.md#buildとレスポンシブ検証)の公式URL・SHA-256検証手順を実行し、そこで生成したbinaryの絶対pathを`MDBOOK_BIN`に設定する。`mdbook`は検証済みversion `0.5.4`へ固定し、version文字列だけが一致する任意の`PATH`上binaryでは公開成果物を生成しない。`check-visibility --artifact`は生成後の漏えい検査であり、変換前にadapterが行うsource visibility検査やresponsive検査では代替できない。

### 既存Jekyll / GitHub Pages書籍

既存書籍は、個別の移行Issueとconsumer検証が完了するまで現在のJekyll方式を維持する。

- `book-config.json`、`docs/_config.yml`、layout、include、asset、consumer workflowを暗黙変換しない。
- `create-book`、`update-book`、`sync-components`、`rollout-ux`はlegacy compatibility commandとして維持する。
- Jekyll componentの同期は[`web-jekyll-legacy`互換契約](../adapters/web-jekyll-legacy/README.md)に従う。
- `web-jekyll-legacy` targetのskeleton manifestをJekyll siteとしてdeployしない。
- mdBookへの移行は1冊ごとのPRで、URL、redirect、navigation、Pages、公開HTTPを検証する。

既存Jekyll書籍であることは保守停止を意味しない。セキュリティ、accessibility、Pages互換性の修正は、legacy consumerへの影響を検証した独立Issue / PRとして行う。

## Adapterとdeployの分離

adapter buildは変換と成果物検証を担当し、repository設定や外部サービスへの公開を行わない。

| 責務 | adapter build | deploy / rollout |
| --- | --- | --- |
| 標準入力とeditionの検証 | 対象 | 対象外 |
| target固有project / package生成 | 実装済みtargetだけ対象 | 対象外 |
| 生成artifactのvisibility検査 | 実装済みtargetの責務 | 結果を再確認 |
| GitHub Pages / Cloudflare Pages設定 | 対象外 | 別Issue |
| consumer repository変更 | 対象外 | 1冊1PR |
| 投稿、販売登録、upload | 対象外 | channel別運用 |

GitHub PagesとCloudflare Pagesの標準deploy方式は[#97](https://github.com/itdojp/book-formatter/issues/97)で扱う。target adapterへcredential、repository設定変更、公開操作を混在させない。

## Edition visibility

すべての標準targetは[`free < sample < paid < internal`](./paid-editions.md)のvisibility契約を入力時に検証する。実adapterは生成後artifactも再検査する。legacy Jekyll consumerには標準visibility契約が自動適用されないため、有償本文を含む書籍を未監査で同期・公開しない。

## 移行gate

Jekyll consumerを標準Web出力へ移行する場合は、少なくとも次を満たす。

1. 対象repositoryと正本原稿を確定する。
2. formatterを監査済みcommit SHAで固定する。
3. free / paid / internal境界を登録し、生成artifactの漏えい検査を通す。
4. 旧URLと新URL、redirect、canonical link、navigationを比較する。
5. desktop / mobileの表示とaccessibilityを確認する。
6. consumerのPR CI、merge後main、Pages deployment、公開HTTPと主要markerを確認する。
7. rollback条件と旧Jekyll経路の終了条件を記録する。

全書籍への一括適用、mutableな`main`参照、未検証targetのdeployは行わない。
