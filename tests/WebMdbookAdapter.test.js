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
});
