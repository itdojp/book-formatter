import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import fs from 'fs-extra';
import YAML from 'yaml';

import {
  AdapterBuildError,
  buildStandardBookAdapter
} from '../src/AdapterBuild.js';

const REPOSITORY_ROOT = process.cwd();
const SAMPLE_BOOK = path.join(REPOSITORY_ROOT, 'examples/standard-book');
const temporaryDirectories = [];

async function temporaryDirectory(prefix) {
  const directory = await fs.mkdtemp(path.join(REPOSITORY_ROOT, `tests/${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}

async function copySampleBook() {
  const directory = await temporaryDirectory('tmp-zenn-book-');
  await fs.copy(SAMPLE_BOOK, directory);
  return directory;
}

async function updateMetadata(bookDirectory, mutate) {
  const metadataPath = path.join(bookDirectory, 'book.yaml');
  const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'), { uniqueKeys: true });
  mutate(metadata);
  await fs.writeFile(metadataPath, YAML.stringify(metadata));
}

async function appendWorkflow(bookDirectory, markdown) {
  await fs.appendFile(path.join(bookDirectory, 'manuscript/02-workflow.md'), markdown, 'utf8');
}

async function build(bookDirectory, outputRoot, editionId = 'free', dryRun = false) {
  return buildStandardBookAdapter({
    bookDirectory,
    target: 'zenn',
    editionId,
    outputRoot,
    dryRun
  });
}

function bookOutput(result) {
  return path.join(result.outputDirectory, 'books', 'standard-book-example');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('ZennAdapter', () => {
  test('free editionを非公開の決定的なZenn bookへ変換する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-output-');
    const first = await build(bookDirectory, outputRoot);
    const configPath = path.join(bookOutput(first), 'config.yaml');
    const workflowPath = path.join(bookOutput(first), 'workflow.md');
    const config = YAML.parse(await fs.readFile(configPath, 'utf8'), { uniqueKeys: true });
    const workflow = await fs.readFile(workflowPath, 'utf8');
    const firstManifest = await fs.readFile(first.manifestPath, 'utf8');
    const firstConfig = await fs.readFile(configPath, 'utf8');

    assert.deepStrictEqual(config, {
      title: '標準書籍フォーマット最小例',
      summary: '標準書籍フォーマットと出力手順を確認する最小例',
      topics: ['markdown', 'publishing'],
      published: false,
      price: 0,
      chapters: ['introduction', 'workflow']
    });
    assert.strictEqual(first.manifest.adapter.implementation, 'zenn-v1');
    assert.strictEqual(first.manifest.adapter.project_format, 'zenn-book');
    assert.strictEqual(first.manifest.adapter.published, false);
    assert.deepStrictEqual(first.manifest.adapter.warnings, [
      {
        code: 'relative_link_passthrough',
        file: 'manuscript/02-workflow.md',
        line: 14
      }
    ]);
    assert.match(workflow, /^---\ntitle: 正本から出力する流れ\n---\n/u);
    assert.doesNotMatch(workflow, /^# 第2章 正本から出力する流れ$/mu);
    assert.match(workflow, /^## 最小ワークフロー$/mu);
    assert.match(workflow, /:::message\n正本と生成物は別に管理します。\n:::/u);
    assert.match(workflow, /:::message alert\n検証前の生成物を公開しません。\n:::/u);
    assert.doesNotMatch(workflow, /:::note|:::tip|:::warning|:::paid|:::internal/u);
    assert.doesNotMatch(workflow, /有償edition候補|内部向け候補/u);
    assert.strictEqual(await fs.pathExists(path.join(bookOutput(first), 'afterword.md')), false);
    assert.ok(!firstManifest.includes(bookDirectory));
    assert.ok(!firstManifest.includes('有償edition候補'));

    await fs.writeFile(path.join(first.outputDirectory, 'stale.txt'), 'stale\n');
    const second = await build(bookDirectory, outputRoot);
    assert.strictEqual(await fs.pathExists(path.join(second.outputDirectory, 'stale.txt')), false);
    assert.strictEqual(await fs.readFile(second.manifestPath, 'utf8'), firstManifest);
    assert.strictEqual(await fs.readFile(path.join(bookOutput(second), 'config.yaml'), 'utf8'), firstConfig);
  });

  test('paid editionだけ設定済み価格とchapter free境界を出力する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-paid-output-');
    const result = await build(bookDirectory, outputRoot, 'paid');
    const config = YAML.parse(
      await fs.readFile(path.join(bookOutput(result), 'config.yaml'), 'utf8'),
      { uniqueKeys: true }
    );

    assert.strictEqual(config.published, false);
    assert.strictEqual(config.price, 500);
    assert.deepStrictEqual(config.chapters, ['preface', 'introduction', 'workflow', 'afterword']);
    for (const slug of ['preface', 'introduction']) {
      assert.match(
        await fs.readFile(path.join(bookOutput(result), `${slug}.md`), 'utf8'),
        /^---\ntitle: .+\nfree: true\n---\n/u
      );
    }
    assert.match(
      await fs.readFile(path.join(bookOutput(result), 'workflow.md'), 'utf8'),
      /^---\ntitle: 正本から出力する流れ\nfree: false\n---\n/u
    );
    assert.match(
      await fs.readFile(path.join(bookOutput(result), 'afterword.md'), 'utf8'),
      /^---\ntitle: おわりに\nfree: false\n---\n/u
    );
    const workflow = await fs.readFile(path.join(bookOutput(result), 'workflow.md'), 'utf8');
    assert.match(workflow, /この範囲は有償edition候補です/u);
    assert.doesNotMatch(workflow, /この範囲は内部向け候補です|:::paid|:::internal/u);
  });

  test('参照画像をZenn imagesへcopyしてpathを書き換えcode内の例は変更しない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-image-output-');
    const image = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
    await fs.ensureDir(path.join(bookDirectory, 'assets/figures'));
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow.png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow).png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow name.png'), image);
    await appendWorkflow(
      bookDirectory,
      '\n![処理フロー](../assets/figures/flow.png)\n' +
        '![記号付き](../assets/figures/flow%29.png)\n' +
        '![空白付き](../assets/figures/flow%20name.png)\n' +
        '`![inline example](../assets/missing.png)`\n' +
        '\\![escaped example](../assets/missing.png)\n' +
        '```markdown\n![fenced example](../assets/missing.png)\n```\n'
    );

    const result = await build(bookDirectory, outputRoot);
    const workflow = await fs.readFile(path.join(bookOutput(result), 'workflow.md'), 'utf8');
    assert.match(
      workflow,
      /!\[処理フロー\]\(\/images\/standard-book-example\/figures\/flow\.png\)/u
    );
    assert.match(
      workflow,
      /!\[記号付き\]\(\/images\/standard-book-example\/figures\/flow%29\.png\)/u
    );
    assert.match(
      workflow,
      /!\[空白付き\]\(\/images\/standard-book-example\/figures\/flow%20name\.png\)/u
    );
    assert.match(workflow, /`!\[inline example\]\(\.\.\/assets\/missing\.png\)`/u);
    assert.match(workflow, /\\!\[escaped example\]\(\.\.\/assets\/missing\.png\)/u);
    assert.match(workflow, /```markdown\n!\[fenced example\]\(\.\.\/assets\/missing\.png\)\n```/u);
    assert.deepStrictEqual(
      await fs.readFile(
        path.join(result.outputDirectory, 'images/standard-book-example/figures/flow.png')
      ),
      image
    );
    assert.deepStrictEqual(
      await fs.readFile(
        path.join(result.outputDirectory, 'images/standard-book-example/figures/flow).png')
      ),
      image
    );
    assert.deepStrictEqual(
      await fs.readFile(
        path.join(result.outputDirectory, 'images/standard-book-example/figures/flow name.png')
      ),
      image
    );
  });

  test('外部・root外・未対応・過大・symlink画像をfail closedで拒否する', async (context) => {
    const cases = [
      ['![empty]()', /must have a non-empty destination/],
      [
        '![reference][asset]\n\n[asset]: /images/standard-book-example/missing.png',
        /Unsupported image syntax remained/
      ],
      ['![external](https://assets.example/image.png)', /External images are not supported/],
      ['![root](/images/existing.png)', /must be relative/],
      ['![outside](../../../outside.png)', /resolves outside the book root/],
      ['![title](../assets/image.png "caption")', /titles or whitespace paths are not supported/]
    ];
    for (const [index, [markdown, expected]] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory(`tmp-zenn-image-reject-${index}-`);
      await fs.writeFile(path.join(bookDirectory, 'assets/image.png'), 'png');
      await appendWorkflow(bookDirectory, `\n${markdown}\n`);
      await assert.rejects(build(bookDirectory, outputRoot), expected);
    }

    const extensionBook = await copySampleBook();
    const extensionOutput = await temporaryDirectory('tmp-zenn-image-extension-');
    await fs.writeFile(path.join(extensionBook, 'assets/vector.svg'), '<svg></svg>\n');
    await appendWorkflow(extensionBook, '\n![vector](../assets/vector.svg)\n');
    await assert.rejects(build(extensionBook, extensionOutput), /Unsupported Zenn image extension \.svg/);

    const largeBook = await copySampleBook();
    const largeOutput = await temporaryDirectory('tmp-zenn-image-large-');
    await fs.writeFile(path.join(largeBook, 'assets/large.png'), Buffer.alloc(3 * 1024 * 1024 + 1));
    await appendWorkflow(largeBook, '\n![large](../assets/large.png)\n');
    await assert.rejects(build(largeBook, largeOutput), /exceeds 3MB/);

    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link assertion is skipped on Windows');
      return;
    }
    const symlinkBook = await copySampleBook();
    const symlinkOutput = await temporaryDirectory('tmp-zenn-image-symlink-');
    await fs.writeFile(path.join(symlinkBook, 'assets/real.png'), 'png');
    await fs.symlink('real.png', path.join(symlinkBook, 'assets/link.png'));
    await appendWorkflow(symlinkBook, '\n![link](../assets/link.png)\n');
    await assert.rejects(build(symlinkBook, symlinkOutput), /must not contain symbolic links/);
  });

  test('target metadata、title、chapter slug、internal edition境界を拒否する', async () => {
    const missingTarget = await copySampleBook();
    await updateMetadata(missingTarget, (metadata) => delete metadata.targets);
    await assert.rejects(build(missingTarget, await temporaryDirectory('tmp-zenn-no-target-')), /must define targets\.zenn/);

    const longTitle = await copySampleBook();
    await updateMetadata(longTitle, (metadata) => {
      metadata.title = 'a'.repeat(71);
    });
    await assert.rejects(build(longTitle, await temporaryDirectory('tmp-zenn-long-title-')), /title must be at most 70/);

    const longChapter = await copySampleBook();
    const longId = `chapter-${'a'.repeat(44)}`;
    await updateMetadata(longChapter, (metadata) => {
      metadata.structure.chapters[1].id = longId;
      for (const edition of metadata.editions) {
        if (edition.documents) {
          edition.documents = edition.documents.map((id) => id === 'workflow' ? longId : id);
        }
      }
    });
    await assert.rejects(build(longChapter, await temporaryDirectory('tmp-zenn-long-chapter-')), /chapter slug is invalid/);

    const internalBook = await copySampleBook();
    await assert.rejects(
      build(internalBook, await temporaryDirectory('tmp-zenn-internal-'), 'internal'),
      /does not emit internal editions/
    );

    const freeWithoutPrice = await copySampleBook();
    await updateMetadata(freeWithoutPrice, (metadata) => delete metadata.targets.zenn.price);
    await assert.doesNotReject(
      build(freeWithoutPrice, await temporaryDirectory('tmp-zenn-free-no-price-'))
    );
    await assert.rejects(
      build(freeWithoutPrice, await temporaryDirectory('tmp-zenn-paid-no-price-'), 'paid'),
      /price is required for a paid Zenn build/
    );

    const utf16Topic = await copySampleBook();
    await updateMetadata(utf16Topic, (metadata) => {
      metadata.targets.zenn.topics = ['技術', '😀'.repeat(10)];
    });
    await assert.rejects(
      build(utf16Topic, await temporaryDirectory('tmp-zenn-utf16-topic-')),
      /topic length and character contract/
    );

  });

  test('unsupported warningはredactedで、unknown ownerをdry-run含め置換しない', async () => {
    const bookDirectory = await copySampleBook();
    const dryOutput = await temporaryDirectory('tmp-zenn-dry-output-');
    const dry = await build(bookDirectory, dryOutput, 'free', true);
    assert.strictEqual(dry.written, false);
    assert.strictEqual(await fs.pathExists(dry.outputDirectory), false);
    assert.ok(dry.manifest.adapter.warnings.some(
      (warning) => warning.code === 'relative_link_passthrough'
    ));
    assert.ok(dry.manifest.adapter.warnings.every(
      (warning) => Object.keys(warning).sort().join(',') === 'code,file,line'
    ));
    assert.ok(!JSON.stringify(dry.manifest.adapter.warnings).includes('book.yaml'));

    const outputRoot = await temporaryDirectory('tmp-zenn-owner-output-');
    const outputDirectory = path.join(outputRoot, 'zenn');
    await fs.ensureDir(outputDirectory);
    await fs.writeFile(path.join(outputDirectory, 'keep.txt'), 'owner data\n');
    await assert.rejects(build(bookDirectory, outputRoot), /without a valid adapter manifest/);
    await assert.rejects(build(bookDirectory, outputRoot, 'free', true), /without a valid adapter manifest/);
    assert.strictEqual(await fs.readFile(path.join(outputDirectory, 'keep.txt'), 'utf8'), 'owner data\n');
  });

  test('source Front Matter、不正h1、protocol-relative linkをfail closedで拒否する', async () => {
    const frontMatterBook = await copySampleBook();
    await fs.writeFile(
      path.join(frontMatterBook, 'manuscript/02-workflow.md'),
      '---\ntitle: duplicated metadata\n---\n# 第2章 正本から出力する流れ\n',
      'utf8'
    );
    await assert.rejects(
      build(frontMatterBook, await temporaryDirectory('tmp-zenn-front-matter-')),
      /Source YAML Front Matter is not supported/
    );

    const missingH1Book = await copySampleBook();
    await fs.writeFile(
      path.join(missingH1Book, 'manuscript/02-workflow.md'),
      '## 第2章 正本から出力する流れ\n',
      'utf8'
    );
    await assert.rejects(
      build(missingH1Book, await temporaryDirectory('tmp-zenn-missing-h1-')),
      /exactly one leading ATX h1/
    );

    const protocolRelativeBook = await copySampleBook();
    await appendWorkflow(protocolRelativeBook, '\n[external](//outside.example/path)\n');
    await assert.rejects(
      build(protocolRelativeBook, await temporaryDirectory('tmp-zenn-protocol-relative-')),
      /Protocol-relative links are not supported/
    );

    const rawHtmlBook = await copySampleBook();
    await appendWorkflow(rawHtmlBook, '\n<img src="https://tracker.example/x.png">\n');
    await assert.rejects(
      build(rawHtmlBook, await temporaryDirectory('tmp-zenn-raw-html-')),
      /Reader-visible raw HTML is not supported/
    );

    const rawHtmlLiteralBook = await copySampleBook();
    await appendWorkflow(
      rawHtmlLiteralBook,
      '\n`<a href="http://outside.example">literal</a>`\n' +
        '```html\n<img src="https://tracker.example/x.png">\n```\n'
    );
    await assert.doesNotReject(
      build(rawHtmlLiteralBook, await temporaryDirectory('tmp-zenn-raw-html-literal-'), 'free', true)
    );
  });

  test('変換失敗時は既存のowned outputを変更しない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-preserve-output-');
    const first = await build(bookDirectory, outputRoot);
    const originalManifest = await fs.readFile(first.manifestPath, 'utf8');
    const originalConfig = await fs.readFile(
      path.join(bookOutput(first), 'config.yaml'),
      'utf8'
    );
    await fs.writeFile(path.join(first.outputDirectory, 'preserve.txt'), 'existing output\n');
    await appendWorkflow(bookDirectory, '\n![external](https://assets.example/image.png)\n');

    await assert.rejects(build(bookDirectory, outputRoot), /External images are not supported/);
    assert.strictEqual(await fs.readFile(first.manifestPath, 'utf8'), originalManifest);
    assert.strictEqual(
      await fs.readFile(path.join(bookOutput(first), 'config.yaml'), 'utf8'),
      originalConfig
    );
    assert.strictEqual(
      await fs.readFile(path.join(first.outputDirectory, 'preserve.txt'), 'utf8'),
      'existing output\n'
    );
  });

  test('schemaはZenn metadataのslug/topic/priceをfail closedで検証する', async () => {
    const cases = [
      [(metadata) => { metadata.targets.zenn.slug = 'short'; }, /must match pattern/],
      [(metadata) => { metadata.targets.zenn.topics = []; }, /must NOT have fewer than 1 items/],
      [(metadata) => { metadata.targets.zenn.topics = ['valid', 'invalid topic']; }, /must match pattern/],
      [(metadata) => { metadata.targets.zenn.topics = ['a'.repeat(19)]; }, /must NOT have more than 18 characters/],
      [(metadata) => { metadata.targets.zenn.price = 250; }, /must be multiple of 100/],
      [(metadata) => { metadata.targets.zenn.price = 5100; }, /must be <= 5000/]
    ];
    for (const [index, [mutate, expected]] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, mutate);
      await assert.rejects(
        build(bookDirectory, await temporaryDirectory(`tmp-zenn-schema-${index}-`)),
        expected
      );
    }
  });

  test('adapter errorは共通CLI境界でAdapterBuildErrorへ正規化する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => delete metadata.targets.zenn);
    await assert.rejects(
      build(bookDirectory, await temporaryDirectory('tmp-zenn-error-type-')),
      (error) => error instanceof AdapterBuildError && /targets\.zenn/.test(error.message)
    );
  });
});
