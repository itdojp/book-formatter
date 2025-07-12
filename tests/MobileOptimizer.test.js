import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { MobileOptimizer } from '../src/MobileOptimizer.js';

describe('MobileOptimizer', () => {
  let mobileOptimizer;
  let testDir;

  beforeEach(async () => {
    mobileOptimizer = new MobileOptimizer();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-optimizer-test-'));
  });

  afterEach(async () => {
    if (testDir && await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('optimizeForMobile', () => {
    it('should create mobile optimization files', async () => {
      const config = {
        title: 'Test Book',
        description: 'Test Description',
        mobile: {
          enabled: true,
          themeColor: '#3b82f6'
        }
      };

      await mobileOptimizer.optimizeForMobile(config, testDir);

      // Check if CSS file was created
      const cssPath = path.join(testDir, 'assets', 'css', 'mobile-responsive.css');
      assert(await fs.pathExists(cssPath));

      // Check if JS file was created
      const jsPath = path.join(testDir, 'assets', 'js', 'mobile-navigation.js');
      assert(await fs.pathExists(jsPath));

      // Check if layouts were created
      const layoutPath = path.join(testDir, '_layouts', 'default.html');
      assert(await fs.pathExists(layoutPath));

      // Check if mobile config was created
      const configPath = path.join(testDir, 'mobile-config.json');
      assert(await fs.pathExists(configPath));
    });

    it('should generate PWA manifest when enabled', async () => {
      const config = {
        title: 'Test Book',
        mobile: {
          pwa: {
            enabled: true,
            shortName: 'TestBook',
            themeColor: '#ff0000'
          }
        }
      };

      await mobileOptimizer.optimizeForMobile(config, testDir);

      const manifestPath = path.join(testDir, 'manifest.json');
      assert(await fs.pathExists(manifestPath));

      const manifest = await fs.readJson(manifestPath);
      assert.strictEqual(manifest.name, 'Test Book');
      assert.strictEqual(manifest.short_name, 'TestBook');
      assert.strictEqual(manifest.theme_color, '#ff0000');
    });
  });

  describe('generateResponsiveCSS', () => {
    it('should create responsive CSS file', async () => {
      await mobileOptimizer.generateResponsiveCSS(testDir);

      const cssPath = path.join(testDir, 'assets', 'css', 'mobile-responsive.css');
      assert(await fs.pathExists(cssPath));

      const cssContent = await fs.readFile(cssPath, 'utf8');
      assert(cssContent.includes('box-sizing: border-box'));
    });
  });

  describe('generateMobileNavigation', () => {
    it('should create mobile navigation JS file', async () => {
      await mobileOptimizer.generateMobileNavigation(testDir);

      const jsPath = path.join(testDir, 'assets', 'js', 'mobile-navigation.js');
      assert(await fs.pathExists(jsPath));

      const jsContent = await fs.readFile(jsPath, 'utf8');
      assert(jsContent.includes('mobile-menu-toggle'));
    });
  });

  describe('generateMobileLayout', () => {
    it('should generate mobile-optimized layout', () => {
      const config = {
        title: 'Test Book',
        mobile: {
          themeColor: '#123456'
        }
      };

      const layout = mobileOptimizer.generateMobileLayout(config);

      assert(layout.includes('<!DOCTYPE html>'));
      assert(layout.includes('viewport'));
      assert(layout.includes('#123456'));
      assert(layout.includes('mobile-menu-toggle'));
      assert(layout.includes('book-sidebar'));
    });
  });

  describe('generateMobileChapterLayout', () => {
    it('should generate chapter layout', () => {
      const config = { title: 'Test Book' };
      const layout = mobileOptimizer.generateMobileChapterLayout(config);

      assert(layout.includes('layout: default'));
      assert(layout.includes('chapter-title'));
      assert(layout.includes('chapter-content'));
    });
  });

  describe('generateViewportMeta', () => {
    it('should create viewport meta include', async () => {
      const config = {
        mobile: {
          viewport: 'width=device-width, initial-scale=1.0'
        }
      };

      await mobileOptimizer.generateViewportMeta(config, testDir);

      const metaPath = path.join(testDir, '_includes', 'mobile-meta.html');
      assert(await fs.pathExists(metaPath));

      const metaContent = await fs.readFile(metaPath, 'utf8');
      assert(metaContent.includes('width=device-width'));
      assert(metaContent.includes('apple-mobile-web-app-capable'));
    });
  });

  describe('optimizeImages', () => {
    it('should create responsive image CSS', async () => {
      // Create images directory
      const imagesDir = path.join(testDir, 'assets', 'images');
      await fs.ensureDir(imagesDir);

      await mobileOptimizer.optimizeImages(testDir);

      const cssPath = path.join(testDir, 'assets', 'css', 'responsive-images.css');
      assert(await fs.pathExists(cssPath));

      const cssContent = await fs.readFile(cssPath, 'utf8');
      assert(cssContent.includes('max-width: 100%'));
      assert(cssContent.includes('responsive-image'));
    });
  });

  describe('generatePWAManifest', () => {
    it('should create PWA manifest with correct structure', async () => {
      const config = {
        title: 'Test PWA Book',
        description: 'A test book for PWA',
        mobile: {
          pwa: {
            shortName: 'TestPWA',
            backgroundColor: '#ffffff',
            themeColor: '#000000'
          }
        }
      };

      await mobileOptimizer.generatePWAManifest(config, testDir);

      const manifestPath = path.join(testDir, 'manifest.json');
      assert(await fs.pathExists(manifestPath));

      const manifest = await fs.readJson(manifestPath);
      
      assert.strictEqual(manifest.name, 'Test PWA Book');
      assert.strictEqual(manifest.short_name, 'TestPWA');
      assert.strictEqual(manifest.description, 'A test book for PWA');
      assert.strictEqual(manifest.display, 'standalone');
      assert.strictEqual(manifest.background_color, '#ffffff');
      assert.strictEqual(manifest.theme_color, '#000000');
      assert(Array.isArray(manifest.icons));
      assert(manifest.icons.length > 0);
    });
  });

  describe('generateMobileConfig', () => {
    it('should create mobile configuration file', async () => {
      const config = {
        mobile: {
          lazyLoading: true,
          swipeGestures: false,
          scaleFactor: 1.2
        }
      };

      await mobileOptimizer.generateMobileConfig(config, testDir);

      const configPath = path.join(testDir, 'mobile-config.json');
      assert(await fs.pathExists(configPath));

      const mobileConfig = await fs.readJson(configPath);
      
      assert(typeof mobileConfig.performance === 'object');
      assert(typeof mobileConfig.navigation === 'object');
      assert(typeof mobileConfig.typography === 'object');
      assert(typeof mobileConfig.layout === 'object');
      
      assert.strictEqual(mobileConfig.performance.lazyLoading, true);
      assert.strictEqual(mobileConfig.navigation.swipeGestures, false);
      assert.strictEqual(mobileConfig.typography.scaleFactor, 1.2);
    });
  });

  describe('validateMobileOptimization', () => {
    it('should validate mobile configuration successfully', () => {
      const config = {
        mobile: {
          viewport: 'width=device-width, initial-scale=1.0',
          themeColor: '#3b82f6',
          breakpoints: {
            mobile: '768px',
            tablet: '1024px',
            desktop: '1200px'
          }
        }
      };

      const validation = mobileOptimizer.validateMobileOptimization(config);
      
      assert.strictEqual(validation.isValid, true);
      assert.strictEqual(validation.errors.length, 0);
    });

    it('should detect invalid breakpoint configuration', () => {
      const config = {
        mobile: {
          breakpoints: {
            mobile: '1024px',
            tablet: '768px'  // Invalid: mobile >= tablet
          }
        }
      };

      const validation = mobileOptimizer.validateMobileOptimization(config);
      
      assert.strictEqual(validation.isValid, false);
      assert(validation.errors.length > 0);
      assert(validation.errors[0].includes('ブレイクポイント'));
    });

    it('should generate warnings for missing configuration', () => {
      const config = {}; // Minimal config

      const validation = mobileOptimizer.validateMobileOptimization(config);
      
      assert(validation.warnings.length > 0 || validation.suggestions.length > 0);
    });
  });

  describe('generateOptimizationReport', () => {
    it('should create optimization report', async () => {
      const config = {
        title: 'Test Book',
        mobile: {
          viewport: 'width=device-width, initial-scale=1.0',
          themeColor: '#3b82f6',
          pwa: true
        }
      };

      await mobileOptimizer.generateOptimizationReport(config, testDir);

      const reportPath = path.join(testDir, 'mobile-optimization-report.md');
      assert(await fs.pathExists(reportPath));

      const reportContent = await fs.readFile(reportPath, 'utf8');
      assert(reportContent.includes('# モバイル最適化レポート'));
      assert(reportContent.includes('## 設定概要'));
      assert(reportContent.includes('## 最適化状況'));
      assert(reportContent.includes('width=device-width'));
      assert(reportContent.includes('#3b82f6'));
    });
  });
});