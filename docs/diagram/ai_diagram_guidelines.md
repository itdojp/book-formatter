# 生成AI向け作図ガイドライン

## プロンプト構成原則

### 基本構造
```
1. 図表種別の明確化
2. 技術仕様の指定
3. 美的要求の定義
4. 制約条件の設定
5. 出力形式の指定
```

### 必須前置詞
```
"Create a clean, professional SVG diagram that follows modern technical documentation standards."
```

## 美的品質指示

### デザイン原則
```
- Minimalist design with generous white space
- Consistent geometric proportions using golden ratio (1.618)
- Professional typography with clear hierarchy
- Subtle shadows and depth without skeuomorphism
- Balanced composition following rule of thirds
```

### 視覚的洗練度
```
- Use rounded corners (4px radius) for modern appearance
- Implement subtle gradients for depth (10-15% opacity difference)
- Apply consistent stroke weights (1px, 2px, 3px hierarchy)
- Maintain optical balance over mathematical centering
- Ensure visual breathing room between elements
```

## 色彩指示テンプレート

### 基本指示
```
Use this exact color palette:
- Primary: #3B82F6 (blue)
- Success: #10B981 (green) 
- Warning: #F59E0B (amber)
- Error: #EF4444 (red)
- Neutral: #6B7280 (gray)
- Background: CSS var(--svg-bg)
- Text: CSS var(--svg-text)
- Borders: CSS var(--svg-border)

Apply colors semantically, not decoratively.
```

### グラデーション指示
```
For depth, use subtle gradients:
- Start: base color at 100% opacity
- End: base color at 85% opacity
- Direction: top-to-bottom or left-to-right only
```

## レイアウト指示

## レイアウト問題防止策

### 要素重複防止
```
Strict layout requirements:
- Calculate exact coordinates for each element
- Maintain minimum 16px clearance between all elements
- Use bounding box calculations: element_width + 32px spacing
- No overlapping elements allowed - verify collision detection
- Elements must be fully contained within viewBox boundaries
```

### 文字はみ出し防止
```
Text containment rules:
- Text elements must fit within parent container with 8px padding
- Use text-anchor="middle" for centered alignment
- Calculate text width: character_count × 7px (approximation)
- For containers: width ≥ text_width + 16px
- Break long text into multiple lines if width > 100px
- Maximum text length per line: 12 characters
```

### 座標計算指示
```
Use explicit coordinate calculation:
- Define grid: 800x600 viewBox with 40px margins
- Working area: 720x520 pixels
- Element positions: x = margin + (index × (width + spacing))
- Vertical spacing: y = margin + (row × (height + spacing))
- Always specify x, y, width, height for all elements
```

## 厳密配置テンプレート

### 水平配置（3要素例）
```
For 3 elements in 720px width:
- Element width: 200px
- Spacing: 60px  
- Positions: x = 40, 300, 560
- Calculation: (720 - 3×200) ÷ 2 = 60px spacing
- Verify: 200 + 60 + 200 + 60 + 200 = 720px ✓
```

### 垂直配置（4要素例）
```
For 4 elements in 520px height:
- Element height: 80px
- Spacing: 40px
- Positions: y = 40, 160, 280, 400
- Calculation: (520 - 4×80) ÷ 3 = 40px spacing
- Verify: 80×4 + 40×3 = 440px < 520px ✓
```

### テキスト配置計算
```
For text in rectangular container:
- Container: width=120px, height=60px
- Text position: x=60 (center), y=35 (vertical center + font-size/2)
- Max characters: (120-16) ÷ 7 = 14 characters
- Text anchor: middle
- Dominant baseline: central
```

## タイポグラフィ指示

### フォント指定
```
Use system fonts only:
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif

Size hierarchy:
- H1 (titles): 16px, font-weight: 600
- H2 (labels): 14px, font-weight: 500  
- H3 (details): 12px, font-weight: 400
- Caption: 10px, font-weight: 400
```

