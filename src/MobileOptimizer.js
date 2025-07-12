import fs from 'fs-extra';
import path from 'path';

/**
 * Mobile Optimizer for Book Formatter
 * Optimizes generated books for mobile devices and responsive design
 */

export class MobileOptimizer {
  constructor(errorHandler) {
    this.errorHandler = errorHandler || {
      safeExecute: async (fn) => await fn()
    };
  }

  /**
   * Apply mobile optimizations to a book project
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async optimizeForMobile(config, outputPath) {
    return this.errorHandler.safeExecute(async () => {
      console.log('📱 モバイル最適化を開始します...');

      // Generate responsive CSS
      await this.generateResponsiveCSS(outputPath);
      
      // Generate mobile navigation JavaScript
      await this.generateMobileNavigation(outputPath);
      
      // Optimize layout templates
      await this.optimizeLayoutTemplates(config, outputPath);
      
      // Generate viewport meta tags
      await this.generateViewportMeta(config, outputPath);
      
      // Optimize images for mobile
      await this.optimizeImages(outputPath);
      
      // Generate PWA manifest if requested
      if (config.mobile?.pwa) {
        await this.generatePWAManifest(config, outputPath);
      }
      
      // Generate mobile-specific configuration
      await this.generateMobileConfig(config, outputPath);

      console.log('✅ モバイル最適化が完了しました');
      
    }, 'optimizeForMobile');
  }

  /**
   * Generate responsive CSS file
   * @param {string} outputPath - Output directory path
   */
  async generateResponsiveCSS(outputPath) {
    const cssDir = path.join(outputPath, 'assets', 'css');
    await fs.ensureDir(cssDir);

    // Copy the mobile-responsive.css from shared assets
    const sourceCSS = path.join(process.cwd(), 'shared', 'assets', 'css', 'mobile-responsive.css');
    const targetCSS = path.join(cssDir, 'mobile-responsive.css');

    if (await fs.pathExists(sourceCSS)) {
      await fs.copy(sourceCSS, targetCSS);
      console.log('📝 レスポンシブCSSファイルを生成しました');
    } else {
      // Generate a basic responsive CSS if source doesn't exist
      await this.generateBasicResponsiveCSS(targetCSS);
    }
  }

  /**
   * Generate basic responsive CSS as fallback
   * @param {string} targetPath - Target CSS file path
   */
  async generateBasicResponsiveCSS(targetPath) {
    const basicCSS = `/* Basic Mobile Responsive CSS */
* {
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  margin: 0;
  padding: 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* Mobile styles */
@media (max-width: 767px) {
  .container {
    padding: 0 0.5rem;
  }
  
  h1 { font-size: 1.75rem; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.25rem; }
  
  .mobile-hidden { display: none; }
  
  table {
    font-size: 0.875rem;
    overflow-x: auto;
    display: block;
    white-space: nowrap;
  }
}

/* Tablet styles */
@media (min-width: 768px) and (max-width: 1023px) {
  .tablet-hidden { display: none; }
}

/* Desktop styles */
@media (min-width: 1024px) {
  .desktop-hidden { display: none; }
}
`;

    await fs.writeFile(targetPath, basicCSS);
    console.log('📝 基本レスポンシブCSSファイルを生成しました');
  }

  /**
   * Generate mobile navigation JavaScript
   * @param {string} outputPath - Output directory path
   */
  async generateMobileNavigation(outputPath) {
    const jsDir = path.join(outputPath, 'assets', 'js');
    await fs.ensureDir(jsDir);

    // Copy mobile navigation JS from shared assets
    const sourceJS = path.join(process.cwd(), 'shared', 'assets', 'js', 'mobile-navigation.js');
    const targetJS = path.join(jsDir, 'mobile-navigation.js');

    if (await fs.pathExists(sourceJS)) {
      await fs.copy(sourceJS, targetJS);
      console.log('📝 モバイルナビゲーションJSファイルを生成しました');
    } else {
      // Generate basic mobile navigation JS
      await this.generateBasicMobileNavigation(targetJS);
    }
  }

