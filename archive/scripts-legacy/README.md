# Scripts legacy: 実行しない履歴保存

このcategoryは用途が終了したscriptの保存先を定義する。現在はREADMEのみで、実行可能な
scriptは収録していない。共通条件は [archiveの契約](../README.md) に従う。

## 移動記録

- Archived at: 未実施。2026-09-25のPhase 1AではREADMEだけを作成。
- Source paths: 移動済みfileなし。候補 `scripts/build-simple.js` は元pathに保持。
- Last known owner/consumer: GitHub外の手動利用者は未確認。内部参照0だけで終了と断定しない。
- Reason: 旧buildの履歴を残しつつ、現在の書籍生成と取り違えないための準備。
- Replacement: 開発用build smokeの正本は `npm run build` / `scripts/build.js`（CLIのhelp確認）。
  標準書籍の出力は [target別契約](../../docs/output-targets.md) を使う。
  旧scriptとこれらの出力が等価であるとは保証しない。
- Compatibility: 今回は元path、package script、workflowを変更しない。
- Verification: 今回は文書/pack/formatter QAのみ。旧scriptの実行・移動・復元試験は未実施。
- Restore procedure: [共通復元手順](../README.md#復元手順)。読み出しと静的レビューを先に行う。
- Follow-up: [#102](https://github.com/itdojp/book-formatter/issues/102)。owner/consumerが不明なら移動を保留する。

## build-simple.jsの扱い

基準main `b96712e` の候補はCommonJS形式で、出力先 `docs/` の削除処理を含む。
**調査、動作確認、復元確認のために実行しない。** 現行のES module契約や書籍生成経路と
同じものとは扱わず、まずGit履歴、呼出元、想定config、手動運用を静的に確認する。

移動する場合は `archive/scripts-legacy/scripts/build-simple.js` を候補とし、1 script categoryの
別PRで行う。内容hashと旧path互換判断を記録し、archive内を実行するshimは自動で設けない。
現役のrollout shell scriptは、このcategory名を理由に一括移動しない。

npm tarballにはこのcategoryを含めない。除外の実効性を各移動PRで再検証し、
旧コードが新たな配布・install・build入口にならないようにする。
