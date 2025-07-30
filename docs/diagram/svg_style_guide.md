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

## 理論的コンテンツの特殊要件

### 数学的・学術的図表の設計原則

#### 学術出版品質の実現
```css
/* 学術品質向けスタイル拡張 */
:root {
  --svg-math-bg: #FAFAFA;
  --svg-math-border: #D1D5DB;
  --svg-theorem-bg: #EFF6FF;
  --svg-proof-bg: #F0FDF4;
  --svg-definition-bg: #FFFBEB;
  --svg-example-bg: #F5F3FF;
}

[data-theme="dark"] {
  --svg-math-bg: #1F2937;
  --svg-math-border: #4B5563;
  --svg-theorem-bg: #1E3A8A;
  --svg-proof-bg: #14532D;
  --svg-definition-bg: #92400E;
  --svg-example-bg: #5B21B6;
}
```

#### 数学記号とUnicode対応
```xml
<!-- 数学記号テンプレート -->
<defs>
  <style>
    .math-symbol { font-family: 'Latin Modern Math', 'STIX Two Math', serif; }
    .complexity-class { font-weight: 600; color: var(--svg-primary); }
    .formal-notation { font-family: 'SF Mono', 'Monaco', monospace; font-size: 11px; }
    .theorem-text { font-style: italic; fill: var(--svg-text); }
    .proof-text { fill: var(--svg-text-secondary); }
  </style>
</defs>

<!-- 複雑性クラス表現例 -->
<text class="complexity-class math-symbol">P ⊆ NP ⊆ PSPACE ⊆ EXPTIME</text>

<!-- 形式記法例 -->
<text class="formal-notation">δ: Q × Γ → Q × Γ × {L,R}</text>

<!-- 集合記法例 -->
<text class="math-symbol">Σ* = {ε} ∪ Σ ∪ Σ² ∪ Σ³ ∪ ...</text>
```

### 専門分野別スタイルパターン

#### 複雑性理論図表
```css
/* 複雑性クラス階層 */
.complexity-inclusion {
  fill: var(--svg-theorem-bg);
  stroke: var(--svg-primary);
  stroke-width: 2;
  stroke-dasharray: none;
}

.complexity-class-p { fill: #10B981; fill-opacity: 0.1; }
.complexity-class-np { fill: #3B82F6; fill-opacity: 0.1; }
.complexity-class-pspace { fill: #8B5CF6; fill-opacity: 0.1; }
.complexity-class-exptime { fill: #EF4444; fill-opacity: 0.1; }

.inclusion-arrow {
  stroke: var(--svg-text);
  stroke-width: 2;
  marker-end: url(#inclusion-head);
}
```

#### 暗号プロトコル図表
```css
/* セキュリティ境界と参加者 */
.security-boundary {
  fill: none;
  stroke: var(--svg-error);
  stroke-width: 3;
  stroke-dasharray: 8,4;
}

.trusted-zone {
  fill: var(--svg-success);
  fill-opacity: 0.05;
  stroke: var(--svg-success);
  stroke-width: 1;
}

.participant-alice { fill: #3B82F6; }
.participant-bob { fill: #10B981; }
.participant-adversary { fill: var(--svg-error); }

.protocol-message {
  stroke: var(--svg-primary);
  stroke-width: 2;
  marker-end: url(#message-arrow);
}

.encryption-notation {
  font-family: 'SF Mono', monospace;
  font-size: 10px;
  fill: var(--svg-text-secondary);
}
```

#### アルゴリズム実行図表
```css
/* アルゴリズム可視化 */
.algorithm-step {
  fill: var(--svg-bg-alt);
  stroke: var(--svg-border);
  stroke-width: 1;
  rx: 4;
}

.algorithm-step.current {
  fill: var(--svg-warning);
  fill-opacity: 0.2;
  stroke: var(--svg-warning);
  stroke-width: 2;
}

.data-structure {
  fill: var(--svg-bg);
  stroke: var(--svg-primary);
  stroke-width: 1.5;
}

.variable-value {
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  fill: var(--svg-primary);
}

.complexity-annotation {
  font-size: 10px;
  font-style: italic;
  fill: var(--svg-text-secondary);
}
```