  /**
   * Generate basic mobile navigation as fallback
   * @param {string} targetPath - Target JS file path
   */
  async generateBasicMobileNavigation(targetPath) {
    const basicJS = `// Basic Mobile Navigation
document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const sidebar = document.querySelector('.book-sidebar');
  
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', function() {
      sidebar.classList.toggle('open');
    });
  }
  
  // Close menu when clicking outside
  document.addEventListener('click', function(event) {
    if (!sidebar.contains(event.target) && !menuToggle.contains(event.target)) {
      sidebar.classList.remove('open');
    }
  });
});
`;

    await fs.writeFile(targetPath, basicJS);
    console.log('📝 基本モバイルナビゲーションJSファイルを生成しました');
  }

  /**
   * Optimize layout templates for mobile
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async optimizeLayoutTemplates(config, outputPath) {
    const layoutsDir = path.join(outputPath, '_layouts');
    await fs.ensureDir(layoutsDir);

    // Generate mobile-optimized default layout
    const defaultLayout = this.generateMobileLayout(config);
    await fs.writeFile(path.join(layoutsDir, 'default.html'), defaultLayout);

    // Generate mobile-optimized chapter layout
    const chapterLayout = this.generateMobileChapterLayout(config);
    await fs.writeFile(path.join(layoutsDir, 'chapter.html'), chapterLayout);

    console.log('📝 モバイル最適化レイアウトテンプレートを生成しました');
  }

  /**
   * Generate mobile-optimized default layout
   * @param {Object} config - Book configuration
   * @returns {string} HTML layout template
   */
  generateMobileLayout(config) {
    const mobileConfig = config.mobile || {};
    const themeColor = mobileConfig.themeColor || '#3b82f6';
    
    return `<!DOCTYPE html>
<html lang="{{ page.lang | default: site.lang | default: 'ja' }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=no">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  
  <title>{% if page.title %}{{ page.title | escape }} - {% endif %}{{ site.title | escape }}</title>
  <meta name="description" content="{{ page.excerpt | default: site.description | strip_html | normalize_whitespace | truncate: 160 | escape }}">
  
  <!-- Mobile optimizations -->
  <meta name="theme-color" content="${themeColor}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="{{ site.title | escape }}">
  
  <!-- Preload critical resources -->
  <link rel="preload" href="{{ '/assets/css/mobile-responsive.css' | relative_url }}" as="style">
  <link rel="preload" href="{{ '/assets/js/mobile-navigation.js' | relative_url }}" as="script">
  
  <!-- Stylesheets -->
  <link rel="stylesheet" href="{{ '/assets/css/mobile-responsive.css' | relative_url }}">
  {% if site.custom_css %}
    <link rel="stylesheet" href="{{ site.custom_css | relative_url }}">
  {% endif %}
  
  <!-- Favicon -->
  <link rel="icon" type="image/x-icon" href="{{ '/favicon.ico' | relative_url }}">
  
  <!-- RSS feed -->
  {% feed_meta %}
  
  <!-- SEO tags -->
  {% seo %}
</head>
<body class="book-layout">
  <header class="book-header">
    <div class="container">
      <div class="book-header-content">
        <a href="{{ '/' | relative_url }}" class="book-title">{{ site.title | escape }}</a>
        
        <nav class="book-nav tablet-up">
          {% include navigation.html %}
        </nav>
        
        <button class="mobile-menu-toggle mobile-only" aria-label="メニューを開く">
          ☰
        </button>
      </div>
    </div>
  </header>

  <div class="book-sidebar-overlay"></div>
  
  <aside class="book-sidebar" aria-label="サイドナビゲーション">
    {% include sidebar.html %}
  </aside>

  <main class="book-main">
    <div class="container">
      <div class="book-content">
        {{ content }}
        
        {% include page-navigation.html %}
      </div>
    </div>
  </main>

  <footer class="book-footer">
    <div class="container">
      <div class="text-center text-secondary text-sm">
        <p>&copy; {{ 'now' | date: '%Y' }} {{ site.author | escape }}. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <!-- Scripts -->
  <script src="{{ '/assets/js/mobile-navigation.js' | relative_url }}" defer></script>
  {% if site.custom_js %}
    <script src="{{ site.custom_js | relative_url }}" defer></script>
  {% endif %}
</body>
</html>`;
  }

