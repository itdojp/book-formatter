import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FORMATTER_ROOT, detectDiagnosticTarget, isDiagnosticEntryPoint, matchesNodeEngine, parseDiagnosticArguments, requireDiagnosticFile } from '../src/DiagnosticContracts.js';
import { TroubleshootingTool } from '../scripts/troubleshoot.js';
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
        name: 'book-formatter',
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
        name: 'book-formatter'
      });

      const results = await diagnosticTool.runDiagnostics(testDir);

      // Should have errors for missing src, tests, shared directories
      const dirErrors = results.details.filter(d => 
        d.type === 'error' && d.check.includes('ディレクトリ')
      );
      
      assert(dirErrors.length > 0);
    });

    it('rejects empty package metadata as an unknown target', async () => {
      await fs.writeJson(path.join(testDir, 'package.json'), {
        // No formatter identity or book metadata.
      });

      const results = await diagnosticTool.runDiagnostics(testDir);

      const targetErrors = results.details.filter(d =>
        d.type === 'error' && d.check === '診断対象の判定' &&
        d.message.includes('診断対象の形式を判定できません')
      );

      assert.strictEqual(targetErrors.length, 1);
    });
  });

  describe('target and engine contracts (#167)', () => {
    const legacy = async (prefix = '', root = testDir) => {
      await fs.ensureDir(root);
      await fs.writeJson(path.join(root, 'book-config.json'), {
        title: '合成書籍', description: '診断 fixture', author: 'Fixture'
      });
      for (const file of ['_config.yml', 'index.md', '_layouts/default.html',
        '_includes/page-navigation.html', 'assets/css/main.css']) {
        await fs.outputFile(path.join(root, prefix, file), 'fixture');
      }
    };
    const run = args => spawnSync(process.execPath, args, {
      cwd: testDir, encoding: 'utf8', timeout: 30000
    });
    const script = name => path.join(FORMATTER_ROOT, 'scripts', `${name}.js`);

    it('matches every supported minimum and excluded major against live engines', async () => {
      const { engines } = await fs.readJson(path.join(FORMATTER_ROOT, 'package.json'));
      for (const [version, expected] of [
        ['v18.20.8', false], ['20.18.99', false], ['20.19.0', true], ['20.99.9', true],
        ['21.9.0', false], ['22.12.99', false], ['22.13.0', true], ['22.99.0', true],
        ['23.9.9', false], ['24.0.0', true], ['25.0.0', true], ['30.1.0', true],
        ['24.0.0-rc.1', false], ['24.0', false], ['024.0.0', false], ['', false]
      ]) assert.strictEqual(matchesNodeEngine(version, engines.node), expected, version);
      assert.strictEqual(matchesNodeEngine('22.13.0', '^22.14.0'), false);
      assert.strictEqual(matchesNodeEngine('22.14.0', '^22.14.0'), true);
      for (const range of [null, '', '>=24.0.0 || *', '^0.2.3', '^22', '>=24.00.0', '>=9007199254740992.0.0']) {
        assert.throws(() => matchesNodeEngine('24.1.0', range), /engines\.node.*(?:文字列|条件)/);
      }
    });

    it('rejects unsupported Node in the actual diagnostic API', async () => {
      await diagnosticTool.checkNodeEnvironment('v22.12.0');
      assert.strictEqual(diagnosticTool.results.details.find(row => row.check === 'Node.jsバージョン').type, 'error');
    });

    it('validates standard source without demanding formatter directories or dependencies', async () => {
      await fs.copy(path.join(FORMATTER_ROOT, 'examples/standard-book'), testDir);
      const result = await diagnosticTool.runDiagnostics(testDir);
      assert.strictEqual(diagnosticTool.target.kind, 'standard');
      assert.strictEqual(result.errors + result.criticalErrors, 0);
      assert(!result.details.some(row => /node_modules|ディレクトリ tests|ディレクトリ shared/.test(row.check)));
      await diagnosticTool.exportResults(path.join(testDir, 'result.json'));
      const { metadata } = await fs.readJson(path.join(testDir, 'result.json'));
      assert.strictEqual(metadata.projectPath, testDir);
      assert.strictEqual(metadata.targetKind, 'standard');
    });

    it('rejects invalid standard metadata without legacy fallback', async () => {
      await fs.writeFile(path.join(testDir, 'book.yaml'), 'schema_version: 9000');
      const result = await diagnosticTool.runDiagnostics(testDir);
      assert(result.errors > 0);
      assert.strictEqual(diagnosticTool.target.kind, 'standard');
    });

    for (const prefix of ['', 'docs/']) {
      it(`validates generated legacy projection at ${prefix || 'root'}`, async () => {
        await legacy(prefix);
        const result = await diagnosticTool.runDiagnostics(testDir);
        assert.strictEqual(result.errors + result.criticalErrors, 0);
        assert.strictEqual(diagnosticTool.target.kind, 'legacy');
        assert(!result.details.some(row => row.check.includes('shared/templates')));
        await fs.remove(path.join(testDir, prefix, '_layouts/default.html'));
        const missing = await diagnosticTool.runDiagnostics(testDir);
        assert(missing.details.some(row => row.type === 'error' && row.check.includes('_layouts/default.html')));
      });
    }

    it('rejects unknown, malformed and ambiguous metadata without creating files', async () => {
      for (const fixture of [
        {}, { 'package.json': '{}' }, { 'package.json': '{' },
        { 'book.yaml': '', 'book-config.json': '{}' },
        { 'book.yaml': '', 'package.json': '{"name":"book-formatter"}' }
      ]) {
        await fs.emptyDir(testDir);
        for (const [file, content] of Object.entries(fixture)) await fs.writeFile(path.join(testDir, file), content);
        const result = await diagnosticTool.runDiagnostics(testDir);
        assert.strictEqual(diagnosticTool.target, null);
        assert(result.errors > 0);
        assert(result.details.some(row => row.type === 'error' && row.check === '診断対象の判定'));
        assert.deepStrictEqual((await fs.readdir(testDir)).sort(), Object.keys(fixture).sort());
      }
    });

    it('rejects obsolete legacy shape, missing/ambiguous projection and symlink resources', async () => {
      await legacy();
      await fs.writeJson(path.join(testDir, 'book-config.json'), { book: { title: 'old shape' } });
      assert((await diagnosticTool.runDiagnostics(testDir)).errors > 0);
      await legacy();
      await fs.remove(path.join(testDir, '_config.yml'));
      const missingProjection = await diagnosticTool.runDiagnostics(testDir);
      assert(missingProjection.errors > 0);
      assert(missingProjection.details.some(row => row.type === 'error' && row.message.includes('legacy 公開元を特定できません')));
      await legacy();
      await fs.outputFile(path.join(testDir, 'docs/_config.yml'), 'fixture');
      assert((await diagnosticTool.runDiagnostics(testDir)).errors > 0);
      await fs.remove(path.join(testDir, 'docs'));
      await fs.remove(path.join(testDir, '_layouts/default.html'));
      await fs.symlink(path.join(testDir, 'index.md'), path.join(testDir, '_layouts/default.html'));
      const symlinkResult = await diagnosticTool.runDiagnostics(testDir);
      assert(symlinkResult.errors > 0);
      assert(symlinkResult.details.some(row => row.message.includes('パス全体にシンボリックリンクを含まない通常ファイルが必要です')));
    });

    it('does not ignore dangling metadata symlinks', async () => {
      await fs.symlink(path.join(testDir, 'absent'), path.join(testDir, 'book.yaml'));
      await assert.rejects(async () => {
        const target = await detectDiagnosticTarget(testDir);
        await diagnosticTool.checkBookTarget(target);
        if (diagnosticTool.results.errors) throw new Error('invalid metadata');
      });
    });

    it('localizes missing file and directory diagnostics without exposing the target root', async () => {
      await fs.ensureDir(path.join(testDir, 'present'));
      for (const [relative, missing, kind] of [
        ['absent/file.txt', 'absent', 'ディレクトリ'],
        ['present/file.txt', 'present/file.txt', '通常ファイル']
      ]) {
        await assert.rejects(() => requireDiagnosticFile(testDir, relative), error => {
          assert.strictEqual(error.code, 'ENOENT');
          assert.strictEqual(error.message, `${missing}: 必要な${kind}が見つかりません`);
          assert(!error.message.includes(testDir));
          return true;
        });
      }
    });

    it('checks real formatter template resources, not phantom shared/templates', async () => {
      await diagnosticTool.checkTemplateFiles(FORMATTER_ROOT);
      assert.strictEqual(diagnosticTool.results.errors + diagnosticTool.results.warnings, 0);
      assert(!diagnosticTool.results.details.some(row => row.check.includes('templates/chapter.md')));
      const missing = new DiagnosticTool();
      await missing.checkTemplateFiles(testDir);
      assert(missing.results.errors > 0);
      assert(missing.results.details.some(row => row.type === 'error' && row.check.includes('shared/layouts/default.html')));
    });

    it('never borrows running built-ins or executes code from another formatter checkout', async () => {
      const own = new DiagnosticTool();
      await own.checkTemplateFiles(FORMATTER_ROOT);
      const resources = own.results.details.filter(row => row.check.startsWith('テンプレート '));
      for (const row of resources) {
        const relative = row.check.slice('テンプレート '.length);
        await fs.copy(path.join(FORMATTER_ROOT, relative), path.join(testDir, relative));
      }
      await fs.writeJson(path.join(testDir, 'package.json'), { name: 'book-formatter', type: 'module' });
      // Harmless execution sentinel, confined to this owned fixture directory.
      await fs.writeFile(path.join(testDir, 'src/TemplateEngine.js'), [
        'import fs from \'node:fs\';',
        'fs.writeFileSync(new URL(\'./executed.flag\', import.meta.url), \'unexpected\');',
        'export class TemplateEngine { getAvailableTemplates() { return []; } }'
      ].join('\n'));
      assert.strictEqual((await detectDiagnosticTarget(testDir)).kind, 'formatter');
      await diagnosticTool.checkTemplateFiles(testDir);
      assert(diagnosticTool.results.errors > 0, 'foreign built-ins must stay unverified');
      assert(!diagnosticTool.results.details.some(row => row.check.startsWith('組み込みテンプレート') && row.type === 'pass'));
      assert(!await fs.pathExists(path.join(testDir, 'src/executed.flag')));
      assert.strictEqual(await fs.readFile(path.join(testDir, 'src/TemplateEngine.js'), 'utf8'), [
        'import fs from \'node:fs\';',
        'fs.writeFileSync(new URL(\'./executed.flag\', import.meta.url), \'unexpected\');',
        'export class TemplateEngine { getAvailableTemplates() { return []; } }'
      ].join('\n'));
    });

    it('parses flags independently of path and fails closed on unknown/multiple arguments', () => {
      for (const args of [['--export'], ['.', '--export'], ['--export', '.']]) {
        const parsed = parseDiagnosticArguments(args, ['--export'], testDir);
        assert.strictEqual(parsed.projectPath, testDir);
        assert(parsed.flags.has('--export'));
      }
      assert.strictEqual(parseDiagnosticArguments(['--', '-literal'], [], testDir).projectPath, path.join(testDir, '-literal'));
      for (const args of [['--typo'], ['one', 'two'], ['--auto']]) {
        assert.throws(() => parseDiagnosticArguments(args, ['--export'], testDir), /未対応のオプション|プロジェクトパスは一つ/);
      }
    });

    it('diagnose --export uses cwd, reports actual target and preserves sources', async () => {
      await legacy();
      const child = run([script('diagnose'), '--export']);
      assert.strictEqual(child.status, 0, child.stdout + child.stderr);
      const report = await fs.readJson(path.join(testDir, 'diagnostic-results.json'));
      assert.strictEqual(report.metadata.projectPath, testDir);
      assert.strictEqual(report.metadata.targetKind, 'legacy');
      assert.strictEqual(await fs.readFile(path.join(testDir, 'index.md'), 'utf8'), 'fixture');
      assert(!await fs.pathExists(path.join(testDir, '--export')));
    });

    it('importing CLI exports never interprets the host process arguments', async () => {
      const importer = path.join(testDir, 'consumer.mjs');
      for (const [name, exported] of [['diagnose', 'runDiagnostics'], ['troubleshoot', 'TroubleshootingTool']]) {
        await fs.writeFile(importer, [
          `import * as api from ${JSON.stringify(pathToFileURL(script(name)).href)};`,
          `if (typeof api[${JSON.stringify(exported)}] !== 'function') throw new Error('missing export');`,
          'console.log(\'import-returned\');'
        ].join('\n'));
        for (const args of [[], ['--help'], ['-h'], ['--export'], ['--auto'], ['--', '--help']]) {
          const child = run([importer, ...args]);
          assert.strictEqual(child.status, 0, child.stdout + child.stderr);
          assert.strictEqual(child.stdout.trim(), 'import-returned');
          assert.strictEqual(child.stderr, '');
          assert.deepStrictEqual(await fs.readdir(testDir), ['consumer.mjs']);
        }
      }
    });

    it('direct CLI entrypoints display both help aliases without target writes', async () => {
      for (const name of ['diagnose', 'troubleshoot']) {
        for (const flag of ['--help', '-h']) {
          const child = run([script(name), flag]);
          assert.strictEqual(child.status, 0, child.stdout + child.stderr);
          assert(child.stdout.includes('使用方法'));
          assert.strictEqual(child.stderr, '');
          assert.deepStrictEqual(await fs.readdir(testDir), []);
        }
      }
    });

    it('direct CLI help handles escaped characters in the entrypoint file URL', async () => {
      const root = path.join(testDir, 'entry # space');
      await fs.ensureDir(path.join(root, 'scripts'));
      await fs.symlink(path.join(FORMATTER_ROOT, 'src'), path.join(root, 'src'), 'dir');
      // Do not rely on a node_modules ancestor outside the isolated fixture.
      await fs.symlink(path.join(FORMATTER_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
      for (const name of ['diagnose', 'troubleshoot']) {
        const entry = path.join(root, 'scripts', `${name}.mjs`);
        await fs.copy(script(name), entry);
        const child = run([entry, '--help']);
        assert.strictEqual(child.status, 0, child.stdout + child.stderr);
        assert(child.stdout.includes('使用方法'));
        assert.strictEqual(child.stderr, '');
      }
    });

    it('symlinked CLI entrypoints still display help without running diagnostics', async () => {
      for (const name of ['diagnose', 'troubleshoot']) {
        const entry = path.join(testDir, `${name}-link.mjs`);
        await fs.symlink(script(name), entry, 'file');
        for (const flag of ['--help', '-h']) {
          const child = run([entry, flag]);
          assert.strictEqual(child.status, 0, child.stdout + child.stderr);
          assert(child.stdout.includes('使用方法'));
          assert(!child.stdout.includes('📍 診断対象'));
          assert.strictEqual(child.stderr, '');
        }
        await fs.remove(entry);
        assert.deepStrictEqual(await fs.readdir(testDir), []);
      }
    });

    it('entrypoint detection tolerates hosts without a matching filesystem entry', () => {
      const url = pathToFileURL(script('diagnose')).href;
      assert.strictEqual(isDiagnosticEntryPoint(url, script('diagnose')), true);
      for (const entry of [undefined, null, '', '-e', testDir, path.join(testDir, 'missing')]) {
        assert.strictEqual(isDiagnosticEntryPoint(url, entry), false);
      }
      assert.strictEqual(isDiagnosticEntryPoint(url, script('troubleshoot')), false);
    });

    it('CLI respects -- before a literal help-shaped path', async () => {
      const literalRoot = path.join(testDir, '--help');
      await legacy('', literalRoot);
      const child = run([script('diagnose'), '--export', '--', '--help']);
      assert.strictEqual(child.status, 0, child.stdout + child.stderr);
      const { metadata } = await fs.readJson(path.join(literalRoot, 'diagnostic-results.json'));
      assert.strictEqual(metadata.projectPath, literalRoot);
      const help = run([script('diagnose'), '--help']);
      assert.strictEqual(help.status, 0);
      assert(help.stdout.includes('使用方法'));
      await fs.writeJson(path.join(literalRoot, 'book-config.json'), {});
      const troubleshooting = run([script('troubleshoot'), '--', '--help']);
      assert.strictEqual(troubleshooting.status, 1, troubleshooting.stdout + troubleshooting.stderr);
      assert(await fs.pathExists(path.join(literalRoot, 'troubleshooting-report.md')));
    });

    it('CLI invalid inputs return failure before reports or repair writes', async () => {
      for (const name of ['diagnose', 'troubleshoot']) {
        const child = run([script(name), '--unknown']);
        assert(child.status > 0, child.stderr);
        assert(child.stderr.includes('未対応のオプションです: --unknown'));
        assert.deepStrictEqual(await fs.readdir(testDir), []);
      }
    });

    it('troubleshoot rejects --auto on book and unknown targets before writes', async () => {
      for (const kind of ['unknown', 'legacy', 'standard']) {
        await fs.emptyDir(testDir);
        if (kind === 'legacy') await legacy();
        if (kind === 'standard') await fs.copy(path.join(FORMATTER_ROOT, 'examples/standard-book'), testDir);
        const before = (await fs.readdir(testDir)).sort();
        const child = run([script('troubleshoot'), '--auto']);
        assert(child.status > 0, child.stdout + child.stderr);
        if (kind !== 'unknown') assert(child.stderr.includes('--auto は実行中の formatter checkout 専用です'));
        assert.deepStrictEqual((await fs.readdir(testDir)).sort(), before);
        assert(!await fs.pathExists(path.join(testDir, 'node_modules')));
        const tool = new TroubleshootingTool();
        await assert.rejects(tool.autoFix([], testDir));
      }
    });

    it('allows --auto only for the running formatter, never another named checkout', async () => {
      const tool = new TroubleshootingTool();
      await tool.requireAutoFixTarget(FORMATTER_ROOT);
      await fs.writeJson(path.join(testDir, 'package.json'), { name: 'book-formatter' });
      await assert.rejects(tool.requireAutoFixTarget(testDir));
    });

    it('troubleshoot reports book validation errors without suggesting formatter repair', async () => {
      await fs.writeJson(path.join(testDir, 'book-config.json'), {});
      const child = run([script('troubleshoot')]);
      assert.strictEqual(child.status, 1, child.stdout + child.stderr);
      const report = await fs.readFile(path.join(testDir, 'troubleshooting-report.md'), 'utf8');
      assert(!/npm init|mkdir shared|npm update/.test(report));
      assert(report.includes('[formatter ドキュメント](https://github.com/itdojp/book-formatter/blob/main/README.md)'));
      assert(!report.includes('](./README.md)'));
      assert(!await fs.pathExists(path.join(testDir, 'package.json')));
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

      try {
        diagnosticTool.generateSummary();
      } finally {
        console.log = originalLog;
      }

      // Check if summary was logged
      const summaryLogs = logs.join('\n');
      assert(summaryLogs.includes('合格: 2件'));
      assert(summaryLogs.includes('警告: 1件'));
      assert(summaryLogs.includes('エラー: 1件'));
      assert(summaryLogs.includes('ヘルススコア: 50.0%'));
    });
  });
});
