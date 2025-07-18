# Book Formatter

設定駆動型のブック生成システム - Book Publishing Template v3.0対応

## 概要

Book Formatterは、JSON設定ファイルから書籍プロジェクトを自動生成する設定駆動型のツールです。テンプレート方式ではなく設定駆動型により、柔軟性と保守性を両立し、新しい書籍の作成と既存書籍の管理を効率化します。

## 特徴

- ⚡ **高速生成**: 新しい書籍を5分以内で作成
- 🔧 **設定駆動**: JSON/YAML設定ファイルでカスタマイズ
- 📝 **テンプレート内蔵**: Markdown、Jekyll、GitHub Pages対応
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

### 1. サンプル設定ファイルの作成

```bash
# サンプル設定ファイルを生成
npm start init

# または特定のパスに生成
npm start init --output ./my-book-config.json
```

### 2. 設定ファイルの編集

生成されたサンプル設定ファイルを編集して、書籍の情報を設定します：

```json
{
  "title": "私の技術書",
  "description": "素晴らしい技術書の説明",
  "author": "著者名",
  "version": "1.0.0",
  "language": "ja",
  "license": "MIT",
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

### 4. 新しい書籍の生成

**⚡ 実証済み効率的手順**: 7つのフェーズを通じて、新しい書籍を約4.5時間で完成させることができます。

#### 🎯 7つのフェーズ概要

1. **Phase 1: プロジェクト初期化** (30分)
   - book-formatter を使用した初期化
   - 書籍設定ファイルの作成

2. **Phase 2: GitHub リポジトリ設定** (30分)
   - GitHub リポジトリの作成
   - GitHub Pages 設定（Deploy from a branch）

3. **Phase 3: Jekyll テンプレート設定** (60分)
   - 必須ファイルの確認と設定
   - ナビゲーションテンプレートの設定

4. **Phase 4: 章ファイルの作成** (章数 × 15分)
   - 各章ファイルの構造設定
   - front matter の設定

5. **Phase 5: リンク設定の統一** (30分)
   - index.md のリンク形式統一
   - 章間リンクの設定

6. **Phase 6: 品質保証とテスト** (30分)
   - 設定ファイル検証
   - リンクチェック
   - ビルドテスト

7. **Phase 7: 公開前の最終確認** (30分)
   - 全ページの表示確認
   - コンテンツ品質確認

#### 📋 詳細な手順書

**全手順の詳細は以下の新規書籍作成手順書を参照してください：**

📚 **[新規書籍作成手順書](./docs/book-creation-guide.md)**

この手順書には、各フェーズの詳細なコマンド、設定例、よくある問題と解決策が含まれています。

#### 🚀 クイックスタート

```bash
# 基本的な使用方法
npm start create-book

# オプションを指定
npm start create-book --config ./book-config.json --output ./my-book

# 既存ディレクトリを上書き
npm start create-book --force
```

### 5. 既存書籍の更新

```bash
# 書籍の更新
npm start update-book

# 特定のパスを指定
npm start update-book --config ./book-config.json --book ./existing-book

# バックアップを作成しない
npm start update-book --no-backup
```

### 6. 複数書籍の一括同期

```bash
# すべての書籍を同期
npm start sync-all-books

# 特定のディレクトリを指定
npm start sync-all-books --directory ./books

# 実行せず予定を表示
npm start sync-all-books --dry-run
```

## CLIコマンド

| コマンド | 説明 | オプション |
|---------|------|----------|
| `init` | サンプル設定ファイルを作成 | `--output`, `--force` |
| `create-book` | 新しい書籍を作成 | `--config`, `--output`, `--force` |
| `update-book` | 既存の書籍を更新 | `--config`, `--book`, `--no-backup` |
| `validate-config` | 設定ファイルをバリデーション | `--config`, `--verbose` |
| `sync-all-books` | 複数の書籍を一括同期 | `--directory`, `--pattern`, `--dry-run` |

## 設定ファイル仕様

### 必須フィールド

- `title`: 書籍のタイトル（100文字以内）
- `description`: 書籍の説明（500文字以内）
- `author`: 著者名

### オプションフィールド

- `version`: バージョン（semantic versioning形式）
- `language`: 言語コード（デフォルト: "ja"）
- `license`: ライセンス（デフォルト: "MIT"）
- `repository`: リポジトリ情報
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

## 改善提案

Book Formatterの改善提案については[IMPROVEMENT_PROPOSALS.md](./docs/IMPROVEMENT_PROPOSALS.md)を参照してください。

## 生成されるファイル構造

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

# デバッグ情報を有効にして実行
DEBUG=book-formatter:* npm start create-book
```

## 対応形式

- **入力**: JSON、YAML設定ファイル
- **出力**: Markdown、HTML（Jekyll）、GitHub Pages
- **将来対応予定**: PDF、EPUB

## システム要件

- Node.js 18.0.0以上
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
# 詳細ログを有効にして実行
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
  - 新規書籍作成時は必ずbook-formatterを使用してください
  - 旧テンプレートからの移行については[移行ガイド](./docs/migration-guide.md)を参照してください

---

📚 Happy Book Writing!