import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import YAML from 'yaml';
import MarkdownIt from 'markdown-it';
import { parseFragment } from 'parse5';
import { unzipSync } from 'fflate';

import { buildStandardBookAdapter, AdapterBuildError } from '../src/AdapterBuild.js';
import { BOOTH_IMPLEMENTATION, BOOTH_PLAN_VERSION, validateBoothCommerce } from '../src/BoothPackage.js';
import { AdapterSafeIOError } from '../src/AdapterSafeIO.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const roots = [];
const configRelative = 'editions/booth.yaml';
async function fixture() {
  const root = await fs.mkdtemp(path.join(ROOT, 'tests/tmp-booth-'));
  roots.push(root);
  const book = path.join(root, 'book');
  await fs.copy(path.join(ROOT, 'examples/standard-book'), book);
  return { root, book, outputRoot: path.join(root, 'dist') };
}
const build = ({ book, outputRoot }, overrides = {}) => buildStandardBookAdapter({ bookDirectory: book, target: 'booth', editionId: 'paid', outputRoot, ...overrides });
async function update(book, file, mutate) {
  const p = path.join(book, file); const data = YAML.parse(await fs.readFile(p, 'utf8'), { uniqueKeys: true, maxAliasCount: 100 });
  mutate(data); await fs.writeFile(p, YAML.stringify(data));
}
async function snapshot(dir) {
  return Object.fromEntries(await Promise.all((await fs.readdir(dir)).sort().map(async (n) => [n, (await fs.readFile(path.join(dir, n))).toString('base64')])));
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { for (const root of roots.splice(0)) await fs.remove(root); });

