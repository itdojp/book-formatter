# note adapter

- 実装状態: implemented (`note-v1`)
- 入力: 検証済み標準書籍、paid edition、明示したfree/sample edition
- 出力: note編集画面へ人手で転記・設定するためのmanual handoff package
- 実装Issue: [#99](https://github.com/itdojp/book-formatter/issues/99)
- note仕様確認日: 2026-09-06

## 責務と非目標

`note-v1`はnoteへの自動投稿機能ではない。非公式API、browser automation、account、本人確認、決済設定、公開操作を扱わない。Markdownは正本との照合・転記用、HTMLは表示比較用であり、いずれもnoteの公式import形式とは表現しない。noteの公式一括import形式はWXR / MTである。

adapterは次を担当する。

1. paid editionとfree sample editionをそれぞれvisibility検査する。
2. free sampleのsource line集合と、paid editionからその集合を差し引いたpaid-only line集合を構成する。
3. calloutを有限のblockquoteへ変換し、manual reviewが必要な画像、relative link、raw HTMLを本文なしwarningとして記録する。
4. free fragmentをsample editionとして、package全体をpaid editionとして再度visibility検査する。
5. owned outputだけをstagingから置換する。

## `targets.note`

```yaml
targets:
  note:
    slug: standard-book-example
    free_sample_edition: sample
    price: 500
    hashtags:
      - Markdown
      - 技術書
    attachment_candidates:
      - assets/complete-edition.pdf
```

| field | 契約 |
| --- | --- |
| `slug` | 生成packageのlocal directory名。2〜64文字の小文字ASCII英数字と単一hyphen |
| `free_sample_edition` | paid lineより上を定義する既存の`free`または`sample` edition |
| `price` | 通常会員契約で100〜50,000円の整数。adapterはnoteへ設定しない |
| `hashtags` | 1〜10件、各30文字以下、先頭`#`なし。公式集合の保守的な部分集合だけを受理する |
| `attachment_candidates` | 任意。`source.assets`配下のPDF相対path、各50MB以下 |

build対象editionは`visibility: paid`でなければならない。free sample editionは別editionであり、その文書集合がpaid editionの文書集合に含まれなければならない。また、free sampleのreader-visible本文はpaid edition内で単一のprefixでなければならず、paid-only本文の後にfree本文が再出現する構成を拒否する。noteの有料ラインは1か所の段落境界であるため、adapterは原稿を暗黙に並べ替えない。

通常会員より高い価格上限、複数account tier、販売数量、返金設定は`note-v1`のmetadata契約に含めない。最終的なaccount契約と価格は公開者がnote画面で確認する。

## 出力

```text
<out-dir>/note/
├── manifest.json
└── <slug>/
    ├── 01-free-sample.md
    ├── 01-free-sample.html
    ├── 02-paid-body.md
    ├── 02-paid-body.html
    ├── note-publish-manifest.yaml
    ├── publish-checklist.md
    └── assets/                 # 検証済み候補がある場合だけ
```

`note-publish-manifest.yaml`は価格、hashtag、fragment、paid lineの段落境界、画像/PDF候補、redacted warningを記録する。本文や絶対pathは格納しない。`manifest.json`は共通adapter manifestである。

複数文書を1つのfragmentへ連結するときは、reference linkとnamed footnoteのlabelを文書／fragment別にnamespaceする。各fragmentで参照する可視な定義は必要に応じて複製し、free fragmentからpaid/internal定義への依存はfail closedで拒否する。表示文字列とinline/fenced codeは変更せず、HTML比較fragmentのfootnote IDも文書ID別に分離する。生成見出しとchecklistへ使う書籍・構造titleは可視な単一行に限定し、Markdown punctuationをescapeする。

namespaceの割当前に、各fragmentの全収録文書と補完する可視な定義を先行走査し、既存のshortcut/full/collapsed reference・named-footnote候補を予約する。未解決のlabelや後続文書のplain bracket textを、生成labelとの衝突によって意図せずlink/footnoteへ変換しない。予約集合はfree/paid別に保持し、候補収集はpinned `markdown-it` のinline処理を観測するだけで原稿やtokenを変更しない。code、escaped opener、HTML/autolink、inline-link destination/titleは既存parserの境界を利用して除外する。

```bash
npm start build -- \
  --book examples/standard-book \
  --target note \
  --edition paid \
  --out-dir dist
```

`--dry-run`はmetadata、両edition、source digest、変換、画像/PDF候補、既存output ownershipまで検査するがfileを書かない。

## callout、画像、link

- `note` / `tip` / `warning` calloutはblockquoteへ劣化変換し、`callout_degraded_to_blockquote`を記録する。
- local画像は`source.assets`配下のJPG/JPEG/PNG/GIF/HEIC、20MB以下だけを候補としてcopyする。Markdown内の画像syntaxは正本照合のため維持し、HTML fragmentだけをlocal候補pathへ向ける。
- 外部/root-relative画像、未対応形式はdownload/変換せずwarningにする。
- relative linkとreader-visible raw HTMLは、note編集画面での手動再設定・確認を要求するwarningにする。
- PDF候補はcopyするだけで、upload、malware scan、権利確認、販売範囲設定を行わない。

## 手動公開gate

`publish-checklist.md`に従い、少なくとも次を人間が確認する。

- title、価格、hashtag
- free fragment転記後の段落境界に有料ラインを設定
- paid fragment、画像、ALT、PDF、link、code、calloutの表示
- 公開後のfile download
- ログアウトまたはシークレットモードで購入者表示
- internal本文、credential、個人情報の非公開

## 公式仕様

2026-09-06に次のnote公式Helpを確認した。

- [有料記事を書く（有料ラインの設定）](https://www.help-note.com/hc/ja/articles/360008882894)
- [エディタ（記事編集画面）でできること](https://www.help-note.com/hc/ja/articles/360012426133)
- [Markdownショートカット](https://www.help-note.com/hc/ja/articles/4410617032217)
- [インポート機能の仕様](https://www.help-note.com/hc/ja/articles/16143759138329)
- [ファイルアップロード機能について](https://www.help-note.com/hc/ja/articles/360016349894)
- [価格の設定とお支払い方法について](https://www.help-note.com/hc/ja/articles/360011270114)
- [ハッシュタグに使用できる文字](https://www.help-note.com/hc/ja/articles/40810212577945)

外部仕様は変更され得るため、実際の公開時に現行Helpと編集画面を再確認する。

共通CLI、output ownership、same-UID境界は[Adapter開発契約](../README.md)を参照する。
