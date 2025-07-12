import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { DiagnosticTool } from '../src/DiagnosticTool.js';

describe('DiagnosticTool', () => {
  let diagnosticTool;
  let testDir;

  beforeEach(async () => {
    diagnosticTool = new DiagnosticTool();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-test-'));
  });

  afterEach(async () => {
    if (testDir && await fs.pathExists(testDir)) {
      await fs.remove(testDir);
    }
  });

  describe('runDiagnostics', () => {
    it('should run all diagnostic checks', async () => {
      // Create a minimal project structure
      await fs.ensureDir(path.join(testDir, 'src'));
      await fs.ensureDir(path.join(testDir, 'tests'));
      await fs.ensureDir(path.join(testDir, 'shared'));
      
      await fs.writeJson(path.join(testDir, 'package.json'), {
        name: 'test-project',
        version: '1.0.0',
        description: 'Test project',
        scripts: {
          test: 'node --test',
          build: 'echo build'
        },
        dependencies: {
          'fs-extra': '^11.0.0',
          'yaml': '^2.0.0'
        }
      });

      const results = await diagnosticTool.runDiagnostics(testDir);

      assert(typeof results === 'object');
      assert(typeof results.passed === 'number');
      assert(typeof results.warnings === 'number');
      assert(typeof results.errors === 'number');
      assert(typeof results.criticalErrors === 'number');
      assert(Array.isArray(results.details));
    });

    it('should detect missing directories', async () => {
      // Create minimal package.json only
      await fs.writeJson(path.join(testDir, 'package.json'), {
        name: 'test-project'
      });

      const results = await diagnosticTool.runDiagnostics(testDir);

      // Should have errors for missing src, tests, shared directories
      const dirErrors = results.details.filter(d => 
        d.type === 'error' && d.check.includes('ディレクトリ')
      );
      
      assert(dirErrors.length > 0);
    });

    it('should validate package.json content', async () => {
      await fs.writeJson(path.join(testDir, 'package.json'), {
        // Missing required fields
      });

      const results = await diagnosticTool.runDiagnostics(testDir);

      // Should have warnings for missing package.json fields
      const packageWarnings = results.details.filter(d => 
        d.check.includes('package.json')
      );
      
      assert(packageWarnings.length > 0);
    });
  });

  describe('addResult', () => {
    it('should add pass results correctly', () => {
      diagnosticTool.addResult('pass', 'Test Check', 'Test message');

      assert.strictEqual(diagnosticTool.results.passed, 1);
      assert.strictEqual(diagnosticTool.results.details.length, 1);
      
      const result = diagnosticTool.results.details[0];
      assert.strictEqual(result.type, 'pass');
      assert.strictEqual(result.check, 'Test Check');
      assert.strictEqual(result.message, 'Test message');
    });

    it('should add warning results correctly', () => {
      diagnosticTool.addResult('warning', 'Warning Check', 'Warning message');

      assert.strictEqual(diagnosticTool.results.warnings, 1);
      assert.strictEqual(diagnosticTool.results.details.length, 1);
    });

    it('should add error results correctly', () => {
      diagnosticTool.addResult('error', 'Error Check', 'Error message');

      assert.strictEqual(diagnosticTool.results.errors, 1);
      assert.strictEqual(diagnosticTool.results.details.length, 1);
    });

    it('should add critical error results correctly', () => {
      diagnosticTool.addResult('critical', 'Critical Check', 'Critical message');

      assert.strictEqual(diagnosticTool.results.criticalErrors, 1);
      assert.strictEqual(diagnosticTool.results.details.length, 1);
    });

    it('should include timestamp in results', () => {
      const beforeTime = new Date().toISOString();
      diagnosticTool.addResult('pass', 'Test', 'Test');
      const afterTime = new Date().toISOString();

      const result = diagnosticTool.results.details[0];
      assert(result.timestamp >= beforeTime);
      assert(result.timestamp <= afterTime);
    });
  });

  describe('calculateDirectorySize', () => {
    it('should calculate directory size', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'hello');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'world');
      
      const subDir = path.join(testDir, 'subdir');
      await fs.ensureDir(subDir);
      await fs.writeFile(path.join(subDir, 'file3.txt'), 'test');

      const size = await diagnosticTool.calculateDirectorySize(testDir);

      assert(typeof size === 'number');
      assert(size > 0);
      // Should be approximately 13 bytes (5 + 5 + 4)
      assert(size >= 13);
    });

    it('should skip node_modules and .git directories', async () => {
      // Create test files in regular directory
      await fs.writeFile(path.join(testDir, 'regular.txt'), 'content');
      
      // Create node_modules with large file
      const nodeModulesDir = path.join(testDir, 'node_modules');
      await fs.ensureDir(nodeModulesDir);
      await fs.writeFile(path.join(nodeModulesDir, 'large.txt'), 'x'.repeat(1000));
      
      // Create .git with large file
      const gitDir = path.join(testDir, '.git');
      await fs.ensureDir(gitDir);
      await fs.writeFile(path.join(gitDir, 'large.txt'), 'x'.repeat(1000));

      const size = await diagnosticTool.calculateDirectorySize(testDir);

      // Should only count the regular file, not node_modules or .git
      assert(size < 50); // Much smaller than if it included large files
    });
  });

  describe('countFiles', () => {
    it('should count files correctly', async () => {
      // Create test files
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content');
      
      const subDir = path.join(testDir, 'subdir');
      await fs.ensureDir(subDir);
      await fs.writeFile(path.join(subDir, 'file3.txt'), 'content');

      const count = await diagnosticTool.countFiles(testDir);

      assert.strictEqual(count, 3);
    });

    it('should skip node_modules and .git directories', async () => {
      // Create regular files
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content');
      
      // Create files in node_modules
      const nodeModulesDir = path.join(testDir, 'node_modules');
      await fs.ensureDir(nodeModulesDir);
      await fs.writeFile(path.join(nodeModulesDir, 'module.js'), 'code');
      
      // Create files in .git
      const gitDir = path.join(testDir, '.git');
      await fs.ensureDir(gitDir);
      await fs.writeFile(path.join(gitDir, 'config'), 'config');

      const count = await diagnosticTool.countFiles(testDir);

      // Should only count the regular file
      assert.strictEqual(count, 1);
    });
  });

  describe('exportResults', () => {
    it('should export results to JSON file', async () => {
      // Add some test results
      diagnosticTool.addResult('pass', 'Test 1', 'Passed');
      diagnosticTool.addResult('warning', 'Test 2', 'Warning');
      diagnosticTool.addResult('error', 'Test 3', 'Error');

      const outputPath = path.join(testDir, 'results.json');
      await diagnosticTool.exportResults(outputPath);

      // Check if file was created
      assert(await fs.pathExists(outputPath));

      // Check file content
      const exportedData = await fs.readJson(outputPath);
      
      assert.strictEqual(exportedData.passed, 1);
      assert.strictEqual(exportedData.warnings, 1);
      assert.strictEqual(exportedData.errors, 1);
      assert.strictEqual(exportedData.details.length, 3);
      
      // Check metadata
      assert(exportedData.metadata);
      assert(exportedData.metadata.timestamp);
      assert(exportedData.metadata.platform);
      assert(exportedData.metadata.nodeVersion);
      assert(exportedData.metadata.projectPath);
    });
  });

  describe('checkSystemEnvironment', () => {
    it('should check system environment', async () => {
      await diagnosticTool.checkSystemEnvironment();

      const osResults = diagnosticTool.results.details.filter(d => 
        d.check === 'オペレーティングシステム'
      );
      
      assert.strictEqual(osResults.length, 1);
      assert.strictEqual(osResults[0].type, 'info');

      const memoryResults = diagnosticTool.results.details.filter(d => 
        d.check === 'メモリ使用量'
      );
      
      assert.strictEqual(memoryResults.length, 1);
      assert(['pass', 'warning'].includes(memoryResults[0].type));
    });
  });

  describe('checkNodeEnvironment', () => {
    it('should check Node.js environment', async () => {
      await diagnosticTool.checkNodeEnvironment();

      const nodeResults = diagnosticTool.results.details.filter(d => 
        d.check === 'Node.jsバージョン'
      );
      
      assert.strictEqual(nodeResults.length, 1);
      assert(['pass', 'warning', 'error'].includes(nodeResults[0].type));

      const npmResults = diagnosticTool.results.details.filter(d => 
        d.check === 'npmバージョン'
      );
      
      assert.strictEqual(npmResults.length, 1);
      assert(['pass', 'warning'].includes(npmResults[0].type));
    });
  });

  describe('generateSummary', () => {
    it('should generate summary correctly', () => {
      // Add test results
      diagnosticTool.addResult('pass', 'Test 1', 'Passed');
      diagnosticTool.addResult('pass', 'Test 2', 'Passed');
      diagnosticTool.addResult('warning', 'Test 3', 'Warning');
      diagnosticTool.addResult('error', 'Test 4', 'Error');

      // Capture console output (in a real test, you might want to mock console)
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      diagnosticTool.generateSummary();

      console.log = originalLog;

      // Check if summary was logged
      const summaryLogs = logs.join('\n');
      assert(summaryLogs.includes('合格: 2件'));
      assert(summaryLogs.includes('警告: 1件'));
      assert(summaryLogs.includes('エラー: 1件'));
      assert(summaryLogs.includes('ヘルススコア: 50.0%'));
    });
  });
});