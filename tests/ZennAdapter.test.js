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
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/a&b.png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/a(b).png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/a)b.png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/a`b`.png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/a`b.png'), image);
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/outer.png'), image);
    await fs.writeFile(
      path.join(bookDirectory, 'assets/figures/a[docs](target.md).png'),
      image
    );
    await appendWorkflow(
      bookDirectory,
      '\n![処理フロー](../assets/figures/flow.png)\n' +
        '![記号付き](../assets/figures/flow%29.png)\n' +
        '![空白付き](../assets/figures/flow%20name.png)\n' +
        '![entity](../assets/figures/a&amp;b.png)\n' +
        '![escaped path](../assets/figures/a\\(b\\).png)\n' +
        '![angle path](<../assets/figures/a)b.png>)\n' +
        '![angle whitespace](<../assets/figures/flow name.png>)\n' +
        '![backtick path](../assets/figures/a`b`.png)\n' +
        'inline destination twin: `b`\n' +
        '![single backtick path](../assets/figures/a`b.png) and `b`\n' +
        '[docs](target.md) ![link-like path](../assets/figures/a[docs](target.md).png)\n' +
        '![a\\]b](../assets/figures/flow.png)\n' +
        '![[reference](http://example.test)](../assets/figures/flow.png)\n' +
        '![code alt `]`](../assets/figures/flow.png)\n' +
        '![outer ![inner](missing.png)](../assets/figures/outer.png)\n' +
        '![x](../assets/figures/flow.png) ' +
        '<https://example.test/![x](../assets/figures/flow.png)>\n' +
        '![metadata twin](../assets/figures/flow.png) ' +
        '[same metadata](https://example.test "literal ![metadata twin](../assets/figures/flow.png)")\n' +
        'text ` literal ![unmatched](../assets/figures/flow.png)\n\n' +
        '`![inline example](../assets/missing.png)`\n' +
        '\\![escaped example](../assets/missing.png)\n' +
        '[docs](https://example.test "literal ![icon](../assets/missing.png)")\n' +
        '[multiline](https://example.test\n "literal ![icon](../assets/missing.png)")\n' +
        '[link metadata](https://example.test\n "literal [fake](relative.md)")\n' +
        `${Array.from(
          { length: 50 },
          () => '![repeated](../assets/figures/flow.png)'
        ).join(' ')}\n` +
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
    assert.match(
      workflow,
      /!\[entity\]\(\/images\/standard-book-example\/figures\/a%26b\.png\)/u
    );
    assert.match(
      workflow,
      /!\[escaped path\]\(\/images\/standard-book-example\/figures\/a%28b%29\.png\)/u
    );
    assert.match(
      workflow,
      /!\[angle path\]\(\/images\/standard-book-example\/figures\/a%29b\.png\)/u
    );
    assert.match(
      workflow,
      /!\[angle whitespace\]\(\/images\/standard-book-example\/figures\/flow%20name\.png\)/u
    );
    assert.match(
      workflow,
      /!\[backtick path\]\(\/images\/standard-book-example\/figures\/a%60b%60\.png\)/u
    );
    assert.match(workflow, /inline destination twin: `b`/u);
    assert.match(
      workflow,
      /!\[single backtick path\]\(\/images\/standard-book-example\/figures\/a%60b\.png\) and `b`/u
    );
    assert.match(
      workflow,
      /\[docs\]\(target\.md\) !\[link-like path\]\(\/images\/standard-book-example\/figures\/a%5Bdocs%5D%28target\.md%29\.png\)/u
    );
    assert.ok(
      workflow.includes('![a\\]b](/images/standard-book-example/figures/flow.png)')
    );
    assert.ok(
      workflow.includes(
        '![[reference](http://example.test)](/images/standard-book-example/figures/flow.png)'
      )
    );
    assert.ok(
      workflow.includes('![code alt `]`](/images/standard-book-example/figures/flow.png)')
    );
    assert.ok(
      workflow.includes(
        '![outer ![inner](missing.png)](/images/standard-book-example/figures/outer.png)'
      )
    );
    assert.ok(
      workflow.includes(
        '![x](/images/standard-book-example/figures/flow.png) ' +
        '<https://example.test/![x](../assets/figures/flow.png)>'
      )
    );
    assert.ok(
      workflow.includes(
        '![metadata twin](/images/standard-book-example/figures/flow.png) ' +
        '[same metadata](https://example.test "literal ![metadata twin](../assets/figures/flow.png)")'
      )
    );
    assert.match(
      workflow,
      /text ` literal !\[unmatched\]\(\/images\/standard-book-example\/figures\/flow\.png\)/u
    );
    assert.match(workflow, /`!\[inline example\]\(\.\.\/assets\/missing\.png\)`/u);
    assert.match(workflow, /\\!\[escaped example\]\(\.\.\/assets\/missing\.png\)/u);
    assert.match(
      workflow,
      /\[docs\]\(https:\/\/example\.test "literal !\[icon\]\(\.\.\/assets\/missing\.png\)"\)/u
    );
    assert.match(
      workflow,
      /\[multiline\]\(https:\/\/example\.test\n "literal !\[icon\]\(\.\.\/assets\/missing\.png\)"\)/u
    );
    assert.match(
      workflow,
      /\[link metadata\]\(https:\/\/example\.test\n "literal \[fake\]\(relative\.md\)"\)/u
    );
    assert.strictEqual(
      [...workflow.matchAll(
        /!\[repeated\]\(\/images\/standard-book-example\/figures\/flow\.png\)/gu
      )].length,
      50
    );
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
    assert.deepStrictEqual(
      await fs.readFile(
        path.join(result.outputDirectory, 'images/standard-book-example/figures/a`b`.png')
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
      [
        '![real](../assets/image.png)\n![reference][asset]\n\n' +
          '[asset]: /images/standard-book-example/image.png',
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

  test('保持したasset rootからの走査中に差し替えられた中間symlinkを追従しない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-image-race-');
    const assetRoot = path.join(bookDirectory, 'assets');
    const figures = path.join(assetRoot, 'figures');
    const displacedFigures = path.join(assetRoot, 'figures.displaced');
    const outside = await temporaryDirectory('tmp-zenn-image-race-outside-');
    await fs.ensureDir(figures);
    await fs.writeFile(path.join(figures, 'race.png'), 'validated image bytes');
    await fs.writeFile(path.join(outside, 'race.png'), 'unrelated readable bytes');
    await appendWorkflow(bookDirectory, '\n![race](../assets/figures/race.png)\n');

    const originalLstat = fs.lstat;
    let assetRootLstatCalls = 0;
    fs.lstat = async (candidate, ...args) => {
      const result = await originalLstat(candidate, ...args);
      if (path.resolve(candidate) === assetRoot && ++assetRootLstatCalls === 3) {
        await fs.rename(figures, displacedFigures);
        await fs.symlink(outside, figures, 'dir');
      }
      return result;
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /Image path must not contain symbolic links/
      );
    } finally {
      fs.lstat = originalLstat;
    }
    assert.ok(assetRootLstatCalls >= 3);
    assert.strictEqual(
      await fs.readFile(path.join(outside, 'race.png'), 'utf8'),
      'unrelated readable bytes'
    );
    assert.strictEqual(
      await fs.readFile(path.join(displacedFigures, 'race.png'), 'utf8'),
      'validated image bytes'
    );
    assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'zenn')), false);
  });

  test('可視性検査後に差し替えられた原稿を安全な読み取りとdigestで拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('source symbolic-link race assertion is skipped on Windows');
      return;
    }
    const cases = [
      {
        name: 'regular replacement',
        replace: async (sourcePath) => {
          await fs.writeFile(sourcePath, '# Replaced\n\nreplacement content\n', 'utf8');
        },
        expected: /changed after visibility validation/u
      },
      {
        name: 'symbolic-link replacement',
        replace: async (sourcePath, bookDirectory) => {
          await fs.remove(sourcePath);
          await fs.symlink('../other.txt', sourcePath);
          await fs.writeFile(path.join(bookDirectory, 'other.txt'), '# Linked\n\nlinked content\n');
        },
        expected: /must remain a regular non-symlink file/u
      }
    ];

    for (const scenario of cases) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory('tmp-zenn-source-race-');
      const sourcePath = path.join(bookDirectory, 'manuscript/02-workflow.md');
      const originalReadFile = fs.readFile;
      let replaced = false;
      fs.readFile = async (candidate, ...args) => {
        const contents = await originalReadFile(candidate, ...args);
        if (!replaced && path.resolve(candidate) === sourcePath) {
          replaced = true;
          await scenario.replace(sourcePath, bookDirectory);
        }
        return contents;
      };
      try {
        await assert.rejects(build(bookDirectory, outputRoot), scenario.expected, scenario.name);
      } finally {
        fs.readFile = originalReadFile;
      }
      assert.strictEqual(replaced, true, scenario.name);
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'zenn')), false);
    }
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

  test('複数行paragraphのrelative link warningは各物理行を保持する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-multiline-warning-');
    await appendWorkflow(
      bookDirectory,
      '\n警告位置の確認です。\n次の[リンク](../first.md)です。\n別の[リンク](../second.md)です。\n'
    );

    const result = await build(bookDirectory, outputRoot);
    const warnings = result.manifest.adapter.warnings.filter(
      (warning) => warning.code === 'relative_link_passthrough'
    );
    assert.deepStrictEqual(warnings.map((warning) => warning.line), [14, 47, 48]);
  });

  test('quoted link title内のparenthesisをdestination境界として数えない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-quoted-link-title-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n' +
        '[double](target.md "note (")\n' +
        '[single](target.md \'note (\' )\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ).map((warning) => warning.line),
      [1, 2]
    );
  });

  test('autolink metadata内のlink・code風textをsource候補から除外する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-autolink-metadata-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n' +
        '<https://example.test/`b`/[fake](relative.md)> and `b` [real](relative.md)\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ),
      [{
        code: 'relative_link_passthrough',
        file: 'manuscript/02-workflow.md',
        line: 1
      }]
    );
  });

  test('複数行inline codeをまたぐrelative link warningも物理行を保持する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-inline-code-warning-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n' +
        '[first](../first.md) `code\n' +
        'more` [second](../second.md)\n' +
        '`code\n' +
        '[hidden](../hidden.md)\n' +
        'more` [visible](../visible.md)\n' +
        'text ` literal [unmatched](../unmatched.md)\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    const warnings = result.manifest.adapter.warnings.filter(
      (warning) => warning.file === 'manuscript/02-workflow.md'
    );
    assert.deepStrictEqual(warnings.map((warning) => warning.line), [1, 2, 5, 6]);
  });

  test('異なる長さの未完了backtick runを一度indexし後続linkを検査する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-backtick-index-');
    const unmatchedRuns = Array.from(
      { length: 512 },
      (_, index) => `${'`'.repeat(index + 1)}x`
    ).join(' ');
    const delimiter = '`'.repeat(513);
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      `# Warning positions\n${unmatchedRuns} ${delimiter}code${delimiter} [visible](../visible.md)\n`,
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ),
      [{
        code: 'relative_link_passthrough',
        file: 'manuscript/02-workflow.md',
        line: 1
      }]
    );
  });

  test('未完了link labelを一度indexし先行relative linkを保持する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-bracket-index-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      `# Warning positions\n[visible](../visible.md) ${'['.repeat(20_000)}\n`,
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ),
      [{
        code: 'relative_link_passthrough',
        file: 'manuscript/02-workflow.md',
        line: 1
      }]
    );
  });

  test('複数行に分割されたrelative linkも開始物理行へwarningを対応付ける', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-multiline-link-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n[multiline\nlink](../target.md)\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ),
      [{
        code: 'relative_link_passthrough',
        file: 'manuscript/02-workflow.md',
        line: 1
      }]
    );
  });

  test('nested relative linkはparserが採用した内側の開始物理行へ対応付ける', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-nested-link-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n' +
        '[first](../first.md)\n' +
        '[outer\n' +
        '[inner](../target.md)](ignored.md)\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ).map((warning) => warning.line),
      [1, 3]
    );
  });

  test('reference形式のrelative linkも完全なblock contextからwarningへ対応付ける', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-reference-link-');
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Warning positions\n' +
        '[full][target]\n' +
        '[collapsed][]\n' +
        '[shortcut]\n\n' +
        '[target]: ../target.md\n' +
        '[collapsed]: ../collapsed.md\n' +
        '[shortcut]: ../shortcut.md\n',
      'utf8'
    );

    const result = await build(bookDirectory, outputRoot);
    assert.deepStrictEqual(
      result.manifest.adapter.warnings.filter(
        (warning) => warning.file === 'manuscript/02-workflow.md'
      ).map((warning) => warning.line),
      [1, 2, 3]
    );
  });

  test('source Front Matter、不正h1、protocol-relative linkをfail closedで拒否する', async () => {
    const indentedH1Book = await copySampleBook();
    await fs.writeFile(
      path.join(indentedH1Book, 'manuscript/02-workflow.md'),
      '   # Indented canonical heading\n\nBody.\n',
      'utf8'
    );
    const indentedH1Result = await build(
      indentedH1Book,
      await temporaryDirectory('tmp-zenn-indented-h1-')
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(bookOutput(indentedH1Result), 'workflow.md'), 'utf8'),
      /^\s{0,3}# Indented canonical heading$/mu
    );

    const nestedH1Book = await copySampleBook();
    await fs.writeFile(
      path.join(nestedH1Book, 'manuscript/02-workflow.md'),
      '# Canonical heading\n\n> # Quoted heading\n\n- # List heading\n',
      'utf8'
    );
    const nestedH1Result = await build(
      nestedH1Book,
      await temporaryDirectory('tmp-zenn-nested-h1-')
    );
    const nestedH1Output = await fs.readFile(
      path.join(bookOutput(nestedH1Result), 'workflow.md'),
      'utf8'
    );
    assert.doesNotMatch(nestedH1Output, /^# Canonical heading$/mu);
    assert.match(nestedH1Output, /^> # Quoted heading$/mu);
    assert.match(nestedH1Output, /^- # List heading$/mu);

    const duplicateH1Book = await copySampleBook();
    await fs.writeFile(
      path.join(duplicateH1Book, 'manuscript/02-workflow.md'),
      '# First heading\n\n# Second heading\n',
      'utf8'
    );
    await assert.rejects(
      build(duplicateH1Book, await temporaryDirectory('tmp-zenn-duplicate-h1-')),
      /exactly one leading ATX h1/
    );

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

    const emptyLinkBook = await copySampleBook();
    await appendWorkflow(emptyLinkBook, '\n[empty]()\n');
    await assert.rejects(
      build(emptyLinkBook, await temporaryDirectory('tmp-zenn-empty-link-')),
      /link must have a non-empty destination/
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

  test('同時に植え付けられたstaging symlinkを追従せず外部fileを変更しない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('staging symbolic-link race assertion is skipped on Windows');
      return;
    }
    for (const plantedPath of ['books', 'manifest.json']) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory('tmp-zenn-staging-race-');
      const outside = await temporaryDirectory('tmp-zenn-staging-outside-');
      const outsideFile = path.join(outside, 'outside.txt');
      await fs.writeFile(outsideFile, 'outside data\n');
      const originalLstat = fs.lstat;
      let planted = false;
      fs.lstat = async (candidate, ...args) => {
        const result = await originalLstat(candidate, ...args);
        if (!planted && path.basename(candidate).startsWith('.zenn-')) {
          planted = true;
          const destination = plantedPath === 'books' ? outside : outsideFile;
          await fs.symlink(
            destination,
            path.join(candidate, plantedPath),
            plantedPath === 'books' ? 'dir' : 'file'
          );
        }
        return result;
      };
      try {
        await assert.rejects(
          build(bookDirectory, outputRoot),
          /staging (?:directory|file) could not be created exclusively/u,
          plantedPath
        );
      } finally {
        fs.lstat = originalLstat;
      }
      assert.strictEqual(planted, true, plantedPath);
      assert.strictEqual(await fs.readFile(outsideFile, 'utf8'), 'outside data\n');
      assert.deepStrictEqual(await fs.readdir(outside), ['outside.txt']);
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'zenn')), false);
    }
  });

  test('staging rootはheld parentで作成したidentityと差し替えを分離する', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('staging root identity race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-staging-root-race-');
    const originalLstat = fs.lstat;
    let injected = false;
    let stagingDirectory;
    let displacedDirectory;
    fs.lstat = async (candidate, ...args) => {
      if (!injected && path.basename(candidate).startsWith('.zenn-')) {
        injected = true;
        stagingDirectory = candidate;
        displacedDirectory = `${candidate}.displaced`;
        await fs.rename(candidate, displacedDirectory);
        await fs.mkdir(candidate, { mode: 0o700 });
        await fs.writeFile(path.join(candidate, 'unrelated.txt'), 'concurrent owner data\n');
      }
      return originalLstat(candidate, ...args);
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /staging cleanup retained path/u
      );
    } finally {
      fs.lstat = originalLstat;
    }
    assert.strictEqual(injected, true);
    assert.strictEqual(
      await fs.readFile(path.join(stagingDirectory, 'unrelated.txt'), 'utf8'),
      'concurrent owner data\n'
    );
    assert.strictEqual(await fs.pathExists(displacedDirectory), true);
    assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'zenn')), false);
  });

  test('検証後に変更されたstaging fileをinstallしない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('staging file race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-staging-file-race-');
    const outputDirectory = path.resolve(outputRoot, 'zenn');
    const originalRename = fs.rename;
    let injected = false;
    fs.rename = async (source, destination, ...args) => {
      if (
        !injected &&
        path.basename(source).startsWith('.zenn-') &&
        path.resolve(destination) === outputDirectory
      ) {
        injected = true;
        await fs.writeFile(
          path.join(source, 'books/standard-book-example/config.yaml'),
          'title: replaced\npublished: true\n',
          'utf8'
        );
      }
      return originalRename(source, destination, ...args);
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /Zenn staging file changed after exclusive creation/u
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.strictEqual(injected, true);
    assert.strictEqual(await fs.pathExists(outputDirectory), false);
  });

  test('install中に変更されたbook.yaml snapshotをrollbackする', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('metadata snapshot race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const metadataPath = path.join(bookDirectory, 'book.yaml');
    const outputRoot = await temporaryDirectory('tmp-zenn-metadata-race-');
    const outputDirectory = path.resolve(outputRoot, 'zenn');
    const originalRename = fs.rename;
    let injected = false;
    fs.rename = async (source, destination, ...args) => {
      if (
        !injected &&
        path.basename(source).startsWith('.zenn-') &&
        path.resolve(destination) === outputDirectory
      ) {
        injected = true;
        const metadata = await fs.readFile(metadataPath, 'utf8');
        await fs.writeFile(
          metadataPath,
          metadata.replace('slug: standard-book-example', 'slug: changed-book-example'),
          'utf8'
        );
      }
      return originalRename(source, destination, ...args);
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /Zenn source changed after visibility validation: book\.yaml/u
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.strictEqual(injected, true);
    assert.strictEqual(await fs.pathExists(outputDirectory), false);
  });

  test('ownership検証後に差し替えられたoutputをbackup削除しない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('directory identity race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-output-race-');
    const first = await build(bookDirectory, outputRoot);
    const outputDirectory = first.outputDirectory;
    const displacedOwnedDirectory = `${outputDirectory}.concurrent-owned`;
    const originalRename = fs.rename;
    let injected = false;
    let replacementBackup;
    fs.rename = async (source, destination, ...args) => {
      if (
        !injected &&
        path.resolve(source) === outputDirectory &&
        destination.startsWith(`${outputDirectory}.backup-`)
      ) {
        injected = true;
        replacementBackup = destination;
        await originalRename(source, displacedOwnedDirectory);
        await fs.ensureDir(source);
        await fs.writeFile(path.join(source, 'unrelated.txt'), 'concurrent owner data\n');
      }
      return originalRename(source, destination, ...args);
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /output identity changed across backup rename/
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.strictEqual(injected, true);
    assert.ok(replacementBackup);
    assert.strictEqual(
      await fs.readFile(path.join(replacementBackup, 'unrelated.txt'), 'utf8'),
      'concurrent owner data\n'
    );
    assert.strictEqual(
      await fs.pathExists(path.join(displacedOwnedDirectory, 'manifest.json')),
      true
    );
  });

  test('install直後に差し替えられたoutputをrollbackで再帰削除しない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('directory rollback race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-rollback-race-');
    const first = await build(bookDirectory, outputRoot);
    const outputDirectory = first.outputDirectory;
    const displacedInstalled = `${outputDirectory}.concurrent-installed`;
    const originalRename = fs.rename;
    let backupDirectory;
    let injected = false;
    fs.rename = async (source, destination, ...args) => {
      if (
        path.resolve(source) === outputDirectory &&
        destination.startsWith(`${outputDirectory}.backup-`)
      ) {
        backupDirectory = destination;
      }
      const result = await originalRename(source, destination, ...args);
      if (
        !injected &&
        path.resolve(destination) === outputDirectory &&
        path.basename(source).startsWith('.zenn-')
      ) {
        injected = true;
        await originalRename(destination, displacedInstalled);
        await fs.ensureDir(destination);
        await fs.writeFile(path.join(destination, 'unrelated.txt'), 'replacement output data\n');
      }
      return result;
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /rollback retained paths for manual recovery/
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.strictEqual(injected, true);
    assert.ok(backupDirectory);
    assert.strictEqual(
      await fs.readFile(path.join(outputDirectory, 'unrelated.txt'), 'utf8'),
      'replacement output data\n'
    );
    assert.strictEqual(
      await fs.pathExists(path.join(displacedInstalled, 'manifest.json')),
      true
    );
    assert.strictEqual(
      await fs.pathExists(path.join(backupDirectory, 'manifest.json')),
      true
    );
  });

  test('identity固定cleanup後に差し替えられたbackupを再帰削除しない', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('directory cleanup race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-zenn-cleanup-race-');
    const first = await build(bookDirectory, outputRoot);
    const outputDirectory = first.outputDirectory;
    const originalRmdir = fs.rmdir;
    const originalRename = fs.rename;
    let replacementBackup;
    let displacedBackup;
    fs.rmdir = async (candidate, ...args) => {
      if (!replacementBackup && candidate.startsWith(`${outputDirectory}.backup-`)) {
        replacementBackup = candidate;
        displacedBackup = `${candidate}.validated-empty`;
        await originalRename(candidate, displacedBackup);
        await fs.ensureDir(candidate);
        await fs.writeFile(path.join(candidate, 'unrelated.txt'), 'concurrent backup data\n');
      }
      return originalRmdir(candidate, ...args);
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /backup cleanup failed; retained path/
      );
    } finally {
      fs.rmdir = originalRmdir;
    }
    assert.ok(replacementBackup);
    assert.strictEqual(
      await fs.readFile(path.join(replacementBackup, 'unrelated.txt'), 'utf8'),
      'concurrent backup data\n'
    );
    assert.deepStrictEqual(await fs.readdir(displacedBackup), []);
    assert.strictEqual(
      await fs.pathExists(path.join(outputDirectory, 'manifest.json')),
      true
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
