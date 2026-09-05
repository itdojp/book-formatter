# Adapter開発契約

`adapters/` は、標準書籍フォーマットを出力先ごとの成果物へ変換する責務を分離するための入口です。Issue #94で共通CLIとmanifest契約を実装し、#95で`web-mdbook`、#98で`zenn`を実adapterにしました。`web-jekyll-legacy`は既存consumerの互換境界を文書化したlegacy support targetであり、build実装はskeletonのままです。その他のtargetもskeletonです。

新規書籍とlegacy consumerのtarget選択は[出力target方針](../docs/output-targets.md)を参照してください。

## Target registry

| target | 用途 | 状態 | 実装Issue |
|---|---|---|---|
| `web-mdbook` | 標準Web / mdBook | `web-mdbook-v1` | [#95](https://github.com/itdojp/book-formatter/issues/95) |
| `web-jekyll-legacy` | 既存Jekyll / GitHub Pages互換 | skeleton / legacy support contract | [#96](https://github.com/itdojp/book-formatter/issues/96) |
| `zenn` | Zenn book | `zenn-v1` | [#98](https://github.com/itdojp/book-formatter/issues/98) |
| `note` | note投稿用成果物 | skeleton | [#99](https://github.com/itdojp/book-formatter/issues/99) |
| `kindle` | EPUB / Kindle | skeleton | [#100](https://github.com/itdojp/book-formatter/issues/100) |
| `booth` | BOOTH販売パッケージ | skeleton | [#101](https://github.com/itdojp/book-formatter/issues/101) |
| `pdf` | screen / print PDF | skeleton | [#100](https://github.com/itdojp/book-formatter/issues/100) |

Target IDは有限集合です。CLI、実装、directory、testの追加を同じPRで行い、未知targetを黙って受理しないでください。

## 共通CLI

```bash
# 検証とmanifest表示だけを行う
npm start build -- \
  --book examples/standard-book \
  --target web-mdbook \
  --edition free \
  --dry-run

# <book>/dist/zenn/へZenn book projectを出力する
npm start build -- \
  --book examples/standard-book \
  --target zenn \
  --edition free

# 出力rootを変更し、<out-dir>/pdf/manifest.jsonへ出力する
npm start build -- \
  --book examples/standard-book \
  --target pdf \
  --edition paid \
  --out-dir dist
```

`book-formatter` CLIの `stdout` はversioned JSON manifestです。進捗とエラーは `stderr` に出力します。npm経由ではnpm自身のscript headerも表示されます。`--dry-run` は出力先も検証しますが、directoryやfileを作成しません。

実装済みtargetの詳細な生成物とtarget固有metadataは、それぞれのREADMEを参照してください。

- [`web-mdbook`](web-mdbook/README.md)
- [`zenn`](zenn/README.md)

## 共通処理順序

1. `book.yaml` と標準directoryをschema / semantic validationする。
2. `target` と `edition` を有限契約に照合する。
3. Edition visibility検査を実行し、findingが1件でもあれば停止する。
4. 時刻、絶対path、除外本文を含まない決定的なmanifestを組み立てる。
5. dry-runでなければtarget実装を実行する。skeletonはmanifestだけを書き、実adapterは所有manifestを伴うstaging出力でtarget directoryを置換する。

Manifestは変換判断の証跡であり、単独では公開可能性を保証しません。各実adapterは生成後の成果物をvisibility検査へ渡し、target固有の構造・link・accessibility・publication検査を追加する責任があります。`web-mdbook`の具体契約は[web-mdbook adapter](web-mdbook/README.md)を参照してください。

## 開発規約

- 標準原稿、`book.yaml`、別targetの成果物を変更しない。
- network、deploy、投稿、販売登録をadapter buildへ混在させない。
- 出力先の既存fileを所有manifestなしで一括削除しない。skeletonは `manifest.json` 以外を書かない。
- symbolic linkを経由する出力やcanonical source directory内への出力を拒否する。
- manifestのkey順、document順、改行を決定的に保つ。
- 有償・internal本文やcredentialをmanifest / log / test fixtureへ複製しない。
- target固有実装は対応Issueで追加し、`implementation: skeleton` を実装済みと誤認させない。

## Manifest version 1

Version 1は次を記録します。

- adapter targetと実装状態
- 書籍ID、title、version、language
- edition ID、title、status、visibility
- visibility contract versionとredacted summary
- editionへ含める文書のID、section、相対path、visibility、decision
- 文書内visibility blockの開始・終了行、visibility、SHA-256 digest、include/exclude decision（本文は含めない）

破壊的なfield変更は `manifest_version` を上げます。追加fieldもconsumer互換性を確認し、fixtureとREADMEを同じPRで更新してください。
