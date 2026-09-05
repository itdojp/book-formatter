import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SCRIPT = path.join(REPOSITORY_ROOT, 'scripts/scaffold-new-book.sh');
const TEMP_ROOTS = [];

function makeTemporaryRoot(label) {
  const root = mkdtempSync(
    path.join(REPOSITORY_ROOT, 'tests/tmp-scaffold-' + label + '-'),
  );
  TEMP_ROOTS.push(root);
  mkdirSync(path.join(root, 'caller'));
  mkdirSync(path.join(root, 'outputs'));
  return root;
}

function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    'git ' + args.join(' ') + ' failed: ' + result.stderr,
  );
  return result.stdout.trim();
}

function relativeFiles(root) {
  const files = [];
  const visit = (current, relative) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const childRelative = relative ? relative + '/' + entry.name : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(child, childRelative);
      } else {
        files.push(childRelative);
      }
    }
  };
  visit(root, '');
  return files.sort();
}

function assertTreeMatches(source, destination) {
  const files = relativeFiles(source);
  assert.deepEqual(relativeFiles(destination), files);
  for (const relative of files) {
    assert.deepEqual(
      readFileSync(path.join(destination, relative)),
      readFileSync(path.join(source, relative)),
      'content mismatch: ' + relative,
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function installMockGh(root) {
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const mock = path.join(bin, 'gh');
  const mockSource = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'printf \'%q \' "$@" >> "$GH_MOCK_LOG"',
    'printf \'\\n\' >> "$GH_MOCK_LOG"',
    'mode="$GH_MOCK_MODE"',
    '',
    'case "$1" in',
    '  auth)',
    '    test "$2" = status',
    '    if [ "$mode" = auth-fail ]; then exit 1; fi',
    '    exit 0',
    '    ;;',
    '  api)',
    '    case "$mode" in',
    '      remote-exists) exit 0 ;;',
    '      lookup-fail)',
    '        echo \'gh: Service Unavailable (HTTP 503)\' >&2',
    '        exit 1',
    '        ;;',
    '      *)',
    '        echo \'gh: Not Found (HTTP 404)\' >&2',
    '        exit 1',
    '        ;;',
    '    esac',
    '    ;;',
    '  repo)',
    '    test "$2" = create',
    '    full_name="$3"',
    '    shift 3',
    '    source_path=',
    '    saw_public=0',
    '    saw_remote=0',
    '    saw_push=0',
    '    while [ "$#" -gt 0 ]; do',
    '      case "$1" in',
    '        --source)',
    '          source_path="$2"',
    '          shift 2',
    '          ;;',
    '        --public)',
    '          saw_public=1',
    '          shift',
    '          ;;',
    '        --remote)',
    '          test "$2" = origin',
    '          saw_remote=1',
    '          shift 2',
    '          ;;',
    '        --push)',
    '          saw_push=1',
    '          shift',
    '          ;;',
    '        *)',
    '          echo "unexpected repo create option: $1" >&2',
    '          exit 90',
    '          ;;',
    '      esac',
    '    done',
    '',
    '    test -n "$source_path"',
    '    test "$saw_public" -eq 1',
    '    test "$saw_remote" -eq 1',
    '    test "$saw_push" -eq 1',
    '    test "$(git -C "$source_path" branch --show-current)" = main',
    '    test "$(git -C "$source_path" rev-list --count HEAD)" = 1',
    '    test -z "$(git -C "$source_path" status --porcelain=v1 --untracked-files=all)"',
    '    test -z "$(git -C "$source_path" remote)"',
    '    {',
    '      printf \'source=%s\\n\' "$source_path"',
    '      printf \'branch=%s\\n\' "$(git -C "$source_path" branch --show-current)"',
    '      printf \'commits=%s\\n\' "$(git -C "$source_path" rev-list --count HEAD)"',
    '      printf \'status=%s\\n\' "$(git -C "$source_path" status --porcelain=v1 --untracked-files=all)"',
    '      printf \'remotes-before=%s\\n\' "$(git -C "$source_path" remote)"',
    '    } > "$GH_MOCK_EVIDENCE"',
    '',
    '    remote_name="$full_name"',
    '    if [ "$mode" = wrong-origin ]; then remote_name=other/repository; fi',
    '    git -C "$source_path" remote add origin "https://github.com/$remote_name.git"',
    '    if [ "$mode" = create-fail ]; then',
    '      echo \'synthetic create/push failure\' >&2',
    '      exit 42',
    '    fi',
    '    printf \'https://github.com/%s\\n\' "$full_name"',
    '    ;;',
    '  *)',
    '    echo "unexpected gh command: $*" >&2',
    '    exit 91',
    '    ;;',
    'esac',
    '',
  ].join('\n');
  writeFileSync(mock, mockSource);
  chmodSync(mock, 0o755);
  return bin;
}

function runScaffold(root, args, { ghMode = '', author = true } = {}) {
  const log = path.join(root, 'gh.log');
  const evidence = path.join(root, 'gh-evidence.txt');
  writeFileSync(log, '');
  const bin = installMockGh(root);
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    GH_MOCK_LOG: log,
    GH_MOCK_EVIDENCE: evidence,
    GH_MOCK_MODE: ghMode,
  };
  if (author) {
    env.GIT_AUTHOR_NAME = 'Scaffold Test';
    env.GIT_AUTHOR_EMAIL = 'scaffold-test@example.invalid';
  } else {
    delete env.GIT_AUTHOR_NAME;
    delete env.GIT_AUTHOR_EMAIL;
  }
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: path.join(root, 'caller'),
    env,
    encoding: 'utf8',
  });
  return { ...result, log, evidence };
}

