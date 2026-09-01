import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'path';
import fs from 'fs-extra';
import YAML from 'yaml';
import {
  StandardBookValidationError,
  validateStandardBook
} from '../src/StandardBookValidator.js';

const REPOSITORY_ROOT = process.cwd();
const SAMPLE_BOOK = path.join(REPOSITORY_ROOT, 'examples/standard-book');
const temporaryDirectories = [];

async function copySampleBook() {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(REPOSITORY_ROOT, 'tests/tmp-standard-book-')
  );
  temporaryDirectories.push(temporaryDirectory);
  await fs.copy(SAMPLE_BOOK, temporaryDirectory);
  return temporaryDirectory;
}

async function updateMetadata(bookDirectory, mutate) {
  const metadataPath = path.join(bookDirectory, 'book.yaml');
  const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
  mutate(metadata);
  await fs.writeFile(metadataPath, YAML.stringify(metadata));
}

async function expectMetadataRejected(mutate, pattern) {
  const bookDirectory = await copySampleBook();
  await updateMetadata(bookDirectory, mutate);
  await assert.rejects(validateStandardBook(bookDirectory), pattern);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('StandardBookValidator', () => {
  test('schema_version 1の最小サンプルを検証する', async () => {
    const result = await validateStandardBook(SAMPLE_BOOK);

    assert.strictEqual(result.schemaVersion, 1);
    assert.strictEqual(result.documentCount, 4);
    assert.strictEqual(result.editionCount, 1);
  });

  test('schema_versionがない旧config形式を標準正本として受理しない', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'book.yaml'),
      YAML.stringify({
        title: 'Legacy generator config',
        description: 'This remains owned by ConfigValidator.',
        author: 'Example'
      })
    );

    await assert.rejects(
      validateStandardBook(bookDirectory),
      (error) => error instanceof StandardBookValidationError && /schema_version/.test(error.message)
    );
  });

  test('structureの重複IDを拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.structure.chapters[1].id = metadata.structure.chapters[0].id;
    });

    await assert.rejects(validateStandardBook(bookDirectory), /structure id must be unique/);
  });

  test('宣言した原稿がsource directory外にある場合は拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.structure.chapters[0].path = 'assets/README.md';
    });

    await assert.rejects(
      validateStandardBook(bookDirectory),
      /must be below its declared source directory/
    );
  });

  test('宣言したsource directoryがない場合は拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.source.assets = 'missing-assets';
    });

    await assert.rejects(validateStandardBook(bookDirectory), /does not exist/);
  });

  test('schemaで未定義の最上位fieldを拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.output = { target: 'unreviewed-adapter' };
    });

    await assert.rejects(validateStandardBook(bookDirectory), /additional properties/);
  });

  test('source、structure path、edition IDの重複を拒否する', async () => {
    await expectMetadataRejected((metadata) => {
      metadata.source.editions = metadata.source.assets;
    }, /source directories must use distinct paths/);

    await expectMetadataRejected((metadata) => {
      metadata.structure.chapters[1].path = metadata.structure.chapters[0].path;
    }, /structure path must be unique/);

    await expectMetadataRejected((metadata) => {
      metadata.editions.push({ ...metadata.editions[0] });
    }, /edition ids must be unique/);
  });

  test('欠落fileとsymbolic link経由の原稿を拒否する', async (context) => {
    await expectMetadataRejected((metadata) => {
      metadata.structure.chapters[0].path = 'manuscript/missing.md';
    }, /does not exist/);

    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link assertions are skipped on Windows');
      return;
    }

    const bookDirectory = await copySampleBook();
    const manuscriptDirectory = path.join(bookDirectory, 'manuscript');
    const originalPath = path.join(manuscriptDirectory, '01-introduction.md');
    const targetPath = path.join(manuscriptDirectory, '01-target.md');
    await fs.move(originalPath, targetPath);
    await fs.symlink('01-target.md', originalPath);

    await assert.rejects(validateStandardBook(bookDirectory), /must not contain symbolic links/);
  });

  test('中間symbolic linkによるroot外参照とcanonical aliasを拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symbolic-link assertions require a Unix-like test environment');
      return;
    }

    const bookDirectory = await copySampleBook();
    const externalDirectory = await fs.mkdtemp(
      path.join(REPOSITORY_ROOT, 'tests/tmp-standard-book-external-')
    );
    temporaryDirectories.push(externalDirectory);
    await fs.copy(path.join(bookDirectory, 'manuscript'), path.join(externalDirectory, 'manuscript'));
    await fs.symlink(externalDirectory, path.join(bookDirectory, 'linked-parent'), 'dir');
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.source.manuscript = 'linked-parent/manuscript';
      metadata.structure.chapters.forEach((chapter) => {
        chapter.path = `linked-parent/${chapter.path}`;
      });
    });

    await assert.rejects(validateStandardBook(bookDirectory), /must not contain symbolic links/);

    const aliasBook = await copySampleBook();
    await fs.symlink('.', path.join(aliasBook, 'alias-root'), 'dir');
    await updateMetadata(aliasBook, (metadata) => {
      metadata.source.editions = 'alias-root/assets';
    });

    await assert.rejects(validateStandardBook(aliasBook), /must not contain symbolic links/);
  });

  test('symbolic linkのbook.yamlを拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symbolic-link assertions require a Unix-like test environment');
      return;
    }

    const bookDirectory = await copySampleBook();
    const metadataPath = path.join(bookDirectory, 'book.yaml');
    await fs.move(metadataPath, path.join(bookDirectory, 'book.metadata.yaml'));
    await fs.symlink('book.metadata.yaml', metadataPath);

    await assert.rejects(validateStandardBook(bookDirectory), /must not contain symbolic links/);
  });

  test('symbolic linkのbook rootを拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.skip('symbolic-link assertions require a Unix-like test environment');
      return;
    }

    const bookDirectory = await copySampleBook();
    const linkedRoot = `${bookDirectory}-link`;
    temporaryDirectories.push(linkedRoot);
    await fs.symlink(bookDirectory, linkedRoot, 'dir');

    await assert.rejects(validateStandardBook(linkedRoot), /Book root must be a real directory/);
  });

  test('sourceとstructureのfile/directory型不一致を拒否する', async () => {
    await expectMetadataRejected((metadata) => {
      metadata.source.assets = 'manuscript/01-introduction.md';
    }, /must be a real directory/);

    const bookDirectory = await copySampleBook();
    await fs.ensureDir(path.join(bookDirectory, 'manuscript/directory.md'));
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.structure.chapters[0].path = 'manuscript/directory.md';
    });
    await assert.rejects(validateStandardBook(bookDirectory), /must be a real file/);
  });

  test('Semantic Version 2.0.0の境界を検証する', async () => {
    for (const version of ['1.0.0-alpha.1', '1.0.0-0', '1.0.0+build.1']) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.version = version;
      });
      await assert.doesNotReject(validateStandardBook(bookDirectory), version);
    }

    for (const version of ['1.0.0-01', '01.0.0', '1.0']) {
      await expectMetadataRejected((metadata) => {
        metadata.version = version;
      }, /must match pattern/);
    }
  });

  test('構文不正または資格情報付きのHTTPS URLを拒否する', async () => {
    for (const url of ['https://?', 'http://example.test/book', 'https://user:secret@example.test/book']) {
      await expectMetadataRejected((metadata) => {
        metadata.repository.url = url;
      }, /must match pattern|must match format|valid HTTPS URL|without credentials/);
    }
  });

  test('Git branchとして不正なdefault_branchを拒否する', async () => {
    for (const branch of ['../outside', '-option', 'feature//double', 'release.lock']) {
      await expectMetadataRejected((metadata) => {
        metadata.repository.default_branch = branch;
      }, /must match pattern|valid Git branch name/);
    }

    for (const branch of ['release/v1.0.0', 'foo@bar', 'release+2026', 'topic#1']) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.repository.default_branch = branch;
      });
      await assert.doesNotReject(validateStandardBook(bookDirectory), branch);
    }
  });

  test('CLIのdefault、明示path、引数過多、validation failureを検証する', async () => {
    const defaultRun = spawnSync(process.execPath, ['scripts/validate-standard-book.js'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(defaultRun.status, 0, defaultRun.stderr);
    assert.match(defaultRun.stdout, /schema_version=1/);

    const explicitRun = spawnSync(
      process.execPath,
      ['scripts/validate-standard-book.js', SAMPLE_BOOK],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(explicitRun.status, 0, explicitRun.stderr);

    const tooManyArgs = spawnSync(
      process.execPath,
      ['scripts/validate-standard-book.js', SAMPLE_BOOK, 'unexpected'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(tooManyArgs.status, 2);
    assert.match(tooManyArgs.stderr, /Usage:/);

    const invalidRun = spawnSync(
      process.execPath,
      ['scripts/validate-standard-book.js', path.join(REPOSITORY_ROOT, 'examples/missing-book')],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(invalidRun.status, 1);
    assert.match(invalidRun.stderr, /validation failed/);
  });
});
