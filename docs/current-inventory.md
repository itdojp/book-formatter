# book-formatter 現行資産インベントリ

## 目的と基準点

この文書は、Issue [#89](https://github.com/itdojp/book-formatter/issues/89) の判断基準として、現行の `book-formatter` に存在する資産、実行契約、既知の乖離を記録する。実ファイルの移動や削除は行わず、将来構成への移行候補は [archive-plan.md](./archive-plan.md) に分離する。

- 監査日: 2026-09-01
- 監査対象: `main@cff9fcf8bae31140f07b358d314fc64173cb7013`
- tracked files: 137
- submodule / symlink: 0 / 0
- 監査方法: `git ls-files`、深さ3までのファイルツリー、`package.json` scripts、workflow、import、パス文字列、Git履歴、ローカル検証

本書での分類は次の意味とする。

| 区分 | 判定基準 |
| --- | --- |
| `active` | package script、workflow、runtime import、scaffold、同期処理、または現行運用文書から利用が確認できる |
| `legacy` | 現行Jekyll運用などでは意味を持つが、Epic #88の将来標準ではlegacy adapterへの境界設定が必要 |
| `archive` | 現行実行契約から参照されず、既知の代替があるか、そのまま再利用すると高い誤用リスクがある移動候補 |
| `unknown` | 所有者、正本、現行利用者、または終了条件を証拠から確定できない。移動・削除しない |

分類は「将来も永続的に残す」という判断ではなく、上記基準点における状態である。特にJekyll資産は現在のconsumerを支えるため `active` であっても、Issue #96で `adapters/web-jekyll-legacy/` へ責務を移す候補になる。

## 数量サマリ

| 配置 | tracked files | 現在の主分類 | 概要 |
| --- | ---: | --- | --- |
| repository root | 8 | active / legacy | package、アーキテクチャ、利用・障害対応文書 |
| `.github/` | 2 | active | formatter自身の品質検証と明示選択型の書籍同期 |
| `config/` | 1 | active | Book Syncの対象allowlist |
| `docs/` | 21 | active / legacy / archive / unknown | 現行手順、Jekyll v3手順、履歴提案、コピー資産 |
| `resources/` | 1 | active | textlint/prhの共通辞書 |
| `scripts/` | 28 | active / archive | QA、同期、診断、運用rollout、旧build |
| `shared/` | 19 | active | 現在のJekyll consumerへ同期する共通部品とschema |
| `src/` | 11 | active | CLI、生成、設定検証、診断、UX rollout |
| `templates/` | 30 | active | workflow、starter、Jekyll資産、UX profile/module |
| `tests/` | 16 | active | 12ファイルは標準test gate、4ファイルはgate外 |

## 主要ディレクトリの分類

| パス | 区分 | 現在の責務と根拠 | 既知の境界・注意 |
| --- | --- | --- | --- |
| `.github/workflows/quality-check.yml` | active | Node.js 22/24のlint/test/build、template検証、audit/CodeQL、書籍生成、Markdown検証を実行 | Markdownlintは警告扱い。監査対象SHAのQuality Check run `32687766136` はsuccess |
| `.github/workflows/book-sync.yml` | active | 最大3冊を明示指定し、dry-runまたは確認token付きwriteで `shared/` を同期 | Jekyll consumer専用。将来adapterから独立させる必要がある |
| `config/` | active | `book-sync-allowlist.json` を同期要求検証で使用 | registry導入はIssue #92の責務 |
| `resources/` | active | `resources/prh/common.yml` を `check-textlint` が既定辞書として使用 | 出力先別Markdown方針はIssue #91で再整理 |
| `src/` | active | `src/index.js` から生成・検証・UX rolloutを提供し、診断系scriptも各classをimport | 組み込みTemplateEngineはJekyll構成と旧Node要件を含む。標準format/adapter分離は#90/#94 |
| `shared/` | active | `sync-components` とBook Syncが layouts/includes/assets をconsumerの `docs/` へ同期し、config schemaも保持 | layouts/includes/assetsは現在のJekyll正本。schemaはJekyll専用と断定しない。`version.json` と実ファイルの不一致あり |
| `templates/` | active | starter一式、Book QA/Nav workflow、UX core/module/profileをscaffoldまたはruntimeが利用 | top-level Jekyll templateとstarter/sharedの正本関係を#90/#96で固定する必要がある |
| `tests/` | active | formatterの生成・QA・同期安全性を検証 | 4 test filesが `npm test` 対象外。後述のbaseline failureもある |
| `docs/` | active / legacy / archive / unknown | 利用手順、執筆ガイド、図表ルール、Jekyll v3運用履歴を混在して保持 | 正本と履歴文書の識別子がなく、実装との乖離がある。個別分類は後述 |
| `scripts/` | active / archive | package scripts、consumer同期、運用監査、rolloutを保持 | `build-simple.js` のみarchive候補。shell rollout群は現行READMEに掲載されるため直ちにarchiveしない |

## root資産

| パス | 区分 | 根拠 |
| --- | --- | --- |
| `package.json`, `package-lock.json`, `eslint.config.js` | active | install、CLI、test、lint、buildの現行契約 |
| `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md` | active | 利用入口、設計説明、変更履歴 |
| `.gitignore` | active | repository hygiene |
| `TROUBLESHOOTING.md` | legacy | Book Publishing Template v3.0 / Jekyll Pagesの障害対応。現行workflow記述もあるが、将来の全channel共通手順ではない |

## `scripts/` の内訳

### active: package / workflow / runtime gate

- build・QA: `build.js`、`check-layout-risk.js`、`check-links.js`、`check-markdown-structure.js`、`check-node24-actions.js`、`check-textlint.js`、`check-unicode.js`
- 診断・可視化: `dashboard.js`、`diagnose.js`、`troubleshoot.js`
- 同期安全性: `sync-components.js`、`validate-book-sync-request.js`、`validate-book-sync-paths.js`
- consumer生成物から利用: `check-pages-status.js`、`validate-github-pages.js`
- SVG規約: `svg-font-inventory.js`、`svg-font-normalize.js`

### active: 明示実行する運用ツール

`README.md` と `docs/README-unified-setup.md` が次のscriptを現行運用ツールまたはscaffold手順として掲載しているため、参照回数だけでarchive扱いにしない。

- `add_nav_check_workflow.sh`
- `check_pages.sh`
- `cleanup_defaults_and_root_index.sh`
- `fix_review_issues.sh`
- `fix_root_links.sh`
- `rollout_codeowners.sh`
- `rollout_fix_config_yaml.sh`
- `rollout_unification.sh`
- `scaffold-new-book.sh`
- `lib.sh`（上記shell scriptの共通関数）

これらはJekyll consumerまたは一括rolloutに依存する。#96でadapter境界が成立するまで `active`、その後の要否は#102で再監査する。

### archive候補

| パス | 根拠 |
| --- | --- |
| `scripts/build-simple.js` | package/workflow/docからの参照が0。repositoryは `type: module` だがCommonJS `require()` を使用し、consumerの `docs/` を削除して再生成するため誤実行リスクが高い |

## `shared/` と `templates/` の正本関係

現在確認できる同期契約は次のとおり。

1. `shared/layouts/`、`shared/includes/`、`shared/assets/` が `sync-components.js` の入力である。
2. `scaffold-new-book.sh` は `templates/starter/` と `templates/.github/` をコピーした後、`shared/` を生成先の `docs/_layouts`、`docs/_includes`、`docs/assets` へ上書き同期する。
3. `templates/ux/` は `UxRollout` がprofile/module名から動的に参照するため、ファイル名の直接参照がなくてもactiveである。
4. `templates/.github/PULL_REQUEST_TEMPLATE.md` はscaffold時にdirectory単位でコピーされるためactiveである。

監査で確認した乖離:

- `shared/version.json` は `shared/templates/*.template` 2件を列挙するが、該当ファイル・directoryは存在しない。
- `shared/version.json` のmanaged assetsは6件だが、`shared/assets/js/` には `code-copy.js`、`main.js`、`mobile-navigation.js`、`safe-main.js`、`sidebar.js` も存在する。
- `shared/README.md` 自体は存在するが、そのtree例には実体のない `shared/templates/` が含まれ、例示versionも `1.0.0` のまま実version `3.2.3` と一致しない。
- `shared/includes/page-navigation.html` とstarter copyは同一。一方 `docs/_includes/page-navigation.html` と `docs/includes/page-navigation.html` は双方とも異なる。
- `shared/includes/sidebar-nav.html` とstarter copyは同一。一方 `docs/_includes/sidebar-nav.html` は異なる。
- `docs/assets/js/safe-main.js` とstarter copyは同一だが、`shared/assets/js/safe-main.js` は異なる。

`docs/includes/page-navigation.html` は `docs/README-unified-setup.md` が手動copy元として明示するためactiveである。ただしshared/starterとの内容差があり、正本とは断定しない。他の `docs/_includes/` と `docs/assets/js/safe-main.js` は現時点で `unknown` copyとして保持する。いずれも#96でJekyll adapterの正本と移行経路を固定してから移動を判断する。

## `tests/` と品質gate

`npm test` は次の12ファイルを明示実行する。

- `BookGenerator.test.js`
- `BookSyncSafety.test.js`
- `CheckLayoutRisk.test.js`
- `CheckLinks.test.js`
- `CheckMarkdownStructure.test.js`
- `CheckTextlint.test.js`
- `ConfigValidator.test.js`
- `GitHubPagesHandler.test.js`
- `Node24Actions.test.js`
- `SvgFontNormalize.test.js`
- `UnicodeChecker.test.js`
- `UxRollout.test.js`

次の4ファイルはtrackedだが標準gate外である。

| test | 現在の結果 | 判定 |
| --- | --- | --- |
| `DiagnosticTool.test.js` | 3回中2回でtest worker failure | unknown: 標準gateから除外した理由が記録されておらず、`Unable to deserialize cloned data` が非決定的に発生 |
| `ErrorHandler.test.js` | 単独集合ではpass | unknown: 同上 |
| `MobileOptimizer.test.js` | 1 failure | legacy drift: 生成CSSに `box-sizing: border-box` を期待する旧契約 |
| `navigation.test.js` | 単独集合ではpass | unknown: 標準gateから除外した理由が記録されていない |

Node.js `v22.22.2` / npm `10.9.7` で4ファイルをまとめて3回実行した結果は、`48 pass / 2 fail`、`51 pass / 1 fail`、`36 pass / 2 fail` だった。常に `MobileOptimizer.test.js` の旧CSS期待が失敗し、1回目と3回目は `DiagnosticTool.test.js` のtest workerも失敗した。本Issueではtest契約を変更せず、#103で非決定性の原因、gateへの復帰・廃止・legacy adapter testへの移管を判断する。

## `docs/` の分類

| パス / group | 区分 | 理由・扱い |
| --- | --- | --- |
| `diagram/`, `writing/` | active | channel非依存の作図・執筆ガイド。#91で標準Markdown規約との整合を確認 |
| `examples/redirect-from-sample.md` | legacy | Jekyll redirectの例。#96へ移管候補 |
| `README-unified-setup.md`, `TROUBLESHOOTING.md`, `book-creation-guide.md`, `book-format-unification-guide.md`, `guides/mobile-responsive.md`, `prev-next-navigation-guide.md` | legacy | Jekyll v3 / GitHub Pages / rolloutの利用手順。現行consumerには意味があるが、マルチチャネル標準の正本ではない |
| `JS-ERROR-HANDLING.md`, `PERFORMANCE_GUIDE.md` | legacy | Jekyll shared JS/layoutの運用説明。#96配下でコードとの同期が必要 |
| `includes/page-navigation.html` | active | `README-unified-setup.md` が新規書籍への手動copy元として明示。内容はshared/starterと異なるため#96で移行先と正本を固定するまで保持 |
| `_includes/`, `assets/js/safe-main.js` | unknown | shared/starterと重複・差分があり、現行consumerまたは正本を確定できない。移動禁止 |
| `IMPROVEMENT_PROPOSALS.md` | legacy | 2025年時点の提案と実装例を混在するが、現行READMEとPerformance Guideから参照される。#103で参照先と代替を更新するまで保持 |
| `mobile-responsive-implementation-guide.md` | legacy | 現行 `shared/assets/css/mobile-responsive.css` が由来を明記し、統一ガイドからも参照されるJekyll responsive実装資料。#115/#116と#96で更新・移管し、代替成立後にのみarchiveを再判断 |

## 文書・実装間の確認済み乖離

| 観測 | 影響 | 後続 |
| --- | --- | --- |
| READMEの `npm run test:coverage` が未定義 | 利用者が再現できない | #103 |
| `book-format-unification-guide.md` の `npm run check-conflicts` が未定義 | 同上 | #103 |
| `PERFORMANCE_GUIDE.md` の `serve` / `lighthouse` が未定義 | 同上 | #96 / #103 |
| mobile実装ガイドの `test:responsive` / `test:interaction` / `test:performance` が未定義 | 同上 | #96 / #103 |
| READMEの `LICENSE`、`docs/migration-guide.md`、統一ガイドの `docs/cli-usage.md` が存在しない | link checkが3件failure | #103 |
| `DiagnosticTool` が存在しない `templates/index.md`、`chapter.md`、`package.json` を必須候補として確認 | 診断結果と実配置が不一致になり得る | #90 / #103 |
| `ARCHITECTURE.md` / `shared/README.md` / `shared/version.json` と実treeが不一致 | shared componentのmanaged範囲が曖昧 | #90 / #96 / #103 |
| 新規作成ガイドはbranch Pagesを必須・Actions非推奨とする一方、root troubleshootingはworkflow Pagesを推奨 | deployment契約が二重 | #96 / #97 / #103 |

## 基準点での検証結果

| command | 結果 |
| --- | --- |
| `npm ci --ignore-scripts` | pass、444 packages、脆弱性0 |
| `npm audit --audit-level=high` | pass、脆弱性0 |
| `npm test` | pass、103 + 13 tests、failure 0 |
| `npm run lint` | pass、error 0 / warning 4 |
| `npm run build` | pass |
| `npm run check:node24-actions` | pass |
| gate外4 test filesの直接実行 | 3回ともfail。48/51/36 pass、2/1/2 fail。`MobileOptimizer` は常時、`DiagnosticTool` は非決定的にfailure |
| `node scripts/check-links.js . --output <workspace-log>` | fail、broken link 3 |
| `git diff --check` | pass（未staged差分0） |
| `git diff --cached --check` | pass（追加した2文書を検査） |

gate外testと既存broken linkは `main@cff9fcf8` のbaselineであり、本Issueの文書追加による回帰ではない。

## 再監査手順

将来のarchive実施前には、最低限次を同一commitで再実行する。

```bash
git ls-files
git status --short --branch
node -e 'const p=require("./package.json"); console.log(p.scripts)'
git grep -nE 'shared/|templates/|docs/_includes|scripts/'
node --version
npm --version
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
npm run lint
npm run build
git diff --check
git diff --cached --check
```

GitHub外の利用者が手動でpathを参照している可能性はrepository内のgrepだけでは否定できない。そのため、未参照は単独で削除理由にせず、[archive-plan.md](./archive-plan.md) の段階的な移動・互換・rollback条件を適用する。
