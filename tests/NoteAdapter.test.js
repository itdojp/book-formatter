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
  const directory = await temporaryDirectory('tmp-note-book-');
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

async function build(bookDirectory, outputRoot, editionId = 'paid', dryRun = false) {
  return buildStandardBookAdapter({
    bookDirectory,
    target: 'note',
    editionId,
    outputRoot,
    dryRun
  });
}

function packageDirectory(result) {
  return path.join(result.outputDirectory, 'standard-book-example');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('NoteAdapter', () => {
  test('paid editionを無料・有料fragmentと手動公開packageへ決定的に分離する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-output-');
    const first = await build(bookDirectory, outputRoot);
    const output = packageDirectory(first);
    const freeMarkdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const freeHtml = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');
    const noteManifest = YAML.parse(
      await fs.readFile(path.join(output, 'note-publish-manifest.yaml'), 'utf8'),
      { uniqueKeys: true }
    );
    const checklist = await fs.readFile(path.join(output, 'publish-checklist.md'), 'utf8');
    const commonManifest = await fs.readFile(first.manifestPath, 'utf8');
    const firstNoteManifest = await fs.readFile(
      path.join(output, 'note-publish-manifest.yaml'),
      'utf8'
    );

    assert.strictEqual(first.manifest.adapter.implementation, 'note-v1');
    assert.strictEqual(first.manifest.adapter.project_format, 'note-manual-package');
    assert.strictEqual(first.manifest.adapter.manual_operation_required, true);
    assert.deepStrictEqual(noteManifest.paid_line, {
      placement: 'between-paragraphs',
      after: '01-free-sample.md',
      before: '02-paid-body.md'
    });
    assert.deepStrictEqual(noteManifest.fragments.free_sample.document_ids, [
      'preface',
      'introduction'
    ]);
    assert.deepStrictEqual(noteManifest.fragments.paid_body.document_ids, [
      'workflow',
      'afterword'
    ]);
    assert.deepStrictEqual(noteManifest.warnings, [
      {
        code: 'relative_link_requires_manual_review',
        file: 'manuscript/02-workflow.md',
        line: 15
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 31
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 35
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 39
      }
    ]);
    assert.match(freeMarkdown, /^## はじめに$/mu);
    assert.match(freeMarkdown, /^## 標準書籍フォーマットとは$/mu);
    assert.doesNotMatch(freeMarkdown, /有償edition候補|内部向け候補/u);
    assert.match(paidMarkdown, /^## 正本から出力する流れ$/mu);
    assert.match(paidMarkdown, /この範囲は有償edition候補です/u);
    assert.doesNotMatch(paidMarkdown, /この範囲は内部向け候補です/u);
    assert.doesNotMatch(`${freeMarkdown}${paidMarkdown}`, /:::paid|:::internal/u);
    assert.match(paidMarkdown, /> \*\*NOTE\*\*/u);
    assert.match(paidHtml, /<blockquote>/u);
    assert.doesNotMatch(`${freeHtml}${paidHtml}`, /:::paid|:::internal/u);
    assert.match(checklist, /noteへ自動投稿しません/u);
    assert.match(checklist, /シークレットモード/u);
    assert.ok(!commonManifest.includes(bookDirectory));
    assert.ok(!commonManifest.includes('内部向け候補'));

    await fs.writeFile(path.join(first.outputDirectory, 'stale.txt'), 'stale\n');
    const second = await build(bookDirectory, outputRoot);
    assert.strictEqual(await fs.pathExists(path.join(second.outputDirectory, 'stale.txt')), false);
    assert.strictEqual(await fs.readFile(second.manifestPath, 'utf8'), commonManifest);
    assert.strictEqual(
      await fs.readFile(path.join(packageDirectory(second), 'note-publish-manifest.yaml'), 'utf8'),
      firstNoteManifest
    );
  });

  test('sample内のpaid blockをfreeから除外しpaid側だけへ配置する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        'adapterによる変換は後続Issueで扱います。\n\n' +
        ':::paid\n' +
        'この範囲は有償edition候補です。\n' +
        ':::\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-regions-'));
    const freeMarkdown = await fs.readFile(
      path.join(packageDirectory(result), '01-free-sample.md'),
      'utf8'
    );
    const paidMarkdown = await fs.readFile(
      path.join(packageDirectory(result), '02-paid-body.md'),
      'utf8'
    );

    assert.match(freeMarkdown, /adapterによる変換は後続Issueで扱います/u);
    assert.doesNotMatch(freeMarkdown, /この範囲は有償edition候補です/u);
    assert.match(paidMarkdown, /この範囲は有償edition候補です/u);
    assert.doesNotMatch(paidMarkdown, /adapterによる変換は後続Issueで扱います/u);
  });

  test('無料範囲が有料範囲の後へ再出現する非単調構成を拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    await appendWorkflow(bookDirectory, '\n有料block後に再出現する無料本文です。\n');

    await assert.rejects(
      build(bookDirectory, await temporaryDirectory('tmp-note-non-monotonic-')),
      /Free-sample content must be a single prefix before the note paid line/
    );
  });

  test('fragment先頭のcode indentと末尾のMarkdown空白を保持する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        '    paid code\n' +
        '\n' +
        'paid hard break  \n' +
        'next paid line\n\n' +
        ':::note\n' +
        '```text\n' +
        'literal code  \n' +
        '```\n' +
        ':::\n',
      'utf8'
    );

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-whitespace-'));
    const output = packageDirectory(result);
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');

    assert.match(paidMarkdown, /\n {4}paid code\n\npaid hard break {2}\nnext paid line/u);
    assert.match(paidMarkdown, /> literal code {2}\n/u);
    assert.match(paidHtml, /<pre><code>paid code\n<\/code><\/pre>/u);
    assert.match(paidHtml, /paid hard break<br>\nnext paid line/u);
    assert.match(paidHtml, /literal code {2}\n/u);
  });

  test('文書間で重複するreferenceとfootnoteをnamespaceしcode literalを保持する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'frontmatter/preface.md'),
      '# はじめに\n\n' +
        '[first][shared] [shared][] [quoted][z-quoted] [^note]\n\n' +
        'x < [shared] > y\n\n' +
        'Text [shared]: remains visible.\n\n' +
        '`[shared] [^note]`\n\n' +
        '`literal\\` [after][shared] `later`\n\n' +
        '```text\n[shared] [^note]\n```\n\n' +
        '<span data-test="1 > 0" data-label="[shared]">metadata</span>\n\n' +
        '<span\n data-label="[shared]">multiline metadata</span>\n\n' +
        '[shared]: https://first.example/reference\n' +
        '> [z-quoted]: https://first.example/quoted\n' +
        '[shared]: https://ignored.example/duplicate\n' +
        '[^note]: first footnote\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/01-introduction.md'),
      '# 第1章 標準書籍フォーマットとは\n\n' +
        '[second][shared] [shared] [^note]\n\n' +
        '[inline](https://second.example/[shared])\n\n' +
        '[shared]: https://second.example/reference\n' +
        '[^note]: second footnote\n',
      'utf8'
    );

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-labels-'));
    const output = packageDirectory(result);
    const markdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const html = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');

    assert.match(markdown, /\[first\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[shared\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[quoted\]\[note-preface-free-ref-2\]/u);
    assert.match(markdown, /x < \[shared\]\[note-preface-free-ref-1\] > y/u);
    assert.match(markdown, /Text \[shared\]\[note-preface-free-ref-1\]: remains visible\./u);
    assert.match(markdown, /\[\^note-preface-free-fn-1\]/u);
    assert.match(markdown, /\[note-preface-free-ref-1\]: https:\/\/first\.example\/reference/u);
    assert.match(markdown, /> \[note-preface-free-ref-2\]: https:\/\/first\.example\/quoted/u);
    assert.match(markdown, /\[\^note-preface-free-fn-1\]: first footnote/u);
    assert.match(markdown, /\[second\]\[note-introduction-free-ref-1\]/u);
    assert.match(markdown, /\[shared\]\[note-introduction-free-ref-1\]/u);
    assert.match(markdown, /\[\^note-introduction-free-fn-1\]/u);
    assert.match(
      markdown,
      /\[note-introduction-free-ref-1\]: https:\/\/second\.example\/reference/u
    );
    assert.match(markdown, /\[\^note-introduction-free-fn-1\]: second footnote/u);
    assert.match(markdown, /`\[shared\] \[\^note\]`/u);
    assert.match(markdown, /`literal\\` \[after\]\[note-preface-free-ref-1\] `later`/u);
    assert.match(markdown, /```text\n\[shared\] \[\^note\]\n```/u);
    assert.match(markdown, /<span data-test="1 > 0" data-label="\[shared\]">metadata<\/span>/u);
    assert.match(markdown, /<span\n data-label="\[shared\]">multiline metadata<\/span>/u);
    assert.match(markdown, /\[inline\]\(https:\/\/second\.example\/\[shared\]\)/u);
    assert.doesNotMatch(markdown, /^\[shared\]:/mu);
    assert.doesNotMatch(markdown, /^\[\^note\]:/mu);

    assert.match(html, /href="https:\/\/first\.example\/reference"/u);
    assert.doesNotMatch(html, /ignored\.example\/duplicate/u);
    assert.match(html, /href="https:\/\/first\.example\/quoted"/u);
    assert.match(html, /href="https:\/\/second\.example\/reference"/u);
    assert.match(html, /x &lt; <a href="https:\/\/first\.example\/reference">shared<\/a> &gt; y/u);
    assert.match(html, /id="fnref-preface-1"/u);
    assert.match(html, /id="fn-preface-1"/u);
    assert.match(html, /id="fnref-introduction-1"/u);
    assert.match(html, /id="fn-introduction-1"/u);
    assert.doesNotMatch(html, />note-(?:preface|introduction)-ref-/u);
    assert.strictEqual(new Set([...html.matchAll(/id="(fn(?:ref)?-[^"]+)"/gu)]
      .map((match) => match[1])).size, 4);
  });

  test('freeとpaid fragmentへ可視なreferenceとfootnote定義を補完する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        'free [shared] [^note]\n\n' +
        ':::paid\n' +
        'paid [shared] [^note]\n' +
        ':::\n\n' +
        '[shared]: <https://shared.example/a%20b>\n' +
        '  "Shared title"\n' +
        '[shared]: https://ignored.example/duplicate\n' +
        '[z-nested]: https://shared.example/nested\n' +
        '[^note]: shared footnote with [z-nested]\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-shared-defs-'));
    const output = packageDirectory(result);
    const freeMarkdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const freeHtml = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');

    assert.match(freeMarkdown, /free \[shared\]\[note-workflow-free-ref-1\] \[\^note-workflow-free-fn-1\]/u);
    assert.match(freeMarkdown, /\[note-workflow-free-ref-1\]: <https:\/\/shared\.example\/a%20b>\n {2}"Shared title"/u);
    assert.match(freeMarkdown, /\[\^note-workflow-free-fn-1\]: shared footnote with \[z-nested\]\[note-workflow-free-ref-2\]/u);
    assert.match(paidMarkdown, /paid \[shared\]\[note-workflow-paid-ref-1\] \[\^note-workflow-paid-fn-1\]/u);
    assert.match(paidMarkdown, /\[note-workflow-paid-ref-1\]: <https:\/\/shared\.example\/a%20b> "Shared title"/u);
    assert.match(paidMarkdown, /\[\^note-workflow-paid-fn-1\]: shared footnote with \[z-nested\]\[note-workflow-paid-ref-2\]/u);
    assert.match(paidMarkdown, /\[note-workflow-paid-ref-2\]: <https:\/\/shared\.example\/nested>/u);
    assert.doesNotMatch(paidMarkdown, /%2520/u);
    assert.match(freeHtml, /href="https:\/\/shared\.example\/a%20b" title="Shared title"/u);
    assert.match(paidHtml, /href="https:\/\/shared\.example\/a%20b" title="Shared title"/u);
    assert.doesNotMatch(freeHtml, /ignored\.example\/duplicate/u);
    assert.doesNotMatch(paidHtml, /ignored\.example\/duplicate/u);
    assert.match(freeHtml, /id="fn-workflow-1"/u);
    assert.match(paidHtml, /id="fn-workflow-1"/u);
  });

  test('free fragmentから不可視なreferenceまたはfootnote定義への依存を拒否する', async () => {
    const cases = [
      {
        body: 'free [hidden]\n\n:::paid\n\n[hidden]: https://hidden.example/reference\npaid body\n\n:::\n',
        expected: /free-sample fragment reference definition is outside its visible source/
      },
      {
        body: 'free [^hidden]\n\n:::paid\n\n[^hidden]: hidden footnote\npaid body\n\n:::\n',
        expected: /free-sample fragment footnote definition is outside its visible source/
      }
    ];
    for (const [index, item] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      await fs.writeFile(
        path.join(bookDirectory, 'manuscript/02-workflow.md'),
        `# 第2章 正本から出力する流れ\n\n${item.body}`,
        'utf8'
      );
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
      });
      await assert.rejects(
        build(bookDirectory, await temporaryDirectory(`tmp-note-hidden-def-${index}-`)),
        item.expected,
        `hidden definition case ${index} must fail closed`
      );
    }
  });

  test('生成titleは可視single-lineに制限しMarkdown punctuationをescapeする', async () => {
    const multilineBook = await copySampleBook();
    await updateMetadata(multilineBook, (metadata) => {
      metadata.structure.frontmatter[0].title = 'unsafe\n## injected';
    });
    await assert.rejects(
      build(multilineBook, await temporaryDirectory('tmp-note-title-line-')),
      /structure title preface must be a visible single-line string/
    );

    const multilineBookTitle = await copySampleBook();
    await updateMetadata(multilineBookTitle, (metadata) => {
      metadata.title = 'unsafe\n# injected';
    });
    await assert.rejects(
      build(multilineBookTitle, await temporaryDirectory('tmp-note-book-title-line-')),
      /book title must be a visible single-line string/
    );

    const escapedBook = await copySampleBook();
    await updateMetadata(escapedBook, (metadata) => {
      metadata.title = '[Book](https://book.example)';
      metadata.structure.frontmatter[0].title = '[Generated](https://title.example)';
    });
    const result = await build(escapedBook, await temporaryDirectory('tmp-note-title-escape-'));
    const output = packageDirectory(result);
    const markdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const html = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const checklist = await fs.readFile(path.join(output, 'publish-checklist.md'), 'utf8');

    assert.ok(markdown.includes('## \\[Generated\\]\\(https\\:\\/\\/title\\.example\\)\n'));
    assert.match(html, /<h2>\[Generated\]\(https:\/\/title\.example\)<\/h2>/u);
    assert.doesNotMatch(html, /href="https:\/\/title\.example/u);
    assert.ok(checklist.includes('「\\[Book\\]\\(https\\:\\/\\/book\\.example\\)」'));
    assert.doesNotMatch(checklist, /\[Book\]\(https:\/\/book\.example\)/u);
  });

  test('画像とPDFを候補としてcopyし外部・非対応画像をredacted warningにする', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-assets-');
    await fs.ensureDir(path.join(bookDirectory, 'assets/figures'));
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow.png'), 'png bytes');
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/vector.svg'), '<svg></svg>');
    await fs.writeFile(path.join(bookDirectory, 'assets/guide.pdf'), '%PDF-1.4\n');
    await appendWorkflow(
      bookDirectory,
      '\n![flow](../assets/figures/flow.png)\n' +
        '![vector](../assets/figures/vector.svg)\n' +
        '![external](https://assets.example/image.png)\n'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/guide.pdf'];
    });

    const result = await build(bookDirectory, outputRoot);
    const noteManifest = YAML.parse(
      await fs.readFile(
        path.join(packageDirectory(result), 'note-publish-manifest.yaml'),
        'utf8'
      ),
      { uniqueKeys: true }
    );
    assert.deepStrictEqual(noteManifest.image_candidates, [{
      source: 'assets/figures/flow.png',
      destination: 'assets/figures/flow.png',
      documents: ['manuscript/02-workflow.md']
    }]);
    assert.deepStrictEqual(noteManifest.attachment_candidates, [{
      source: 'assets/guide.pdf',
      destination: 'assets/guide.pdf'
    }]);
    assert.deepStrictEqual(
      noteManifest.warnings.filter((warning) => warning.file === 'manuscript/02-workflow.md')
        .map((warning) => warning.code),
      [
        'relative_link_requires_manual_review',
        'callout_degraded_to_blockquote',
        'callout_degraded_to_blockquote',
        'callout_degraded_to_blockquote',
        'image_requires_manual_upload',
        'unsupported_image_requires_manual_conversion',
        'external_or_root_image_requires_manual_upload'
      ]
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(packageDirectory(result), 'assets/figures/flow.png')),
      Buffer.from('png bytes')
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(packageDirectory(result), 'assets/guide.pdf')),
      Buffer.from('%PDF-1.4\n')
    );
    const html = await fs.readFile(path.join(packageDirectory(result), '02-paid-body.html'), 'utf8');
    assert.match(html, /src="assets\/figures\/flow\.png"/u);
    assert.match(html, /\[画像を手動挿入: vector\]/u);
    assert.ok(!JSON.stringify(noteManifest).includes(bookDirectory));
  });

  test('画像・添付のroot外、symlink、過大fileをfail closedで拒否する', async (context) => {
    const outsideBook = await copySampleBook();
    await appendWorkflow(outsideBook, '\n![outside](../../outside.png)\n');
    await assert.rejects(
      build(outsideBook, await temporaryDirectory('tmp-note-outside-')),
      /must be below the declared assets directory/
    );

    const largeAttachmentBook = await copySampleBook();
    const largePath = path.join(largeAttachmentBook, 'assets/large.pdf');
    await fs.writeFile(largePath, '%PDF');
    await fs.truncate(largePath, 50 * 1024 * 1024 + 1);
    await updateMetadata(largeAttachmentBook, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/large.pdf'];
    });
    await assert.rejects(
      build(largeAttachmentBook, await temporaryDirectory('tmp-note-large-')),
      /exceeds 50MB/
    );

    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link assertion is skipped on Windows');
      return;
    }
    const symlinkBook = await copySampleBook();
    await fs.writeFile(path.join(symlinkBook, 'assets/real.pdf'), '%PDF');
    await fs.symlink('real.pdf', path.join(symlinkBook, 'assets/link.pdf'));
    await updateMetadata(symlinkBook, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/link.pdf'];
    });
    await assert.rejects(
      build(symlinkBook, await temporaryDirectory('tmp-note-symlink-')),
      /must not contain symbolic links/
    );
  });

  test('paid対象・sample部分集合・metadata有限契約をfail closedで検証する', async () => {
    await assert.rejects(
      build(await copySampleBook(), await temporaryDirectory('tmp-note-free-'), 'free'),
      /requires a paid edition/
    );

    const missingTarget = await copySampleBook();
    await updateMetadata(missingTarget, (metadata) => delete metadata.targets.note);
    await assert.rejects(
      build(missingTarget, await temporaryDirectory('tmp-note-no-target-')),
      (error) => error instanceof AdapterBuildError && /targets\.note/.test(error.message)
    );

    const wrongSample = await copySampleBook();
    await updateMetadata(wrongSample, (metadata) => {
      metadata.targets.note.free_sample_edition = 'internal';
    });
    await assert.rejects(
      build(wrongSample, await temporaryDirectory('tmp-note-wrong-sample-')),
      /distinct free or sample/
    );

    const notSubset = await copySampleBook();
    await updateMetadata(notSubset, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'paid').documents =
        metadata.editions.find((edition) => edition.id === 'paid').documents
          .filter((documentId) => documentId !== 'preface');
    });
    await assert.rejects(
      build(notSubset, await temporaryDirectory('tmp-note-not-subset-')),
      /Free-sample documents must be included in the paid edition: preface/
    );
  });

  test('schemaはnote slug、price、hashtag、添付pathをfail closedで検証する', async () => {
    const cases = [
      [(metadata) => { metadata.targets.note.slug = 'Invalid_Slug'; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.price = 99; }, /must be >= 100/],
      [(metadata) => { metadata.targets.note.price = 50001; }, /must be <= 50000/],
      [(metadata) => { metadata.targets.note.hashtags = []; }, /must NOT have fewer than 1 items/],
      [(metadata) => { metadata.targets.note.hashtags = ['invalid-tag']; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.hashtags = ['a'.repeat(31)]; }, /must NOT have more than 30 characters/],
      [(metadata) => { metadata.targets.note.attachment_candidates = ['../book.pdf']; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.attachment_candidates = ['assets/not-pdf.txt']; }, /must match pattern/]
    ];
    for (const [index, [mutate, expected]] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, mutate);
      await assert.rejects(
        build(bookDirectory, await temporaryDirectory(`tmp-note-schema-${index}-`)),
        expected
      );
    }
  });

  test('dry-runはpackageを書かずunknown ownerを置換しない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-dry-');
    const dry = await build(bookDirectory, outputRoot, 'paid', true);
    assert.strictEqual(dry.written, false);
    assert.strictEqual(await fs.pathExists(dry.outputDirectory), false);
    assert.strictEqual(dry.manifest.adapter.implementation, 'note-v1');

    await fs.ensureDir(dry.outputDirectory);
    await fs.writeFile(path.join(dry.outputDirectory, 'unrelated.txt'), 'keep\n');
    await assert.rejects(build(bookDirectory, outputRoot), /valid adapter manifest/);
    assert.strictEqual(
      await fs.readFile(path.join(dry.outputDirectory, 'unrelated.txt'), 'utf8'),
      'keep\n'
    );
  });

  test('可視性検査後に変更されたsourceを出力前に拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('source race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const sourcePath = path.join(bookDirectory, 'manuscript/02-workflow.md');
    const outputRoot = await temporaryDirectory('tmp-note-source-race-');
    const originalReadFile = fs.readFile;
    let changed = false;
    fs.readFile = async (candidate, ...args) => {
      const contents = await originalReadFile(candidate, ...args);
      if (!changed && path.resolve(candidate) === sourcePath) {
        changed = true;
        await fs.writeFile(sourcePath, '# changed\n\npaid replacement\n');
      }
      return contents;
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /(?:changed after visibility validation|Visibility reports disagree on source digest)/
      );
    } finally {
      fs.readFile = originalReadFile;
    }
    assert.strictEqual(changed, true);
    assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'note')), false);
  });
});
