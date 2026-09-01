import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import fs from 'fs-extra';
import YAML from 'yaml';

import {
  AdapterBuildError,
  assertOutputDoesNotOverlapBookSources,
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
  const directory = await temporaryDirectory('tmp-web-mdbook-book-');
  await fs.copy(SAMPLE_BOOK, directory);
  return directory;
}

async function build(bookDirectory, outputRoot, editionId = 'free') {
  return buildStandardBookAdapter({
    bookDirectory,
    target: 'web-mdbook',
    editionId,
    outputRoot
  });
}

async function appendWorkflow(bookDirectory, source) {
  await fs.appendFile(path.join(bookDirectory, 'manuscript/02-workflow.md'), source, 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('WebMdbookAdapter', () => {
  test('free editionを正本順の決定的なmdBook projectへ変換する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-output-');
    const first = await build(bookDirectory, outputRoot);
    const target = first.outputDirectory;
    const firstFiles = (await fs.readdir(target)).sort();
    const firstWorkflow = await fs.readFile(
      path.join(target, 'src/manuscript/02-workflow.md'),
      'utf8'
    );

    assert.deepStrictEqual(firstFiles, ['book.toml', 'manifest.json', 'src', 'theme']);
    assert.strictEqual(first.manifest.adapter.implementation, 'web-mdbook-v1');
    assert.strictEqual(first.manifest.adapter.verified_mdbook_version, '0.5.4');
    assert.deepStrictEqual(
      first.manifest.documents.map((document) => document.id),
      ['introduction', 'workflow']
    );
    assert.match(firstWorkflow, /> \*\*Note\*\*/);
    assert.match(firstWorkflow, /> \*\*Tip\*\*/);
    assert.match(firstWorkflow, /> \*\*Warning\*\*/);
    assert.doesNotMatch(firstWorkflow, /:::|有償edition候補|内部向け候補/);
    assert.strictEqual(
      await fs.pathExists(path.join(target, 'src/backmatter/afterword.md')),
      false
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(target, 'src/SUMMARY.md'), 'utf8'),
      '# Summary\n\n' +
        '- [標準書籍フォーマットとは](manuscript/01-introduction.md)\n' +
        '- [正本から出力する流れ](manuscript/02-workflow.md)\n'
    );

    const bookToml = await fs.readFile(path.join(target, 'book.toml'), 'utf8');
    assert.match(bookToml, /build-dir = "book"/);
    assert.match(bookToml, /create-missing = false/);
    assert.match(bookToml, /additional-css = \["theme\/css\/itdo-mdbook\.css"\]/);
    assert.match(
      bookToml,
      /git-repository-url = "https:\/\/github\.com\/itdojp\/book-formatter"/
    );
    assert.doesNotMatch(bookToml, /edit-url-template/);
    assert.doesNotMatch(bookToml, /theme\s*=/);

    const publicMetadata = YAML.parse(await fs.readFile(path.join(target, 'src/book.yaml'), 'utf8'));
    assert.strictEqual(publicMetadata.edition.id, 'free');
    assert.strictEqual(publicMetadata.repository, undefined);
    assert.strictEqual(publicMetadata.structure, undefined);

    await fs.writeFile(path.join(target, 'stale.html'), 'stale\n');
    const second = await build(bookDirectory, outputRoot);
    assert.strictEqual(await fs.pathExists(path.join(target, 'stale.html')), false);
    assert.strictEqual(
      await fs.readFile(path.join(target, 'src/manuscript/02-workflow.md'), 'utf8'),
      firstWorkflow
    );
    assert.deepStrictEqual(second.manifest, first.manifest);
  });

  test('paid editionはpaid block/documentを含みinternal block/documentを除外する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-paid-output-');
    const result = await build(bookDirectory, outputRoot, 'paid');
    const workflow = await fs.readFile(
      path.join(result.outputDirectory, 'src/manuscript/02-workflow.md'),
      'utf8'
    );

    assert.match(workflow, /この範囲は有償edition候補です/);
    assert.doesNotMatch(workflow, /この範囲は内部向け候補です|:::paid|:::internal/);
    assert.strictEqual(
      await fs.pathExists(path.join(result.outputDirectory, 'src/backmatter/afterword.md')),
      true
    );
    assert.strictEqual(
      await fs.pathExists(path.join(result.outputDirectory, 'src/backmatter/internal-notes.md')),
      false
    );
  });

  test('reader-visible raw HTMLを有限に禁止しfenced literalを許可する', async () => {
    const unsafeInputs = [
      '<template shadowrootmode="open"><slot></slot></template>',
      '<slot name="paid"></slot>',
      '<iframe srcdoc="<p>nested</p>"></iframe>',
      '<iframe src="data:text/html,nested"></iframe>',
      '<!-- reader-visible metadata -->'
    ];

    for (const [index, unsafe] of unsafeInputs.entries()) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory(`tmp-web-mdbook-raw-${index}-`);
      await appendWorkflow(bookDirectory, `\n${unsafe}\n`);
      await assert.rejects(
        build(bookDirectory, outputRoot),
        (error) =>
          error instanceof AdapterBuildError &&
          /Reader-visible raw HTML is not supported/.test(error.message)
      );
    }

    const dryRunBook = await copySampleBook();
    const dryRunOutput = await temporaryDirectory('tmp-web-mdbook-raw-dry-run-');
    await appendWorkflow(dryRunBook, '\n<iframe srcdoc="nested"></iframe>\n');
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: dryRunBook,
        target: 'web-mdbook',
        editionId: 'free',
        outputRoot: dryRunOutput,
        dryRun: true
      }),
      /Reader-visible raw HTML is not supported/
    );
    assert.strictEqual(await fs.pathExists(path.join(dryRunOutput, 'web-mdbook')), false);

    const safeBook = await copySampleBook();
    const safeOutput = await temporaryDirectory('tmp-web-mdbook-fenced-html-');
    await appendWorkflow(
      safeBook,
      '\n```html\n<template shadowrootmode="open"><slot></slot></template>\n```\n'
    );
    const result = await build(safeBook, safeOutput);
    assert.match(
      await fs.readFile(path.join(result.outputDirectory, 'src/manuscript/02-workflow.md'), 'utf8'),
      /<template shadowrootmode="open">/
    );
  });

  test('mdBook file directiveをfenced literalを含めfail closedで拒否する', async () => {
    const directives = [
      '{{#include ../assets/fixture.txt}}',
      '{{#rustdoc_include ../assets/fixture.rs:fixture}}',
      '{{#playground ../assets/fixture.rs}}',
      '```text\n{{#include ../assets/fixture.txt}}\n```'
    ];

    for (const [index, directive] of directives.entries()) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory(`tmp-web-mdbook-directive-${index}-`);
      await appendWorkflow(bookDirectory, `\n${directive}\n`);
      await assert.rejects(
        build(bookDirectory, outputRoot),
        (error) =>
          error instanceof AdapterBuildError &&
          /mdBook file directive is not allowed/.test(error.message)
      );
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'web-mdbook')), false);
    }

    const excludedBook = await copySampleBook();
    const excludedOutput = await temporaryDirectory('tmp-web-mdbook-excluded-directive-');
    await appendWorkflow(
      excludedBook,
      '\n:::paid\n{{#include ../assets/paid-fixture.txt}}\n:::\n'
    );
    const result = await build(excludedBook, excludedOutput);
    assert.doesNotMatch(
      await fs.readFile(path.join(result.outputDirectory, 'src/manuscript/02-workflow.md'), 'utf8'),
      /#include/u
    );

    const summaryBook = await copySampleBook();
    const summaryOutput = await temporaryDirectory('tmp-web-mdbook-summary-directive-');
    const metadataPath = path.join(summaryBook, 'book.yaml');
    const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
    metadata.structure.chapters[0].title = '{{#include ../assets/title.txt}}';
    await fs.writeFile(metadataPath, YAML.stringify(metadata));
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: summaryBook,
        target: 'web-mdbook',
        editionId: 'free',
        outputRoot: summaryOutput,
        dryRun: true
      }),
      /mdBook file directive is not allowed in generated SUMMARY\.md/
    );
  });

  test('参照assetだけを複製しlink境界をfail closedにする', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-assets-output-');
    await fs.writeFile(
      path.join(bookDirectory, 'assets/diagram.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint" /></defs>' +
        '<rect fill="url(#paint)" /></svg>\n'
    );
    await fs.writeFile(path.join(bookDirectory, 'assets/unreferenced.txt'), 'do not copy\n');
    await appendWorkflow(bookDirectory, '\n![変換図](../assets/diagram.svg)\n');
    const result = await build(bookDirectory, outputRoot);
    assert.strictEqual(
      await fs.readFile(path.join(result.outputDirectory, 'src/assets/diagram.svg'), 'utf8'),
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint" /></defs>' +
        '<rect fill="url(#paint)" /></svg>\n'
    );
    assert.strictEqual(
      await fs.pathExists(path.join(result.outputDirectory, 'src/assets/unreferenced.txt')),
      false
    );

    const cases = [
      ['![hotlink](https://assets.example/image.png)', /Unsupported external image/],
      ['[danger](javascript:alert(1))', /Unsupported external link/],
      ['[excluded](../backmatter/afterword.md)', /must be an included Markdown document/],
      ['[outside](../../README.md)', /resolves outside the book root/],
      ['[root](/private/path)', /Root\/protocol-relative link is not allowed/],
      ['![embedded](data:image/png;base64,AAAA)', /Unsupported external image/]
    ];
    for (const [index, [markdown, expected]] of cases.entries()) {
      const unsafeBook = await copySampleBook();
      const unsafeOutput = await temporaryDirectory(`tmp-web-mdbook-link-${index}-`);
      await appendWorkflow(unsafeBook, `\n${markdown}\n`);
      await assert.rejects(build(unsafeBook, unsafeOutput), expected);
    }

    const unsafeSvgCases = [
      ['<svg><script>blocked</script></svg>', /active element <script>/],
      ['<svg onload="blocked"></svg>', /event-handler attribute onload/],
      [
        '<svg><image href="https://assets.example/pixel.png" /></svg>',
        /non-local href reference/
      ],
      ['<svg><style>rect { fill: red; }</style></svg>', /active element <style>/],
      ['<svg><foreignObject>blocked</foreignObject></svg>', /active element <foreignObject>/],
      ['<svg><animate attributeName="x" /></svg>', /active element <animate>/],
      [
        '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>blocked</s:script></svg>',
        /active element <s:script>/
      ],
      [
        '<svg xml:base="https://assets.example/"><use href="#shape" /></svg>',
        /alternate base URL/
      ],
      ['<svg><rect fill="u\\72l(https://assets.example/pixel)" /></svg>', /ambiguous escaped/]
    ];
    for (const [index, [svg, expected]] of unsafeSvgCases.entries()) {
      const unsafeBook = await copySampleBook();
      const unsafeOutput = await temporaryDirectory(`tmp-web-mdbook-svg-${index}-`);
      await fs.writeFile(path.join(unsafeBook, 'assets/payload.svg'), svg);
      await appendWorkflow(unsafeBook, '\n[open](../assets/payload.svg)\n');
      await assert.rejects(build(unsafeBook, unsafeOutput), expected);
    }

    for (const extension of ['htm', 'html', 'xhtml', 'xml', 'svgz']) {
      const activeDocumentBook = await copySampleBook();
      const activeDocumentOutput = await temporaryDirectory(
        `tmp-web-mdbook-active-document-${extension}-`
      );
      await fs.writeFile(
        path.join(activeDocumentBook, `assets/payload.${extension}`),
        '<script>blocked</script>\n'
      );
      await appendWorkflow(activeDocumentBook, `\n[open](../assets/payload.${extension})\n`);
      await assert.rejects(
        build(activeDocumentBook, activeDocumentOutput),
        new RegExp(`Unsupported web asset extension \\.${extension}`)
      );
    }
  });

  test('未知producerの既存出力を上書きしない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-owner-output-');
    const target = path.join(outputRoot, 'web-mdbook');
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'owner.txt'), 'foreign\n');

    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory,
        target: 'web-mdbook',
        editionId: 'free',
        outputRoot,
        dryRun: true
      }),
      /Refusing to replace output without a valid adapter manifest/
    );
    await assert.rejects(
      build(bookDirectory, outputRoot),
      /Refusing to replace output without a valid adapter manifest/
    );
    assert.strictEqual(await fs.readFile(path.join(target, 'owner.txt'), 'utf8'), 'foreign\n');
  });

  test('出力target配下のcanonical bookをdry-runと実buildの両方で保護する', async () => {
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-book-ancestor-output-');
    const target = path.join(outputRoot, 'web-mdbook');
    const bookDirectory = path.join(target, 'canonical-book');
    await fs.ensureDir(target);
    await fs.writeJson(path.join(target, 'manifest.json'), {
      kind: 'book-formatter.adapter-build',
      adapter: { target: 'web-mdbook' }
    });
    await fs.copy(SAMPLE_BOOK, bookDirectory);
    const canonicalMarker = path.join(bookDirectory, 'manuscript/01-introduction.md');
    const original = await fs.readFile(canonicalMarker, 'utf8');

    for (const dryRun of [true, false]) {
      await assert.rejects(
        buildStandardBookAdapter({
          bookDirectory,
          target: 'web-mdbook',
          editionId: 'free',
          outputRoot,
          dryRun
        }),
        /Output directory must not overlap the canonical book or declared sources/
      );
      assert.strictEqual(await fs.readFile(canonicalMarker, 'utf8'), original);
    }
  });

  test('filesystem identityでbind aliasの出力内包とsource配下を拒否する', async () => {
    const directoryEntry = { isDirectory: () => true, isSymbolicLink: () => false };
    const fileEntry = { isDirectory: () => false, isSymbolicLink: () => false };
    const entryFor = (candidate, identities, files = new Set()) => {
      if (!identities.has(candidate)) return null;
      return files.has(candidate) ? fileEntry : directoryEntry;
    };
    const baseIdentities = new Map([
      ['/canonical/book', { dev: 7, ino: 20 }],
      ['/canonical/book/book.yaml', { dev: 7, ino: 24 }],
      ['/canonical/book/manuscript', { dev: 7, ino: 21 }],
      ['/canonical/book/manuscript/nested', { dev: 7, ino: 23 }],
      ['/canonical/book/assets', { dev: 7, ino: 22 }],
      ['/alias', { dev: 7, ino: 30 }],
      ['/', { dev: 7, ino: 1 }]
    ]);

    const bindOutputIdentities = new Map([
      ...baseIdentities,
      ['/alias/output', { dev: 7, ino: 31 }],
      ['/alias/output/canonical-book', { dev: 7, ino: 20 }]
    ]);
    await assert.rejects(
      assertOutputDoesNotOverlapBookSources(
        '/canonical/book',
        ['/canonical/book/manuscript', '/canonical/book/assets'],
        '/alias/output',
        {
          lstat: async (candidate) => entryFor(
            candidate,
            bindOutputIdentities,
            new Set(['/canonical/book/book.yaml'])
          ),
          readdir: async (candidate) => {
            if (candidate === '/canonical/book/manuscript') return ['nested'];
            if (candidate === '/alias/output') return ['canonical-book'];
            return [];
          },
          realpath: async (candidate) => candidate,
          stat: async (candidate) => bindOutputIdentities.get(candidate)
        }
      ),
      /Output directory must not overlap the canonical book or declared sources/
    );

    const sourceDescendantIdentities = new Map([
      ...baseIdentities,
      ['/alias/output', { dev: 7, ino: 31 }],
      ['/alias/output/source-subtree', { dev: 7, ino: 23 }]
    ]);
    await assert.rejects(
      assertOutputDoesNotOverlapBookSources(
        '/canonical/book',
        ['/canonical/book/manuscript', '/canonical/book/assets'],
        '/alias/output',
        {
          lstat: async (candidate) => entryFor(
            candidate,
            sourceDescendantIdentities,
            new Set(['/canonical/book/book.yaml'])
          ),
          readdir: async (candidate) => {
            if (candidate === '/canonical/book/manuscript') return ['nested'];
            if (candidate === '/alias/output') return ['source-subtree'];
            return [];
          },
          realpath: async (candidate) => candidate,
          stat: async (candidate) => sourceDescendantIdentities.get(candidate)
        }
      ),
      /Output directory must not overlap the canonical book or declared sources/
    );

    const sourceAliasIdentities = new Map([
      ...baseIdentities,
      ['/alias/output', { dev: 7, ino: 21 }]
    ]);
    await assert.rejects(
      assertOutputDoesNotOverlapBookSources(
        '/canonical/book',
        ['/canonical/book/manuscript', '/canonical/book/assets'],
        '/alias/output',
        {
          lstat: async (candidate) => entryFor(
            candidate,
            sourceAliasIdentities,
            new Set(['/canonical/book/book.yaml'])
          ),
          readdir: async () => [],
          realpath: async (candidate) => candidate,
          stat: async (candidate) => sourceAliasIdentities.get(candidate)
        }
      ),
      /Output directory must not overlap the canonical book or declared sources/
    );

    const metadataAliasIdentities = new Map([
      ...baseIdentities,
      ['/alias/output', { dev: 7, ino: 31 }],
      ['/alias/output/metadata', { dev: 7, ino: 24 }]
    ]);
    await assert.rejects(
      assertOutputDoesNotOverlapBookSources(
        '/canonical/book',
        ['/canonical/book/manuscript', '/canonical/book/assets'],
        '/alias/output',
        {
          lstat: async (candidate) => entryFor(
            candidate,
            metadataAliasIdentities,
            new Set(['/canonical/book/book.yaml', '/alias/output/metadata'])
          ),
          readdir: async (candidate) => candidate === '/alias/output' ? ['metadata'] : [],
          realpath: async (candidate) => candidate,
          stat: async (candidate) => metadataAliasIdentities.get(candidate)
        }
      ),
      /Output directory must not overlap the canonical book or declared sources/
    );

    const duplicateViewIdentities = new Map([
      ...baseIdentities,
      ['/alias/output', { dev: 7, ino: 31 }],
      ['/alias/output/a', { dev: 7, ino: 32 }],
      ['/alias/output/b', { dev: 7, ino: 32 }],
      ['/alias/output/b/slot', { dev: 7, ino: 23 }]
    ]);
    await assert.rejects(
      assertOutputDoesNotOverlapBookSources(
        '/canonical/book',
        ['/canonical/book/manuscript', '/canonical/book/assets'],
        '/alias/output',
        {
          lstat: async (candidate) => entryFor(
            candidate,
            duplicateViewIdentities,
            new Set(['/canonical/book/book.yaml'])
          ),
          readdir: async (candidate) => {
            if (candidate === '/canonical/book/manuscript') return ['nested'];
            if (candidate === '/alias/output') return ['a', 'b'];
            if (candidate === '/alias/output/b') return ['slot'];
            return [];
          },
          realpath: async (candidate) => candidate,
          stat: async (candidate) => duplicateViewIdentities.get(candidate)
        }
      ),
      /Output directory must not overlap the canonical book or declared sources/
    );
  });

  test('backup cleanupが部分失敗しても新outputを欠損backupへrollbackしない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-backup-cleanup-output-');
    const initial = await build(bookDirectory, outputRoot);
    await fs.writeFile(path.join(initial.outputDirectory, 'old-only.txt'), 'old\n');

    const remove = fs.remove;
    let retainedBackup;
    fs.remove = async (candidate) => {
      if (path.basename(String(candidate)).startsWith('web-mdbook.backup-')) {
        retainedBackup = candidate;
        await remove(path.join(candidate, 'old-only.txt'));
        const error = new Error('injected partial backup cleanup failure');
        error.code = 'EIO';
        throw error;
      }
      return remove(candidate);
    };

    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /New output was installed, but backup cleanup failed; retained path:/
      );
    } finally {
      fs.remove = remove;
    }

    assert.ok(retainedBackup);
    assert.strictEqual(await fs.pathExists(retainedBackup), true);
    assert.strictEqual(await fs.pathExists(path.join(initial.outputDirectory, 'book.toml')), true);
    assert.strictEqual(await fs.pathExists(path.join(initial.outputDirectory, 'old-only.txt')), false);
  });

  test('SUMMARYへ改行を注入するstructure titleを拒否する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-summary-title-');
    const metadataPath = path.join(bookDirectory, 'book.yaml');
    const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
    metadata.structure.chapters[0].title = '正規タイトル\n- [注入](https://example.invalid)';
    await fs.writeFile(metadataPath, YAML.stringify(metadata));

    await assert.rejects(build(bookDirectory, outputRoot), /single-line display text/);
  });

  test('SUMMARY titleのraw HTMLをdisplay textへescapeする', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-web-mdbook-summary-html-');
    const metadataPath = path.join(bookDirectory, 'book.yaml');
    const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
    metadata.structure.chapters[0].title = '<script>unsafe</script> & [表示]';
    await fs.writeFile(metadataPath, YAML.stringify(metadata));

    const result = await build(bookDirectory, outputRoot);
    const summary = await fs.readFile(path.join(result.outputDirectory, 'src/SUMMARY.md'), 'utf8');
    assert.ok(summary.includes('&lt;script&gt;unsafe&lt;/script&gt; &amp; \\[表示\\]'));
    assert.ok(!summary.includes('<script>'));
    assert.ok(!summary.includes('</script>'));
  });

  test('GitHub clone URLをWeb URLへ正規化してrepository linkへ使用する', async () => {
    const repositoryUrls = [
      'https://github.com/itdojp/standard-book-example.git',
      'https://GITHUB.COM/itdojp/standard-book-example.git/',
      'https://github.com:443/itdojp/standard-book-example'
    ];

    for (const [index, repositoryUrl] of repositoryUrls.entries()) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory(`tmp-web-mdbook-repository-normalize-${index}-`);
      const metadataPath = path.join(bookDirectory, 'book.yaml');
      const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.repository.url = repositoryUrl;
      await fs.writeFile(metadataPath, YAML.stringify(metadata));

      const result = await build(bookDirectory, outputRoot);
      const bookToml = await fs.readFile(path.join(result.outputDirectory, 'book.toml'), 'utf8');
      assert.match(
        bookToml,
        /git-repository-url = "https:\/\/github\.com\/itdojp\/standard-book-example"/
      );
      assert.doesNotMatch(bookToml, /edit-url-template/);
      assert.ok(!bookToml.includes('standard-book-example.git/edit/'));
    }
  });

  test('GitHub以外またはrepository root以外のURLをrepository linkとして拒否する', async () => {
    const unsupportedUrls = [
      'https://gitlab.example/itdojp/standard-book-example',
      'https://github.com/itdojp/standard-book-example/tree/main',
      'https://github.com/itdojp/standard-book-example?tab=readme',
      'https://github.com/itdojp/standard-book-example#readme',
      'https://github.com/itdojp/standard-book-example?',
      'https://github.com/itdojp/standard-book-example#',
      'https://github.com/itdojp/extra/../standard-book-example',
      'https://github.com/itdojp/%2e/standard-book-example',
      'https://github.com/itdojp/standard-book-example/.',
      'https://github.com/itdojp/standard-book-example%2Fextra',
      'https://github.com/_/standard-book-example',
      'https://github.com/owner-/standard-book-example',
      'https://github.com/owner--name/standard-book-example',
      'https://github.com:8443/itdojp/standard-book-example'
    ];

    for (const [index, repositoryUrl] of unsupportedUrls.entries()) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory(`tmp-web-mdbook-repository-reject-${index}-`);
      const metadataPath = path.join(bookDirectory, 'book.yaml');
      const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.repository.url = repositoryUrl;
      await fs.writeFile(metadataPath, YAML.stringify(metadata));

      const isUnsupportedRepositoryError = (error) =>
        error instanceof AdapterBuildError &&
        /web-mdbook repository\.url must/.test(error.message);
      await assert.rejects(
        buildStandardBookAdapter({
          bookDirectory,
          target: 'web-mdbook',
          editionId: 'free',
          outputRoot,
          dryRun: true
        }),
        isUnsupportedRepositoryError
      );
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'web-mdbook')), false);
      await assert.rejects(build(bookDirectory, outputRoot), isUnsupportedRepositoryError);
    }
  });
});
