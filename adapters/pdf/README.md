# pdf adapter

- 実装状態: skeleton / plan-only (`publication-plan-v1`)
- 入力: 検証済み標準書籍とedition visibility plan
- 出力: `manifest.json`、`screen-pdf.placeholder.json`、`print-pdf.placeholder.json`、`publication-checklist.md`
- profile/CSS: [`shared/print/`](../../shared/print/)
- 基盤: [#100](https://github.com/itdojp/book-formatter/issues/100)、実生成/検証: [#152](https://github.com/itdojp/book-formatter/issues/152)

PDFを生成しません。`generated: false` / `ready_for_distribution: false`を固定し、rendererやartifact hashを捏造しません。screen/printを別profileとし、font、リンク、accessibility、印刷所指定の検証は未実施です。

`--out-dir dist`で`dist/pdf/`へ出力。既存のowned target出力は全置換するため手動ファイルを保管しないでください。詳細は[PDF/EPUB/Kindle基盤](../../docs/pdf-epub-kindle.md)、共通CLIは[Adapter開発契約](../README.md)を参照してください。
