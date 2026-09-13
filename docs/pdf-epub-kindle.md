# PDF / EPUB / Kindle 出力基盤

## 現在の実装範囲

#100は**設計＋plan-only skeleton**を実装する。`pdf` / `kindle`のbuildは、検証済み標準書籍とeditionからmanifest、placeholder JSON、公開前チェックリストを出力する。PDF/EPUB本文、表紙画像、組版済み奥付は生成しない。placeholderを`.pdf`や`.epub`に偽装せず、`generated: false` / `ready_for_distribution: false`を固定する。

実レンダラー、成果物visibility検査、EPUBCheck、Kindle Previewer、印刷所向け検証は[後続Issue #152](https://github.com/itdojp/book-formatter/issues/152)で行う。build成功は入稿・販売可能性の証明ではない。

## Profiles

正本は[`shared/print/profiles.json`](../shared/print/profiles.json)、plan versionは`1`。CLI targetとは別の有限profile集合である。registryは`schema_version`と`profiles`のみ、各profileは`id`/`target`/`format`/`intended_file`/`stylesheet`/`layout`/`validation`の7必須nonblank stringのみを受理する。有限IDと対応するtarget/format/filename/stylesheetを固定照合し、欠落・型違い・未知key・対応ずれを出力前に拒否する。

| profile | target | 将来の主成果物 | 用途と未完了条件 |
| --- | --- | --- | --- |
| `screen-pdf` | `pdf` | `book-screen.pdf` | A5候補、画面閲覧。リンク、検索/抽出、字体、desktop/mobileとaccessibility検証は未実施 |
| `print-pdf` | `pdf` | `book-print.pdf` | A5・対向余白の候補。印刷所のtrim/bleed/color/PDF-X/font指定が未確定 |
| `epub` | `kindle` | `book.epub` | Reflowable EPUB 3候補。EPUBCheck、目次/reading order、Kindle Previewerは未実施 |

各CSSは候補であり、レンダラーでの適用・表示検証済みではない。固定viewportをEPUBへ強制せず、読者の文字サイズ変更を妨げない。外部fontや画像をdownloadせず、fontのライセンス/埋込確認も後続gateとする。PDFのフォント/表/図版品質をEPUBへそのまま移せるとは仮定しない。

## CLI と出力

```bash
npm ci --ignore-scripts
npm start build -- --book examples/standard-book --target pdf --edition paid --out-dir dist
npm start build -- --book examples/standard-book --target kindle --edition paid --out-dir dist
npm start build -- --book examples/standard-book --target kindle --edition free --out-dir dist-free --dry-run
```

`--out-dir`は**targetの親root**。CLIが`pdf`または`kindle`を追加するため、`--out-dir dist/pdf`だと`dist/pdf/pdf`になる。省略時は`<book>/dist/`を使う。失敗を`|| true`で隠さない。

```text
dist/
  pdf/
    manifest.json
    screen-pdf.placeholder.json
    print-pdf.placeholder.json
    publication-checklist.md
  kindle/
    manifest.json
    epub.placeholder.json
    publication-checklist.md
```

profileの`intended_file`は将来のファイル名であり、上記buildでは存在しない。CSSはformatter側の`shared/print/`を参照する設計資料で、生成物へコピー/適用しない。

`manifest_version: 1`と`implementation: skeleton`を維持し、`project_format: publication-plan-v1`、profile IDs、checklist pathを追加する。既存manifest-only出力からの変更はplaceholder/checklist追加とowned-directory replacementである。`booth`等、他targetの出力は変えない。

既存の正しいtarget manifestを持つ出力directoryは**全置換対象**。そこへ手動PDFや原稿を保管しない。manifestがないdirectory、別producer、source配下、symlink経由の出力は拒否する。出力rootの兄弟ファイルは維持する。trusted user-owned serialized buildという既存[共有I/Oの限界 #138](https://github.com/itdojp/book-formatter/issues/138)を拡張したとは主張しない。

## Metadata と権利

placeholderの`colophon`には`book.yaml`のtitle、author名、publisher名、language、version、edition ID、declared licenseを転記する。copyright statement、publication date、identifier、cover sourceは未確定の`null`、rights approvalは`pending`とする。架空のISBN、著作権者、公開日、承認を補完しない。書籍metadataのlicenseと販売/頒布の権利確認は同一ではない。

表紙の選択、権利確認、実際の奥付組版・最終確認は公開者が行う。本文や添付fileはplaceholderへコピーしない。JSON文字列としてmetadataを保持し、任意titleをチェックリストのMarkdownへ挿入しない。

## Visibility と release gate

1. 共通CLIのschema/edition/source visibility検査を通す。free editionからpaid文書を指定する等の違反は出力前に拒否する。有償版もinternal除外を検査する。
2. book metadataのdigest snapshotを出力時にも検証し、既存owned staging/identity/rollback契約で生成する。planはsource検査時点の観測であり、その後の原稿変更を無効化する保証ではない。
3. placeholderには`source_visibility: passed-for-plan-snapshot`を記録する一方、`artifact_visibility`と`render_validation`は`not-run`。renderer/hashも`null`である。実PDF/EPUBがないため、成果物検査に合格したとは記録しない。
4. 後続実装では選択editionの再投影・実生成・成果物本文/metadata/assets/attachmentsの検査を行い、全gateを満たすまで公開しない。

`--dry-run`は同じmanifest/profile契約と出力先を検証するが、ファイルは作らない。現在のチェックリストはすべて未確認で出力し、実検証結果や人間の署名を自動捏造しない。

## エンジン選定（2026-09-13確認）

候補のVivliostyle CLIはHTML/MarkdownからPDFとEPUBを生成でき、公式導入条件はNode.js 22.12.0以上。rootが保持するNode20互換性と分離して導入する。[公式導入ガイド](https://docs.vivliostyle.org/en/cli/getting-started/)

npm metadataの候補`@vivliostyle/cli@11.3.3`は、browser/Puppeteer、native canvas、MuPDF、Vite等を含む。本体のunpacked size `4,751,538 bytes`は依存treeやbrowser全体の容量ではない。実install/audit/CI時間・memoryの測定はまだ行っていない。このPRでroot依存やNode20/22/24契約を変更せず、隔離Node24 toolchainの評価を#152へ分離する。

EPUBCheckはEPUB仕様への適合を検査するツールであり、実機の可読性や販売審査の代替ではない。[EPUBCheck公式](https://www.w3.org/publishing/epubcheck/)

Kindleの主出力はEPUBとする。KDPはEPUBを受け付け、Kindle Previewerでの確認を案内している。日本語PDFをKindle原稿の既定経路とは扱わない。[KDP入力形式](https://kdp.amazon.com/en_US/help/topic/G200634390)

Kindle Previewerはdesktop環境で確認する前提であり、Linux CIでのunit testだけをPreviewer完了とは記録しない。[Kindle Previewer](https://kdp.amazon.com/en_US/help/topic/G202131170)

## 検証と非目的

現在のunit/CLI検証はprofileの有限性、metadata、全fileの再生成一致、dry-run、source visibility拒否、metadata変更拒否、unowned/symlink/source出力拒否、他target互換性を対象とする。PDF/EPUB表示や入稿審査はテスト済みではない。

KDP/BOOTH自動upload、商用DTP調整、DRM/透かし、全書籍一括変換、consumer pin更新は対象外。
