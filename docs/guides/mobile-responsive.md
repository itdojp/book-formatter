# モバイルレスポンシブ実装ガイド（標準）

- サイドバーは 1024px 未満で非表示にし、本文を1カラムにします。
- 下部ナビゲーション（章/付録）はディレクトリ形式URLを前提に canonical include を使用します。
- `templates/assets/css/mobile-responsive.css` を取り込み、`docs/assets/css/mobile-responsive.css` として運用してください。

```html
<link rel="stylesheet" href="{{ '/assets/css/mobile-responsive.css' | relative_url }}">
```

補足:
- トップページには下部ナビを表示しません（章/付録ページのみ）。
- URLは `.../index.html` ではなく末尾 `/` で統一します。
