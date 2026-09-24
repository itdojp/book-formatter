# Proposals: 過去の提案と設計判断

このcategoryは過去の提案文書を履歴として参照するための入口。提案に書かれたコード、
性能値、対応状況を現在の実装契約と見なさない。共通条件は [archiveの契約](../README.md) に従う。

## 移動記録

- Archived at: 未実施。2026-09-25のPhase 1AではREADMEだけを作成。
- Source paths: 移動済みfileなし。`docs/IMPROVEMENT_PROPOSALS.md` は元pathに保持。
- Last known owner/consumer: 2025年時点の提案文書。#103で現在の入口を整理したが、
  外部の旧URL利用や引用元が存在しないことは未確認。
- Reason: 歴史的な提案と現行の運用・未完了Issueを混同しないための準備。
- Replacement: [共通作業契約](../../docs/codex-cli-workflow.md)、
  [target別契約](../../docs/output-targets.md)、live Issueの個別Runbook。
- Compatibility: 今回のpath変更なし。実移動時は相対リンクとGitHubの既存URLを確認し、
  必要な旧pathの案内とその撤去条件を別途記録する。
- Verification: 今回は文書/pack/formatter QAのみ。実移動・復元試験は未実施。
- Restore procedure: [共通復元手順](../README.md#復元手順)。元commitと内容hashを照合する。
- Follow-up: [#102](https://github.com/itdojp/book-formatter/issues/102)。

## 移動時の注意

候補先は `archive/proposals/docs/IMPROVEMENT_PROPOSALS.md`。移動の承認ではない。
現在の [履歴参照入口](../../docs/PERFORMANCE_GUIDE.md) と
[資産インベントリ](../../docs/current-inventory.md) を確認し、元文書はbyte単位で保存する。

- 原文のコードを現行実装に合わせて書き換えながら「移動だけ」とは報告しない。
- 相対リンクが移動先で壊れる場合、原文の変更と混ぜず、配置・互換案内・別PRを検討する。
- 旧pathの案内、immutable commit URL、出典としての参照を区別する。
- 提案中のコードを自動実行する検証や、未実測の性能・セキュリティ主張の再利用はしない。
- private/有料本文や権利未確認資料は、履歴保存を理由に公開しない。

ここに文書を保存しても、一般のPDF/EPUB生成や販売・再配布の承認を得たことにはならない。
