# 技術書SVGスタイルガイド

## 基本方針

### デザイン原則
- **可読性最優先**: 小さな画面でも判読可能
- **一貫性**: 全図表で統一されたビジュアル言語
- **スケーラビリティ**: ベクター形式の利点を活用
- **アクセシビリティ**: 色覚特性への配慮

### 技術要件
- GitHub Pages対応（Jekyll環境）
- レスポンシブ対応
- 印刷品質確保
- ソースコード管理との親和性

## カラーパレット（テーマ対応）

### CSS Variables定義
```css
:root {
  --svg-bg: #FFFFFF;
  --svg-bg-alt: #F8F9FA;
  --svg-text: #1A1A1A;
  --svg-text-secondary: #666666;
  --svg-border: #E0E0E0;
  --svg-primary: #0066CC;
  --svg-success: #059669;
  --svg-warning: #D97706;
  --svg-error: #DC2626;
  --svg-neutral: #6B7280;
}

[data-theme="dark"] {
  --svg-bg: #1A1A1A;
  --svg-bg-alt: #2D2D2D;
  --svg-text: #F5F5F5;
  --svg-text-secondary: #B3B3B3;
  --svg-border: #404040;
  --svg-primary: #3B82F6;
  --svg-success: #10B981;
  --svg-warning: #F59E0B;
  --svg-error: #EF4444;
  --svg-neutral: #9CA3AF;
}
```

### 認知負荷軽減原則
- **色数制限**: 基本5色のみ使用
- **意味固定**: 色と機能の1対1対応
- **高コントラスト**: 最低4.5:1、推奨7:1以上
- **パターン併用**: 色以外での区別手段必須

## フォント仕様

### 基本設定
```css
font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
```

### サイズ階層
```
タイトル: 16px (font-weight: 600)
ラベル: 12px (font-weight: 400)
注釈: 10px (font-weight: 400)
```

## モバイル対応仕様

### ビューポート設計
```
最小表示幅: 320px
推奨最大幅: 800px
アスペクト比: 16:9または4:3に統一
```

### タッチインターフェース
```
最小タップ領域: 44px × 44px
要素間余白: 最低8px
ホバー効果: タッチでは非表示
```

### フォントサイズ（モバイル）
```
タイトル: 14px (最小), 18px (推奨)
ラベル: 12px (最小), 14px (推奨)  
注釈: 11px (最小), 12px (推奨)
```

### 認知負荷軽減設計
```
情報階層: 3層まで
同時表示要素: 7±2個まで
線種パターン: 実線・破線・点線の3種のみ
矢印種別: 2種まで（通常・双方向）
```

## テーマ対応SVGテンプレート

### 基本構造
```xml
<svg viewBox="0 0 800 600" 
     xmlns="http://www.w3.org/2000/svg"
     style="max-width: 100%; height: auto;">
  
  <defs>
    <style>
      .bg { fill: var(--svg-bg); }
      .bg-alt { fill: var(--svg-bg-alt); }
      .text { fill: var(--svg-text); font-family: system-ui, sans-serif; }
      .text-sm { font-size: 12px; }
      .text-md { font-size: 14px; font-weight: 500; }
      .border { stroke: var(--svg-border); fill: none; stroke-width: 1; }
      .primary { fill: var(--svg-primary); }
      .primary-stroke { stroke: var(--svg-primary); stroke-width: 2; }
      .success { fill: var(--svg-success); }
      .warning { fill: var(--svg-warning); }
      .error { fill: var(--svg-error); }
      .neutral { fill: var(--svg-neutral); }
    </style>
    
    <!-- 矢印マーカー（テーマ対応） -->
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="3" 
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" class="primary"/>
    </marker>
    
    <!-- パターン定義（認知負荷軽減） -->
    <pattern id="dots" patternUnits="userSpaceOnUse" width="4" height="4">
      <circle cx="2" cy="2" r="1" class="neutral"/>
    </pattern>
    
    <pattern id="stripes" patternUnits="userSpaceOnUse" width="4" height="4">
      <path d="M0,4 L4,0" stroke="var(--svg-neutral)" stroke-width="1"/>
    </pattern>
  </defs>
  
  <!-- 背景 -->
  <rect width="100%" height="100%" class="bg"/>
  
  <!-- コンテンツ -->
</svg>
```

### シンプルなコンポーネント例
```xml
<!-- プロセスボックス -->
<g class="process-box">
  <rect x="50" y="50" width="120" height="40" rx="4" 
        class="bg-alt border"/>
  <text x="110" y="75" text-anchor="middle" class="text text-sm">
    プロセス名
  </text>
</g>

<!-- 接続線 -->
<line x1="170" y1="70" x2="230" y2="70" 
      class="primary-stroke" marker-end="url(#arrow)"/>
```

