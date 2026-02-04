#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';

/**
 * リンクチェッカーツール
 * Markdownファイル内のリンクを検証
 */
class LinkChecker {
  constructor() {
    this.brokenLinks = [];
    this.externalWarnings = [];
    this.checkedLinks = new Map(); // url -> { ok, reason }
    this.fileLinks = new Map(); // ファイルごとのリンクを記録
    this.fileErrors = [];
    this.anchorCache = new Map(); // filePath -> Set(anchor)
    this.md = new MarkdownIt({
      // linkify: bare URLs in plain text become links; markdown-it won't do this inside code blocks.
      linkify: true
    }).use(footnote);

    // CLI options (set in checkDirectory)
    this.checkExternal = false;
    this.externalTimeoutMs = 10000;
    this.siteRootDir = null;
    this.repoName = null;
  }

  /**
   * ディレクトリ内のMarkdownファイルをチェック
   * @param {string} directory - チェック対象のディレクトリ
   * @param {Object} options - オプション
   */
  async checkDirectory(directory, options = {}) {
    const {
      pattern = '**/*.md',
      ignore = [
        'node_modules/**',
        '**/node_modules/**',
        'templates/**',
        '**/templates/**',
        'examples/**',
        '**/examples/**'
      ],
      checkExternal = false,
      externalTimeoutMs = 10000
    } = options;

    this.checkExternal = Boolean(checkExternal);
    this.externalTimeoutMs = Number.isFinite(externalTimeoutMs) ? externalTimeoutMs : 10000;
    
    console.log(chalk.blue(`🔍 Checking links in ${directory}...`));

    const baseDir = path.resolve(directory);
    // Resolve "site root" for absolute links:
    // - If the repo uses GitHub Pages with /docs as the published root (common), use it.
    // - If the checker runs against the docs/ directory directly, keep docs/ as the site root
    //   but still derive the repository name from the parent directory (for /<repo>/... baseurl links).
    // - Otherwise, treat the provided directory as the site root.
    this.siteRootDir = baseDir;
    let repoRootDir = baseDir;
    const docsConfigInDocs = path.join(baseDir, 'docs', '_config.yml');
    const configInBase = path.join(baseDir, '_config.yml');

    if (await fs.pathExists(docsConfigInDocs)) {
      this.siteRootDir = path.join(baseDir, 'docs');
      repoRootDir = baseDir;
    } else if (path.basename(baseDir) === 'docs' && (await fs.pathExists(configInBase))) {
      this.siteRootDir = baseDir;
      repoRootDir = path.dirname(baseDir);
    }

    this.repoName = path.basename(repoRootDir);

    // Markdownファイルを検索
    // Use `cwd` + relative patterns so `ignore` reliably matches (e.g. node_modules/**)
    // even when scanning with an absolute directory.
    const files = await glob(pattern, {
      cwd: baseDir,
      ignore,
      windowsPathsNoEscape: true,
      absolute: true
    });
    
    console.log(chalk.gray(`Found ${files.length} markdown files`));
    
    // 各ファイルをチェック
    for (const file of files) {
      await this.checkFile(file, baseDir);
    }
    
    return this.generateReport();
  }

  /**
   * 単一ファイルのリンクをチェック
   * @param {string} filePath - ファイルパス
   * @param {string} baseDir - ベースディレクトリ
   */
  async checkFile(filePath, baseDir) {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const relativeFile = path.relative(baseDir, filePath).replace(/\\/g, '/');
      this.fileErrors.push({ file: relativeFile, message: error.message });
      console.warn(chalk.yellow(`Warning: Failed to read "${relativeFile}": ${error.message}`));
      return;
    }

    const relativeFile = path.relative(baseDir, filePath).replace(/\\/g, '/');
    
    // Markdownリンクを抽出
    const links = this.extractLinks(content);
    
    if (links.length === 0) return;
    
    console.log(chalk.gray(`  Checking ${relativeFile} (${links.length} links)`));
    
    this.fileLinks.set(relativeFile, []);
    
