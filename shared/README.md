# 共通コンポーネント管理システム

このディレクトリは、すべての書籍プロジェクトで共有されるコンポーネントを管理します。

## ディレクトリ構造

```
shared/
├── layouts/          # 共通レイアウトファイル
│   ├── book.html    # 書籍ページレイアウト
│   └── default.html # デフォルトレイアウト
├── includes/         # 共通インクルードファイル
│   ├── sidebar-nav.html      # サイドバーナビゲーション
│   └── page-navigation.html  # ページナビゲーション
├── assets/           # 共通アセット
│   ├── css/         # スタイルシート
│   │   └── main.css # メインスタイル
│   └── js/          # JavaScript
│       └── sidebar.js # サイドバー制御
├── templates/        # 設定テンプレート
│   ├── _config.yml.template      # Jekyll設定
│   └── navigation.yml.template   # ナビゲーション設定
└── schemas/          # スキーマ定義
    └── book-config.schema.json   # book-config.json のスキーマ
```

## バージョン管理

共通コンポーネントは semantic versioning に従ってバージョン管理されます。

### バージョンファイル

`shared/version.json`:
```json
{
  "version": "1.0.0",
  "updated": "2025-07-10",
  "components": {
    "layouts": "1.0.0",
    "includes": "1.0.0",
    "assets": "1.0.0",
    "templates": "1.0.0"
  }
}
```

## 使用方法

### 1. 手動での同期

```bash
# 特定の書籍に共通コンポーネントを適用
npm run sync-components -- --book practical-auth-book

# すべての書籍に適用
npm run sync-components -- --all
```

### 2. 自動同期（GitHub Actions）

共通コンポーネントが更新されると、GitHub Actions により自動的にすべての書籍プロジェクトに同期されます。

### 3. 選択的な同期

`book-config.json` で同期する コンポーネントを指定できます：

```json
{
  "shared": {
    "version": "1.0.0",
    "components": {
      "layouts": true,
      "includes": true,
      "assets": {
        "css": true,
        "js": false
      },
      "templates": false
    }
  }
}
```

## 更新履歴

更新履歴は `shared/CHANGELOG.md` に記録されます。

## 貢献ガイドライン

1. 共通コンポーネントの変更は慎重に行ってください
2. 後方互換性を保つよう心がけてください
3. 大きな変更はメジャーバージョンを上げてください
4. すべての変更は CHANGELOG.md に記録してください