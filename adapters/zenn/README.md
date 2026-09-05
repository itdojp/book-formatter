# zenn adapter

- 実装状態: implemented (`zenn-v1`)
- 入力: 検証済み標準書籍、`targets.zenn` metadata、edition visibility plan
- 出力: Zenn book projectとredacted version 1 `manifest.json`
- 実装Issue: [#98](https://github.com/itdojp/book-formatter/issues/98)

## 責務

`zenn-v1`は標準正本から、Zenn CLI / GitHub連携へ渡せる次の構造を生成します。Zennへの投稿、GitHub連携、販売設定、公開操作は行いません。

```text
<output-root>/zenn/
├── manifest.json
├── books/
│   └── <targets.zenn.slug>/
│       ├── config.yaml
│       └── <structure-id>.md
└── images/
    └── <targets.zenn.slug>/
        └── <referenced-image>
```

`--out-dir`は全target共通の**出力root**です。例えば`--out-dir dist`は`dist/zenn/`を生成します。`--out-dir dist/zenn`を指定すると`dist/zenn/zenn/`になるため、target名を重ねないでください。指定を省略した場合は`<book>/dist/zenn/`です。

## `book.yaml` metadata

schema version 1の後方互換なoptional fieldとして、次を指定します。`targets.zenn`がない書籍を標準validatorで扱うことはできますが、Zenn buildは明示的に失敗します。

```yaml
targets:
  zenn:
    slug: standard-book-example
    summary: 標準書籍フォーマットと出力手順を確認する最小例
    topics:
      - markdown
      - publishing
    price: 500
```

| field | 契約 |
| --- | --- |
| `slug` | `[0-9a-z_-]`の12〜50文字。公開URLの一部になるため安定値を使う |
| `summary` | 公開される本の説明。空文字列不可 |
| `topics` | 1〜5件。各18文字以内。ASCII空白・記号不可 |
| `price` | paid buildで必須となる200〜5000円・100円単位の整数。free/sampleだけなら省略可 |

書籍titleはZennの上限に合わせて70 UTF-16 code unit以内、出力対象のstructure IDはchapter slugとして1〜50文字でなければなりません。target固有制約はZenn build時にfail closedで検査します。

## editionと公開境界

処理順は次のとおりです。

1. 標準schema / pathを検証する。
2. edition visibility検査を通す。
3. 除外documentと`paid` / `internal` blockをsource projectionで除外する。
4. Zenn projectをstagingへ生成する。
5. 生成artifactに対してvisibility検査を再実行する。
6. 既存出力が同じ`zenn` adapter所有であることを確認し、原子的に置換する。

`internal` editionはZennへ出力しません。`config.yaml#published`は正本のedition statusにかかわらず必ず`false`です。paid editionでは`targets.zenn.price`を出力し、free/sample editionでは現行Zenn validatorが要求する`price: 0`を出力します。paid book内では、included `paid` blockを持たないfree/sample documentだけをchapter Front Matterの`free: true`にします。paid documentと、document自体はfree/sampleでもincluded `paid` blockを含むchapterは`free: false`にして有償本文を無料公開しません。

Issue #98の初期記述には「有償版の場合のみ`price`を出力」とありますが、2026-09-06に確認した現行Zenn validatorは`price`をnumber必須としています。そのためfield自体を省略せず、非0価格をpaid buildだけに限定します。

## Markdownと画像

標準calloutは有限に変換します。

| 標準構文 | Zenn出力 |
| --- | --- |
| `:::note` / `:::tip` | `:::message` |
| `:::warning` | `:::message alert` |
| included `:::paid` | visibility delimiterを除き本文だけを出力 |
| excluded `:::paid` / `:::internal` | block全体を除外 |

画像は標準Markdownの相対画像だけを受理し、宣言済み`assets/`配下の実fileを`/images/<book-slug>/...`へ書き換えます。出力URLは各path componentをpercent encodeし、記号やpercent encode済み空白を含む有効なfile名でもMarkdownのdestination境界を壊しません。途中componentを含むsymbolic link、root外参照、外部hotlink、unescaped空白またはtitleを含むdestination、3MB超、`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`以外を拒否します。fenced codeとinline code内の画像構文例は変換しません。

個別MarkdownのYAML Front Matterは`book.yaml`と二重管理になるため拒否し、adapterがZenn用Front Matterを生成します。外部linkは明示的な`https`だけを受理し、protocol-relative URLと他schemeを拒否します。相対linkは初版では変換せず、行番号付きwarningとしてmanifestへ記録します。

標準正本の先頭h1はZennのchapter Front Matterと表示titleが重複しないように除きます。正本には標準Markdown契約どおり、先頭content blockとしてATX h1がちょうど1件必要です。manifest warningの`line`はvisibility projectionと先頭h1除去後のchapter body行を示します。

初版で保証しないtarget固有変換は、本文を含まない`code` / `file` / `line`だけのwarningとしてmanifestへ記録します。現在はrelative link passthroughとraw HTML passthroughが対象です。warningは公開可能性の証明ではなく、人間がZenn CLI preview前に確認する作業項目です。全Zenn Markdown構文の変換は対象外です。

## Build

Zenn CLIをinstallしていない環境でも成果物生成と検査を実行できます。

```bash
npm start build -- \
  --book examples/standard-book \
  --target zenn \
  --edition free \
  --out-dir dist

test -f dist/zenn/books/standard-book-example/config.yaml
```

`--dry-run`は入力、visibility、target metadata、変換可能性、既存出力所有権を検査し、manifestをstdoutへ返しますがfileを作りません。生成後は人間がZenn CLI previewと公開内容を確認し、`published`の変更と公開操作を別工程で行います。

一次情報:

- [Zenn公式: CLIで本を管理する](https://zenn.dev/zenn/articles/zenn-cli-guide)
- [Zenn公式: GitHubリポジトリ連携で画像をアップロードする](https://zenn.dev/zenn/articles/deploy-github-images)
- [Zenn公式: Markdown記法一覧](https://zenn.dev/zenn/articles/markdown-guide)

機械契約は2026-09-06時点の`zenn-dev/zenn-editor` `canary@e82d3716857deecb16c4408bcf95ba4e6dd2b7a6`にあるbook / chapter validatorとも照合しています。Zenn側の契約変更時は、この確認日と参照commitを更新してadapterを再監査します。

共通CLI、所有manifest、出力先境界は[Adapter開発契約](../README.md)を参照してください。
