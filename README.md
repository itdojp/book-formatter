# Book Formatter

設定駆動型のブック生成システム - Book Publishing Template v3.0対応

## 概要

Book Formatterは、標準`book.yaml`を起点とするマルチチャネルadapterと、既存`book-config.json` / Jekyll書籍の互換保守機能を提供します。新規Web書籍は標準formatと`web-mdbook`を使用し、従来のJekyll / GitHub Pages生成・同期経路は`web-jekyll-legacy`として維持します。

出力先の選択、実装済みadapter、legacy境界は[出力target方針](docs/output-targets.md)を参照してください。

## 特徴

- ⚡ **高速生成**: 標準Web書籍の検証・出力と既存legacy書籍の保守を自動化
- 🔧 **設定駆動**: JSON/YAML設定ファイルでカスタマイズ
- 📝 **マルチチャネル基盤**: 標準Markdown / mdBookと既存Jekyll / GitHub Pages互換
- 🛡️ **バリデーション**: 設定ファイルの自動検証
- 🔄 **自動更新**: 既存書籍の構造を自動更新
- 🧪 **テスト対応**: 充実したテストスイート
- 🌐 **日本語対応**: 日本語技術書に最適化

## インストール

```bash
# リポジトリをクローン
git clone https://github.com/itdojp/book-formatter.git
cd book-formatter

# 依存関係をインストール
npm install

# 実行権限を付与（Unix系）
chmod +x src/index.js
```

## 使用方法

### 新規標準Web書籍

新規Web書籍は[`examples/standard-book`](examples/standard-book)を基準に`book.yaml`、標準Markdown、editionを定義し、`web-mdbook`へ出力します。

```bash
export BOOK_ROOT=./my-book
export BOOK_EDITION=free
export BOOK_OUTPUT_ROOT=dist
(
set -euo pipefail
npm run validate:standard-book -- "$BOOK_ROOT"
npm start build -- \
  --book "$BOOK_ROOT" \
  --target web-mdbook \
  --edition "$BOOK_EDITION" \
  --out-dir "$BOOK_OUTPUT_ROOT"
)
```

