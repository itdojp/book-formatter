# Book Registry version 1

## 目的

`book-registry.example.yaml` は、複数書籍の現状と移行判断を横断管理するための
portfolio-level registry例である。個別書籍の正本metadataである `book.yaml` や、
公開カタログそのものを置き換えない。

このregistryが管理する対象は次のとおりである。

- repository、default branch、repository内の書籍path
- 現行engine
- 公開・販売channelの状態
- channelへ出力するeditionの状態
- 標準formatへの移行状態

全書籍の完全な棚卸し、GitHub APIによる探索、consumer repositoryの更新は、
Issue #92の対象外である。

## 正本ファイル

| ファイル | 責務 |
| --- | --- |
| `book-registry.example.yaml` | version 1の最小pilot例 |
| `shared/schema/book-registry.schema.json` | JSON Schema Draft 7の構造契約 |
| `src/BookRegistryValidator.js` | schema外の参照整合性とURL境界 |
| `scripts/validate-book-registry.js` | ローカル・CI向けvalidator CLI |

検証はrepository rootで実行する。

```bash
npm run validate:book-registry
npm run validate:book-registry -- path/to/book-registry.yaml
```

validatorは外部networkへ接続しない。checked-in registryとschemaだけを検査する。

## version 1の構造

```yaml
schema_version: 1
checked_at: 2026-09-01
books:
  repository-name:
    title: Human-readable title
    status: active
    repository:
      url: https://github.com/owner/repository-name
      branch: main
      path: .
    engine: jekyll
    channels:
      github_pages:
        status: active
        url: https://owner.github.io/repository-name/
    editions:
      web:
        title: Web edition
        status: active
        channels:
          - github_pages
    migration:
      status: planned
      target_engine: standard
```

`books` はrepository名をkeyにしたobject mapである。arrayではなくmapを正本形に
する。registryの入力形式はYAMLに限定し、YAML parserの重複key検査とschema検証を
組み合わせて、同じrepository名やnested fieldの重複をfail-closedで拒否する。

## 状態

book、channel、edition、migrationは同じ有限statusを使う。ただし、それぞれの
statusは独立して判定する。

| status | 意味 |
| --- | --- |
| `active` | 現在利用中、または移行作業中 |
| `planned` | 実施方針はあるが未着手 |
| `legacy` | 現在の互換性維持には必要だが、標準構成ではない |
| `archived` | 新規利用を停止し、履歴として保持 |
| `unknown` | 事実またはowner判断を確認できていない |

`unknown` は移行途中の事実不足を推測で埋めないための値である。確認できた時点で、
根拠のある有限statusへ更新する。

## engine

| engine | 意味 |
| --- | --- |
| `standard` | `book.yaml` version 1を正本とする標準format |
| `mdbook` | mdBookが現行build engine |
| `jekyll` | Jekyllが現行build engine |
| `other` | 上記以外の確認済みengine |
| `unknown` | engineを確認できていない |

`standard` は特定rendererを意味しない。標準Markdownとmetadataをadapterへ渡す
source contractを表す。renderer選択は各adapterの責務である。

## channel

version 1が扱うchannel keyは次の8種類である。

| key | 対象 |
| --- | --- |
| `github_pages` | GitHub Pages |
| `cloudflare_pages` | Cloudflare Pages |
| `web` | 上記に限定しないWeb公開 |
| `zenn` | Zenn |
| `note` | note |
| `kindle` | Kindle |
| `booth` | BOOTH |
| `pdf` | PDF配布 |

各channelはstatusを必須とし、確認済みの場合だけHTTPS URLを持つ。token、secret、
credential、非公開原稿のpathはregistryへ記録しない。

channelの`url`と`status`はlive公開状態の観測値とする。build command、output
directory、base path、provider credentialを設定するdeploy profileではない。
Web公開の設定値と責務境界は[Web出力のデプロイ契約](web-deployment.md)を参照する。

## edition

editionは「どのchannelへ出力する単位か」を記録する。version 1のregistryは、
edition内の章選択、`paid` / `internal` marker、公開漏えい防止を定義しない。
これらは書籍内の[visibility model](paid-editions.md)が所有する。

editionの `channels` は、同じbook recordの `channels` で宣言済みのkeyだけを
参照できる。validatorは未宣言channelへの参照を拒否する。

## repository

`repository` は次の3項目を必須とする。

| field | 契約 |
| --- | --- |
| `url` | credentialを含まないGitHub HTTPS URL |
| `branch` | symbolic `HEAD` ではない有効なGit branch名 |
| `path` | repository rootを `.` とする安全な相対path |

`books` のkeyとURL末尾のrepository名は一致しなければならない。`path` は絶対path、
backslash、`.` / `..` の中間segmentによるaliasやtraversalを許可しない。

## migration

`migration.status` が `active` または `planned` の場合、
`target_engine` は必須である。移行実装のPR、期限、ownerをこのregistryだけで
管理することは意図していない。必要な運用情報はIssueまたはProjectで管理する。

## pilot entry

`it-engineer-knowledge-architecture` を最初のpilot例にしている。2026-09-01時点で
確認した事実は次のとおりである。

- public repository、default branchは `main`
- Pages APIは `workflow` / `built`
- `docs/` をJekyll 4.4.1でbuildするGitHub Actions workflow
- 公開URLは
  `https://itdojp.github.io/it-engineer-knowledge-architecture/`

他channelの利用方針はこのIssueで確定していないため `unknown` とする。
標準formatへの移行はEpic #88のpilot方針に基づき `planned` とする。

## 既存 `rollout-ux --registry` との関係

既存 `UxRollout` は、JSON/YAMLの `books` object mapまたはarrayを読み込む。
version 1 registryはobject mapを採用しているため、既存loaderはfileを読み取り、
directory名とrepository keyを照合できる。

一方、`--apply-ux-profile` はlegacy registry entry直下の `profile` と
`modules` を書籍の `book-config.json` へ反映する運用である。portfolio registryは
この書き込み契約を所有せず、version 1 schemaにも両fieldを含めない。

移行期間は次のように分離する。

1. portfolio/adapter判断には `book-registry.example.yaml` と同じversion 1契約を使う。
2. legacy UX profile rolloutには従来形式のregistryを別fileとして使う。
3. 将来統合する場合は、versioned projectionまたはadapterを別Issueで追加する。
4. 現行 `rollout-ux` のloader、legacy object/array形式、write動作は変更しない。

この分離により、同じ「registry」という名称を理由に未定義のUX値を書き込むことを
防ぎつつ、既存commandを破壊しない。

## 更新手順

1. 対象repositoryとchannelのlive stateを確認する。
2. 推測できない値は `unknown` にする。
3. `checked_at` を実際の確認日に更新する。
4. `npm run validate:book-registry` を実行する。
5. schema変更時はversion互換性とconsumer影響をPRに記録する。

全書籍を追加する際は小さいbatchに分け、private repositoryの非公開情報をpublic
registryへ記録しない。
