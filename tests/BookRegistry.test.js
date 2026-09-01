import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'path';
import fs from 'fs-extra';
import YAML from 'yaml';
import {
  BookRegistryValidationError,
  DEFAULT_BOOK_REGISTRY,
  validateBookRegistry
} from '../src/BookRegistryValidator.js';
import { UxRollout } from '../src/UxRollout.js';

const REPOSITORY_ROOT = process.cwd();
const temporaryDirectories = [];

async function copyExampleRegistry() {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(REPOSITORY_ROOT, 'tests/tmp-book-registry-')
  );
  temporaryDirectories.push(temporaryDirectory);
  const registryPath = path.join(temporaryDirectory, 'book-registry.yaml');
  await fs.copy(DEFAULT_BOOK_REGISTRY, registryPath);
  return registryPath;
}

async function mutateExampleRegistry(mutate) {
  const registryPath = await copyExampleRegistry();
  const registry = YAML.parse(await fs.readFile(registryPath, 'utf8'));
  mutate(registry);
  await fs.writeFile(registryPath, YAML.stringify(registry));
  return registryPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('BookRegistryValidator', () => {
  test('version 1のpilot exampleを検証する', async () => {
    const result = await validateBookRegistry();

    assert.strictEqual(result.schemaVersion, 1);
    assert.strictEqual(result.bookCount, 1);
    assert.strictEqual(result.channelCount, 8);
    assert.strictEqual(result.editionCount, 1);
    assert.strictEqual(
      result.registry.books['it-engineer-knowledge-architecture'].engine,
      'jekyll'
    );
  });

  test('移行途中のunknown値を受理する', async () => {
    const registryPath = await mutateExampleRegistry((registry) => {
      const book = registry.books['it-engineer-knowledge-architecture'];
      book.status = 'unknown';
      book.engine = 'unknown';
      book.migration = { status: 'unknown' };
      for (const channel of Object.values(book.channels)) {
        channel.status = 'unknown';
      }
      book.editions['catalog-web'].status = 'unknown';
    });

    await assert.doesNotReject(validateBookRegistry(registryPath));
  });

  test('未定義fieldと有限enum外の値を拒否する', async () => {
    const unknownFieldPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].publication = {};
    });
    await assert.rejects(validateBookRegistry(unknownFieldPath), /additional properties/);

    const invalidStatusPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].status = 'published';
    });
    await assert.rejects(validateBookRegistry(invalidStatusPath), /allowed values/);
  });

  test('unsafe repository URL、branch、pathを拒否する', async () => {
    const credentialUrlPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].repository.url =
        'https://user:secret@github.com/itdojp/it-engineer-knowledge-architecture';
    });
    await assert.rejects(
      validateBookRegistry(credentialUrlPath),
      /must match pattern|without credentials/
    );

    const invalidBranchPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].repository.branch = 'HEAD';
    });
    await assert.rejects(validateBookRegistry(invalidBranchPath), /must match pattern/);

    const traversalPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].repository.path = '../outside';
    });
    await assert.rejects(validateBookRegistry(traversalPath), /must match pattern/);
  });

  test('repository keyとURLの不一致、editionの未宣言channel参照を拒否する', async () => {
    const mismatchPath = await mutateExampleRegistry((registry) => {
      registry.books['it-engineer-knowledge-architecture'].repository.url =
        'https://github.com/itdojp/different-book';
    });
    await assert.rejects(validateBookRegistry(mismatchPath), /must end with/);

    const missingChannelPath = await mutateExampleRegistry((registry) => {
      const book = registry.books['it-engineer-knowledge-architecture'];
      delete book.channels.note;
      book.editions['catalog-web'].channels.push('note');
    });
    await assert.rejects(validateBookRegistry(missingChannelPath), /undeclared channel: note/);
  });

  test('YAMLの重複keyとYAML以外のextensionをfail-closedで拒否する', async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(REPOSITORY_ROOT, 'tests/tmp-book-registry-invalid-')
    );
    temporaryDirectories.push(temporaryDirectory);

    const duplicatePath = path.join(temporaryDirectory, 'duplicate.yaml');
    await fs.writeFile(
      duplicatePath,
      'schema_version: 1\nschema_version: 1\nchecked_at: 2026-09-01\nbooks: {}\n'
    );
    await assert.rejects(
      validateBookRegistry(duplicatePath),
      (error) =>
        error instanceof BookRegistryValidationError &&
        /Cannot parse registry|Map keys must be unique/.test(error.message)
    );

    for (const extension of ['.json', '.txt']) {
      const unsupportedPath = path.join(temporaryDirectory, 'registry' + extension);
      await fs.writeFile(unsupportedPath, '{"schema_version":1,"books":{}}');
      await assert.rejects(
        validateBookRegistry(unsupportedPath),
        /extension must be \.yaml or \.yml/
      );
    }
  });

  test('標準registryを既存UxRollout loaderで読み取り照合できる', async () => {
    const rollout = new UxRollout();
    const registry = rollout.normalizeRegistry(await rollout.loadRegistry(DEFAULT_BOOK_REGISTRY));
    const resolved = rollout.resolveRegistryEntry(
      '/workspace/it-engineer-knowledge-architecture',
      null,
      registry
    );

    assert.ok(resolved);
    assert.strictEqual(resolved.key, 'it-engineer-knowledge-architecture');
    assert.strictEqual(resolved.entry.repository.branch, 'main');
  });

  test('CLIのdefault、明示path、引数過多、validation failureを検証する', async () => {
    const defaultRun = spawnSync(process.execPath, ['scripts/validate-book-registry.js'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(defaultRun.status, 0, defaultRun.stderr);
    assert.match(defaultRun.stdout, /schema_version=1, books=1, channels=8, editions=1/);

    const explicitRun = spawnSync(
      process.execPath,
      ['scripts/validate-book-registry.js', DEFAULT_BOOK_REGISTRY],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(explicitRun.status, 0, explicitRun.stderr);

    const tooManyArgs = spawnSync(
      process.execPath,
      ['scripts/validate-book-registry.js', DEFAULT_BOOK_REGISTRY, 'unexpected'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(tooManyArgs.status, 2);
    assert.match(tooManyArgs.stderr, /Usage:/);

    const invalidRun = spawnSync(
      process.execPath,
      ['scripts/validate-book-registry.js', path.join(REPOSITORY_ROOT, 'missing-registry.yaml')],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' }
    );
    assert.strictEqual(invalidRun.status, 1);
    assert.match(invalidRun.stderr, /validation failed/);
  });
});
