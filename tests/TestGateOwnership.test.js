import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const { scripts } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const legacyFiles = ['DiagnosticTool', 'ErrorHandler', 'MobileOptimizer', 'navigation']
  .map(name => `tests/${name}.test.js`);
const rootFiles = (await fs.readdir(path.join(root, 'tests')))
  .filter(name => name.endsWith('.test.js')).map(name => `tests/${name}`).sort();
const parallelPrefix = 'node --test --test-concurrency=1 ';

// Deliberately finite package-script grammar. A new execution mode needs an
// explicit ownership update, not a regex that silently ignores shell operators.
function checkOwnership(commands, files) {
  const parts = commands.test.split(' && ');
  assert.equal(parts.length, 3);
  assert(parts[0].startsWith(parallelPrefix));
  assert.equal(parts[1], 'node tests/GitHubPagesHandler.test.js');
  assert.equal(parts[2], 'npm run test:legacy');
  assert.equal(commands['test:legacy'], legacyFiles.map(file => `node ${file}`).join(' && '));
  const standard = parts[0].slice(parallelPrefix.length).split(' ');
  for (const file of standard) assert.match(file, /^tests\/[A-Za-z0-9-]+\.test\.js$/);
  const owned = [...standard, 'tests/GitHubPagesHandler.test.js', ...legacyFiles];
  assert.equal(new Set(owned).size, owned.length, 'each test file must have one owner');
  assert.deepEqual(owned.sort(), [...files].sort(), 'unowned or stale root test file');
}

test('all root *.test.js files have exactly one standard, Pages or legacy gate', () => {
  checkOwnership(scripts, rootFiles);
});

const mutations = [
  ['unregistered file', commands => commands, [...rootFiles, 'tests/Unregistered.test.js']],
  ['missing suite', commands => ({ ...commands, test: commands.test.replace('tests/BookGenerator.test.js ', '') })],
  ['duplicate suite', commands => ({ ...commands, test: commands.test.replace(parallelPrefix, `${parallelPrefix}tests/BookGenerator.test.js `) })],
  ['stale registered path', commands => ({ ...commands, test: commands.test.replace('tests/BookGenerator.test.js', 'tests/Absent.test.js') })],
  ['legacy gate detached', commands => ({ ...commands, test: commands.test.replace(' && npm run test:legacy', '') })],
  ['legacy failure ignored', commands => ({ ...commands, 'test:legacy': `${commands['test:legacy']} || true` })],
  ['legacy suite omitted', commands => ({ ...commands, 'test:legacy': commands['test:legacy'].split(' && ').slice(1).join(' && ') })],
  ['legacy concurrent execution', commands => ({ ...commands, 'test:legacy': commands['test:legacy'].replace(' && ', ' & ') })],
  ['test name filter', commands => ({ ...commands, test: commands.test.replace(parallelPrefix, `${parallelPrefix}--test-name-pattern=one `) })]
];
for (const [name, mutate, files = rootFiles] of mutations) {
  test(`ownership fails closed: ${name}`, () => {
    assert.throws(() => checkOwnership(mutate(scripts), files));
  });
}

// Execute the actual declared legacy command, with tiny node:test fixtures in
// place of runtime suites. Prove UTF-8 output, every assertion, failing status
// and && short-circuit behavior, not just the appearance of filenames.
for (const failingFile of [null, ...legacyFiles]) {
  test(`direct legacy gate propagates ${failingFile ?? 'success of all four files'}`, async () => {
    checkOwnership(scripts, rootFiles);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-gate-test-'));
    try {
      await fs.mkdir(path.join(dir, 'tests'));
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      for (const file of legacyFiles) {
        await fs.writeFile(path.join(dir, file), [
          'import test from \'node:test\';',
          'import assert from \'node:assert/strict\';',
          `test('fixture', () => { console.log('実行済み 📚 ${file}'); assert.equal(${file === failingFile}, false); });`
        ].join('\n'));
      }
      const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
      // The fixture must be a standalone node:test process, not a nested worker
      // that inherits this inventory suite's test-runner reporting protocol.
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(scripts['test:legacy'], {
        cwd: dir, env, shell: true, encoding: 'utf8', timeout: 30000
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, failingFile ? 1 : 0, result.stdout + result.stderr);
      const count = failingFile ? legacyFiles.indexOf(failingFile) + 1 : legacyFiles.length;
      for (let i = 0; i < legacyFiles.length; i++) {
        assert.equal(result.stdout.includes(`実行済み 📚 ${legacyFiles[i]}`), i < count);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
