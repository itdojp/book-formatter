import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import fs from 'fs-extra';
import YAML from 'yaml';

import {
  ADAPTER_MANIFEST_VERSION,
  ADAPTER_TARGETS,
  AdapterBuildError,
  buildStandardBookAdapter
} from '../src/AdapterBuild.js';

const REPOSITORY_ROOT = process.cwd();
const SAMPLE_BOOK = path.join(REPOSITORY_ROOT, 'examples/standard-book');
const temporaryDirectories = [];

async function createTemporaryDirectory(prefix = 'tmp-adapter-build-') {
  const directory = await fs.mkdtemp(path.join(REPOSITORY_ROOT, `tests/${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}

async function copySampleBook() {
  const directory = await createTemporaryDirectory('tmp-adapter-book-');
  await fs.copy(SAMPLE_BOOK, directory);
  return directory;
}

async function updateMetadata(bookDirectory, mutate) {
  const metadataPath = path.join(bookDirectory, 'book.yaml');
  const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'), {
    uniqueKeys: true
  });
  mutate(metadata);
  await fs.writeFile(metadataPath, YAML.stringify(metadata));
}

function runCli(args) {
  return spawnSync(process.execPath, ['src/index.js', 'build', ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8'
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('AdapterBuild', () => {
  test('有限targetのskeleton READMEが共通registryと一致する', async () => {
    assert.deepStrictEqual(ADAPTER_TARGETS, [
      'web-mdbook',
      'web-jekyll-legacy',
      'zenn',
      'note',
      'kindle',
      'booth',
      'pdf'
    ]);
    for (const target of ADAPTER_TARGETS) {
      const readme = await fs.readFile(
        path.join(REPOSITORY_ROOT, 'adapters', target, 'README.md'),
        'utf8'
      );
      assert.match(readme, new RegExp(`^# ${target} adapter`, 'm'));
      assert.match(readme, /実装状態: skeleton/);
    }
  });

  test('dry-runは決定的なredacted manifestを返しファイルを書かない', async () => {
    const bookDirectory = await copySampleBook();
    const first = await buildStandardBookAdapter({
      bookDirectory,
      target: 'web-mdbook',
      editionId: 'free',
      dryRun: true
    });
    const second = await buildStandardBookAdapter({
      bookDirectory,
      target: 'web-mdbook',
      editionId: 'free',
      dryRun: true
    });

    assert.deepStrictEqual(second.manifest, first.manifest);
    assert.strictEqual(first.written, false);
    assert.strictEqual(first.manifest.manifest_version, ADAPTER_MANIFEST_VERSION);
    assert.strictEqual(first.manifest.adapter.target, 'web-mdbook');
    assert.strictEqual(first.manifest.adapter.implementation, 'skeleton');
    assert.strictEqual(first.manifest.visibility.safe, true);
    assert.deepStrictEqual(
      first.manifest.documents.map((document) => document.id),
      ['introduction', 'workflow']
    );
    assert.ok(!JSON.stringify(first.manifest).includes('内部確認メモ'));
    assert.strictEqual(await fs.pathExists(first.manifestPath), false);
  });

  test('通常buildはtarget配下へmanifestだけを原子的かつ決定的に出力する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await createTemporaryDirectory('tmp-adapter-output-');
    await fs.writeFile(path.join(outputRoot, 'preserve.txt'), 'keep\n');

    const first = await buildStandardBookAdapter({
      bookDirectory,
      target: 'zenn',
      editionId: 'free',
      outputRoot
    });
    const firstContent = await fs.readFile(first.manifestPath, 'utf8');
    const second = await buildStandardBookAdapter({
      bookDirectory,
      target: 'zenn',
      editionId: 'free',
      outputRoot
    });
    const secondContent = await fs.readFile(second.manifestPath, 'utf8');

    assert.strictEqual(first.written, true);
    assert.strictEqual(first.manifestPath, path.join(outputRoot, 'zenn', 'manifest.json'));
    assert.strictEqual(secondContent, firstContent);
    assert.deepStrictEqual(JSON.parse(firstContent), first.manifest);
    assert.deepStrictEqual(await fs.readdir(path.join(outputRoot, 'zenn')), ['manifest.json']);
    assert.strictEqual(await fs.readFile(path.join(outputRoot, 'preserve.txt'), 'utf8'), 'keep\n');
    assert.ok(!firstContent.includes(bookDirectory));

    const defaultBuild = await buildStandardBookAdapter({
      bookDirectory,
      target: 'kindle',
      editionId: 'free'
    });
    assert.strictEqual(
      defaultBuild.manifestPath,
      path.join(bookDirectory, 'dist', 'kindle', 'manifest.json')
    );
    assert.deepStrictEqual(
      await fs.readdir(path.join(bookDirectory, 'dist', 'kindle')),
      ['manifest.json']
    );
  });

  test('未知target、不正edition、visibility違反を明確に拒否する', async () => {
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: SAMPLE_BOOK,
        target: 'unknown',
        editionId: 'free',
        dryRun: true
      }),
      (error) => error instanceof AdapterBuildError && /Unknown adapter target: unknown/.test(error.message)
    );

    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: SAMPLE_BOOK,
        target: 'pdf',
        editionId: 'missing',
        dryRun: true
      }),
      (error) => error instanceof AdapterBuildError && /Unknown edition: missing/.test(error.message)
    );

    const unsafeBook = await copySampleBook();
    await updateMetadata(unsafeBook, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'free').documents.push('afterword');
    });
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: unsafeBook,
        target: 'note',
        editionId: 'free',
        dryRun: true
      }),
      /Visibility check failed for edition free: 1 finding\(s\)/
    );

    const invalidBook = await createTemporaryDirectory('tmp-adapter-invalid-book-');
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory: invalidBook,
        target: 'pdf',
        editionId: 'free',
        dryRun: true
      }),
      /book.yaml does not exist/
    );
  });

  test('source配下とsymbolic link経由の出力を拒否する', async (context) => {
    const bookDirectory = await copySampleBook();
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory,
        target: 'pdf',
        editionId: 'free',
        outputRoot: path.join(bookDirectory, 'manuscript'),
        dryRun: true
      }),
      /must not be inside source.manuscript/
    );

    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link assertion is skipped on Windows');
      return;
    }

    const realOutput = await createTemporaryDirectory('tmp-adapter-real-output-');
    const linkParent = await createTemporaryDirectory('tmp-adapter-link-parent-');
    const linkPath = path.join(linkParent, 'linked-output');
    await fs.symlink(realOutput, linkPath, 'dir');

    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory,
        target: 'booth',
        editionId: 'free',
        outputRoot: linkPath,
        dryRun: true
      }),
      /must not contain symbolic links/
    );

    const manifestLinkRoot = await createTemporaryDirectory(
      'tmp-adapter-manifest-link-root-'
    );
    const targetDirectory = path.join(manifestLinkRoot, 'booth');
    await fs.ensureDir(targetDirectory);
    await fs.symlink(
      path.join(realOutput, 'outside-manifest.json'),
      path.join(targetDirectory, 'manifest.json')
    );
    await assert.rejects(
      buildStandardBookAdapter({
        bookDirectory,
        target: 'booth',
        editionId: 'free',
        outputRoot: manifestLinkRoot
      }),
      /Manifest destination must be a regular file/
    );
  });

  test('CLI dry-runはJSON manifestをstdoutへ出し書き込まない', async () => {
    const bookDirectory = await copySampleBook();
    const result = runCli([
      '--book', bookDirectory,
      '--target', 'web-mdbook',
      '--edition', 'free',
      '--dry-run'
    ]);

    assert.strictEqual(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    assert.strictEqual(manifest.adapter.target, 'web-mdbook');
    assert.match(result.stderr, /dry-run: 書き込みなし/);
    assert.strictEqual(
      await fs.pathExists(path.join(bookDirectory, 'dist', 'web-mdbook')),
      false
    );
  });

  test('CLIはmanifestを出力し、unknown targetとinvalid editionで非0終了する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await createTemporaryDirectory('tmp-adapter-cli-output-');
    const built = runCli([
      '--book', bookDirectory,
      '--target', 'zenn',
      '--edition', 'free',
      '--out-dir', outputRoot
    ]);
    assert.strictEqual(built.status, 0, built.stderr);
    assert.strictEqual(
      await fs.pathExists(path.join(outputRoot, 'zenn', 'manifest.json')),
      true
    );

    const unknownTarget = runCli([
      '--book', bookDirectory,
      '--target', 'web',
      '--edition', 'free',
      '--dry-run'
    ]);
    assert.notStrictEqual(unknownTarget.status, 0);
    assert.match(unknownTarget.stderr, /Unknown adapter target: web/);

    const invalidEdition = runCli([
      '--book', bookDirectory,
      '--target', 'web-mdbook',
      '--edition', 'preview',
      '--dry-run'
    ]);
    assert.notStrictEqual(invalidEdition.status, 0);
    assert.match(invalidEdition.stderr, /Unknown edition: preview/);
  });
});