describe('BOOTH plan-only package', () => {
  test('four docs + ZIP + manifest, deterministic repeat, visibility separation, no real artifacts', async () => {
    const f = await fixture();
    const sourceBefore = await snapshot(path.join(f.book, 'manuscript'));
    const first = await build(f); const output = first.outputDirectory;
    assert.equal(BOOTH_PLAN_VERSION, 1); assert.equal(first.manifest.adapter.implementation, BOOTH_IMPLEMENTATION);
    assert.equal(first.manifest.adapter.generated, false); assert.equal(first.manifest.adapter.ready_for_distribution, false);
    const zip = await fs.readFile(path.join(output, first.manifest.adapter.package_path));
    assert.equal(hash(zip), first.manifest.adapter.package_sha256);
    const files = unzipSync(zip);
    assert.deepEqual(Object.keys(files), ['CHANGELOG.md', 'README.txt', 'booth-package-manifest.yaml', 'product-description.md']);
    assert.deepEqual((await fs.readdir(output)).sort(), [...Object.keys(files), 'manifest.json', 'standard-book-example-0.1.0.zip'].sort());
    for (const [name, bytes] of Object.entries(files)) assert.deepEqual(Buffer.from(bytes), await fs.readFile(path.join(output, name)));
    const plan = YAML.parse(Buffer.from(files['booth-package-manifest.yaml']).toString());
    assert.equal(plan.commerce.price, 500); assert.equal(plan.commerce.sku, 'STANDARD-BOOK-FULL');
    assert.equal(plan.full_edition.id, 'paid'); assert.equal(plan.sample_edition.id, 'sample');
    assert.equal(plan.generated, false); assert.equal(plan.rights_approval, 'pending');
    assert.deepEqual(plan.artifacts.map((a) => [a.role, a.edition, a.format, a.intended_file, a.status, a.sha256]), [
      ['full', 'paid', 'pdf', 'full/book-screen.pdf', 'not-generated', null],
      ['full', 'paid', 'epub', 'full/book.epub', 'not-generated', null],
      ['sample', 'sample', 'pdf', 'sample/book-sample.pdf', 'not-generated', null]
    ]);
    for (const [name, bytes] of Object.entries(files)) {
      const text = Buffer.from(bytes).toString();
      assert.ok(!text.includes(f.book));
      assert.ok(!text.includes('この範囲は内部向け候補です。'));
      assert.ok(!text.includes('この範囲は有償edition候補です。'));
      if (!name.endsWith('yaml')) assert.match(text, /PLAN ONLY/);
    }
    const before = await snapshot(output); await build(f); assert.deepEqual(await snapshot(output), before);
    assert.deepEqual(await snapshot(path.join(f.book, 'manuscript')), sourceBefore);
  });
  test('dry-run validates all metadata/visibility and computes the same plan without output', async () => {
    const f = await fixture(); const dry = await build(f, { dryRun: true });
    assert.equal(dry.written, false); assert.equal(await fs.pathExists(f.outputRoot), false);
    assert.deepEqual((await build(f)).manifest, dry.manifest);
  });
  test('price/SKU/slug/version/changelog come from source configuration', async () => {
    const f = await fixture();
    await update(f.book, 'book.yaml', (m) => { m.version = '2.3.4'; });
    await update(f.book, configRelative, (c) => { c.slug = 'other-book'; c.sku = 'CUSTOM_42'; c.price = 1200; c.changelog[0].version = '2.3.4'; });
    const result = await build(f);
    assert.equal(result.manifest.adapter.package_path, 'other-book-2.3.4.zip');
    const plan = YAML.parse(await fs.readFile(path.join(result.outputDirectory, 'booth-package-manifest.yaml'), 'utf8'));
    assert.equal(plan.commerce.price, 1200); assert.equal(plan.commerce.sku, 'CUSTOM_42'); assert.equal(plan.book.version, '2.3.4');
  });

  for (const field of ['schema_version', 'channel', 'slug', 'sku', 'currency', 'price', 'full_edition', 'sample_edition', 'summary', 'changelog']) {
    for (const value of [undefined, null]) {
      test(`config required field ${field}/${value} rejected before output`, async () => {
        const f = await fixture();
        await update(f.book, configRelative, (c) => { if (value === undefined) delete c[field]; else c[field] = value; });
        await assert.rejects(build(f), AdapterBuildError); assert.equal(await fs.pathExists(f.outputRoot), false);
      });
    }
  }
  for (const [label, mutate] of [
    ['unknown key', (c) => { c.extra = true; }],
    ['future version', (c) => { c.schema_version = 2; }],
    ['foreign channel', (c) => { c.channel = 'unknown'; }],
    ['path slug', (c) => { c.slug = '../escape'; }],
    ['backslash slug', (c) => { c.slug = 'bad\\path'; }],
    ['empty SKU', (c) => { c.sku = ''; }],
    ['foreign currency', (c) => { c.currency = 'USD'; }],
    ['negative price', (c) => { c.price = -1; }],
    ['fraction price', (c) => { c.price = 1.5; }],
    ['string price', (c) => { c.price = '500'; }],
    ['unsafe integer price', (c) => { c.price = Number.MAX_SAFE_INTEGER + 1; }],
    ['infinite price', (c) => { c.price = Infinity; }],
    ['blank summary', (c) => { c.summary = '  '; }],
    ['overlong summary', (c) => { c.summary = 'a'.repeat(2001); }],
    ['empty history', (c) => { c.changelog = []; }],
    ['version mismatch', (c) => { c.changelog[0].version = '0.2.0'; }],
    ['duplicate version', (c) => { c.changelog.push(c.changelog[0]); }],
    ['invalid date', (c) => { c.changelog[0].date = '2026-02-30'; }],
    ['missing changes', (c) => { delete c.changelog[0].changes; }],
    ['unknown history field', (c) => { c.changelog[0].extra = 1; }],
    ['missing sample edition', (c) => { c.sample_edition = 'absent'; }],
    ['paid sample', (c) => { c.sample_edition = 'paid'; }],
    ['internal sample', (c) => { c.sample_edition = 'internal'; }],
    ['wrong full', (c) => { c.full_edition = 'free'; }]
  ]) {
    test(`finite metadata contract: ${label}`, async () => {
      const f = await fixture(); await update(f.book, configRelative, mutate);
      await assert.rejects(build(f), AdapterBuildError); assert.equal(await fs.pathExists(f.outputRoot), false);
    });
  }
  for (const editionId of ['free', 'sample', 'internal']) {
    test(`${editionId} cannot receive a full paid plan`, async () => {
      const f = await fixture(); await assert.rejects(build(f, { editionId }), /configured paid full edition/);
      assert.equal(await fs.pathExists(f.outputRoot), false);
    });
  }
  for (const edition of ['paid', 'sample']) {
    test(`${edition} unsafe visibility rejected before packaging`, async () => {
      const f = await fixture(); await update(f.book, 'book.yaml', (m) => m.editions.find((e) => e.id === edition).documents.push('internal-notes'));
      await assert.rejects(build(f), /[Vv]isibility check failed/); assert.equal(await fs.pathExists(f.outputRoot), false);
    });
  }
  for (const kind of ['missing', 'duplicate-key', 'oversize', 'symlink']) {
    test(`commerce file ${kind} rejected`, async () => {
      const f = await fixture(); const configPath = path.join(f.book, configRelative);
      if (kind === 'missing') await fs.remove(configPath);
      if (kind === 'duplicate-key') await fs.appendFile(configPath, '\nprice: 20\n');
      if (kind === 'oversize') await fs.appendFile(configPath, '\n#' + 'x'.repeat(64 * 1024));
      if (kind === 'symlink') { const other = path.join(f.root, 'other.yaml'); await fs.move(configPath, other); await fs.symlink(other, configPath); }
      await assert.rejects(build(f)); assert.equal(await fs.pathExists(f.outputRoot), false);
    });
  }
  test('late config change preserves existing output and cleans owned staging', async () => {
    const f = await fixture(); const first = await build(f); const before = await snapshot(first.outputDirectory);
    const original = fs.ensureDir; let changed = false;
    fs.ensureDir = async (...args) => {
      const r = await original(...args);
      if (!changed && path.resolve(args[0]) === f.outputRoot) { changed = true; await fs.appendFile(path.join(f.book, configRelative), '\n# changed\n'); }
      return r;
    };
    try { await assert.rejects(build(f), /commerce changed after validation/); } finally { fs.ensureDir = original; }
    assert.equal(changed, true); assert.deepEqual(await snapshot(first.outputDirectory), before);
    assert.deepEqual(await fs.readdir(f.outputRoot), ['booth']);
  });
  for (const source of ['manuscript/02-workflow.md', 'frontmatter/preface.md', 'backmatter/afterword.md']) {
    for (const phase of ['between full and sample checks', 'after both checks']) {
      test(`source snapshot ${phase}: ${source}`, async () => {
        const f = await fixture(); const first = await build(f); const before = await snapshot(first.outputDirectory);
        const originalJson = fs.readJson; const originalEnsure = fs.ensureDir; let changed = false;
        const mutate = async () => {
          changed = true;
          await fs.appendFile(path.join(f.book, source), '\nSynthetic concurrent change.\n');
        };
        fs.readJson = async (...args) => {
          const data = await originalJson(...args);
          if (!changed && phase === 'between full and sample checks' && String(args[0]).endsWith('commerce.schema.json')) await mutate();
          return data;
        };
        fs.ensureDir = async (...args) => {
          const result = await originalEnsure(...args);
          if (!changed && phase === 'after both checks' && path.resolve(args[0]) === f.outputRoot) await mutate();
          return result;
        };
        try { await assert.rejects(build(f), /snapshots disagree|changed after visibility validation/); }
        finally { fs.readJson = originalJson; fs.ensureDir = originalEnsure; }
        assert.equal(changed, true); assert.deepEqual(await snapshot(first.outputDirectory), before);
        assert.deepEqual(await fs.readdir(f.outputRoot), ['booth']);
      });
    }
  }
  test('unknown output/source overlap/symlink are rejected and siblings preserved on owned replacement', async () => {
    const f = await fixture(); const file = path.join(f.outputRoot, 'booth', 'keep.txt');
    await fs.outputFile(file, 'other owner'); await assert.rejects(build(f), /without a valid adapter manifest/);
    assert.equal(await fs.readFile(file, 'utf8'), 'other owner');
    await fs.remove(path.join(f.outputRoot, 'booth'));
    await assert.rejects(build(f, { outputRoot: path.join(f.book, 'manuscript') }), /must not be inside source/);
    const other = path.join(f.root, 'other'); await fs.ensureDir(other); await fs.symlink(other, path.join(f.outputRoot, 'booth'));
    await assert.rejects(build(f), /symbolic links/); assert.deepEqual(await fs.readdir(other), []);
    await fs.remove(path.join(f.outputRoot, 'booth')); await fs.writeFile(path.join(f.outputRoot, 'sibling.txt'), 'keep');
    await fs.outputJson(path.join(f.outputRoot, 'booth', 'manifest.json'), { kind: 'book-formatter.adapter-build', adapter: { target: 'booth', implementation: 'skeleton' } });
    await build(f); assert.equal(await fs.readFile(path.join(f.outputRoot, 'sibling.txt'), 'utf8'), 'keep');
  });
  test('metadata is literal in Markdown/HTML rather than executable product content', async () => {
    const f = await fixture(); const payload = '<script>bad</script> <ScRiPt>CASE</ScRiPt> [x](https://publisher.example/) ![img](x) &copy;';
    await update(f.book, 'book.yaml', (m) => { m.title = payload; });
    await update(f.book, configRelative, (c) => { c.summary = payload; c.changelog[0].changes = [payload]; });
    const result = await build(f); const md = new MarkdownIt({ html: true, linkify: true });
    for (const name of ['product-description.md', 'CHANGELOG.md']) {
      const rendered = md.render(await fs.readFile(path.join(result.outputDirectory, name), 'utf8'));
      const inspect = (node) => {
        assert.ok(!['script', 'a', 'img'].includes(node.tagName), `unexpected active element: ${node.tagName}`);
        for (const child of node.childNodes || []) inspect(child);
      };
      inspect(parseFragment(rendered));
      assert.match(rendered, /&lt;script&gt;/);
      assert.match(rendered, /&lt;ScRiPt&gt;CASE/);
    }
  });
  test('CLI ZIP is deterministic across timezones, no accidental target nesting', async () => {
    const f = await fixture(); const digests = [];
    for (const TZ of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      const result = spawnSync(process.execPath, ['src/index.js', 'build', '--book', f.book, '--target', 'booth', '--edition', 'paid', '--out-dir', f.outputRoot], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, TZ } });
      assert.equal(result.status, 0, result.stderr); const manifest = JSON.parse(result.stdout);
      digests.push(hash(await fs.readFile(path.join(f.outputRoot, 'booth', manifest.adapter.package_path))));
    }
    assert.equal(new Set(digests).size, 1); assert.deepEqual(await fs.readdir(f.outputRoot), ['booth']);
  });
  test('pure schema validation accepts zero and maximum safe price without coercion', async () => {
    const metadata = YAML.parse(await fs.readFile(path.join(ROOT, 'examples/standard-book/book.yaml'), 'utf8'));
    const c = YAML.parse(await fs.readFile(path.join(ROOT, 'examples/standard-book/editions/booth.yaml'), 'utf8'));
    const edition = metadata.editions.find((e) => e.id === 'paid');
    for (const price of [0, Number.MAX_SAFE_INTEGER]) await validateBoothCommerce({ ...c, price }, metadata, edition);
    await assert.rejects(validateBoothCommerce([], metadata, edition), AdapterSafeIOError);
  });
});
