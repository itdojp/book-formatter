# Cloudflare Pages設定例（標準mdBook）

この例はCloudflare PagesのGit integrationへ設定する値を示します。API token、account ID、DNS、custom domainは扱いません。`web-mdbook-v1`のbuild contractをconsumer repository内のreview済みscriptとして固定してから設定してください。

## Dashboard設定

| Field | Value |
| --- | --- |
| Framework preset | None |
| Root directory | repository root（既定） |
| Build command | `bash scripts/build-web-mdbook.sh` |
| Build output directory | `dist/web-mdbook/book` |
| Production branch | `main`またはreview済み`repository.default_branch` |
| `MDBOOK_OUTPUT__HTML__SITE_URL` | `/` |
| Node.js | consumerが検証したNode 24 |

script内または非secret environment variableの`BOOK_FORMATTER_SHA`を、監査済み40桁commitへ固定します。`main`、major tag、展開済みtool directoryを代用しません。secret値を`book.yaml`、`book-registry`、build log、artifactへ記録しません。

## `scripts/build-web-mdbook.sh`が満たす契約

scriptの具体処理は[web-mdbook adapterのself-contained build](../../adapters/web-mdbook/README.md#buildとレスポンシブ検証)と同一にします。

1. `set -euo pipefail`で開始する。
2. formatter checkoutのHEADと全tracked bytesを監査済みSHAへ照合する。
3. `npm ci --ignore-scripts`で依存を再構築する。
4. `book.yaml`、edition visibility、`web-mdbook` adapter projectを検証する。
5. SHA-256検証したmdBook 0.5.4 binaryをfresh directoryへ展開する。
6. `MDBOOK_OUTPUT__HTML__SITE_URL=/`でbuildする。
7. projectの決定的な再生成、responsive、local link、artifact visibilityを検証する。
8. `dist/web-mdbook/book/index.html`、`404.html`、`searchindex-*.js`を確認する。
9. `dist/web-mdbook/book`以外をdeploy outputへ混在させない。

Cloudflare Pagesはbuild commandのexit codeで成否を判定するため、warningを出してexit 0にするfallbackを作りません。

## Productionとpreview

- Production branchだけをcanonical public URLの候補とする。
- preview branchの自動build範囲はBranch controlで有限にする。
- preview URLをportfolio registryのproduction URLへ記録しない。
- private/paid/internal editionをpreviewへ出さない。公開projectは原則`free` editionを使う。
- Cloudflare GitHub Appは対象consumer repositoryだけへinstallする。

## 404

mdBookはtop-level `404.html`を生成します。Cloudflare Pagesはtop-level 404がないprojectをSPAとして扱うため、buildで欠落をfail-closedにします。`_redirects`で全pathを`/index.html`へrewriteして404を隠しません。

custom redirectが必要な場合は、consumerが`_redirects`を正本として管理し、adapter出力へ明示的にcopy・検査する独立PRを作ります。redirectはheader ruleより先に評価されるため、両方を使う場合は公開HTTPで確認します。

## Cacheとheaders

初期状態ではCloudflare Pagesの既定ETag/cacheを使います。

- HTML、`searchindex-*.js`、非fingerprint assetへ`immutable`を付けない。
- content hash付きassetだけを長期cache候補にする。
- stale artifactが疑われる場合はsource SHA/deploymentを照合してからcacheをclearする。
- `_headers`はstatic asset responseにだけ適用され、Pages Functions responseには自動適用されない。
- `_headers`や`_redirects`を使わない書籍へ空のfileを一括配布しない。

## Build cache

build cacheは正本や検証済みartifactの代替ではありません。利用する場合もadapter projectを再生成し、renderer binary version/digest、source SHA、formatter SHA、editionを毎回検証します。cache hitだけでdeploy可と判定しません。

## 確認

- production deploymentが期待するsource SHAを指す
- root、`404.html`相当のmissing route、主要chapterがHTTPで利用可能
- CSS/JS/search indexが同じdeploymentから取得される
- desktop/mobile navigationが使用可能
- paid/internal markerが0
- previewとproductionのURL/branchが区別される

一次資料は[Web出力のデプロイ契約](../web-deployment.md#一次資料2026-09-04-jst確認)を参照してください。
