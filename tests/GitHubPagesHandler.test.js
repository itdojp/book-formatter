import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { GitHubPagesHandler } from '../src/GitHubPagesHandler.js';

describe('GitHubPagesHandler', () => {
  let gitHubPagesHandler;
  let errorHandler;
  let testDir;

  beforeEach(async () => {
    // Create mock error handler
    errorHandler = {
      safeExecute: async (fn) => await fn()
    };
    
    gitHubPagesHandler = new GitHubPagesHandler(errorHandler);
    
    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-pages-test-'));
  });

  afterEach(async () => {
    // Clean up test directory
    if (testDir && await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('setupGitHubPages', () => {
    it('should create essential GitHub Pages files', async () => {
      const config = {
        title: 'Test Book',
        description: 'Test Description',
        author: 'Test Author',
        deployment: {
          platform: 'github-pages',
          method: 'branch'
        }
      };

      await gitHubPagesHandler.setupGitHubPages(config, testDir);

      // Check if essential files are created
      assert(await fs.pathExists(path.join(testDir, '.nojekyll')));
      assert(await fs.pathExists(path.join(testDir, 'Gemfile')));
      assert(await fs.pathExists(path.join(testDir, '404.html')));
      assert(await fs.pathExists(path.join(testDir, 'robots.txt')));
    });

    it('should create CNAME file for custom domain', async () => {
      const config = {
        title: 'Test Book',
        deployment: {
          platform: 'github-pages',
          customDomain: 'example.com'
        }
      };

      await gitHubPagesHandler.setupGitHubPages(config, testDir);

      const cnamePath = path.join(testDir, 'CNAME');
      assert(await fs.pathExists(cnamePath));
      
      const cnameContent = await fs.readFile(cnamePath, 'utf8');
      assert.strictEqual(cnameContent, 'example.com');
    });

    it('should create GitHub Actions workflow for actions deployment', async () => {
      const config = {
        title: 'Test Book',
        deployment: {
          platform: 'github-pages',
          method: 'actions'
        }
      };

      await gitHubPagesHandler.setupGitHubPages(config, testDir);

      const workflowPath = path.join(testDir, '.github', 'workflows', 'deploy-pages.yml');
      assert(await fs.pathExists(workflowPath));
      
      const workflowContent = await fs.readFile(workflowPath, 'utf8');
      assert(workflowContent.includes('Deploy to GitHub Pages'));
      assert(workflowContent.includes('actions/deploy-pages@v4'));
    });
  });

  describe('enhanceJekyllConfig', () => {
    it('should generate enhanced Jekyll configuration', () => {
      const config = {
        title: 'Test Book',
        description: 'Test Description',
        author: 'Test Author',
        language: 'ja',
        repository: {
          owner: 'testuser',
          name: 'test-repo',
          url: 'https://github.com/testuser/test-repo'
        },
        deployment: {
          platform: 'github-pages'
        }
      };

      const jekyllConfig = gitHubPagesHandler.enhanceJekyllConfig(config);

      assert.strictEqual(jekyllConfig.title, 'Test Book');
      assert.strictEqual(jekyllConfig.url, 'https://testuser.github.io');
      assert.strictEqual(jekyllConfig.baseurl, '/test-repo');
      assert.strictEqual(jekyllConfig.repository, 'testuser/test-repo');
      assert(jekyllConfig.plugins.includes('jekyll-sitemap'));
      assert(jekyllConfig.plugins.includes('jekyll-seo-tag'));
      assert.strictEqual(jekyllConfig.lang, 'ja');
    });

    it('should handle custom domain configuration', () => {
      const config = {
        title: 'Test Book',
        repository: {
          owner: 'testuser',
          name: 'test-repo'
        },
        deployment: {
          platform: 'github-pages',
          customDomain: 'example.com'
        }
      };

      const jekyllConfig = gitHubPagesHandler.enhanceJekyllConfig(config);

      assert.strictEqual(jekyllConfig.url, 'https://example.com');
      assert.strictEqual(jekyllConfig.baseurl, '');
    });
  });

  describe('validateGitHubPagesCompatibility', () => {
    it('should validate GitHub Pages compatibility', async () => {
      const config = {
        title: 'Test Book',
        repository: {
          owner: 'testuser',
          name: 'test-repo'
        },
        deployment: {
          platform: 'github-pages',
          method: 'branch'
        }
      };

      // Create some test files
      await fs.writeFile(path.join(testDir, '.nojekyll'), '');
      await fs.writeFile(path.join(testDir, 'Gemfile'), 'gem "github-pages"');

      const validation = await gitHubPagesHandler.validateGitHubPagesCompatibility(config, testDir);

      assert.strictEqual(typeof validation.isValid, 'boolean');
      assert(Array.isArray(validation.errors));
      assert(Array.isArray(validation.warnings));
      assert(Array.isArray(validation.suggestions));
    });

    it('should detect missing essential files', async () => {
      const config = {
        title: 'Test Book',
        deployment: {
          platform: 'github-pages'
        }
      };

      const validation = await gitHubPagesHandler.validateGitHubPagesCompatibility(config, testDir);

      assert(validation.warnings.some(w => w.includes('.nojekyll')));
      assert(validation.warnings.some(w => w.includes('Gemfile')));
    });
  });

  describe('generateNoJekyllFile', () => {
    it('should create .nojekyll file', async () => {
      await gitHubPagesHandler.generateNoJekyllFile(testDir);

      const nojekyllPath = path.join(testDir, '.nojekyll');
      assert(await fs.pathExists(nojekyllPath));
      
      const content = await fs.readFile(nojekyllPath, 'utf8');
      assert.strictEqual(content, '');
    });
  });

  describe('generateGemfile', () => {
    it('should create Gemfile with GitHub Pages gem', async () => {
      await gitHubPagesHandler.generateGemfile(testDir, {});

      const gemfilePath = path.join(testDir, 'Gemfile');
      assert(await fs.pathExists(gemfilePath));
      
      const content = await fs.readFile(gemfilePath, 'utf8');
      assert(content.includes('gem "github-pages"'));
      assert(content.includes('jekyll-feed'));
      assert(content.includes('jekyll-sitemap'));
    });
  });

  describe('generate404Page', () => {
    it('should create custom 404 page', async () => {
      const config = {
        title: 'Test Book',
        description: 'Test Description',
        author: 'Test Author'
      };

      await gitHubPagesHandler.generate404Page(config, testDir);

      const page404Path = path.join(testDir, '404.html');
      assert(await fs.pathExists(page404Path));
      
      const content = await fs.readFile(page404Path, 'utf8');
      assert(content.includes('404 - ページが見つかりません'));
      assert(content.includes('Test Book'));
      assert(content.includes('Test Author'));
    });
  });

  describe('generateRobotsTxt', () => {
    it('should create robots.txt file', async () => {
      const config = {
        repository: {
          owner: 'testuser',
          name: 'test-repo'
        }
      };

      await gitHubPagesHandler.generateRobotsTxt(config, testDir);

      const robotsPath = path.join(testDir, 'robots.txt');
      assert(await fs.pathExists(robotsPath));
      
      const content = await fs.readFile(robotsPath, 'utf8');
      assert(content.includes('User-agent: *'));
      assert(content.includes('Allow: /'));
      assert(content.includes('Sitemap:'));
    });
  });

  describe('checkFileSizes', () => {
    it('should check file sizes in directory', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'small.txt'), 'small file');
      await fs.writeFile(path.join(testDir, 'large.txt'), 'x'.repeat(1000));

      const files = await gitHubPagesHandler.checkFileSizes(testDir);

      assert(Array.isArray(files));
      assert(files.length >= 2);
      assert(files.some(f => f.name === 'small.txt'));
      assert(files.some(f => f.name === 'large.txt'));
      assert(files.every(f => typeof f.size === 'number'));
    });
  });

  describe('checkLiquidConflicts', () => {
    it('should detect Liquid syntax conflicts', async () => {
      // Create file with Liquid syntax
      await fs.writeFile(
        path.join(testDir, 'test.md'), 
        'This has {{ variable }} and {% tag %} syntax'
      );
      
      await fs.writeFile(
        path.join(testDir, 'clean.md'), 
        'This is clean markdown content'
      );

      const conflicts = await gitHubPagesHandler.checkLiquidConflicts(testDir);

      assert(Array.isArray(conflicts));
      assert(conflicts.includes('test.md'));
      assert(!conflicts.includes('clean.md'));
    });
  });
});