# 第2章 正本から出力する流れ

執筆者は標準ディレクトリ内の原稿と素材を更新します。検証に成功した正本だけを、後続のadapterが各公開先へ変換します。

## 最小ワークフロー

1. `book.yaml`と参照先ファイルを更新します。
2. 標準書籍validatorを実行します。
3. 出力先ごとのadapterで成果物を生成します。

このIssueでは、手順2までを実装対象とします。adapterによる変換は後続Issueで扱います。

## 標準Markdownの例

正本の書誌情報と章構成は[`book.yaml`](../book.yaml)で管理します。[^canonical]

| 入力 | 検証 | 出力 |
| --- | --- | --- |
| 正本Markdown | schemaと構造検査 | adapter生成物 |

```bash
npm run validate:standard-book -- examples/standard-book
```

原稿数を $n_{source}$、除外対象を $n_{excluded}$ とすると、出力対象数は次の関係で表せます。

$$
n_{output} = n_{source} - n_{excluded}
$$

:::note
正本と生成物は別に管理します。
:::

:::tip
小さい変更単位で検証すると、変換差分を追跡しやすくなります。
:::

:::warning
検証前の生成物を公開しません。
:::

:::paid
この範囲は有償edition候補です。公開可否はvisibility modelで決定します。
:::

:::internal
この範囲は内部向け候補です。公開成果物からの除外はvisibility検査で保証します。
:::

[^canonical]: 正本は編集対象、生成物は正本から再生成できる公開先別の成果物です。