### テキスト配置
```
- Use sentence case, not ALL CAPS
- Align text to 8px baseline grid
- Maintain 1.4 line height
- Limit text to 40 characters per line
- Use left alignment for readability
```

## 図表種別テンプレート

### アーキテクチャ図
```
Create a system architecture diagram with:
- Rectangular components with 4px rounded corners
- Hierarchical layout showing data flow
- Consistent component sizing (120x60px base unit)
- Clear connection lines with appropriate arrows
- Layered grouping with subtle background colors
- Professional spacing following 8px grid
```

### フローチャート
```
Generate a flowchart using:
- Start/End: rounded rectangles (rx="20")
- Process: rectangles with 4px radius
- Decision: rhombus shapes
- Connector: circles (r="4")
- 2px stroke weight for all shapes
- Directional arrows with consistent styling
```

### シーケンス図
```
Design a sequence diagram featuring:
- Vertical lifelines with 3px dashed strokes
- Activation boxes as subtle rectangles
- Message arrows with clear labels
- Chronological top-to-bottom flow
- Consistent actor spacing (150px intervals)
```

### データフロー図
```
Create a data flow diagram including:
- Circular data stores
- Rectangular processes
- External entities as squares
- Curved flow lines avoiding 90-degree angles
- Descriptive labels on all flows
```

## 品質強化指示

### 詳細度レベル
```
Level 1 (Concept): Basic shapes, minimal detail
Level 2 (Design): Refined shapes, proper spacing
Level 3 (Production): Full styling, shadows, gradients

Default to Level 2 unless specified.
```

### 洗練度チェック
```
Ensure the diagram meets these criteria:
- Would this appear professional in a technical presentation?
- Are visual relationships immediately clear?
- Does the design feel modern and uncluttered?
- Is the information hierarchy obvious?
- Would this reproduce well at different sizes?
```

## プロンプト例

### 基本テンプレート
```
Create a clean, professional SVG diagram of [DIAGRAM_TYPE] showing [CONTENT_DESCRIPTION].

Requirements:
- Use minimalist design with generous white space
- Apply the specified color palette semantically
- Follow 8px grid system for spacing
- Use rounded corners (4px) for modern appearance
- Implement clear visual hierarchy
- Ensure mobile compatibility (320px minimum width)
- Include CSS variables for theme switching
- Maintain professional typography standards

Style: Modern, clean, suitable for technical documentation
Output: Complete SVG with embedded CSS classes
Viewport: 800x600 or appropriate aspect ratio
```

## 問題回避プロンプト例

### 改良前（問題発生しやすい）
```
❌ "Create a diagram with boxes and arrows showing the system flow"
```

### 改良後（問題回避）
```
✅ "Create an SVG diagram (viewBox="0 0 800 600") with exactly 3 rectangular boxes:

Box 1: x=50, y=100, width=180, height=80, containing text 'Frontend'
Box 2: x=310, y=100, width=180, height=80, containing text 'Backend'  
Box 3: x=570, y=100, width=180, height=80, containing text 'Database'

Connect with arrows:
Arrow 1: from (230,140) to (310,140)
Arrow 2: from (490,140) to (570,140)

Text positioning:
- All text centered in boxes: text-anchor='middle'
- Vertical center: y = box_y + 50
- Font size: 14px

Verify no overlapping elements and all content within margins."
```