adapter project生成後は、同じ変数を維持して[`web-mdbook` adapter contract](adapters/web-mdbook/README.md#buildとレスポンシブ検証)のself-contained blockを実行します。このblockはprojectを同じsource snapshotから再生成し、公式binaryの固定URL・SHA-256検証、fresh directoryへの展開、mdBook `0.5.4` gate、決定的なsource再照合、responsive検査、生成後artifact visibility検査を1つのfail-fast実行単位で完了します。既存projectやbinaryは再利用しません。

以下の`init`、`create-book`、`update-book`、`sync-all-books`、`rollout-ux`は、既存`book-config.json` / Jekyll書籍との互換commandです。新規標準formatへ暗黙変換するcommandではありません。`update-book`、`sync-all-books`、`rollout-ux --apply-ux-profile`の非dry-runは、consumer write境界をruntimeで強制する[#130](https://github.com/itdojp/book-formatter/issues/130)完了まで利用しません。詳細は[`web-jekyll-legacy`互換契約](adapters/web-jekyll-legacy/README.md)を参照してください。

### 1. 既存legacy書籍用サンプル設定ファイルの確認

```bash
# 既存book-config.jsonの再構築に使うサンプル設定ファイルを生成
npm start init

# または特定のパスに生成
npm start init --output ./my-book-config.json
```

### 2. 既存legacy書籍用設定ファイルの編集

生成されたサンプル設定ファイルを編集して、書籍の情報を設定します：

```json
{
  "title": "私の技術書",
  "description": "素晴らしい技術書の説明",
  "author": "著者名",
  "version": "1.0.0",
  "language": "ja",
  "license": "CC BY-NC-SA 4.0",
  "repository": {
    "url": "https://github.com/username/repository.git",
    "branch": "main"
  },
  "structure": {
    "chapters": [
      {
        "id": "introduction",
        "title": "はじめに",
        "description": "この書籍について"
      },
      {
        "id": "getting-started",
        "title": "はじめ方",
        "description": "基本的な使い方"
      }
    ],
    "appendices": [
      {
        "id": "references",
        "title": "参考文献"
      }
    ]
  }
}
```

### 3. 設定ファイルのバリデーション

```bash
# 設定ファイルの検証
npm start validate-config

# 詳細な検証結果を表示
npm start validate-config --verbose

# 特定のファイルを検証
npm start validate-config --config ./path/to/config.json
```

### 4. 既存Jekyll書籍の再構築・保守（legacy）

この手順は既存Jekyll / GitHub Pages形式を生成・保守する場合のlegacy手順です。新規標準Web書籍の推奨経路ではありません。

#### 🎯 7つのフェーズ概要

1. **Phase 1: 既存consumerの状態確認** (30分)
   - 現行構成とdefault branch SHAの監査
   - 既存`book-config.json`の検証または再構築

2. **Phase 2: 既存リポジトリ状態の確認** (30分)
   - 監査済みbase SHAから隔離worktreeを作成
   - 現在のGitHub Pages方式を読み取り専用で確認

3. **Phase 3: Jekyll template差分の確認** (60分)
   - 必須fileの有無とconsumer固有変更を確認
   - navigation templateの差分を監査

4. **Phase 4: 既存章ファイルの確認** (章数 × 15分)
   - 既存章fileの構造を保持
   - front matterの差分を監査

5. **Phase 5: リンク設定の統一** (30分)
   - index.md のリンク形式統一
   - 章間リンクの設定

6. **Phase 6: 品質保証とテスト** (30分)
   - 設定ファイル検証
   - リンクチェック
   - Unicode品質チェック（不可視文字/互換漢字/異体字セレクタ等）
   - ビルドテスト

7. **Phase 7: 公開前の最終確認** (30分)
   - 全ページの表示確認
   - コンテンツ品質確認

#### 📋 詳細な手順書

**既存Jekyll書籍の再構築・保守手順は次を参照してください：**

📚 **[Legacy Jekyll Setup Guide](./docs/README-unified-setup.md)**

新規Web書籍ではこのlegacy手順や`create-book`を使用せず、前述の`book.yaml` + `web-mdbook`手順を使用します。

### 5. 既存書籍の更新

```bash
# interfaceの確認だけを行う
npm start update-book -- --help
```

`update-book`にはdry-runがなく、既存consumerへ直接書き込む。固定SHA、隔離worktree、destination symlink検査、変更allowlistをruntimeで強制する[#130](https://github.com/itdojp/book-formatter/issues/130)完了までは実行せず、必要な変更はconsumerごとのtask branchで作成・レビューする。

### 6. 複数書籍の一括同期

```bash
# 実行せず対象候補だけを表示
npm start sync-all-books -- --directory ./books --dry-run
```

`sync-all-books`の非dry-runは、検出した複数consumerへ`update-book`相当の変更を直接適用する。対象の有限化、隔離、preflight、途中失敗、consumer別reviewをruntimeで強制する#130完了までは実行しない。dry-runの表示も変更差分または適用安全性の証拠には使用しない。

### 7. UXロールアウト（既存書籍向け）

```bash
# profile差分の予定だけを確認
npm start rollout-ux -- --registry ./book-registry.json \
  --apply-ux-profile --dry-run

# 共通コアのみを適用（layouts/includes/assets）
npm start rollout-ux -- --apply-ux-core --dry-run

# 共通コアのwriteはdestination symlink検査をruntimeへ追加する#129完了まで停止
# 必要な更新はweb-jekyll-legacy contractの隔離・preflight手順で監査
```

補足:

- `--apply-ux-profile` は `--registry` が必須です
- このcommandの `book-registry.json` は `profile` / `modules` を持つ
  legacy UX registryです。portfolio-level registry version 1との関係は
  [docs/book-registry.md](docs/book-registry.md) を参照してください。
- `--apply-ux-profile`の非dry-runは、config write境界を強制する#130完了まで実行しないでください。
- `--apply-ux-core`の非dry-run、および`Book Sync` workflowのpreview / writeは、
  [#129](https://github.com/itdojp/book-formatter/issues/129)完了まで実行しないでください。

## 品質チェック（ローカル）

```bash
# リンク（内部リンク/アンカー）を検証
npm run check-links -- <book-dir>

# Unicode品質（不可視文字/互換漢字/異体字セレクタ等）を検出
npm run check-unicode -- <book-dir> --output unicode-report.json

# レイアウトリスク（長すぎる行/ワイドな表/大きい画像）をスキャン
npm run check-layout-risk -- <book-dir> --output layout-risk-report.json

# Markdown構造（Front Matter/見出しレベル/コードフェンス言語）を検証
npm run check-markdown-structure -- <book-dir> --output markdown-structure-report.json

# portfolio-level book registryのschemaと参照整合性を検証
npm run validate:book-registry

# 標準書籍のedition visibilityと任意の生成artifactを検証
npm run check-visibility -- examples/standard-book --edition free \
  --output tmp-reports/visibility/free.json

# web-mdbook adapterのbuild planを検証し、manifestを表示（書き込みなし）
npm start build -- --book examples/standard-book \
  --target web-mdbook --edition free --dry-run

# mdBook projectをdist/web-mdbookへ生成してbuild/viewportを検証
export BOOK_ROOT=examples/standard-book
export BOOK_EDITION=free
export BOOK_OUTPUT_ROOT=dist
npm start build -- --book "$BOOK_ROOT" \
  --target web-mdbook --edition "$BOOK_EDITION" --out-dir "$BOOK_OUTPUT_ROOT"

# 文章校正（textlint + PRH辞書）
npm run check-textlint -- <book-dir> --output textlint-report.json

# 技術文書プリセットも併用（任意）
npm run check-textlint -- <book-dir> --with-preset --output textlint-report.json
```

project生成後のmdBook build / viewport / artifact visibility検査は、[`web-mdbook` adapter contract](adapters/web-mdbook/README.md#buildとレスポンシブ検証)のself-contained fail-fast blockだけを正本として実行します。このblockが同じ`BOOK_ROOT`、`BOOK_EDITION`、`BOOK_OUTPUT_ROOT`からprojectを再生成・再照合するため、既存projectや別の書籍/editionをvisibility検査へ渡しません。

標準書籍metadataは[標準書籍フォーマット](docs/standard-book-format.md)、有償本文と内部本文の分離は[Edition visibilityと有償本文の混入防止](docs/paid-editions.md)、新規出力とlegacy経路の選択は[出力target方針](docs/output-targets.md)を参照してください。
出力先adapterの責務、有限target、manifest version 1は[Adapter開発契約](adapters/README.md)を参照してください。

## メンテナンススクリプト（運用者向け）

ロールアウト/点検用途の補助スクリプトを `scripts/` に配置しています。共通のエラーハンドリング（429/secondary rate limit 等のリトライ、ログ、HTTPコード取得、レポート退避）は `scripts/lib.sh` に集約しています。

実行時のレポート類は `tmp-reports/<script>/<timestamp>/` に自動退避します（`tmp-*` は `.gitignore` 対象）。

主なスクリプト:
- `scripts/check_pages.sh`: 公開GitHub Pagesのトップ/共通アセット/ナビ由来ページのHTTPステータスを点検
- `scripts/add_nav_check_workflow.sh`: `Nav + Pages Link Check` ワークフローを各書籍へ追加（ローカルclone前提）
- `scripts/rollout_unification.sh`: shared components（layouts/includes/assets）を各書籍へ同期（ローカルclone前提）
- `scripts/rollout_codeowners.sh`: `.book-formatter/**` のCODEOWNERSを各書籍へ追加（ローカルclone前提）
- `scripts/rollout_fix_config_yaml.sh`: `docs/_config.yml` の `url/baseurl/repository` を監査/正規化（監査がデフォルト）
- `scripts/fix_review_issues.sh`: PRレビュー本文/インラインコメントをJSONとして収集し退避（API 429耐性あり）
- `scripts/fix_root_links.sh`: `"/..."` のroot絶対リンクを監査/（任意で）`relative_url` へ置換
- `scripts/cleanup_defaults_and_root_index.sh`: テンプレ由来のプレースホルダや二重indexの検出（監査のみ）

リトライ関連の環境変数（例）:
- `GH_RETRY_MAX_ATTEMPTS`, `GH_RETRY_SLEEP_BASE_SEC`, `GH_RETRY_SLEEP_MAX_SEC`
- `CURL_RETRY_MAX_ATTEMPTS`
## CLIコマンド

| コマンド | 説明 | オプション |
|---------|------|----------|
| `init` | サンプル設定ファイルを作成 | `--output`, `--force` |
| `create-book` | legacy `book-config.json`からJekyll構成を生成（既存書籍の再構築用途） | `--config`, `--output`, `--force` |
| `update-book` | 既存書籍の更新interface。writeは#130完了まで停止 | `--config`, `--book`, `--no-backup` |
| `validate-config` | 設定ファイルをバリデーション | `--config`, `--verbose` |
| `sync-all-books` | 複数書籍の候補列挙。現在は`--dry-run`限定 | `--directory`, `--pattern`, `--dry-run` |
| `rollout-ux` | UX差分候補の確認。現在は`--dry-run`限定 | `--directory`, `--pattern`, `--registry`, `--apply-ux-core`, `--apply-ux-profile`, `--dry-run`, `--no-backup` |
| `build` | 標準書籍をadapter向けに検証しmanifestを生成 | `--book`, `--target`, `--edition`, `--out-dir`, `--dry-run` |

## 設定ファイル仕様

### 必須フィールド

- `title`: 書籍のタイトル（100文字以内）
- `description`: 書籍の説明（500文字以内）
- `author`: 著者名

### オプションフィールド

- `version`: バージョン（semantic versioning形式）
- `language`: 言語コード（デフォルト: "ja"）
- `license`: ライセンス（デフォルト: "CC BY-NC-SA 4.0"）
- `repository`: リポジトリ情報
- `ux`: UXプロファイル/モジュール設定
- `structure`: 書籍構造（章、付録）

### 章の設定

```json
{
  "structure": {
    "chapters": [
      {
        "id": "chapter-id",        // 英小文字、数字、ハイフンのみ
        "title": "章のタイトル",
        "description": "章の説明（オプション）",
        "objectives": ["目標1", "目標2"]  // オプション
      }
    ]
  }
}
```

### UX設定

```json
{
  "ux": {
    "profile": "A",
    "modules": {
      "quickStart": true,
      "readingGuide": true,
      "checklistPack": false,
      "troubleshootingFlow": false,
      "conceptMap": true,
      "figureIndex": false,
      "legalNotice": false,
      "glossary": true
    }
  }
}
```

## 改善提案

Book Formatterの改善提案については[IMPROVEMENT_PROPOSALS.md](./docs/IMPROVEMENT_PROPOSALS.md)を参照してください。

## legacy commandで生成されるファイル構造

次は`create-book` / `update-book`互換commandのJekyll構造であり、新規標準Web書籍の構造ではありません。

```
my-book/
├── src/                    # 書籍のソースファイル
│   ├── chapter-*/         # 各章のディレクトリ
│   │   └── index.md      # 章のメインファイル
│   └── appendices/       # 付録ディレクトリ
├── assets/               # 画像、CSS等のアセット
├── templates/           # テンプレートファイル
├── scripts/             # ビルドスクリプト
├── tests/              # テストファイル
├── index.md            # メインのインデックスファイル
├── book-config.json    # 書籍設定ファイル
├── _config.yml         # Jekyll設定ファイル
├── package.json        # Node.js設定ファイル
└── README.md           # 書籍のREADME
```

## 開発

### テストの実行

```bash
# すべてのテストを実行
npm test

# 特定のテストファイルを実行
npm test tests/BookGenerator.test.js

# カバレッジレポートを生成
npm run test:coverage
```

### コードフォーマット

```bash
# コードをフォーマット
npm run format

# リンティング
npm run lint
```

### デバッグ

```bash
# 開発モードで実行（ファイル監視）
npm run dev

# legacy create-book互換commandのデバッグ情報を有効にして実行
DEBUG=book-formatter:* npm start create-book
```

## 対応形式

- **入力**: 標準`book.yaml`とlegacy JSON / YAML設定ファイル
- **出力**: 標準Markdown / mdBook project、legacy Markdown / Jekyll HTML
- **将来対応予定**: PDF、EPUB

## システム要件

- Node.js 20.19.0以上、22.13.0以上、または24.0.0以上
- npm 8.0.0以上

## トラブルシューティング

詳細なトラブルシューティングガイドは[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)を参照してください。

### よくある問題

1. **設定ファイルのバリデーションエラー**
   ```bash
   npm start validate-config --verbose
   ```

2. **ファイル権限エラー**
   ```bash
   chmod +x src/index.js
   ```

3. **依存関係の問題**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

### ログの確認

```bash
# legacy create-book互換commandの詳細ログを有効にして実行
DEBUG=* npm start create-book
```

## 貢献

1. フォークしてください
2. フィーチャーブランチを作成してください (`git checkout -b feature/amazing-feature`)
3. 変更をコミットしてください (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュしてください (`git push origin feature/amazing-feature`)
5. プルリクエストを作成してください

## ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 作成者

ITDO Inc. (株式会社アイティードゥ)  
Email: knowledge@itdo.jp  
GitHub: [@itdojp](https://github.com/itdojp)

## 関連リンク

- [使用例とサンプル](https://github.com/itdojp/book-formatter/tree/main/examples)

### 廃止されたシステム

**⚠️ 重要な注意事項**

- **Book Publishing Template v3.0** - **使用禁止**
  - このシステムの基盤となった旧テンプレートシステム
  - 現在は廃止されており、使用は禁止されています
  - 新規Web書籍は標準`book.yaml`と`web-mdbook`を使用してください
  - 旧テンプレートからの移行については[移行ガイド](./docs/migration-guide.md)を参照してください

---

📚 Happy Book Writing!