## アニメーション指針

### 基本ルール
- 装飾的アニメーションは使用しない
- 状態変化の説明に限定
- 3秒以内で完結
- 一時停止・再生可能

### 実装例
```xml
<animateTransform 
  attributeName="transform" 
  type="translate" 
  values="0,0; 100,0" 
  dur="2s" 
  repeatCount="indefinite"/>
```

## アクセシビリティ

### 必須要素
```xml
<title>図表の目的</title>
<desc>詳細な説明</desc>
```

### ARIA対応
```xml
<svg role="img" aria-labelledby="title" aria-describedby="desc">
```

### 代替手段
- テキスト形式の説明併記
- 高コントラストモード対応
- スクリーンリーダー最適化

## ファイル管理

### 命名規則
```
{章番号}_{図番号}_{図表名}.svg
例: 03_02_database_architecture.svg
```

### ディレクトリ構造
```
/assets/
  /images/
    /diagrams/
      /chapter01/
      /chapter02/
      /common/
```

### 最適化
- SVGO使用（設定ファイル提供）
- 不要なメタデータ削除
- パス最適化
- 10KB以下推奨

## 実装方法

### CSS統合
```css
/* メインCSS */
.diagram-container {
  max-width: 100%;
  margin: 1rem 0;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--svg-bg);
  border: 1px solid var(--svg-border);
}

.diagram-container svg {
  display: block;
  min-width: 320px;
  max-width: 100%;
  height: auto;
}

/* モバイル最適化 */
@media (max-width: 640px) {
  .diagram-container {
    margin: 0.5rem -1rem;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
}
```

### テーマ切り替えJavaScript
```javascript
// テーマ切り替え
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// 初期テーマ設定
const savedTheme = localStorage.getItem('theme') || 
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.setAttribute('data-theme', savedTheme);
```

### レスポンシブ埋め込み
```html
<div class="diagram-container">
  <svg><!-- SVG内容 --></svg>
  <details class="diagram-alt">
    <summary>代替テキスト表示</summary>
    <p>図表の詳細説明...</p>
  </details>
</div>
```

## 認知負荷軽減ガイドライン

### 情報設計原則
1. **単一責任**: 1図表1概念
2. **7±2ルール**: 同時表示要素は最大9個
3. **階層明確化**: 最大3レベルまで
4. **色使い最小化**: 基本4色+グレーのみ

### 視覚的単純化
```
線種: 実線（主要）、破線（補助）、点線（関連）
太さ: 1px（通常）、2px（強調）、3px（最重要）
図形: 矩形、円、菱形の3種のみ
矢印: 単方向、双方向の2種のみ
```

### テキスト最適化
```
文字数: ラベル最大12文字
行数: 1要素につき最大2行
言語: 英数混在時は半角統一
略語: 初出時定義必須
```

### レイアウト原則
```
余白: 要素の50%以上確保
整列: グリッドベース配置
グルーピング: 近接による関連性表現
強調: サイズ・色・位置の3要素まで
```

## 品質チェックリスト（更新版）

### 認知負荷チェック
- [ ] 情報要素9個以下
- [ ] 階層3レベル以下  
- [ ] 色使い5色以下
- [ ] 1画面で全体把握可能

### モバイルチェック
- [ ] 320px幅で判読可能
- [ ] フォント12px以上
- [ ] タップ領域44px以上
- [ ] 横スクロール不要

### テーマチェック
- [ ] ライトモード表示正常
- [ ] ダークモード表示正常
- [ ] コントラスト比4.5:1以上
- [ ] 色盲シミュレーション確認

### パフォーマンス
- [ ] ファイルサイズ8KB以下
- [ ] 表示速度1秒以内
- [ ] CSS Variables使用
- [ ] 不要要素除去済み

## ツール推奨

### 作成ツール
1. **Draw.io (diagrams.net)**: フローチャート・アーキテクチャ図
2. **Figma**: UIモックアップ・詳細図
3. **PlantUML**: シーケンス図・クラス図
4. **手書きSVG**: 単純な図形

### 最適化ツール
1. **SVGO**: 自動最適化
2. **SVG-Optimizer**: GUI版最適化
3. **ImageOptim**: macOS向け

### 検証ツール
1. **W3C Markup Validator**: 構文チェック
2. **WAVE**: アクセシビリティ検証
3. **Lighthouse**: パフォーマンス測定

この仕様により、技術書として適切な品質と一貫性を確保できます。