import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import fs from 'fs-extra';
import YAML from 'yaml';

import { AdapterBuildError, buildStandardBookAdapter } from '../src/AdapterBuild.js';
import { AdapterSafeIOError } from '../src/AdapterSafeIO.js';
import { loadPrintProfiles, PRINT_PLAN_VERSION } from '../src/PrintPublicationPlan.js';

const ROOT = process.cwd();
const directories = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(ROOT, 'tests/tmp-print-plan-'));
  directories.push(root);
  const book = path.join(root, 'book');
  await fs.copy(path.join(ROOT, 'examples/standard-book'), book);
  return { root, book, outputRoot: path.join(root, 'dist') };
}
async function editMetadata(book, mutate) {
  const file = path.join(book, 'book.yaml');
  const data = YAML.parse(await fs.readFile(file, 'utf8'));
  mutate(data);
  await fs.writeFile(file, YAML.stringify(data));
}
async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await fs.readdir(directory)).sort().map(async (name) =>
    [name, await fs.readFile(path.join(directory, name), 'utf8')]
  )));
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.remove(directory)));
});

describe('PrintPublicationPlan', () => {
  test('three finite profiles and non-network CSS candidates', async () => {
    const profiles = await loadPrintProfiles();
    assert.equal(PRINT_PLAN_VERSION, 1);
    assert.deepEqual(profiles.map((profile) => profile.id), ['screen-pdf', 'print-pdf', 'epub']);
    assert.deepEqual(await loadPrintProfiles(), profiles);
    for (const profile of profiles) {
      const css = await fs.readFile(path.join(ROOT, profile.stylesheet), 'utf8');
      assert.doesNotMatch(css, /@import|url\(/iu);
      assert.match(css, /overflow-wrap/);
    }
    const epub = await fs.readFile(path.join(ROOT, 'shared/print/epub.css'), 'utf8');
    assert.doesNotMatch(epub, /@page|font-size:\s*\d+px/iu);
  });

  for (const invalid of [null, {}, { schema_version: 2 }, { schema_version: 1, profiles: [null] },
    { schema_version: 1, profiles: [] }]) {
    test(`rejects malformed profile registry ${JSON.stringify(invalid)}`, async () => {
      const original = fs.readJson;
      fs.readJson = async () => invalid;
      try { await assert.rejects(loadPrintProfiles(), AdapterSafeIOError); }
      finally { fs.readJson = original; }
    });
  }

  for (const field of ['id', 'target', 'format', 'intended_file', 'stylesheet', 'layout', 'validation']) {
    for (const [kind, value] of [['missing', undefined], ['null', null], ['number', 7], ['empty', ''], ['blank', '  ']]) {
      test(`profile contract: ${field}/${kind} fails closed`, async () => {
        const profiles = await loadPrintProfiles();
        if (value === undefined) delete profiles[0][field];
        else profiles[0][field] = value;
        const original = fs.readJson;
        fs.readJson = async () => ({ schema_version: 1, profiles });
        try { await assert.rejects(loadPrintProfiles(), AdapterSafeIOError); }
        finally { fs.readJson = original; }
      });
    }
  }

  for (const [kind, mutate] of [
    ['unknown registry key', (data) => { data.extra = true; }],
    ['unknown profile key', (data) => { data.profiles[0].extra = true; }],
    ['wrong target', (data) => { data.profiles[0].target = 'kindle'; }],
    ['wrong format', (data) => { data.profiles[0].format = 'epub'; }],
    ['wrong stylesheet', (data) => { data.profiles[0].stylesheet = '../foreign.css'; }],
    ['wrong intended filename', (data) => { data.profiles[0].intended_file = '../foreign.pdf'; }]
  ]) {
    test(`profile contract: ${kind} fails closed`, async () => {
      const data = { schema_version: 1, profiles: await loadPrintProfiles() };
      mutate(data);
      const original = fs.readJson;
      fs.readJson = async () => data;
      try { await assert.rejects(loadPrintProfiles(), AdapterSafeIOError); }
      finally { fs.readJson = original; }
    });
  }

  for (const target of ['pdf', 'kindle']) {
    test(`profile contract: ${target} refuses a missing profile field before output`, async () => {
      const { book, outputRoot } = await fixture();
      const original = fs.readJson;
      fs.readJson = async (...args) => {
        const data = await original(...args);
        if (String(args[0]).endsWith('shared/print/profiles.json')) {
          delete data.profiles.find((profile) => profile.target === target).layout;
        }
        return data;
      };
      try {
        await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot }),
          (error) => error instanceof AdapterBuildError && /Invalid finite print/.test(error.message));
      } finally { fs.readJson = original; }
      assert.equal(await fs.pathExists(outputRoot), false);
    });
  }

  for (const target of ['pdf', 'kindle']) {
    for (const editionId of ['free', 'paid']) {
      test(`${target}/${editionId}: deterministic plan, metadata, no actual artifact/body`, async () => {
        const { book, outputRoot } = await fixture();
        const before = await fs.readFile(path.join(book, 'book.yaml'), 'utf8');
        const args = { bookDirectory: book, target, editionId, outputRoot };
        const dry = await buildStandardBookAdapter({ ...args, dryRun: true });
        assert.equal(dry.written, false);
        assert.equal(await fs.pathExists(outputRoot), false);
        const result = await buildStandardBookAdapter(args);
        assert.deepEqual(result.manifest, dry.manifest);
        const first = await snapshot(result.outputDirectory);
        await buildStandardBookAdapter(args);
        assert.deepEqual(await snapshot(result.outputDirectory), first);
        assert.equal(await fs.readFile(path.join(book, 'book.yaml'), 'utf8'), before);
        const ids = target === 'pdf' ? ['screen-pdf', 'print-pdf'] : ['epub'];
        assert.deepEqual(Object.keys(first).sort(), ['manifest.json', 'publication-checklist.md',
          ...ids.map((id) => `${id}.placeholder.json`)].sort());
        assert.equal(result.manifest.adapter.implementation, 'skeleton');
        assert.equal(result.manifest.adapter.generated, false);
        assert.equal(result.manifest.adapter.ready_for_distribution, false);
        assert.equal(result.manifest.visibility.safe, true);
        const metadata = YAML.parse(before);
        for (const id of ids) {
          const plan = JSON.parse(first[`${id}.placeholder.json`]);
          assert.equal(plan.plan_version, 1);
          assert.equal(plan.status, 'plan-only');
          assert.equal(plan.generated, false);
          assert.equal(plan.ready_for_distribution, false);
          assert.equal(plan.artifact_visibility, 'not-run');
          assert.equal(plan.render_validation, 'not-run');
          assert.equal(plan.renderer, null);
          assert.equal(plan.artifact_sha256, null);
          assert.equal(plan.colophon.copyright_statement, null);
          assert.equal(plan.colophon.cover_source, null);
          assert.equal(plan.colophon.publication_identifier, null);
          assert.equal(plan.colophon.publication_date, null);
          assert.equal(plan.colophon.rights_approval, 'pending');
          assert.equal(plan.colophon.title, metadata.title);
          assert.deepEqual(plan.colophon.authors, metadata.authors.map((author) => author.name));
          assert.equal(plan.colophon.publisher, metadata.publisher.name);
          assert.equal(plan.colophon.declared_license, metadata.license);
          assert.equal(plan.edition.id, editionId);
          assert.equal(await fs.pathExists(path.join(result.outputDirectory, plan.profile.intended_file)), false);
        }
        const contents = Object.values(first).join('\n');
        assert.ok(!contents.includes(book));
        assert.ok(!contents.includes('この範囲は内部向け候補です。'));
        assert.ok(!contents.includes('この範囲は有償edition候補です。'));
        assert.match(first['publication-checklist.md'], /PLAN ONLY/);
        assert.doesNotMatch(first['publication-checklist.md'], /- \[x\]/u);
        if (target === 'kindle') assert.match(first['publication-checklist.md'], /EPUBCheck[\s\S]*Kindle Previewer/);
      });
    }

    test(`${target}: unsafe edition rejected before any output`, async () => {
      const { book, outputRoot } = await fixture();
      await editMetadata(book, (data) => data.editions.find((edition) => edition.id === 'free').documents.push('afterword'));
      await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'free', outputRoot }), /Visibility check failed/);
      assert.equal(await fs.pathExists(outputRoot), false);
    });

    test(`${target}: unknown output is preserved, source overlap is rejected`, async () => {
      const { book, outputRoot } = await fixture();
      const file = path.join(outputRoot, target, 'keep.txt');
      await fs.outputFile(file, 'owned elsewhere');
      await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot }), /without a valid adapter manifest/);
      assert.equal(await fs.readFile(file, 'utf8'), 'owned elsewhere');
      await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot: path.join(book, 'manuscript') }), /must not be inside source/);
    });

    test(`${target}: old skeleton replacement preserves sibling outputs`, async () => {
      const { book, outputRoot } = await fixture();
      await fs.outputJson(path.join(outputRoot, target, 'manifest.json'), {
        kind: 'book-formatter.adapter-build', adapter: { target, implementation: 'skeleton' }
      });
      await fs.outputFile(path.join(outputRoot, 'keep.txt'), 'sibling');
      await buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot });
      assert.equal(await fs.readFile(path.join(outputRoot, 'keep.txt'), 'utf8'), 'sibling');
      assert.deepEqual((await fs.readdir(outputRoot)).sort(), ['keep.txt', target].sort());
    });

    test(`${target}: metadata mutation after profile load rejects commit without residue`, async () => {
      const { book, outputRoot } = await fixture();
      const original = fs.readJson;
      let injected = false;
      fs.readJson = async (...args) => {
        const data = await original(...args);
        if (String(args[0]).endsWith('shared/print/profiles.json') && !injected) {
          injected = true;
          await editMetadata(book, (metadata) => { metadata.version = '0.2.0'; });
        }
        return data;
      };
      try {
        await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot }), AdapterBuildError);
      } finally { fs.readJson = original; }
      assert.equal(injected, true);
      assert.deepEqual(await fs.readdir(outputRoot), []);
    });

    test(`${target}: symbolic output path is rejected`, async (context) => {
      if (process.platform === 'win32') return context.skip('symlink permissions are platform-dependent');
      const { root, book, outputRoot } = await fixture();
      await fs.ensureDir(outputRoot);
      const other = path.join(root, 'other');
      await fs.ensureDir(other);
      await fs.symlink(other, path.join(outputRoot, target));
      await assert.rejects(buildStandardBookAdapter({ bookDirectory: book, target, editionId: 'paid', outputRoot }), /symbolic links/);
      assert.deepEqual(await fs.readdir(other), []);
    });
  }

  test('metadata does not become checklist Markdown and CLI output is explicitly a plan', async () => {
    const { book, outputRoot } = await fixture();
    await editMetadata(book, (metadata) => { metadata.title = 'Literal [x](https://publisher.example/) <b>title</b>'; });
    const run = spawnSync(process.execPath, ['src/index.js', 'build', '--book', book, '--target', 'kindle', '--edition', 'paid', '--out-dir', outputRoot], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(run.stdout);
    assert.equal(manifest.adapter.project_format, 'publication-plan-v1');
    const files = await snapshot(path.join(outputRoot, 'kindle'));
    assert.ok(!files['publication-checklist.md'].includes('publisher.example'));
    assert.match(JSON.parse(files['epub.placeholder.json']).colophon.title, /Literal/);
  });
});