#### オートマトン理論図表
```css
/* 状態機械と遷移 */
.state {
  fill: var(--svg-bg);
  stroke: var(--svg-primary);
  stroke-width: 2;
  r: 20;
}

.state.initial {
  stroke-width: 3;
}

.state.accept {
  stroke-width: 4;
}

.state.reject {
  stroke: var(--svg-error);
  stroke-width: 2;
}

.transition {
  fill: none;
  stroke: var(--svg-text);
  stroke-width: 1.5;
  marker-end: url(#transition-arrow);
}

.transition-label {
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  text-anchor: middle;
  fill: var(--svg-text);
}

.epsilon-transition {
  stroke-dasharray: 3,3;
}
```

### 大規模プロジェクト向け管理仕様

#### ファイル命名規則（拡張版）
```
{分野}_{章}_{図番号}_{概念名}_{バリエーション}.svg

例:
complexity_ch5_01_class_inclusions.svg
crypto_ch11_03_diffie_hellman_protocol.svg
automata_ch3_05_nfa_to_dfa_conversion.svg
algorithm_ch8_02_dijkstra_execution_step3.svg
```

#### 大規模変換での品質統一
```css
/* 統一スタイルシート */
.academic-diagram {
  font-family: 'Inter', 'Helvetica Neue', system-ui, sans-serif;
  background: var(--svg-bg);
}

.academic-diagram .title {
  font-size: 16px;
  font-weight: 600;
  text-anchor: middle;
  fill: var(--svg-text);
}

.academic-diagram .subtitle {
  font-size: 14px;
  font-weight: 500;
  text-anchor: middle;
  fill: var(--svg-text-secondary);
}

.academic-diagram .description {
  font-size: 11px;
  fill: var(--svg-text-secondary);
  text-anchor: start;
}

.academic-diagram .mathematical {
  font-family: 'Latin Modern Math', 'STIX Two Math', serif;
  font-size: 12px;
}

.academic-diagram .formal {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
}
```

#### パフォーマンス最適化（34+図表規模）
```css
/* 大量図表での最適化 */
.diagram-container {
  container-type: inline-size;
  max-width: 100%;
}

/* コンテナクエリ対応 */
@container (max-width: 480px) {
  .academic-diagram .title { font-size: 14px; }
  .academic-diagram .subtitle { font-size: 12px; }
  .academic-diagram .description { font-size: 10px; }
}

@container (max-width: 320px) {
  .academic-diagram .title { font-size: 13px; }
  .academic-diagram .mathematical { font-size: 11px; }
  .academic-diagram .formal { font-size: 10px; }
}
```

### 多言語対応仕様

#### 日本語技術文書対応
```css
/* 日本語フォント最適化 */
.japanese-text {
  font-family: 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans CJK JP', sans-serif;
  font-feature-settings: "palt" 1; /* プロポーショナル調整 */
  line-height: 1.6;
}

.mixed-text {
  font-family: 'Inter', 'Hiragino Sans', 'Yu Gothic UI', system-ui, sans-serif;
  font-variant-numeric: tabular-nums; /* 数字の幅統一 */
}

/* 縦書き対応（必要に応じて） */
.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
```

#### Unicode記号の標準化
```xml
<!-- よく使用される理論計算機科学記号 -->
<defs>
  <g id="common-symbols">
    <!-- ギリシャ文字 -->
    <text class="symbol-alpha">α</text>
    <text class="symbol-beta">β</text>
    <text class="symbol-gamma">γ</text>
    <text class="symbol-delta">δ</text>
    <text class="symbol-epsilon">ε</text>
    <text class="symbol-lambda">λ</text>
    <text class="symbol-sigma">Σ</text>
    <text class="symbol-gamma-cap">Γ</text>
    
    <!-- 集合記号 -->
    <text class="symbol-element">∈</text>
    <text class="symbol-not-element">∉</text>
    <text class="symbol-subset">⊆</text>
    <text class="symbol-proper-subset">⊊</text>
    <text class="symbol-union">∪</text>
    <text class="symbol-intersection">∩</text>
    <text class="symbol-empty-set">∅</text>
    
    <!-- 論理記号 -->
    <text class="symbol-and">∧</text>
    <text class="symbol-or">∨</text>
    <text class="symbol-not">¬</text>
    <text class="symbol-implies">→</text>
    <text class="symbol-iff">↔</text>
    <text class="symbol-forall">∀</text>
    <text class="symbol-exists">∃</text>
    
    <!-- 特殊記号 -->
    <text class="symbol-infinity">∞</text>
    <text class="symbol-angle-left">⟨</text>
    <text class="symbol-angle-right">⟩</text>
    <text class="symbol-less-equal">≤</text>
    <text class="symbol-greater-equal">≥</text>
  </g>
</defs>
```