    for (const link of links) {
      const result = await this.validateLink(link, filePath, baseDir);
      
      this.fileLinks.get(relativeFile).push({
        ...link,
        ...result
      });
      
      if (!result.valid) {
        this.brokenLinks.push({
          file: relativeFile,
          line: link.line,
          column: link.column,
          url: link.url,
          text: link.text,
          reason: result.reason
        });
      } else if (result.type === 'external' && result.externalOk === false) {
        this.externalWarnings.push({
          file: relativeFile,
          line: link.line,
          column: link.column,
          url: link.url,
          text: link.text,
          reason: result.reason
        });
      }
    }
  }

  /**
   * Markdownコンテンツからリンクを抽出
   * @param {string} content - Markdownコンテンツ
   * @returns {Array} リンク情報の配列
   */
  extractLinks(content) {
    const links = [];
    const tokens = this.md.parse(content, {});

    for (const token of tokens) {
      if (token.type !== 'inline' || !Array.isArray(token.children)) continue;

      const line = Array.isArray(token.map) ? token.map[0] + 1 : 1;
      const children = token.children;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];

        if (child.type === 'link_open') {
          const href = child.attrGet('href');
          if (!href) continue;

          // Capture link text until link_close.
          let text = '';
          for (let j = i + 1; j < children.length; j++) {
            const t = children[j];
            if (t.type === 'link_close') break;
            if (t.type === 'text' || t.type === 'code_inline') text += t.content;
            if (t.type === 'image') text += t.content || '';
          }

          links.push({
            line,
            column: 1,
            text: text.trim(),
            url: href.trim(),
            raw: ''
          });
        }

        if (child.type === 'image') {
          const src = child.attrGet('src');
          if (!src) continue;

          links.push({
            line,
            column: 1,
            text: (child.content || '').trim(),
            url: src.trim(),
            raw: ''
          });
        }
      }
    }

    return links;
  }

  /**
   * リンクを検証
   * @param {Object} link - リンク情報
   * @param {string} sourceFile - ソースファイルパス
   * @param {string} baseDir - ベースディレクトリ
   * @returns {Object} 検証結果
   */
  async validateLink(link, sourceFile, baseDir) {
    const { url } = link;

    // Same-file anchors (#...)
    if (url.startsWith('#')) {
      const anchor = url.slice(1);
      try {
        const valid = await this.validateAnchor(sourceFile, anchor);
        if (!valid) {
          return {
            valid: false,
            reason: `Anchor #${anchor} not found`,
            type: 'anchor'
          };
        }
        return { valid: true, type: 'anchor' };
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        return {
          valid: false,
          type: 'error',
          reason: `Failed to validate anchor #${anchor}: ${message}`
        };
      }
    }
    
    // 外部URLはスキップ（オプションで検証可能）
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!this.checkExternal) {
        return { valid: true, type: 'external' };
      }

      const cached = this.checkedLinks.get(url);
      if (cached) {
        return {
          valid: true,
          type: 'external',
          externalOk: cached.ok,
          reason: cached.reason
        };
      }

      const result = await this.checkExternalUrl(url);
      this.checkedLinks.set(url, { ok: result.ok, reason: result.reason });
      return {
        valid: true, // external failures are warnings by default
        type: 'external',
        externalOk: result.ok,
        reason: result.reason
      };
    }
    
    // メールリンクはスキップ
    if (url.startsWith('mailto:')) {
      return { valid: true, type: 'email' };
    }
    
    // 相対パスの解決
    const sourceDir = path.dirname(sourceFile);
    let targetPath;
    
    // Strip query string. (e.g. ./page.md?foo=bar#baz)
    const [urlWithoutHash, hashPart] = url.split('#', 2);
    const urlPath = urlWithoutHash.split('?', 2)[0].trim();

    // Decode percent-encoded paths if possible.
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(urlPath);
    } catch {
      decodedPath = urlPath;
    }

    // Drop surrounding angle brackets (common in autolinks / reference defs).
    if (decodedPath.startsWith('<') && decodedPath.endsWith('>')) {
      decodedPath = decodedPath.slice(1, -1).trim();
    }

    if (decodedPath.startsWith('/')) {
      // 絶対パス（GitHub Pages の baseurl を含むケースにも対応）
      // 例: /<repo-name>/assets/... -> ./assets/... として解決
      const repoName = this.repoName || path.basename(baseDir);
      const normalized = decodedPath.replace(/^\/+/, '/');
      const repoPrefix = `/${repoName}`;

      let relativeFromRoot = normalized.replace(/^\/+/, '');
      if (normalized === repoPrefix || normalized === `${repoPrefix}/`) {
        relativeFromRoot = '';
      } else if (normalized.startsWith(`${repoPrefix}/`)) {
        relativeFromRoot = normalized.slice((`${repoPrefix}/`).length);
      }

      const siteRoot = this.siteRootDir || baseDir;
      targetPath = path.join(siteRoot, relativeFromRoot);
    } else {
      // 相対パス
      targetPath = path.resolve(sourceDir, decodedPath);
    }
    
    // アンカーの処理
    let anchor = null;
    if (targetPath.includes('#')) {
      const parts = targetPath.split('#');
      targetPath = parts[0];
      anchor = parts[1];
    } else if (hashPart) {
      anchor = hashPart;
    }
    
    // ファイルの存在確認
    try {
      let exists = await fs.pathExists(targetPath);
      
      if (!exists) {
        const hasExt = path.extname(targetPath) !== '';

        // Try common extensions when the link omits them.
        if (!hasExt) {
          const mdCandidate = `${targetPath}.md`;
          const htmlCandidate = `${targetPath}.html`;
          if (await fs.pathExists(mdCandidate)) {
            targetPath = mdCandidate;
            exists = true;
          } else if (await fs.pathExists(htmlCandidate)) {
            targetPath = htmlCandidate;
            exists = true;
          }
        }
      }

      if (!exists) {
        // インデックスファイルの確認
        const indexMd = path.join(targetPath, 'index.md');
        const indexHtml = path.join(targetPath, 'index.html');
        if (await fs.pathExists(indexMd)) {
          targetPath = indexMd;
        } else if (await fs.pathExists(indexHtml)) {
          targetPath = indexHtml;
        } else {
          return { 
            valid: false, 
            reason: 'File not found',
            type: 'internal'
          };
        }
      }

      // If a directory exists, validate it like a page directory by resolving index files.
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        if (await fs.pathExists(path.join(targetPath, 'index.md'))) {
          targetPath = path.join(targetPath, 'index.md');
        } else if (await fs.pathExists(path.join(targetPath, 'index.html'))) {
          targetPath = path.join(targetPath, 'index.html');
        }
      }
      
      // アンカーの検証（オプション）
      if (anchor) {
        const valid = await this.validateAnchor(targetPath, anchor);
        if (!valid) {
          return {
            valid: false,
            reason: `Anchor #${anchor} not found`,
            type: 'anchor'
          };
        }
      }
      
      return { valid: true, type: 'internal' };
      
    } catch (error) {
      return { 
        valid: false, 
        reason: error.message,
        type: 'error'
      };
    }
  }

  /**
   * アンカーの存在を検証
   * @param {string} filePath - ファイルパス
   * @param {string} anchor - アンカー名
   * @returns {boolean} アンカーが存在するか
   */
  async validateAnchor(filePath, anchor) {
    if (!filePath.endsWith('.md')) return true; // Markdownファイル以外はスキップ

    // Normalize and decode anchor if possible.
    let normalizedAnchor = String(anchor || '').trim();
    try {
      normalizedAnchor = decodeURIComponent(normalizedAnchor);
    } catch {
      // keep as-is
    }
    normalizedAnchor = normalizedAnchor.toLowerCase();

    const normalizeSlugBase = (text) => {
      return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    };
    const normalizeAnchorSlug = normalizeSlugBase;

    const cached = this.anchorCache.get(filePath);
    if (cached) {
      if (cached.has(normalizedAnchor)) return true;
      const alt = normalizeAnchorSlug(normalizedAnchor);
      return alt ? cached.has(alt) : false;
    }

    const content = await fs.readFile(filePath, 'utf8');

    // Extract anchors from headings using markdown-it (avoids code fences etc).
    const tokens = this.md.parse(content, {});
    const anchors = new Set();
    const seen = new Map(); // baseSlug -> count (0 for first occurrence)

    const slugify = (text) => {
      // Roughly matches GitHub heading slugs, but keeps Unicode letters/numbers
      // so Japanese headings can be linked.
      const slug = normalizeSlugBase(text);

      if (slug === '') return '';

      if (!seen.has(slug)) {
        seen.set(slug, 0);
        return slug;
      }

      const next = (seen.get(slug) || 0) + 1;
      seen.set(slug, next);
      return `${slug}-${next}`;
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      const headingText = inline.content || '';

      // kramdown-style explicit IDs can appear in headings like:
      //   ## Title {#my-id}
      // If present, the explicit ID should be accepted as a valid anchor.
      for (const m of headingText.matchAll(/\{#([A-Za-z0-9][A-Za-z0-9_-]*)\}/g)) {
        const explicit = String(m[1] || '').trim().toLowerCase();
        if (explicit) anchors.add(explicit);
      }

      // Also generate a slug from the heading text without the explicit ID suffix,
      // so links that rely on auto-generated anchors can be validated too.
      const cleanedHeadingText = headingText.replace(/\s*\{#([A-Za-z0-9][A-Za-z0-9_-]*)\}\s*/g, ' ').trim();
      const slug = slugify(cleanedHeadingText);
      if (slug) anchors.add(slug);
    }

    // Also accept explicit HTML ids.
    for (const match of content.matchAll(/\bid=\"([^\"]+)\"/g)) {
      const id = String(match[1] || '').trim().toLowerCase();
      if (id) anchors.add(id);
    }

    // kramdown attribute list style (e.g. "{: #my-id}") can define IDs separately.
    for (const match of content.matchAll(/\{\:\s*#([A-Za-z0-9][A-Za-z0-9_-]*)\s*\}/g)) {
      const id = String(match[1] || '').trim().toLowerCase();
      if (id) anchors.add(id);
    }

    this.anchorCache.set(filePath, anchors);
    if (anchors.has(normalizedAnchor)) return true;
    const alt = normalizeAnchorSlug(normalizedAnchor);
    return alt ? anchors.has(alt) : false;
  }

  async checkExternalUrl(url) {
    // Best-effort external check (warn only).
    if (typeof fetch !== 'function') {
      return { ok: true, reason: 'fetch is not available' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.externalTimeoutMs);

    try {
      // Prefer HEAD to reduce traffic; fall back to GET if needed.
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal
      });

      if (res.ok) return { ok: true };

      // Some servers reject HEAD; retry with GET only for those cases to reduce load.
      const retryWithGet = new Set([400, 403, 405, 501]);
      if (retryWithGet.has(res.status)) {
        const res2 = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal
        });
        if (res2.ok) return { ok: true };
        return { ok: false, reason: `HTTP ${res2.status}` };
      }

      return { ok: false, reason: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, reason: error.name === 'AbortError' ? 'timeout' : error.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * レポートを生成
   * @returns {Object} レポート
   */
  generateReport() {
    const totalFiles = this.fileLinks.size;
    const totalLinks = Array.from(this.fileLinks.values())
      .reduce((sum, links) => sum + links.length, 0);
    const brokenCount = this.brokenLinks.length;
    const externalWarnings = this.externalWarnings.length;
    const fileReadErrors = this.fileErrors.length;
    
    const report = {
      summary: {
        totalFiles,
        totalLinks,
        brokenLinks: brokenCount,
        externalWarnings,
        fileReadErrors,
        success: brokenCount === 0 && fileReadErrors === 0
      },
      brokenLinks: this.brokenLinks,
      externalWarnings: this.externalWarnings,
      fileReadErrors: this.fileErrors,
      fileDetails: Object.fromEntries(this.fileLinks)
    };
    
    // コンソール出力
    console.log('\n' + chalk.bold('📊 Link Check Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Total files checked: ${totalFiles}`);
    console.log(`Total links found: ${totalLinks}`);
    if (fileReadErrors > 0) {
      console.log(chalk.yellow(`Files failed to read: ${fileReadErrors}`));
    }
    if (externalWarnings > 0) {
      console.log(chalk.yellow(`External link warnings: ${externalWarnings}`));
    }
    
    if (brokenCount === 0) {
      console.log(chalk.green(`✅ All links are valid!`));
    } else {
      console.log(chalk.red(`❌ Found ${brokenCount} broken links:`));
      console.log();
      
      this.brokenLinks.forEach(broken => {
        console.log(chalk.red(`  ${broken.file}:${broken.line}:${broken.column}`));
        console.log(chalk.gray(`    Link: [${broken.text}](${broken.url})`));
        console.log(chalk.yellow(`    Reason: ${broken.reason}`));
        console.log();
      });
    }

    if (externalWarnings > 0) {
      console.log(chalk.yellow(`\n⚠️ External link warnings (best-effort):`));
      console.log();
      this.externalWarnings.forEach(warn => {
        console.log(chalk.yellow(`  ${warn.file}:${warn.line}:${warn.column}`));
        console.log(chalk.gray(`    Link: [${warn.text}](${warn.url})`));
        console.log(chalk.gray(`    Reason: ${warn.reason}`));
        console.log();
      });
    }
    
    return report;
  }

  /**
   * レポートをファイルに保存
   * @param {Object} report - レポート
   * @param {string} outputPath - 出力パス
   */
  async saveReport(report, outputPath) {
    await fs.writeFile(
      outputPath,
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log(chalk.blue(`\n📄 Report saved to: ${outputPath}`));
  }
}

// CLIの設定
const program = new Command();

program
  .name('check-links')
  .description('Check for broken links in markdown files')
  .version('1.0.0')
  .argument('[directory]', 'Directory to check', '.')
  .option('-p, --pattern <pattern>', 'Glob pattern for files', '**/*.md')
  .option('-i, --ignore <patterns...>', 'Patterns to ignore', [
    'node_modules/**',
    '**/node_modules/**',
    'templates/**',
    '**/templates/**',
    'examples/**',
    '**/examples/**'
  ])
  .option('-o, --output <file>', 'Save report to file')
  .option('-e, --external', 'Also check external URLs (best-effort; warnings only)')
  .option('--external-timeout-ms <ms>', 'External URL timeout (ms)', '10000')
  .action(async (directory, options) => {
    const checker = new LinkChecker();
    
    try {
      const report = await checker.checkDirectory(directory, {
        pattern: options.pattern,
        ignore: options.ignore,
        checkExternal: options.external,
        externalTimeoutMs: parseInt(options.externalTimeoutMs, 10)
      });
      
      if (options.output) {
        await checker.saveReport(report, options.output);
      }
      
      // 終了コード
      process.exit(report.summary.success ? 0 : 1);
      
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();

export { LinkChecker };
