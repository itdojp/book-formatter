# kindle adapter

- 実装状態: skeleton / plan-only (`publication-plan-v1`)
- 入力: 検証済み標準書籍とedition visibility plan
- 出力: `manifest.json`、`epub.placeholder.json`、`publication-checklist.md`
- profile/CSS: [`shared/print/`](../../shared/print/)
- 基盤: [#100](https://github.com/itdojp/book-formatter/issues/100)、実生成/検証: [#152](https://github.com/itdojp/book-formatter/issues/152)

Kindle向けの主成果物はEPUBを予定していますが、このskeletonはEPUB本文を生成しません。`generated: false` / `ready_for_distribution: false`を固定し、EPUBCheck/Kindle Previewerは未実行と明示します。入稿・販売登録を行いません。

`--out-dir dist`で`dist/kindle/`へ出力。既存のowned target出力は全置換するため手動ファイルを保管しないでください。詳細は[PDF/EPUB/Kindle基盤](../../docs/pdf-epub-kindle.md)、共通CLIは[Adapter開発契約](../README.md)を参照してください。
