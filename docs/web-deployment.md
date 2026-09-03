# Web出力のデプロイ契約

## 目的と責務

この文書は、adapterが検証済み静的成果物を生成した後に、Web公開先へ渡す境界を定義します。対象は`web-mdbook-v1`と既存Jekyll書籍です。adapterはrepository設定、認証、upload、DNSを変更しません。deployは正本原稿やadapter projectではなく、検証済みbuild outputだけを公開します。

| 責務 | adapter/build | deploy |
| --- | --- | --- |
| 正本metadata、edition、visibilityの検証 | 必須 | 結果を再確認 |
| target固有projectの生成 | 必須 | 変更しない |
| renderer build、link、responsive、artifact visibility | 必須 | 成功した成果物だけ受領 |
| providerの権限、production branch、environment保護 | 対象外 | 必須 |
| artifact upload、deployment、公開HTTP確認 | 対象外 | 必須 |
| DNS、custom domain、repository設定 | 対象外 | 各consumerの独立Issue |

## 現行の出力ディレクトリ

| 入力経路 | project/build command | deployするdirectory | 注意点 |
| --- | --- | --- | --- |
| 標準`web-mdbook` | `npm start build -- --target web-mdbook --out-dir dist`の後、固定mdBook 0.5.4で`dist/web-mdbook`をbuild | `dist/web-mdbook/book` | `dist/web-mdbook`全体や`manifest.json`を公開しない |
| 既存Jekyll workflow | consumer固有のJekyll build | workflowが生成した`_site` | `web-jekyll-legacy` skeleton manifestを公開しない |
| branch/`docs/` sourceの既存Pages | GitHub Pages/Jekyllの現行契約 | providerが選択したrootまたは`docs/` | 本IssueでActions方式へ暗黙移行しない |

`web-mdbook`では`book.toml`と`src/`は中間projectです。公開対象はrenderer出力の`book/`だけです。公開前に同じ書籍・edition・formatter SHAでadapter projectを再生成し、差分がないことを確認します。そのうえでresponsive、local link、artifact visibilityを検査します。

## URL設定の有限モデル

3種類の値を混同しません。

| 値 | 例 | 所有者 | 用途 |
| --- | --- | --- | --- |
| repository URL | `https://github.com/owner/book` | `book.yaml#repository.url` | source repositoryへの導線 |
| base path / mdBook `site-url` | `/book/`または`/` | deploy profile | subpath上の404・asset URL解決 |
| canonical public URL | `https://owner.github.io/book/` | deploy profile / portfolio registry | production確認、重複公開先の正本判断 |

mdBook 0.5.4をdomain root以外で公開するときは、build時に`output.html.site-url`を設定します。project fileをdeploy用に書き換えず、公式のenvironment overrideを使用します。

```bash
MDBOOK_OUTPUT__HTML__SITE_URL=/book/ mdbook build dist/web-mdbook
```

- GitHub project Pages: 原則`/<repository>/`
- GitHub user/organization Pages (`<owner>.github.io` repository): `/`
- Cloudflare Pagesの`*.pages.dev`またはcustom domain root: `/`

`base_path`は先頭・末尾が`/`の正規化済みpathとし、`.`、`..`、backslash、query、fragmentを許可しません。URLをsubdirectoryへmountできるかはprovider側の別契約であり、base pathを書くだけでroutingが作られるとはみなしません。

現行`web-mdbook-v1`はHTMLの`<link rel="canonical">`を生成しません。ここでいう`canonical public URL`はproduction URLの管理・検証値です。HTML canonical elementが必要な場合は、adapter/theme変更を独立Issueで実装し、全pageのpath対応とpreviewの`noindex`を検証します。

## deploy profile案（未実装）

次は将来のversioned metadata拡張案です。`book.yaml` schema version 1は未定義fieldを拒否するため、**この例を現行`book.yaml`へ追加してはいけません**。採用時はschema、validator、adapter、migrationを同じ独立PRで更新します。

```yaml
deployment_profiles:
  - id: github-pages-free
    provider: github-pages
    target: web-mdbook
    edition: free
    output_directory: dist/web-mdbook/book
    base_path: /standard-book-example/
    canonical_url: https://itdojp.github.io/standard-book-example/
    production_branch: main
```

有限契約案は次のとおりです。

- `provider`: `github-pages` / `cloudflare-pages` / `static-host`
- `target`: 実装済みWeb adapterだけ
- `edition`: 同じ`book.yaml`に存在するedition ID
- `output_directory`: adapter targetとrendererから導出し、source directoryと重ならないrelative path
- `base_path`: 上記の正規化済みpath
- `canonical_url`: credential、query、fragmentを含まないHTTPS URL。pathは`base_path`と整合
- `production_branch`: symbolic `HEAD`ではなく、通常は`repository.default_branch`

secret、token、account ID、project API key、private本文pathはmetadataへ保存しません。portfolio-level `book-registry`の`channels.<provider>.url/status`はlive公開状態の観測値です。build commandやcredentialの正本ではありません。