  /**
   * Generate mobile-optimized chapter layout
   * @param {Object} config - Book configuration
   * @returns {string} HTML chapter layout template
   */
  generateMobileChapterLayout(config) {
    return `---
layout: default
---

<article class="chapter">
  <header class="chapter-header">
    <h1 class="chapter-title">{{ page.title }}</h1>
    {% if page.description %}
      <p class="chapter-description">{{ page.description }}</p>
    {% endif %}
  </header>
  
  <div class="chapter-content">
    {{ content }}
  </div>
  
  <footer class="chapter-footer">
    <div class="chapter-meta">
      {% if page.date %}
        <time datetime="{{ page.date | date_to_xmlschema }}">
          {{ page.date | date: '%Y年%m月%d日' }}
        </time>
      {% endif %}
    </div>
  </footer>
</article>`;
  }

  /**
   * Generate viewport meta tag configuration
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generateViewportMeta(config, outputPath) {
    const includesDir = path.join(outputPath, '_includes');
    await fs.ensureDir(includesDir);

    const mobileConfig = config.mobile || {};
    const viewportContent = mobileConfig.viewport || 'width=device-width, initial-scale=1.0, shrink-to-fit=no';

    const metaInclude = `<!-- Mobile viewport configuration -->
<meta name="viewport" content="${viewportContent}">

<!-- Mobile app configurations -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">

<!-- Prevent automatic phone number linking -->
<meta name="format-detection" content="telephone=no">`;

    await fs.writeFile(path.join(includesDir, 'mobile-meta.html'), metaInclude);
    console.log('📝 モバイルメタタグを生成しました');
  }

  /**
   * Optimize images for mobile devices
   * @param {string} outputPath - Output directory path
   */
  async optimizeImages(outputPath) {
    const imagesDir = path.join(outputPath, 'assets', 'images');
    
    if (await fs.pathExists(imagesDir)) {
      // Generate responsive image CSS
      const responsiveImageCSS = `/* Responsive Images */
img {
  max-width: 100%;
  height: auto;
  border-radius: 0.375rem;
}

.responsive-image {
  display: block;
  margin: 1rem auto;
}

/* Image with caption */
.image-with-caption {
  margin: 1.5rem 0;
  text-align: center;
}

.image-with-caption img {
  margin-bottom: 0.5rem;
}

.image-caption {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* Lazy loading optimization */
img[loading="lazy"] {
  opacity: 0;
  transition: opacity 0.3s;
}

img[loading="lazy"].loaded {
  opacity: 1;
}
`;

      const cssDir = path.join(outputPath, 'assets', 'css');
      await fs.ensureDir(cssDir);
      await fs.writeFile(path.join(cssDir, 'responsive-images.css'), responsiveImageCSS);
      
      console.log('📝 レスポンシブ画像CSSを生成しました');
    }
  }