### システム図の厳密指示例
```
Create a microservices architecture SVG (viewBox="0 0 800 600"):

Layout calculation:
- Work area: 720x520 (40px margins)
- 5 components in 2 rows
- Row 1: 3 services (200x80 each, 60px spacing)
- Row 2: 2 databases (150x60 each, centered)

Exact positions:
Service A: x=40, y=80, width=200, height=80
Service B: x=300, y=80, width=200, height=80  
Service C: x=560, y=80, width=200, height=80
DB1: x=175, y=300, width=150, height=60
DB2: x=475, y=300, width=150, height=60

Text positions (center of each box):
Service A text: x=140, y=130
Service B text: x=400, y=130
Service C text: x=660, y=130
DB1 text: x=250, y=340
DB2 text: x=550, y=340

Connections:
- Service A to DB1: path from (140,160) to (250,300)
- Service B to DB1: path from (400,160) to (250,300)
- Service C to DB2: path from (660,160) to (550,300)

Verification checklist:
□ All elements within 40px margins
□ No overlapping boxes or text
□ Text fits within containers
□ Arrows don't cross elements
□ Total width ≤ 720px, height ≤ 520px
```

## 検証指示の強化

### 必須検証項目
```
Before outputting SVG, verify:
1. Bounding box check: all elements x+width ≤ viewBox width
2. Collision detection: no element overlaps another  
3. Text containment: all text within parent boundaries
4. Margin compliance: 40px clearance from edges
5. Spacing consistency: minimum 16px between elements
6. Text readability: font-size ≥ 12px, contrast ≥ 4.5:1
```

### デバッグ指示
```
Include calculation comments in SVG:
<!-- Element positions calculated:
     Box1: 50px + 180px + 20px spacing = 250px
     Box2: 250px + 180px + 20px spacing = 450px  
     Total width: 450px + 180px = 630px < 720px ✓ -->
```

### エラー回避チェックリスト
```
Common issues to prevent:
□ Text longer than container width
□ Elements positioned outside viewBox
□ Overlapping shapes or text
□ Arrow endpoints not connecting properly
□ Insufficient contrast for readability
□ Font sizes too small for mobile viewing
□ Missing text-anchor causing misalignment
□ Inconsistent spacing breaking visual rhythm
```

## 失敗パターンと対策

### パターン1: 文字はみ出し
```
❌ Problem: <text x="50" y="30">Very Long Service Name</text>
✅ Solution: 
   - Calculate: 20 chars × 7px = 140px width needed
   - Adjust container: width="160px" (140px + 20px padding)
   - Or break text: "Very Long" + "Service Name" (2 lines)
```

### パターン2: 要素重複
```
❌ Problem: Box1(x=100, width=200) + Box2(x=250, width=200) = overlap
✅ Solution: Box2.x = Box1.x + Box1.width + spacing = 100 + 200 + 20 = 320
```

### パターン3: 領域はみ出し
```
❌ Problem: Element at x=700, width=200 in viewBox width=800
✅ Solution: Max x = 800 - 200 - 40(margin) = 560px
```

### パターン4: 接続線の問題
```
❌ Problem: Arrow from center to center crosses other elements
✅ Solution: Calculate edge-to-edge connection points
   - From: (box1.x + box1.width, box1.y + box1.height/2)
   - To: (box2.x, box2.y + box2.height/2)
```

## 避けるべき要素

### デザイン面
```
- 過度な装飾や不要なエフェクト
- 3D効果やドロップシャドウの乱用
- 原色の多用や彩度の高い色
- 複雑すぎるグラデーション
- 読みにくいフォントの使用
```

### 技術面
```
- インライン style属性の使用
- 固定サイズの指定
- 複雑すぎるパス定義
- 不要なグループ化
- アクセシビリティ属性の省略
```

## AI特有の注意点

### Claude向け
```
- 具体的な寸法を数値で指定
- 色は16進数コードで明示
- レイアウトは座標で詳細指定
- CSS classesの使用を明確に指示
- viewBox設定を必ず含める
```

### 一般的AI向け
```
- "professional" "clean" "modern"等の形容詞を多用
- 具体的なピクセル値で指定
- フォントはシステムフォントに限定
- アニメーションは最小限に抑制
- W3C準拠を明示的に要求
```

このガイドラインにより、AIが生成する図表の品質と一貫性を大幅に向上できます。