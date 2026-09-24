# Archive: 履歴保存と復元の入口

この領域は旧資産の由来と判断を保存するためのものであり、現行の実行入口ではない。
現役のJekyll consumerを支える [legacy adapter](../adapters/web-jekyll-legacy/README.md) と区別する。
正本は [移行計画](../docs/archive-plan.md) と [Issue #102](https://github.com/itdojp/book-formatter/issues/102)。

## 現在の状態

2026-09-25（Asia/Tokyo）のPhase 1Aは、以下のREADMEと配布除外設定だけを追加する。
**旧資産の移動・削除・復元はまだ0件**であり、#102全体の完了を示さない。
判断の基準は `main@b96712eb084dfe53d1e6e37307729f2c33ec4326`。
今後の移動時にはlive main、consumer、参照元を再確認する。

| Category | 用途 | 現在の収録内容 |
| --- | --- | --- |
| [legacy-book-publishing-template-v3](legacy-book-publishing-template-v3/README.md) | 役割を終えた文書・component snapshot | READMEのみ。移動承認なし |
| [scripts-legacy](scripts-legacy/README.md) | 終了済みの旧運用script | READMEのみ。実行対象なし |
| [proposals](proposals/README.md) | 過去の提案・設計判断 | READMEのみ。文書は元pathに保持 |

## 実行・配布・公開の境界

- 現行CLI、package script、workflow、scaffold、consumer同期からarchive内の資産を呼ばない。
- 現行のlintは `src/` / `tests/`、buildは `src/index.js --help` のsmoke確認を対象とする。
  archiveを新たな入力にしない。
  今後の変更でも、移動先を実行入口にするshimは別途安全性をレビューする。
- `archive/.npmignore` はarchive全体をnpm tarballから除外する局所設定。
  rootに新たな `.npmignore` を置いて既存 `.gitignore` の配布除外を置き換えることはしない。
  READMEを含む履歴はGitHub/Gitから参照する。npmからの閲覧を前提にしない。
- 各移動PRで `npm pack --ignore-scripts` の実tarballを比較し、archive memberが0、
  意図しない既存memberの増減・内容変更が0であることを確認する。`npm publish`は行わない。
- 公開repositoryのarchiveは非公開保管庫ではない。private/有料原稿、secret、credential、
  個人情報を置かない。ライセンス・再配布権限が不明な資産は投入せず、別の判断事項とする。

## 移動前の判断と記録

移動は原則1 PR 1 category。grepの参照0だけで未使用とは判断しない。
package/workflow/importに加え、生成物、文書、Git履歴、consumer、手動運用を確認する。
ownerまたは外部利用が不明なら、unknownとして元pathに残す。

各categoryのREADMEには、移動したfileごとに次を追記する。

| 項目 | 記録内容 |
| --- | --- |
| Archived at | 移動PRのURLと記録日をmerge前に記載。未実施なら未実施とする |
| Source paths | 移動前後のpathと移動前commit、内容のSHA-256 |
| Last known owner/consumer | 最後に確認した利用者・入口、調査範囲、残るunknown |
| Reason / Replacement | 終了理由と現行の代替。代替なしは明示する |
| Compatibility | 旧path利用への影響、必要な互換案内、その撤去条件 |
| Verification | 同一内容、参照、pack、QA、必要なconsumer pilotの実測結果 |
| Restore procedure | 復元対象commit/path、衝突確認、再検証、承認条件 |
| Follow-up | 保留条件、owner、次の判断を追跡するIssue |

最終reviewed headは移動PR本文に固定する。merge後は同PRまたは追跡Issueへmerge SHA・日時を
必ず追記し、READMEからその証跡へ辿れるようにする。merge前に未知のmerge SHAを要求しない。

移動候補一覧は許可リストではない。内容変更と移動を混ぜず、`git diff --summary`、
内容hash、相対リンクを確認する。既存pathに互換案内を残す場合は、原文の保存と区別する。

## 復元手順

現在は旧資産未収録のため、実資産の復元試験は未実施。移動PRごとに以下を具体化して検証する。

1. 記録済みの移動PR・元commit・path・hashを照合し、復元目的とownerを確定する。
2. 許可されたworkspace内のcleanな専用worktreeを使う。dirty/non-mainの他担当checkoutを変更しない。
3. `git show` で記録済みcommitのfileを読み、所有する `.cache/archive-review/` 等へ取り出して
   hashを照合する。scriptを実行したり、既存fileを無確認で上書きしたりしない。
4. 現行の代替、相対リンク、依存関係、公開・権利境界をレビューする。
   復元が必要なら新しいPRで行い、対象が競合する場合は停止する。
5. 移動PR全体を戻す場合も通常のrevert PRとし、無関係な変更を巻き戻さない。
   formatter QA、pack境界、必要なconsumerの出力・Pages・HTTPを再確認してから利用を再開する。

共通のQA・review・merge手順は [作業契約](../docs/codex-cli-workflow.md) に従う。
force push、履歴改変、archive内の旧buildを実行するだけの「復元確認」は行わない。