### 品質チェックリスト（学術版）

#### 学術品質チェック
- [ ] 論文・教科書レベルの視覚品質
- [ ] 数学記号の正確な表示
- [ ] 専門用語の適切な日本語化（例: "function"は「関数」、"variable"は「変数」など、[JIS Z 8301](https://www.jisc.go.jp/)に準拠）
- [ ] 理論的概念の正確な視覚化
- [ ] 学習効果の考慮（段階的理解）

#### 大規模プロジェクト対応
- [ ] 34+図表での一貫性確保
- [ ] チャプター間の統一感
- [ ] ファイル命名規則の徹底
- [ ] パフォーマンス最適化（図表の種類と複雑さに応じたファイルサイズ目標）
  - **シンプルな図表**（例: フローチャート、基本的なブロック図）: 10-20KB
  - **中程度の複雑さの図表**（例: 数学的グラフ、詳細なプロセス図）: 20-30KB
  - **複雑な図表**（例: 学術的な可視化、詳細なアーキテクチャ図）: 30-50KB
  - ファイルサイズを最適化する際は、品質（可読性、スケーラビリティ、アクセシビリティ）を損なわないよう注意。
- [ ] Git管理での効率的運用

#### 国際化対応
- [ ] Unicode記号の適切な処理
- [ ] 日本語・英語混在での可読性
- [ ] 多言語展開の考慮
- [ ] フォントフォールバック戦略

#### アクセシビリティ（学術版）
- [ ] 数学記号の音声読み上げ対応
- [ ] 色盲対応（色以外での区別）
- [ ] 高コントラスト対応
- [ ] 数式のalt textの適切な記述

### 実装サンプル（理論計算機科学）

#### 複雑性クラス包含図
```xml
<svg viewBox="0 0 800 600" class="academic-diagram">
  <defs>
    <style>
      .complexity-p { fill: #10B981; fill-opacity: 0.1; stroke: #10B981; }
      .complexity-np { fill: #3B82F6; fill-opacity: 0.1; stroke: #3B82F6; }
      .complexity-pspace { fill: #8B5CF6; fill-opacity: 0.1; stroke: #8B5CF6; }
      .inclusion-text { font-family: 'Latin Modern Math', serif; font-size: 14px; }
    </style>
  </defs>
  
  <title>計算複雑性クラスの包含関係</title>
  <desc>P, NP, PSPACE, EXPTIMEの階層構造を示す学術的図表</desc>
  
  <!-- 背景 -->
  <rect width="100%" height="100%" fill="var(--svg-bg)"/>
  
  <!-- 複雑性クラス階層 -->
  <ellipse cx="400" cy="450" rx="350" ry="120" class="complexity-pspace"/>
  <ellipse cx="400" cy="400" rx="280" ry="90" class="complexity-np"/>
  <ellipse cx="400" cy="380" rx="200" ry="60" class="complexity-p"/>
  
  <!-- ラベル -->
  <text x="400" y="380" class="inclusion-text" text-anchor="middle">P</text>
  <text x="400" y="430" class="inclusion-text" text-anchor="middle">NP</text>
  <text x="400" y="500" class="inclusion-text" text-anchor="middle">PSPACE</text>
  
  <!-- 包含記号 -->
  <text x="400" y="320" class="inclusion-text" text-anchor="middle">P ⊆ NP ⊆ PSPACE ⊆ EXPTIME</text>
</svg>
```

このセクションにより、特に理論的・学術的コンテンツでの図表品質が大幅に向上し、大規模変換プロジェクトでの成功確率が高まります。