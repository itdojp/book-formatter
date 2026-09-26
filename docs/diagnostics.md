# 対象形式別の診断契約

`diagnose` / `troubleshoot` はローカルの事前診断です。成功は、本文の品質、
テスト・ビルド成功、公開範囲、Pages 設定、公開 HTTP の正常性を証明しません。
これらには [標準作業手順](codex-cli-workflow.md) と対象 adapter の専用 gate を使います。

## 実行と副作用

formatter checkout で実行します。パスは省略すると実行時の cwd です。

```sh
npm run diagnose -- /path/to/book
npm run diagnose -- --export /path/to/book
npm run health-check
npm run troubleshoot -- /path/to/book
```

- 診断対象は positional path 1個。オプションの前後どちらでも指定できます。
  不明なオプション・複数パスは処理前に失敗します。`--` 以後はリテラルなパスです。
- `diagnose` は通常は書込みなし。`--export` / `health-check` は対象直下の
  `diagnostic-results.json` を作成・上書きします。JSON に対象の絶対パスと形式を記録します。
- `troubleshoot` はエラー検出時、対象直下の `troubleshooting-report.md` を作成・上書きします。
  修復は明示的な `--auto` 時のみ。対象が**実行中の formatter 自身の checkout**と
  一致する場合に限定し、書籍・別 checkout・未知形式はレポート書込みより先に拒否します。
  書籍へ `npm init`、依存インストール、formatter 開発用ディレクトリ作成は行いません。
- `--auto` は既存の修復コマンドを実行し得ます。必要な差分の退避・コマンド確認後だけ使い、
  再診断で結果を検証してください。書籍の metadata 自動変換機能ではありません。
- `diagnose`: 0=エラーなし（警告可）、1=診断エラー、2=予期しない診断障害、3=CLI/出力障害。
  `troubleshoot`: 0=診断エラーなし、1=診断/CLI/実行エラー。修復後の成功は再実行で確認します。
  警告も内容を確認してください。チェックの個数から作るスコアは品質認証ではありません。

## 対象を混同しない

| 形式 | 識別子 | 検証対象 / 正本 | 要求しないもの |
| --- | --- | --- | --- |
| formatter 本体 | `package.json` の `name: book-formatter` | 開発用構造・依存・scripts、`src/TemplateEngine.js` の組込み4テンプレート、現役 `shared/layouts` / `includes` / assets、schema、`templates/starter/docs` | 廃止配置 `shared/templates/*` |
| standard book | `book.yaml` | `validateStandardBook()` による schema / 宣言されたソース・構造 | consumer 内の formatter `shared/`, `tests/`, `node_modules/`、Jekyll 出力の一律必須化 |
| legacy book | `book-config.json` | 既存 `ConfigValidator`。root または `docs/` のどちらか一方に `_config.yml` がある場合、その公開ファイルの存在 | formatter 開発用ファイル、標準書籍への自動変換 |
| 未知・競合 | 識別子なし、複数形式、壊れた `package.json` 等 | エラーで停止し、人間が対象 root と正本を確認 | 推測による成功、ファイル移動・削除・新規初期化 |

legacy の存在チェックは `_config.yml`, `index.md`, `_layouts/default.html`,
`_includes/page-navigation.html`, `assets/css/main.css` の有限集合です。
通常ファイルでないもの・symlink は拒否します。root と docs 両方に `_config.yml` がある場合は
公開先を推測せずエラーにします。別の正当な consumer 構造があり得るため、失敗を理由に
canonical source を移動しないでください。設定例や履歴の配置まで自動探索しません。

formatter の template チェックも有限な存在検査で、全ファイルの内容・レンダリング検証ではありません。
組み込みテンプレートの肯定検証は**実行中 formatter 自身の checkout**に限定します。
別 checkout を指定した場合は、資源ファイルの存在は検査しても、組み込みは未検証エラーになります。
その checkout の診断CLIを実行してください。実行元の結果を別 checkout の証明に流用せず、
対象の JavaScript を外部から動的 import して実行することもありません。
`shared/version.json` の歴史的な `templates` 記述は現役テンプレートの所在根拠に使いません。
standard book の Web / Zenn / note / print の出力検証は各 adapter に委譲します。
レポートに含むローカルパス・診断文は、公開する前に非公開情報がないか確認してください。

## Node.js の対応範囲

実行中 formatter 自身の `package.json` の `engines.node` を毎回読みます。
consumer が任意に記した engines を使って formatter の対応範囲を緩めません。
現行値は `^20.19.0 || ^22.13.0 || >=24.0.0`：20.19.0 / 22.13.0 の下限と
21 / 23 の除外を含めます。`>=24.0.0` は25以降も含む宣言であり、検証済み major の列挙ではありません。

実装はこの用途の有限な範囲評価器です。stable release の3要素、`^M.m.p`（M≥1）、
`>=M.m.p`、それらの `||` のみ対応し、全節を先に検証します。
未知の演算子、ゼロ major の caret、prerelease/build suffix、曖昧な版数は対応済みと判定しません。
将来 engines の文法を変更する場合は評価器と境界テストも更新してください。
Node.js 自体の設定・インストール・更新は行いません。

根拠: [npm package.json engines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#engines)、
[公式 node-semver の範囲仕様](https://github.com/npm/node-semver#ranges)。
一般的な SemVer パーサーの完全互換性は主張しません。

## 回帰検証

`tests/DiagnosticTool.test.js` を既存 `test:legacy` の direct-file gate で実行します。
Node 境界・未知文法、3形式、曖昧/旧 metadata、欠落/非通常ファイル、CLI オプション、
実出力先、book/unknown の自動修復拒否を検証します。
テストは合成 fixture だけを作り、実書籍・ホスト Node・公開設定を変更しません。
