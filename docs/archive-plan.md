# book-formatter archive / legacy移行計画

## 目的

この文書は [current-inventory.md](./current-inventory.md) の監査結果を、Issue [#102](https://github.com/itdojp/book-formatter/issues/102) などの後続PRで安全に実行するための計画へ変換する。Issue #89では移動、削除、互換adapterの実装を行わない。

## 原則

1. **現在activeなJekyll資産を先にarchiveしない。** Issue #96で `adapters/web-jekyll-legacy/` の入口、出力、同期契約を成立させてから移す。
2. **unknownは移動しない。** 正本、consumer、所有者を確定し、同一内容または互換経路を検証する。
3. **1 PR 1 categoryを基本とする。** docs、script、Jekyll adapter、component snapshotを混在させない。
4. **履歴を保持する。** 原則 `git mv` を用い、archiveのREADMEに元path、最終用途、代替、復元方法を残す。
5. **grep 0だけで削除しない。** package/workflow/importに加え、README、生成物、consumer、手動運用を調べる。
6. **直接参照を壊さない。** 必要なら旧pathに短い移行案内を1 release残す。ただし実行可能な旧scriptのshimは安全性を個別評価する。
7. **archiveは実行契約から除外する。** formatter、lint、build、package配布に含めるかを明示し、誤って実行しない配置にする。

## 目標構造案

```text
archive/
├── README.md
├── legacy-book-publishing-template-v3/
│   ├── README.md
│   ├── component-snapshots/
│   └── docs/
├── scripts-legacy/
│   ├── README.md
│   └── scripts/
└── proposals/
    ├── README.md
    └── docs/

adapters/
└── web-jekyll-legacy/          # Issue #96で設計・実装
    ├── README.md
    ├── shared/
    ├── templates/
    ├── scripts/
    └── docs/
```

category名はIssue #102の必須構造に合わせる。`archive/` は実行しない履歴保存領域、`adapters/web-jekyll-legacy/` は現行consumerを支える保守対象という違いを維持する。

## `archive/<category>/README.md` の必須項目

各category READMEは次を記録する。

```markdown
# <category>

- Archived at: <commit / date>
- Source paths: <移動前path>
- Last known owner/consumer: <package script / workflow / manual / unknown>
- Reason: <移動理由>
- Replacement: <新path、command、Issue。無い場合は none>
- Compatibility: <shim、移行猶予、非互換>
- Verification: <実行したtestとconsumer pilot>
- Restore procedure: <git mvまたはrevert手順>
- Follow-up: <Issue URL>
```

READMEなしのcategory作成、由来不明のファイル投入、archive内scriptを現行commandから直接呼ぶ構成は禁止する。

## 移動候補

| 優先 | 現path | 現分類 | 想定移動先 | 理由 | 主なリスク | 前提・後続Issue |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `scripts/build-simple.js` | archive | `archive/scripts-legacy/scripts/build-simple.js` | 現行参照0、CommonJS形式、`docs/` 全削除を伴う旧build | GitHub外の手動利用者、旧configでのみ成立する用途を見落とす可能性 | #102。移動前にrelease noteとconsumer検索、誤実行しないREADMEを追加 |
| 2 | `docs/IMPROVEMENT_PROPOSALS.md` | legacy | `archive/proposals/docs/IMPROVEMENT_PROPOSALS.md` | 2025年の提案・サンプル実装で、現在の契約や残課題を表さない | 現行READMEとPerformance Guideのリンクを壊す、設計判断の経緯を失う | #103で現行参照を代替文書へ更新し、link checkで旧path参照0を確認した後に#102。Issue/commit索引をREADMEへ残す |
| 3 | `docs/includes/page-navigation.html` | legacy | `archive/legacy-book-publishing-template-v3/component-snapshots/page-navigation.html` | #96で手動復旧元をmanaged `shared/includes/page-navigation.html` へ切替済み。内容の異なる旧snapshotはactive正本ではない | GitHub外からの未確認直接参照を壊す、由来を失う | #103で外部参照と利用文書を監査した後、#102で由来・代替・復元手順を記録して移動。監査前は保持 |
| 4 | `docs/_includes/`, `docs/assets/js/safe-main.js` | unknown | `archive/legacy-book-publishing-template-v3/component-snapshots/` | shared/starterと複製・差分があり、formatter自身のruntime入力や手動copy元とは確認できない | 外部文書からの未確認path参照 | #96で正本を固定し、hash/consumer監査後に#102。確定まで移動禁止 |
| 5 | root `TROUBLESHOOTING.md`、`docs/mobile-responsive-implementation-guide.md`、その他Jekyll中心の `docs/*.md` | legacy | `adapters/web-jekyll-legacy/docs/` | Jekyll v3 / Pagesの現行運用・実装知識であり、マルチチャネル共通文書と分離すべき | 現行consumerの唯一の手順やshared CSSの由来を失う、相対リンク切れ | #96でadapter docsを成立させ、#115/#116の変更と#103の新しい共通入口を反映してから移動。代替成立前のarchive禁止 |
| 6 | `shared/layouts/`, `shared/includes/`, `shared/assets/` | active | `adapters/web-jekyll-legacy/shared/` | 現在のJekyll同期正本だが、将来の標準formatからJekyll出力責務を分離する | 全published consumerへの広範な互換影響 | #90/#94/#96。pilot consumer、固定SHA、sync差分0を確認するまで移動禁止。`shared/schemas/book-config.schema.json` は対象外 |
| 7 | top-level/starterのJekyll `templates/` とworkflow | active | `adapters/web-jekyll-legacy/templates/` | Jekyll生成・Pages QAに特化 | scaffold、Book QA、consumer workflowのpath破壊 | #90/#94/#96。互換shimまたは新CLI経路と生成fixtureが必要 |
| 8 | consumer rollout shell scripts | active | `adapters/web-jekyll-legacy/scripts/` または `archive/scripts-legacy/` | 現在READMEで運用中だが、標準format移行後は一時用途になる可能性 | 権限、複数repository、cleanup、rollbackの運用契約を壊す | #96後に利用実績を再監査し、使用中はadapterへ、終了済みだけ#102へ |

## 移動しない資産

少なくとも次は本計画だけを根拠にarchiveしない。

- `.github/workflows/quality-check.yml`: formatter自身の品質gate
- `config/book-sync-allowlist.json`: 現行Book Syncの入力
- `resources/prh/common.yml`: 現行textlint契約
- `src/`: 現行CLI/runtime。再設計は#90/#94で行う
- `shared/schemas/book-config.schema.json`: 既存config互換の独立schemaであり、Jekyll専用と断定しない。新 `book.yaml` schemaとの関係を#90で確定する
- package scriptsから呼ばれるQA scripts
- `templates/ux/`: `UxRollout` が動的参照するため、文字列grepの参照0は未使用を意味しない
- `templates/.github/PULL_REQUEST_TEMPLATE.md`: scaffoldがdirectory単位でコピーする
- `tests/`: gate外testを含め、廃止判断は#103で行う
- `docs/diagram/`, `docs/writing/`: channel非依存のため#91で整合を確認する

## 実施順序

### Phase 0: 契約確定

1. #90で標準書籍構造とschemaを定義する。
2. #91で標準Markdown規約を定義する。
3. #94でadapter API / build CLI skeletonを作る。
4. #96でJekyll legacy adapterの入力、出力、同期、互換pathを固定する。
5. #103で共通文書入口とCIの正本を確定する。

### Phase 1: 低リスクarchive

1. `archive/README.md` とIssue #102所定のcategory READMEを先に追加する。
2. `scripts/build-simple.js` を単独PRで移動する。
3. historical docsを1 category PRで移動し、相対リンクとGitHub URLを検証する。
4. package tarball、npm scripts、workflowにarchive pathが混入しないことを確認する。

### Phase 2: Jekyll adapter移管

1. fixed-SHAのconsumer pilotで旧pathとadapter出力を比較する。
2. layouts/includes/assets、starter、workflow、運用docsを分割PRで移す。
3. 同期差分、Book QA、Pages、公開HTTPをconsumerごとに確認する。
4. 旧path shimを置く場合は撤去Issueと期限を同時に登録する。

### Phase 3: unknown解消

1. `docs/_includes` 等のsnapshotについて、Git履歴・README・consumer cloneを再監査する。
2. 正本と同一ならsnapshot categoryへ、固有機能があればadapterへ統合する。
3. owner/consumerを特定できなければ `unknown` のまま保持し、削除しない。

## PR分割案

| PR | 変更範囲 | 含めないもの |
| --- | --- | --- |
| A | Issue #102所定のarchive構造とREADME契約 | ファイル移動 |
| B | `build-simple.js` の移動 | docs、adapter、runtime変更 |
| C | historical docsの移動とリンク更新 | Jekyll shared/template移管 |
| D1 | Jekyll shared assetsのadapter移管 | workflow、consumer rollout |
| D2 | Jekyll templates/scaffoldのadapter移管 | shared assetsの意味変更 |
| D3 | Jekyll docs/ops scriptsの移管 | 新channel adapter |
| E | unknown component snapshotの解消 | 未確認ファイルの削除 |

## 各移動PRの受入条件

- source/target/consumerがPR本文に列挙されている。
- `git mv` または同等の履歴追跡可能な差分である。
- category READMEの必須項目が埋まっている。
- package script、workflow、import、doc linkの旧path参照が意図したshim以外0である。
- `npm ci --ignore-scripts`、audit、test、lint、buildがbaseline以上である。
- gate外testと既存broken linkを悪化させていない。
- Jekyll資産の移管では、代表consumerのBook QA、Pages、公開HTTPを確認している。
- archive内のscriptをworkflow/package commandが実行しない。
- unknownまたは無関係なファイルを同じPRで移動していない。
- rollback方法とfollow-up Issueが記載されている。

## rollback条件

次のいずれかが発生した場合はrolloutを停止し、該当category PRをrevertまたは旧pathへ戻す。

- 現行package commandまたはworkflowが旧path不在で失敗する。
- fixed-SHA consumerで生成差分が説明できない。
- Book QA、Pages、公開HTTPに回帰が出る。
- archiveへ移したscript/docが現在の唯一の運用入口だったことが判明する。
- shared/starter/schemaのversion対応を一意に復元できない。

## 既知のfollow-up

- #90: 標準format/schemaと正本構造
- #91: Markdown・執筆ルール
- #94: adapter / build CLI
- #96: Jekyll legacy adapter
- #97: Web deploy方式
- #102: 実際のarchive移動
- #103: CI、文書、作業手順、既存drift
- #115 / #116: shared responsive / accessibility改善

本計画は #102 の開始時に `main` とconsumer母数を再監査して更新する。Issue #89時点の参照0やhash一致を将来の削除根拠として固定しない。
