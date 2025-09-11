---
layout: book
title: Redirect-from のサンプル（説明用ページ）
---

# redirect-from の使い方

章や付録のスラッグを変更した場合、到達先ページの front matter に `redirect_from` を指定すると、旧URLに来たユーザーを新URLに誘導できます。

## 到達先（新URL）側に書く例（推奨）
```yaml
---
layout: book
title: 新しい章タイトル
redirect_from:
  - /src/chapter-old/
---
```

## 旧URL側にスタブを置く例（Liquidを使う場合）
```markdown
---
layout: none
---
<meta http-equiv="refresh" content="0; url={{ '/src/chapter-new/' | relative_url }}">
```

## 旧URL側にスタブ（Liquidを使わない場合、絶対URL）
```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=/your-repo/src/chapter-new/">
<link rel="canonical" href="/your-repo/src/chapter-new/">
```