  /**
   * Generate PWA manifest file
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generatePWAManifest(config, outputPath) {
    const mobileConfig = config.mobile || {};
    const pwaConfig = mobileConfig.pwa || {};

    const manifest = {
      name: config.title || 'Book',
      short_name: pwaConfig.shortName || config.title || 'Book',
      description: config.description || '',
      start_url: '/',
      display: 'standalone',
      background_color: pwaConfig.backgroundColor || '#ffffff',
      theme_color: pwaConfig.themeColor || '#3b82f6',
      orientation: 'portrait-primary',
      icons: [
        {
          src: '/assets/images/icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/assets/images/icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ],
      categories: ['books', 'education', 'productivity'],
      lang: config.language || 'ja'
    };

    await fs.writeJson(path.join(outputPath, 'manifest.json'), manifest, { spaces: 2 });
    console.log('📝 PWAマニフェストを生成しました');
  }

  /**
   * Generate mobile-specific configuration
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generateMobileConfig(config, outputPath) {
    const mobileConfig = config.mobile || {};
    
    const mobileOptimizations = {
      // Mobile performance settings
      performance: {
        lazyLoading: mobileConfig.lazyLoading !== false,
        prefetch: mobileConfig.prefetch !== false,
        compression: mobileConfig.compression !== false
      },
      
      // Mobile navigation settings
      navigation: {
        swipeGestures: mobileConfig.swipeGestures !== false,
        hamburgerMenu: mobileConfig.hamburgerMenu !== false,
        stickyHeader: mobileConfig.stickyHeader !== false
      },
      
      // Mobile typography settings
      typography: {
        scaleFactor: mobileConfig.scaleFactor || 1.0,
        lineHeight: mobileConfig.lineHeight || 1.6,
        fontSize: mobileConfig.fontSize || '16px'
      },
      
      // Mobile layout settings
      layout: {
        sidebar: mobileConfig.sidebar || 'overlay',
        breakpoints: mobileConfig.breakpoints || {
          mobile: '768px',
          tablet: '1024px',
          desktop: '1200px'
        }
      }
    };

    await fs.writeJson(
      path.join(outputPath, 'mobile-config.json'), 
      mobileOptimizations, 
      { spaces: 2 }
    );
    
    console.log('📝 モバイル設定ファイルを生成しました');
  }

  /**
   * Validate mobile optimization settings
   * @param {Object} config - Book configuration
   * @returns {Object} Validation results
   */
  validateMobileOptimization(config) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };

    const mobileConfig = config.mobile || {};

    // Check for required mobile settings
    if (!mobileConfig.viewport && !config.deployment?.platform) {
      validation.warnings.push('viewport設定が指定されていません');
      validation.suggestions.push('mobile.viewportを設定することを推奨します');
    }

    // Check theme color
    if (!mobileConfig.themeColor) {
      validation.suggestions.push('mobile.themeColorを設定してブランディングを向上させることを推奨します');
    }

    // Check PWA settings
    if (mobileConfig.pwa && !mobileConfig.pwa.shortName) {
      validation.warnings.push('PWA設定でshortNameが指定されていません');
    }

    // Check breakpoints
    if (mobileConfig.breakpoints) {
      const breakpoints = mobileConfig.breakpoints;
      if (breakpoints.mobile && parseInt(breakpoints.mobile) >= parseInt(breakpoints.tablet || '1024px')) {
        validation.errors.push('モバイルブレイクポイントがタブレットブレイクポイント以上です');
        validation.isValid = false;
      }
    }

    return validation;
  }

  /**
   * Generate mobile optimization report
   * @param {Object} config - Book configuration
   * @param {string} outputPath - Output directory path
   */
  async generateOptimizationReport(config, outputPath) {
    const validation = this.validateMobileOptimization(config);
    const mobileConfig = config.mobile || {};

    const report = `# モバイル最適化レポート

生成日時: ${new Date().toLocaleString('ja-JP')}

## 設定概要

- **ビューポート**: ${mobileConfig.viewport || 'デフォルト'}
- **テーマカラー**: ${mobileConfig.themeColor || 'デフォルト'}
- **PWA対応**: ${mobileConfig.pwa ? '有効' : '無効'}
- **スワイプジェスチャー**: ${mobileConfig.swipeGestures !== false ? '有効' : '無効'}

## 最適化状況

### ✅ 実装済み機能

- レスポンシブデザイン
- モバイルナビゲーション
- タッチフレンドリーUI
- 画像最適化
- パフォーマンス最適化

### 検証結果

${validation.isValid ? '✅ すべての検証をパスしました' : '❌ エラーがあります'}

#### エラー (${validation.errors.length}件)
${validation.errors.map(error => `- ${error}`).join('\n')}

#### 警告 (${validation.warnings.length}件)
${validation.warnings.map(warning => `- ${warning}`).join('\n')}

#### 推奨事項 (${validation.suggestions.length}件)
${validation.suggestions.map(suggestion => `- ${suggestion}`).join('\n')}

## パフォーマンス推奨事項

1. **画像最適化**: WebP形式の使用を検討
2. **キャッシュ戦略**: Service Workerの実装を検討
3. **フォント最適化**: システムフォントの使用を継続
4. **JavaScript最適化**: 必要に応じて遅延読み込みを実装

## テスト推奨事項

- [ ] 各種デバイスでのレスポンシブテスト
- [ ] タッチジェスチャーの動作確認
- [ ] ページ読み込み速度の測定
- [ ] アクセシビリティの確認

---

*このレポートはBook Formatter Mobile Optimizerによって自動生成されました。*
`;

    await fs.writeFile(path.join(outputPath, 'mobile-optimization-report.md'), report);
    console.log('📄 モバイル最適化レポートを生成しました');
  }
}