test.after(() => {
  for (const root of TEMP_ROOTS) {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local scaffold persists and preserves the finite starter/shared mapping', () => {
  const root = makeTemporaryRoot('local');
  const output = path.join(root, 'outputs', 'persistent output');
  const result = runScaffold(root, [
    'itdojp',
    'sample-book',
    '--output',
    output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(output, '.git')), false);
  assert.match(
    result.stdout,
    new RegExp('Scaffolded at: ' + escapeRegExp(output)),
  );

  assertTreeMatches(
    path.join(REPOSITORY_ROOT, 'shared/layouts'),
    path.join(output, 'docs/_layouts'),
  );
  assertTreeMatches(
    path.join(REPOSITORY_ROOT, 'shared/includes'),
    path.join(output, 'docs/_includes'),
  );
  assertTreeMatches(
    path.join(REPOSITORY_ROOT, 'shared/assets'),
    path.join(output, 'docs/assets'),
  );
  assertTreeMatches(
    path.join(REPOSITORY_ROOT, 'templates/.github'),
    path.join(output, '.github'),
  );

  const config = readFileSync(path.join(output, 'docs/_config.yml'), 'utf8');
  assert.match(config, /title: "sample book"/);
  assert.match(config, /repository: "itdojp\/sample-book"/);
  assert.match(config, /url: "https:\/\/itdojp\.github\.io"/);
  assert.doesNotMatch(
    config,
    /<(owner|repo|BOOK TITLE|SHORT DESCRIPTION|AUTHOR)>/,
  );
  assert.doesNotMatch(relativeFiles(output).join('\n'), /\.bak$/);
  assert.equal(readFileSync(result.log, 'utf8'), '');
});

test('existing output objects are rejected without mutation', async (t) => {
  for (const type of ['directory', 'file', 'symlink']) {
    await t.test(type, () => {
      const root = makeTemporaryRoot('existing-' + type);
      const output = path.join(root, 'outputs', 'sample-book');
      if (type === 'directory') {
        mkdirSync(output);
        writeFileSync(path.join(output, 'marker.txt'), 'preserve\n');
      } else if (type === 'file') {
        writeFileSync(output, 'preserve\n');
      } else {
        symlinkSync('missing-target', output);
      }

      const before = lstatSync(output);
      const result = runScaffold(root, [
        'itdojp',
        'sample-book',
        '--output',
        output,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /refusing to overwrite/);
      const after = lstatSync(output);
      assert.equal(after.mode, before.mode);
      if (type === 'directory') {
        assert.equal(
          readFileSync(path.join(output, 'marker.txt'), 'utf8'),
          'preserve\n',
        );
      } else if (type === 'file') {
        assert.equal(readFileSync(output, 'utf8'), 'preserve\n');
      }
    });
  }
});

test('argument parsing fails closed before creating output', async (t) => {
  const cases = [
    {
      name: 'missing output',
      args: ['itdojp', 'sample-book'],
      error: /--output <path> is required/,
    },
    {
      name: 'duplicate output',
      args: [
        'itdojp',
        'sample-book',
        '--output',
        'first',
        '--output',
        'second',
      ],
      error: /--output may be specified only once/,
    },
    {
      name: 'unknown option',
      args: ['itdojp', 'sample-book', '--unknown'],
      error: /Unknown option/,
    },
    {
      name: 'option used as output value',
      args: ['itdojp', 'sample-book', '--output', '--create'],
      error: /--output requires a non-empty path/,
    },
    {
      name: 'invalid owner',
      args: ['bad/owner', 'sample-book', '--output', 'sample-book'],
      error: /Invalid GitHub owner/,
    },
    {
      name: 'invalid repository',
      args: ['itdojp', 'sample&book', '--output', 'sample-book'],
      error: /Invalid GitHub repository/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const root = makeTemporaryRoot(
        'args-' + fixture.name.replaceAll(' ', '-'),
      );
      const result = runScaffold(root, fixture.args);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, fixture.error);
      assert.deepEqual(readdirSync(path.join(root, 'outputs')), []);
    });
  }
});

