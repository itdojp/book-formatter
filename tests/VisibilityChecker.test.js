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

    const cases = [
      ['free', `# leak\n\n${PAID_BLOCK_TEXT}\n`],
      ['sample', `# leak\n\n${PAID_BLOCK_TEXT}\n`],
      ['free', `# leak\n\n${INTERNAL_BLOCK_TEXT}\n`],
      ['sample', `# leak\n\n${INTERNAL_BLOCK_TEXT}\n`],
      ['free', 'この文書はdocument-level `paid` visibilityの例です。有償editionの構成と検査方法を説明しますが、実際の販売情報は含みません。'],
      ['free', ':::paid\nremoved too late\n:::\n'],
      ['free', '  :::internal\nindented marker remained\n  :::\n']
    ];
    for (const [editionId, content] of cases) {
      const artifactPath = await createArtifact(content);
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
