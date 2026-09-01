import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import fs from 'fs-extra';
import YAML from 'yaml';

import {
  checkBookVisibility,
  VisibilityValidationError
} from '../src/VisibilityChecker.js';

const REPOSITORY_ROOT = process.cwd();
const SAMPLE_BOOK = path.join(REPOSITORY_ROOT, 'examples/standard-book');
const PAID_BLOCK_TEXT = 'この範囲は有償edition候補です。公開可否はvisibility modelで決定します。';
const INTERNAL_BLOCK_TEXT = 'この範囲は内部向け候補です。公開成果物からの除外はvisibility検査で保証します。';
const temporaryDirectories = [];

async function copySampleBook() {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(REPOSITORY_ROOT, 'tests/tmp-visibility-book-')
  );
  temporaryDirectories.push(temporaryDirectory);
  await fs.copy(SAMPLE_BOOK, temporaryDirectory);
  return temporaryDirectory;
}

async function updateMetadata(bookDirectory, mutate) {
  const metadataPath = path.join(bookDirectory, 'book.yaml');
  const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'), { uniqueKeys: true });
  mutate(metadata);
  await fs.writeFile(metadataPath, YAML.stringify(metadata));
}

async function createArtifact(content, filename = 'edition.md') {
  const directory = await fs.mkdtemp(
    path.join(REPOSITORY_ROOT, 'tests/tmp-visibility-artifact-')
  );
  temporaryDirectories.push(directory);
  const artifactPath = path.join(directory, filename);
  await fs.writeFile(artifactPath, content);
  return artifactPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('VisibilityChecker', () => {
  test('4 editionの有限包含matrixとblock除外を決定論的に報告する', async () => {
    const free = await checkBookVisibility(SAMPLE_BOOK, 'free');
    const sample = await checkBookVisibility(SAMPLE_BOOK, 'sample');
    const paid = await checkBookVisibility(SAMPLE_BOOK, 'paid');
    const internal = await checkBookVisibility(SAMPLE_BOOK, 'internal');

    assert.strictEqual(free.summary.safe, true);
    assert.strictEqual(free.summary.includedDocuments, 2);
    assert.strictEqual(free.summary.protectedRegions, 5);
    assert.strictEqual(sample.summary.safe, true);
    assert.strictEqual(paid.summary.safe, true);
    assert.strictEqual(paid.summary.protectedRegions, 2);
    assert.strictEqual(internal.summary.safe, true);
    assert.strictEqual(internal.summary.protectedRegions, 0);

    const secondFree = await checkBookVisibility(SAMPLE_BOOK, 'free');
    assert.deepStrictEqual(secondFree, free);

    const reorderedBook = await copySampleBook();
    await updateMetadata(reorderedBook, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'free').documents = [
        'workflow',
        'introduction'
      ];
    });
    const reordered = await checkBookVisibility(reorderedBook, 'free');
    assert.deepStrictEqual(
      reordered.documents
        .filter((document) => document.decision === 'include')
        .map((document) => document.id),
      ['workflow', 'introduction']
    );
  });

  test('reportへpaid/internal本文を複製せずdigestだけを記録する', async () => {
    const report = await checkBookVisibility(SAMPLE_BOOK, 'free');
    const serialized = JSON.stringify(report);

    assert.ok(!serialized.includes(PAID_BLOCK_TEXT));
    assert.ok(!serialized.includes(INTERNAL_BLOCK_TEXT));
    assert.match(serialized, /[a-f0-9]{64}/);
  });

  test('free/sample/paid editionのdocument-level混入を拒否する', async () => {
    const cases = [
      ['free', 'afterword'],
      ['sample', 'afterword'],
      ['paid', 'internal-notes']
    ];

    for (const [editionId, documentId] of cases) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.editions.find((edition) => edition.id === editionId).documents.push(documentId);
      });
      const report = await checkBookVisibility(bookDirectory, editionId);
      assert.strictEqual(report.summary.safe, false);
      assert.ok(report.findings.some((finding) => finding.code === 'incompatible_document_visibility'));
    }
  });

  test('全documentのvisibility宣言を要求し、旧metadataはvisibility checkで拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      delete metadata.structure.chapters[0].visibility;
    });

    const report = await checkBookVisibility(bookDirectory, 'free');
    assert.strictEqual(report.summary.safe, false);
    assert.ok(report.findings.some((finding) => finding.code === 'missing_document_visibility'));

    const legacyBook = await copySampleBook();
    await updateMetadata(legacyBook, (metadata) => {
      metadata.editions = [{ id: 'standard', title: '標準版', status: 'draft' }];
    });
    await assert.rejects(
      checkBookVisibility(legacyBook, 'standard'),
      (error) => error instanceof VisibilityValidationError && /visibility and documents/.test(error.message)
    );

    const mismatchedEdition = await copySampleBook();
    await updateMetadata(mismatchedEdition, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'free').visibility = 'internal';
    });
    await assert.rejects(
      checkBookVisibility(mismatchedEdition, 'free'),
      /Reserved edition ID free must use matching visibility free/
    );
  });

  test('fence内markerをliteralとして扱い、未知・indent・nested・未閉鎖を拒否する', async () => {
    const fencedBook = await copySampleBook();
    await fs.appendFile(
      path.join(fencedBook, 'manuscript/01-introduction.md'),
      '\n```markdown\n:::paid\nliteral\n:::\n```\n'
    );
    const fencedReport = await checkBookVisibility(fencedBook, 'free');
    assert.strictEqual(fencedReport.summary.safe, true);
    assert.strictEqual(fencedReport.summary.visibilityRegions, 2);

    const frontMatterBook = await copySampleBook();
    await fs.writeFile(
      path.join(frontMatterBook, 'manuscript/01-introduction.md'),
      '---\ntitle: 公開章\nmarker_example: |\n  :::paid\n---\n\n# 公開章\n\n公開本文です。\n'
    );
    const frontMatterReport = await checkBookVisibility(frontMatterBook, 'free');
    assert.strictEqual(frontMatterReport.summary.safe, true);
    assert.ok(
      !frontMatterReport.findings.some(
        (finding) => finding.code === 'invalid_callout_delimiter'
      )
    );

    const yamlEndBook = await copySampleBook();
    await fs.writeFile(
      path.join(yamlEndBook, 'manuscript/01-introduction.md'),
      '---\ntitle: 公開章\n...\n\n# 公開章\n\n公開本文です。\n'
    );
    const yamlEndReport = await checkBookVisibility(yamlEndBook, 'free');
    assert.strictEqual(yamlEndReport.summary.safe, true);

    const mutations = [
      ['  :::paid\nsecret\n:::\n', 'invalid_callout_delimiter'],
      [':::future\nsecret\n:::\n', 'unknown_callout_type'],
      [':::paid\n:::internal\nsecret\n:::\n:::\n', 'nested_callout'],
      [':::paid\nsecret\n', 'unclosed_callout']
    ];
    for (const [content, code] of mutations) {
      const bookDirectory = await copySampleBook();
      await fs.appendFile(path.join(bookDirectory, 'manuscript/01-introduction.md'), `\n${content}`);
      const report = await checkBookVisibility(bookDirectory, 'free');
      assert.ok(report.findings.some((finding) => finding.code === code), code);
    }
  });

  test('generated artifactのraw markerとprotected本文混入を検出する', async () => {
    const safeArtifact = await createArtifact('# 公開版\n\n公開可能な本文です。\n');
    const safeReport = await checkBookVisibility(SAMPLE_BOOK, 'free', {
      artifactPath: safeArtifact
    });
    assert.strictEqual(safeReport.summary.safe, true);
    assert.strictEqual(safeReport.summary.artifactFiles, 1);

    const frontMatterArtifact = await createArtifact(
      '---\nmarker_example: |\n  :::paid\n...\n\n# 公開版\n',
      'front-matter.md'
    );
    const frontMatterArtifactReport = await checkBookVisibility(SAMPLE_BOOK, 'free', {
      artifactPath: frontMatterArtifact
    });
    assert.strictEqual(frontMatterArtifactReport.summary.safe, true);

    const renderedFenceArtifact = await createArtifact(
      '<pre class="highlight"><code>:::paid\nliteral example\n:::</code></pre>\n',
      'rendered-fence.html'
    );
    const renderedFenceReport = await checkBookVisibility(SAMPLE_BOOK, 'free', {
      artifactPath: renderedFenceArtifact
    });
    assert.strictEqual(renderedFenceReport.summary.safe, true);

    const encodedCodeLiteral = await createArtifact(
      '&lt;code&gt;:::paid&lt;/code&gt;\n',
      'encoded-code-literal.html'
    );
    const encodedCodeLiteralReport = await checkBookVisibility(SAMPLE_BOOK, 'free', {
      artifactPath: encodedCodeLiteral
    });
    assert.strictEqual(encodedCodeLiteralReport.summary.safe, false);

    const markerAfterRenderedFence = await createArtifact(
      '<pre><code>:::paid\nliteral example\n:::</code></pre>\n<p>:::internal</p>\n',
      'marker-after-rendered-fence.html'
    );
    const markerAfterRenderedFenceReport = await checkBookVisibility(SAMPLE_BOOK, 'free', {
      artifactPath: markerAfterRenderedFence
    });
    assert.strictEqual(markerAfterRenderedFenceReport.summary.safe, false);
    assert.ok(
      markerAfterRenderedFenceReport.findings.some(
        (finding) => finding.code === 'raw_protected_marker_in_artifact'
      )
    );

    const cases = [
      ['free', `# leak\n\n${PAID_BLOCK_TEXT}\n`],
      ['sample', `# leak\n\n${PAID_BLOCK_TEXT}\n`],
      ['free', `# leak\n\n${INTERNAL_BLOCK_TEXT}\n`],
      ['sample', `# leak\n\n${INTERNAL_BLOCK_TEXT}\n`],
      ['free', 'この文書はdocument-level `paid` visibilityの例です。有償editionの構成と検査方法を説明しますが、実際の販売情報は含みません。'],
      ['free', ':::paid\nremoved too late\n:::\n'],
      ['free', '  :::internal\nindented marker remained\n  :::\n'],
      ['free', '<p>:::paid</p>\n'],
      ['free', `---\n${PAID_BLOCK_TEXT}\n---\n`, 'front-matter-like.txt']
    ];
    for (const [editionId, content, filename] of cases) {
      const artifactPath = await createArtifact(content, filename || 'edition.md');
      const report = await checkBookVisibility(SAMPLE_BOOK, editionId, { artifactPath });
      assert.strictEqual(report.summary.safe, false, editionId);
      assert.ok(!JSON.stringify(report).includes(PAID_BLOCK_TEXT));
      assert.ok(!JSON.stringify(report).includes(INTERNAL_BLOCK_TEXT));
      assert.ok(
        report.findings.some((finding) =>
          ['protected_content_in_artifact', 'raw_protected_marker_in_artifact'].includes(finding.code)
        ),
        editionId
      );
    }

    const shortBook = await copySampleBook();
    await fs.writeFile(
      path.join(shortBook, 'backmatter/afterword.md'),
      '# 有償版\n\n有償情報\n'
    );
    const shortLeak = await createArtifact('<h1>有償版</h1>\n<p>有償情報</p>\n', 'short.html');
    const shortLeakReport = await checkBookVisibility(shortBook, 'free', {
      artifactPath: shortLeak
    });
    assert.strictEqual(shortLeakReport.summary.safe, false);
    assert.ok(
      shortLeakReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const bomBook = await copySampleBook();
    const bomPaidText = 'BOM付き有償範囲です。';
    await fs.writeFile(
      path.join(bomBook, 'manuscript/01-introduction.md'),
      `\uFEFF:::paid\n${bomPaidText}\n:::\n`
    );
    const bomLeak = await createArtifact(`<p>${bomPaidText}</p>\n`, 'bom.html');
    const bomLeakReport = await checkBookVisibility(bomBook, 'free', {
      artifactPath: bomLeak
    });
    assert.strictEqual(bomLeakReport.summary.visibilityRegions, 3);
    assert.strictEqual(bomLeakReport.summary.safe, false);

    const multiParagraphBook = await copySampleBook();
    const firstPaidParagraph = '有償範囲の第一段落だけが誤って出力されました。';
    await fs.appendFile(
      path.join(multiParagraphBook, 'manuscript/01-introduction.md'),
      `\n:::paid\n${firstPaidParagraph}\n\n有償範囲の第二段落です。\n:::\n`
    );
    const partialLeak = await createArtifact(`<p>${firstPaidParagraph}</p>\n`, 'partial.html');
    const partialLeakReport = await checkBookVisibility(multiParagraphBook, 'free', {
      artifactPath: partialLeak
    });
    assert.strictEqual(partialLeakReport.summary.safe, false);
    assert.ok(
      partialLeakReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const excludedCalloutBook = await copySampleBook();
    const excludedCalloutBody = '除外文書内の標準note本文です。';
    await fs.writeFile(
      path.join(excludedCalloutBook, 'backmatter/afterword.md'),
      `# 有償版\n\n:::note\n${excludedCalloutBody}\n:::\n`
    );
    const excludedCalloutLeak = await createArtifact(
      `<aside>${excludedCalloutBody}</aside>\n`,
      'excluded-callout.html'
    );
    const excludedCalloutReport = await checkBookVisibility(excludedCalloutBook, 'free', {
      artifactPath: excludedCalloutLeak
    });
    assert.strictEqual(excludedCalloutReport.summary.safe, false);
    assert.ok(
      excludedCalloutReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const fencedCases = [
      {
        filename: 'backmatter/afterword.md',
        content: '# 有償版\n\n```text\nPAID_EXCLUDED_CODE\n```\n',
        artifact: '<pre><code>PAID_EXCLUDED_CODE</code></pre>\n'
      },
      {
        filename: 'manuscript/01-introduction.md',
        content: '# 公開版\n\n:::paid\n```text\nPAID_BLOCK_CODE\n```\n:::\n',
        artifact: '<pre><code>PAID_BLOCK_CODE</code></pre>\n'
      }
    ];
    for (const fencedCase of fencedCases) {
      const fencedBook = await copySampleBook();
      await fs.writeFile(path.join(fencedBook, fencedCase.filename), fencedCase.content);
      const fencedLeak = await createArtifact(fencedCase.artifact, 'fenced-code.html');
      const fencedReport = await checkBookVisibility(fencedBook, 'free', {
        artifactPath: fencedLeak
      });
      assert.strictEqual(fencedReport.summary.safe, false, fencedCase.filename);
      assert.ok(
        fencedReport.findings.some(
          (finding) => finding.code === 'protected_content_in_artifact'
        ),
        fencedCase.filename
      );
    }

    const listBook = await copySampleBook();
    await fs.writeFile(
      path.join(listBook, 'manuscript/01-introduction.md'),
      '# 公開版\n\n:::paid\n- PAID_ITEM_ONE\n- PAID_ITEM_TWO\n:::\n'
    );
    const listLeak = await createArtifact(
      '<ul><li>PAID_ITEM_ONE</li><li>PAID_ITEM_TWO</li></ul>\n',
      'list.html'
    );
    const listReport = await checkBookVisibility(listBook, 'free', {
      artifactPath: listLeak
    });
    assert.strictEqual(listReport.summary.safe, false);
    assert.ok(
      listReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const inlineBook = await copySampleBook();
    await fs.writeFile(
      path.join(inlineBook, 'manuscript/01-introduction.md'),
      '# 公開版\n\n:::paid\n[PAID_LINK_TEXT](https://docs.example/paid)\n:::\n'
    );
    const inlineLeak = await createArtifact(
      '<a href="https://docs.example/paid">PAID_LINK_TEXT</a>\n',
      'inline.html'
    );
    const inlineReport = await checkBookVisibility(inlineBook, 'free', {
      artifactPath: inlineLeak
    });
    assert.strictEqual(inlineReport.summary.safe, false);
    assert.ok(
      inlineReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const renderedInlineBook = await copySampleBook();
    await fs.writeFile(
      path.join(renderedInlineBook, 'manuscript/01-introduction.md'),
      '# 公開版\n\n:::paid\nPremium **only** & details\n:::\n'
    );
    const renderedInlineLeak = await createArtifact(
      '<p>Premium <strong>only</strong> &amp; details</p>\n',
      'rendered-inline.html'
    );
    const renderedInlineReport = await checkBookVisibility(renderedInlineBook, 'free', {
      artifactPath: renderedInlineLeak
    });
    assert.strictEqual(renderedInlineReport.summary.safe, false);
    assert.ok(
      renderedInlineReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const adjacentInlineBook = await copySampleBook();
    await fs.writeFile(
      path.join(adjacentInlineBook, 'manuscript/01-introduction.md'),
      '# 公開版\n\n:::paid\nAPI key is `PAID_SECRET`.\n:::\n'
    );
    const adjacentInlineLeak = await createArtifact(
      '<p>API key is <code>PAID_SECRET</code>.</p>\n',
      'adjacent-inline.html'
    );
    const adjacentInlineReport = await checkBookVisibility(adjacentInlineBook, 'free', {
      artifactPath: adjacentInlineLeak
    });
    assert.strictEqual(adjacentInlineReport.summary.safe, false);
    assert.ok(
      adjacentInlineReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );

    const footnoteBook = await copySampleBook();
    await fs.writeFile(
      path.join(footnoteBook, 'manuscript/01-introduction.md'),
      '# 公開版\n\n:::paid\nProtected claim[^paid].\n\n[^paid]: FOOTNOTE_PAID_DETAIL\n:::\n'
    );
    const footnoteLeak = await createArtifact(
      '<p>Protected claim<sup>1</sup>.</p><ol><li>FOOTNOTE_PAID_DETAIL</li></ol>\n',
      'footnote.html'
    );
    const footnoteReport = await checkBookVisibility(footnoteBook, 'free', {
      artifactPath: footnoteLeak
    });
    assert.strictEqual(footnoteReport.summary.safe, false);
    assert.ok(
      footnoteReport.findings.some(
        (finding) => finding.code === 'protected_content_in_artifact'
      )
    );
  });

  test('paidはpaid本文を許可してinternal本文を拒否し、internalは両方を許可する', async () => {
    const paidArtifact = await createArtifact(PAID_BLOCK_TEXT);
    const paidReport = await checkBookVisibility(SAMPLE_BOOK, 'paid', {
      artifactPath: paidArtifact
    });
    assert.strictEqual(paidReport.summary.safe, true);

    const internalLeak = await createArtifact(INTERNAL_BLOCK_TEXT);
    const leakReport = await checkBookVisibility(SAMPLE_BOOK, 'paid', {
      artifactPath: internalLeak
    });
    assert.strictEqual(leakReport.summary.safe, false);

    const internalArtifact = await createArtifact(`${PAID_BLOCK_TEXT}\n${INTERNAL_BLOCK_TEXT}`);
    const internalReport = await checkBookVisibility(SAMPLE_BOOK, 'internal', {
      artifactPath: internalArtifact
    });
    assert.strictEqual(internalReport.summary.safe, true);
  });

  test('artifact tree内のsymbolic linkをfail-closedで拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symbolic-link assertions require a Unix-like test environment');
      return;
    }

    const directory = await fs.mkdtemp(
      path.join(REPOSITORY_ROOT, 'tests/tmp-visibility-artifact-tree-')
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, 'safe.md'), '# safe\n');
    await fs.symlink('safe.md', path.join(directory, 'linked.md'));

    await assert.rejects(
      checkBookVisibility(SAMPLE_BOOK, 'free', { artifactPath: directory }),
      /must not contain symbolic links/
    );

    const linkedParent = path.join(`${directory}-parent-link`);
    temporaryDirectories.push(linkedParent);
    await fs.symlink(directory, linkedParent);
    await assert.rejects(
      checkBookVisibility(SAMPLE_BOOK, 'free', {
        artifactPath: path.join(linkedParent, 'safe.md')
      }),
      /must not traverse a symbolic link/
    );
  });

  test('CLIはJSON report、unsafe exit、usage errorを提供する', async () => {
    const outputDirectory = await fs.mkdtemp(
      path.join(REPOSITORY_ROOT, 'tests/tmp-visibility-cli-')
    );
    temporaryDirectories.push(outputDirectory);
    const outputPath = path.join(outputDirectory, 'free.json');

    const success = spawnSync(
      process.execPath,
      ['scripts/check-visibility.js', SAMPLE_BOOK, '--edition', 'free', '--output', outputPath],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(success.status, 0, success.stderr);
    assert.match(success.stdout, /findings=0/);
    const report = await fs.readJson(outputPath);
    assert.strictEqual(report.summary.safe, true);

    const leakPath = await createArtifact(PAID_BLOCK_TEXT);
    const unsafe = spawnSync(
      process.execPath,
      ['scripts/check-visibility.js', SAMPLE_BOOK, '--edition', 'free', '--artifact', leakPath],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(unsafe.status, 1);
    assert.match(unsafe.stdout, /findings=1/);

    const unknown = spawnSync(
      process.execPath,
      ['scripts/check-visibility.js', SAMPLE_BOOK, '--edition', 'missing'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown edition/);
  });
});