test('--create presents one clean main commit to one mocked gh create call', () => {
  const root = makeTemporaryRoot('create-success');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(root, [
    'itdojp',
    'sample-book',
    '--create',
    '--output',
    output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(git(output, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(
    git(output, 'log', '-1', '--pretty=%s'),
    'chore: initialize book scaffold',
  );
  assert.equal(
    git(output, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
  );
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/itdojp/sample-book.git',
  );

  const evidence = readFileSync(result.evidence, 'utf8');
  assert.match(evidence, new RegExp('source=' + escapeRegExp(output)));
  assert.match(evidence, /branch=main/);
  assert.match(evidence, /commits=1/);
  assert.match(evidence, /status=\n/);
  assert.match(evidence, /remotes-before=\n/);

  const calls = readFileSync(result.log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 3);
  assert.match(calls[0], /^auth status --hostname github\.com /);
  assert.match(calls[1], /^api --silent repos\/itdojp\/sample-book /);
  assert.match(calls[2], /^repo create itdojp\/sample-book --public --source /);
  assert.match(calls[2], / --remote origin --push$/);
});

test('--create preflight failures do not create a local destination', async (t) => {
  const fixtures = [
    {
      name: 'authentication failure',
      mode: 'auth-fail',
      error: /authentication for github\.com is required/,
      calls: 1,
    },
    {
      name: 'existing remote',
      mode: 'remote-exists',
      error: /repository already exists/,
      calls: 2,
    },
    {
      name: 'remote lookup failure',
      mode: 'lookup-fail',
      error: /Unable to prove.*is absent/,
      calls: 2,
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const root = makeTemporaryRoot('preflight-' + fixture.mode);
      const output = path.join(root, 'outputs', 'sample-book');
      const result = runScaffold(
        root,
        ['itdojp', 'sample-book', '--output', output, '--create'],
        { ghMode: fixture.mode },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, fixture.error);
      assert.equal(existsSync(output), false);
      const calls = readFileSync(result.log, 'utf8').trim().split('\n');
      assert.equal(calls.length, fixture.calls);
      assert.equal(
        calls.some((call) => call.startsWith('repo create ')),
        false,
      );
    });
  }
});

test('a partial gh create failure retains the clean committed local repository', () => {
  const root = makeTemporaryRoot('create-failure');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    { ghMode: 'create-fail' },
  );

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(output), true);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(git(output, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(
    git(output, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
  );
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/itdojp/sample-book.git',
  );
  assert.match(result.stderr, /clean local repository is retained/);
  assert.match(result.stderr, /gh repo view itdojp\/sample-book/);
  assert.match(result.stderr, /git -C .* remote -v/);
  const calls = readFileSync(result.log, 'utf8').trim().split('\n');
  assert.equal(
    calls.filter((call) => call.startsWith('repo create ')).length,
    1,
  );
});

test('a successful gh result with the wrong origin fails closed', () => {
  const root = makeTemporaryRoot('wrong-origin');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    { ghMode: 'wrong-origin' },
  );

  assert.notEqual(result.status, 0);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(
    git(output, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
  );
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/other/repository.git',
  );
  assert.match(result.stderr, /local repository contract is incomplete/);
});
