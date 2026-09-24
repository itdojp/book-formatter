# Legacy Book Publishing Template v3: 保管候補の判断

このcategoryは終了済みの旧文書・component snapshotを保存するための入口。
現役の `shared/` や `templates/starter/` をここへ移すことを承認するものではない。
共通の配布・公開・復元条件は [archiveの契約](../README.md) を参照する。

## 移動記録

- Archived at: 未実施。2026-09-25のPhase 1AではREADMEだけを作成。
- Source paths: 移動済みfileなし。下表は候補であり、元pathを保持する。
- Last known owner/consumer: fileごとに再監査が必要。外部の直接参照は未確認。
- Reason: 役割を終えたsnapshotと現行の正本を区別し、由来を失わないための準備。
- Replacement: 現役の入口は [Jekyll legacy adapter](../../adapters/web-jekyll-legacy/README.md)。
  個々のsnapshotと正本が同一であるとは扱わない。
- Compatibility: 現時点のpath変更なし。実移動前にconsumerと旧path利用を確認する。
- Verification: 今回は文書/pack/formatter QAのみ。consumer移管・復元試験は未実施。
- Restore procedure: [共通復元手順](../README.md#復元手順)。将来の移動PRでcommit/path/hashを記録する。
- Follow-up: [#102](https://github.com/itdojp/book-formatter/issues/102)、
  [#104](https://github.com/itdojp/book-formatter/issues/104)、
  [#115](https://github.com/itdojp/book-formatter/issues/115)、
  [#116](https://github.com/itdojp/book-formatter/issues/116)。

## 候補と保持条件

| 元path / 分類 | 今回の判断 | 移動を再検討できる条件 |
| --- | --- | --- |
| `docs/includes/page-navigation.html` / legacy | 元pathに保持 | managed復旧元は `shared/includes/page-navigation.html`。旧snapshotの由来・外部参照・互換経路を確認した後に別PR |
| `docs/_includes/`、`docs/assets/js/safe-main.js` / unknown | 移動しない | owner、固有機能、内容hashとconsumerを確認し、正本または互換経路を確定する |
| top-level `templates/_config.yml` 等 / legacy・unknown | file単位で保持 | 文書・手動copy・scaffoldを含む利用調査が完了したものだけ個別判断 |
| `shared/layouts/`、`shared/includes/`、`shared/assets/`、`templates/starter/` / active | archive対象外 | adapter移管を行う場合も別PRと固定SHAのconsumer pilotが必要 |
| 現役Jekyll運用文書・rollout script / legacy・active | 現在の入口を維持 | 代替と利用実績を確認。legacyであるだけではarchiveしない |

収録先の `component-snapshots/`、`docs/` 等は計画上の名前であり、まだ作成していない。
実移動では [移行計画](../../docs/archive-plan.md) とlive状態を再確認する。