## GitHub Pages

標準mdBookの最小例は[`examples/github-pages-mdbook.yml`](examples/github-pages-mdbook.yml)です。consumer repositoryの`.github/workflows/`へcopyします。formatter SHA、production branch、book root、editionを少なくともレビューしてから使用します。

契約は次のとおりです。

1. consumerとformatterを別directoryへcheckoutし、formatterは監査済み40桁SHAへ固定する。
2. `npm ci --ignore-scripts`、標準format、adapter、responsive、visibilityを同じrunで検証する。
3. project/user Pagesの違いから`site-url`を有限に決定する。
4. `dist/web-mdbook/book`だけをPages artifactとしてuploadする。
5. build jobは`contents: read`、deploy jobは`pages: write`と`id-token: write`を使う。
6. deploy jobは`github-pages` environmentを使い、必要なproduction保護はconsumer側で設定する。
7. 同じrefのdeployを直列化し、途中のproduction deployを無条件にcancelしない。

GitHub Pagesのcustom workflowは`configure-pages`、`upload-pages-artifact`、`deploy-pages`を使用します。repository内の例は本repositoryで監査したNode.js 24対応majorを使い、copy先でも定期的に再監査します。custom domainはworkflow内の推測で設定せず、consumerのPages設定として別管理します。

## Cloudflare Pages

Git integrationの設定例は[`examples/cloudflare-pages.md`](examples/cloudflare-pages.md)です。標準mdBookはstatic outputなのでPages Functionsを必須にしません。

- Root directory: consumer repository root
- Build command: consumerにreview済みで置いたfail-fast build script
- Build output directory: `dist/web-mdbook/book`
- Production branch: reviewed default branch（通常`main`）
- `MDBOOK_OUTPUT__HTML__SITE_URL`: `/`

Cloudflare Pagesはtop-level `404.html`がないstatic projectをSPAとして扱うため、mdBook build後に`404.html`を必ず確認します。mdBook search indexもbuild outputに含まれることを確認し、別cacheから注入しません。

Cloudflare Pagesの既定cache/ETagを初期値とし、fingerprintされていないHTMLやsearch indexへ長期`immutable` cacheを設定しません。custom `_headers`や`_redirects`は出力へ暗黙追加せず、必要なconsumerだけが別PRで管理します。preview deploymentはproduction canonical URLとして記録せず、検索indexへの露出方針をconsumerで決めます。

## その他の静的ホスティング

provider固有機能を使わない場合も次を満たします。

- deploy rootは検証済み`dist/web-mdbook/book`
- unknown file、symbolic link、hard linkをartifactへ混入させない
- base pathと404 routingを実HTTPで確認する
- `index.html`、`404.html`、search index、CSS/JS、主要chapterを確認する
- fingerprint asset以外へ過度な長期cacheを付けない
- upload完了だけで成功とせず、公開URLとbuild markerを確認する

## Jekyll legacy

既存Jekyll書籍はconsumer固有workflowとPages sourceを維持します。標準`web-mdbook`例をcopyするだけでは移行完了になりません。

| Jekyll設定 | project Pages | user/organization Pagesまたはcustom domain root |
| --- | --- | --- |
| `url` | 公開origin。pathを含めない | 公開origin。pathを含めない |
| `baseurl` | 原則`/<repository>` | 原則空文字列 |
| `repository` | source linkに使う`owner/repository`またはconsumer既存形式 | 同左 |

移行は1冊1PRで行います。旧URL、redirect、`url`、`baseurl`、canonical public URLを比較します。navigation、search、404、desktop/mobile、Pages API、公開HTTPも比較します。consumer固有themeが`site.baseurl`を使うことと、生成HTMLのasset/linkが公開subpathで解決することを確認します。

## production確認とrollback

1. workflow/run ID、source SHA、formatter SHA、edition、artifact digestを記録する。
2. provider deploymentが同じsource SHAを指すことを確認する。
3. root、404、search、主要chapter、CSS/JSをHTTPで確認する。
4. local link、navigation、mobile/desktop、visibility markerを確認する。
5. preview URLをproduction証跡へ混同しない。
6. failure時は既知の前回deploymentへproviderの通常rollbackを使い、正本historyを書き換えない。
7. rollback後も原因修正を別PRで行い、force pushや未レビューartifact再uploadをしない。

## 一次資料（2026-09-04確認）

- [GitHub Pages: custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Pages: publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [mdBook 0.5.4 renderer options](https://rust-lang.github.io/mdBook/format/configuration/renderers.html)
- [mdBook environment overrides](https://rust-lang.github.io/mdBook/format/configuration/environment-variables.html)
- [mdBook continuous integration and 404](https://rust-lang.github.io/mdBook/continuous-integration.html)
- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
- [Cloudflare Pages serving, 404, and cache](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Cloudflare Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/)
