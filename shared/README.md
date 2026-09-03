# shared directory contract

`shared/`は複数の契約を保持する。directory全体がJekyll専用でも、全書籍へ自動同期されるわけでもない。

## 分類

| path | 状態 | 責務 |
| --- | --- | --- |
| `layouts/` | active legacy sync source | Jekyll layoutをconsumerの`docs/_layouts/`へ同期 |
| `includes/` | active legacy sync source | Liquid includeをconsumerの`docs/_includes/`へ同期 |
| `assets/` | active legacy sync source | Jekyll向けCSS / JavaScript等をconsumerの`docs/assets/`へ同期 |
| `version.json` | active legacy sync metadata | managed component、version、互換条件を定義 |
| `schemas/book-config.schema.json` | active legacy config schema | 既存`book-config.json`を検証。consumer `docs/`へ同期しない |
| `schema/book.schema.json` | active standard schema | 標準`book.yaml` version 1を検証 |
| `schema/book-registry.schema.json` | active registry schema | portfolio-level book registry version 1を検証 |
| `markdown/` | active standard authoring contract | 標準Markdown規則。`sync-components`対象外 |
| `mdbook/` | active `web-mdbook` asset | mdBook追加theme。Jekyll consumerへの同期対象外 |

## Jekyll component mapping

`scripts/sync-components.js`はJekyll向けのlayouts / includes / assetsに次のmappingを使用する。

| formatter source | consumer destination |
| --- | --- |
| `shared/layouts/<file>` | `docs/_layouts/<file>` |
| `shared/includes/<file>` | `docs/_includes/<file>` |
| `shared/assets/<path>` | `docs/assets/<path>` |

章本文、付録、書籍固有`index.md`、`docs/_config.yml`、workflow、標準Markdown、mdBook themeはこのJekyll mappingに含めない。別component名を明示した場合、sync scriptはsource相対pathを維持するfallbackを持つが、Issue #96のJekyll同期手順と`Book Sync` workflowはlayouts / includes / assetsだけを選択する。

同期対象の有限file集合とversionは`shared/version.json`を正本とする。directoryにfileが存在するだけではmanaged componentにならない。`templates` metadataは既定で無効であり、現在`shared/templates/`は存在しないため、Jekyll templateの配布経路として使用しない。

## ローカル同期

最初に必ずdry-runする。

```bash
npm run sync-components -- \
  --book ../consumer-book \
  --components layouts includes assets \
  --dry-run
```

差分を確認した後、同じ有限componentを同期する。

```bash
npm run sync-components -- \
  --book ../consumer-book \
  --components layouts includes assets
```

consumerの`book-config.json`にあるopt-outはCLI指定で上書きしない。実fileまたはcomponent versionに差分がある場合だけ`shared.version`と同期時刻を更新する。

## Book Sync workflow

`.github/workflows/book-sync.yml`は`workflow_dispatch`専用であり、formatterのmergeだけでは起動しない。

- 既定はdry-run。
- 最大3冊を明示する。`all`は指定できない。
- write modeは確認tokenとcross-repository tokenを要求する。
- 実行者とtokenのwrite権限、対象のOpen PR 0をpreflightする。
- allowlist外の変更や未追跡fileが残る場合は停止する。
- consumerごとにbranch / PRを作り、mainへ直接pushしない。

## `rollout-ux`との関係

`rollout-ux --apply-ux-core`は同じ`ComponentSync`を使う。`--apply-ux-profile`はlegacy UX registryの`profile` / `modules`を`book-config.json`へ反映する。portfolio-level book registry version 1とは入力互換ではない。

```bash
npm start rollout-ux \
  --registry ./legacy-ux-registry.json \
  --apply-ux-core \
  --apply-ux-profile \
  --dry-run
```

## 変更とconsumer検証

1. formatterの監査済みcommit SHAを固定する。
2. managed fileと`shared/version.json`を同じPRで整合させる。
3. 代表consumerでdry-runし、変更pathを確認する。
4. consumerごとにPRを作成する。
5. Book QA、merge後main、Pages deployment、公開HTTPと主要markerを確認する。
6. 回帰時はrolloutを停止し、旧path / versionへ戻せる証跡を保持する。

Jekyll互換の全体像は[`web-jekyll-legacy` adapter contract](../adapters/web-jekyll-legacy/README.md)、物理移動の条件は[`docs/archive-plan.md`](../docs/archive-plan.md)を参照する。
