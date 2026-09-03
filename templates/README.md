# templates directory contract

`templates/`は用途の異なる既存templateを保持する。directory全体を単一の正本、標準書籍format、または実装済みadapterとして扱わない。

## 分類

| path | 分類 | 現在のconsumer / 責務 | 取扱い |
| --- | --- | --- | --- |
| `starter/` | active legacy scaffold | `scripts/scaffold-new-book.sh`がJekyll `docs/`雛形としてcopy | 既存互換のため保持。新規標準Web書籍の既定ではない |
| `.github/workflows/` | active legacy consumer QA | scaffoldとNode.js Actions検査が参照 | consumer workflow templateとして保持。formatter自身のworkflowではない |
| `.github/PULL_REQUEST_TEMPLATE.md` | active scaffold metadata | scaffoldが`.github/`単位でcopy | Jekyll固有とは断定しないが、現在はlegacy scaffold経由で配布 |
| `ux/core/`, `ux/modules/`, `ux/profiles/` | active legacy generator / rollout input | `BookGenerator`が本文生成時に読み、`rollout-ux`がprofile / module設定を扱う | 動的参照があるため移動・archiveしない |
| `_config.yml` | legacy manual template | `docs/README-unified-setup.md`が手動開始点として参照 | `templates/starter/docs/_config.yml`や組み込みTemplateEngineと同一ではない。正本統合まで保持 |
| `_data/`, `_includes/`, `assets/` | compatibility snapshot / ownership unresolved | 現行runtimeからの直接copyを確認できない | `shared/`やstarterとの内容差があるため、正本とみなさず移動・削除しない |

## 正本境界

- 標準書籍のmetadata / directory / Markdown契約は[`docs/standard-book-format.md`](../docs/standard-book-format.md)と[`docs/markdown-rules.md`](../docs/markdown-rules.md)で定義する。
- 新規標準Web出力のthemeは`shared/mdbook/`と`web-mdbook` adapterが所有する。
- 既存Jekyll consumerへ同期するlayout / include / assetの正本は、現時点では`shared/layouts/`、`shared/includes/`、`shared/assets/`である。
- `templates/starter/docs/`はscaffold snapshotであり、`sync-components`実行後の`shared/`出力と同一であることを恒久的に保証しない。
- top-level snapshot間に差分があるため、ファイル名が同じという理由で上書きしない。

## 既存Jekyll scaffold

`scripts/scaffold-new-book.sh`は次の順で展開する。

1. `templates/starter/`を一時directoryへcopyする。
2. `templates/.github/`をcopyする。
3. `shared/layouts/`、`shared/includes/`、`shared/assets/`をJekyllの`docs/`配置へcopyする。
4. owner、repository、titleのplaceholderを置換する。

この経路は既存互換のため残すlegacy scaffoldである。新規標準Web書籍は`book.yaml`と`web-mdbook`を使用する。詳細は[出力target方針](../docs/output-targets.md)を参照する。

## 変更規則

1. template変更前にruntime、script、workflow、文書、consumerの参照を確認する。
2. Jekyll consumerへ影響する変更はformatter内だけで完了扱いにせず、代表consumerのBook QA、Pages、公開HTTPを確認する。
3. snapshot差分を解消するPRと、UX template、workflow、shared componentの変更を混在させない。
4. 物理移動は[`docs/archive-plan.md`](../docs/archive-plan.md)のcategory / pilot / rollback契約に従う。
5. unknown snapshotはownerとconsumerが確定するまで保持する。

既存Jekyll互換の詳細は[`web-jekyll-legacy` adapter contract](../adapters/web-jekyll-legacy/README.md)を参照する。
