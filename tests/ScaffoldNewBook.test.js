import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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

function assertTreeMatches(
  source,
  destination,
  { contentExceptions = [] } = {},
) {
  const files = relativeFiles(source);
  const exceptions = new Set(contentExceptions);
  assert.deepEqual(relativeFiles(destination), files);
  for (const relative of files) {
    if (exceptions.has(relative)) continue;
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
    'if [ "${GH_HOST:-}" != github.com ]; then',
    '  echo "gh host is not pinned to github.com" >&2',
    '  exit 92',
    'fi',
    'if [ -n "${GIT_TEMPLATE_DIR:-}" ]; then',
    '  echo "git template injection remains" >&2',
    '  exit 93',
    'fi',
    'if ! { [ "${1:-}" = auth ] && [ "${2:-}" = git-credential ]; }; then',
    '  test -z "${GIT_EXEC_PATH:-}"',
    'fi',
    'test "${GIT_SSH:-}" = false',
    'test "${GIT_SSH_COMMAND:-}" = false',
    'test "${GIT_CONFIG_COUNT:-}" = 2',
    'test "${GIT_CONFIG_KEY_0:-}" = credential.https://github.com.helper',
    'test "${GIT_CONFIG_VALUE_0+x}" = x',
    'test -z "${GIT_CONFIG_VALUE_0}"',
    'test "${GIT_CONFIG_KEY_1:-}" = credential.https://github.com.helper',
    'test "${GIT_CONFIG_VALUE_1:-}" = "!gh auth git-credential"',
    'test -z "${GIT_CONFIG_PARAMETERS:-}"',
    'while IFS= read -r name; do',
    '  case "$name" in',
    '    GIT_CONFIG_KEY_0|GIT_CONFIG_VALUE_0|GIT_CONFIG_KEY_1|GIT_CONFIG_VALUE_1) ;;',
    '    GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*) echo "untrusted git config remains: $name" >&2; exit 93 ;;',
    '  esac',
    'done < <(compgen -e)',
    'test "${GIT_CONFIG_GLOBAL:-}" = /dev/null',
    'test "${GIT_CONFIG_SYSTEM:-}" = /dev/null',
    'test "${GIT_CONFIG_NOSYSTEM:-}" = 1',
    '',
    'if [ "${1:-}" = auth ] && [ "${2:-}" = git-credential ]; then',
    '  test "${3:-}" = get',
    '  cat >/dev/null',
    '  printf "username=x-access-token\\npassword=synthetic-test-token\\n"',
    '  exit 0',
    'fi',
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
    '  config)',
    '    test "$2" = get',
    '    test "$3" = git_protocol',
    '    test "$4" = --host',
    '    test "$5" = github.com',
    '    if [ "$mode" = ssh-protocol ]; then echo ssh; else echo https; fi',
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
    '    credential_output="$(printf "protocol=https\\nhost=github.com\\n\\n" | git -C "$source_path" credential fill)"',
    '    grep -q "^username=x-access-token$" <<<"$credential_output"',
    '    grep -q "^password=synthetic-test-token$" <<<"$credential_output"',
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
    '    if [ "$mode" = canonical-origin ]; then',
    '      remote_name="$(printf \'%s\' "$full_name" | LC_ALL=C tr \'[:upper:]\' \'[:lower:]\')"',
    '    fi',
    '    remote_url="https://github.com/$remote_name.git"',
    '    if [ "$mode" = ssh-origin ]; then remote_url="git@github.com:$remote_name.git"; fi',
    '    git -C "$source_path" remote add origin "$remote_url"',
    '    effective_push_url="$(git -C "$source_path" remote get-url --push origin)"',
    '    test "$effective_push_url" = "$remote_url"',
    '    printf \'push-url=%s\\n\' "$effective_push_url" >> "$GH_MOCK_EVIDENCE"',
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

function runScaffold(
  root,
  args,
  { ghMode = '', author = true, extraEnv = {}, script = SCRIPT } = {},
) {
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
    ...extraEnv,
  };
  if (author) {
    env.GIT_AUTHOR_NAME = 'Scaffold Test';
    env.GIT_AUTHOR_EMAIL = 'scaffold-test@example.invalid';
  } else {
    delete env.GIT_AUTHOR_NAME;
    delete env.GIT_AUTHOR_EMAIL;
  }
  const result = spawnSync('bash', [script, ...args], {
    cwd: path.join(root, 'caller'),
    env,
    encoding: 'utf8',
  });
  return { ...result, log, evidence };
}

function copyScaffoldSourceFixture(root, { githubTemplates = false } = {}) {
  const formatter = path.join(root, 'formatter');
  mkdirSync(path.join(formatter, 'scripts'), { recursive: true });
  mkdirSync(path.join(formatter, 'templates'), { recursive: true });
  cpSync(SCRIPT, path.join(formatter, 'scripts/scaffold-new-book.sh'));
  cpSync(
    path.join(REPOSITORY_ROOT, 'scripts/lib.sh'),
    path.join(formatter, 'scripts/lib.sh'),
  );
  cpSync(
    path.join(REPOSITORY_ROOT, 'templates/starter'),
    path.join(formatter, 'templates/starter'),
    { recursive: true },
  );
  if (githubTemplates) {
    cpSync(
      path.join(REPOSITORY_ROOT, 'templates/.github'),
      path.join(formatter, 'templates/.github'),
      { recursive: true },
    );
  }
  cpSync(path.join(REPOSITORY_ROOT, 'shared'), path.join(formatter, 'shared'), {
    recursive: true,
  });
  return formatter;
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
    { contentExceptions: ['PULL_REQUEST_TEMPLATE.md'] },
  );

  const config = readFileSync(path.join(output, 'docs/_config.yml'), 'utf8');
  assert.match(config, /title: "sample book"/);
  assert.match(config, /repository: "itdojp\/sample-book"/);
  assert.match(config, /url: "https:\/\/itdojp\.github\.io"/);
  assert.match(config, /^baseurl: "\/sample-book"$/m);
  assert.doesNotMatch(
    config,
    /<(owner|repo|BOOK TITLE|SHORT DESCRIPTION|AUTHOR)>/,
  );
  assert.doesNotMatch(relativeFiles(output).join('\n'), /\.bak$/);
  assert.equal(readFileSync(result.log, 'utf8'), '');

  const navigation = readFileSync(
    path.join(output, 'docs/_data/navigation.yml'),
    'utf8',
  );
  assert.equal(navigation, '{}\n');
  assert.doesNotMatch(
    navigation,
    /\/(?:introduction|chapters|appendices)\//,
  );
  const navWorkflow = readFileSync(
    path.join(output, '.github/workflows/nav-link-check.yml'),
    'utf8',
  );
  assert.match(navWorkflow, /GITHUB_REPOSITORY_OWNER/);
  assert.doesNotMatch(navWorkflow, /itdojp\.github\.io/);
  const bookQaWorkflow = readFileSync(
    path.join(output, '.github/workflows/book-qa.yml'),
    'utf8',
  );
  assert.match(bookQaWorkflow, /actions\/jekyll-build-pages@v1/);
  assert.doesNotMatch(bookQaWorkflow, /configure-pages|\bpages:\s*(?:read|write)/);
  const pullRequestTemplate = readFileSync(
    path.join(output, '.github/PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.match(
    pullRequestTemplate,
    /https:\/\/itdojp\.github\.io\/sample-book\//,
  );
  assert.doesNotMatch(pullRequestTemplate, /<(?:owner|repo|REPO)>/);
});

test('missing canonical GitHub templates fail before output creation', () => {
  const root = makeTemporaryRoot('missing-github-templates');
  const formatter = copyScaffoldSourceFixture(root);

  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output],
    { script: path.join(formatter, 'scripts/scaffold-new-book.sh') },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a regular non-symlink file/);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(result.log, 'utf8'), '');
});

test('symlinked canonical GitHub templates fail before output creation', () => {
  const root = makeTemporaryRoot('symlinked-github-template');
  const formatter = copyScaffoldSourceFixture(root, {
    githubTemplates: true,
  });
  const externalWorkflow = path.join(root, 'external-book-qa.yml');
  writeFileSync(externalWorkflow, 'name: External workflow\n');
  const bookQa = path.join(
    formatter,
    'templates/.github/workflows/book-qa.yml',
  );
  rmSync(bookQa);
  symlinkSync(externalWorkflow, bookQa);

  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output],
    { script: path.join(formatter, 'scripts/scaffold-new-book.sh') },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a regular non-symlink file/);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(result.log, 'utf8'), '');
});

test('option-like relative output names remain literal paths', () => {
  const root = makeTemporaryRoot('option-like-output');
  const output = path.join(root, 'caller', '-sample-book');
  const result = runScaffold(root, [
    'itdojp',
    'sample-book',
    '--output',
    '-sample-book',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(output), true);
  assert.equal(existsSync(path.join(output, 'docs/_config.yml')), true);
});

test('CDPATH cannot redirect or corrupt a relative output parent', () => {
  const root = makeTemporaryRoot('cdpath-output');
  const callerOutputs = path.join(root, 'caller', 'outputs');
  const alternateRoot = path.join(root, 'alternate');
  const alternateOutputs = path.join(alternateRoot, 'outputs');
  mkdirSync(callerOutputs);
  mkdirSync(alternateRoot);
  mkdirSync(alternateOutputs);

  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', 'outputs/sample-book'],
    { extraEnv: { CDPATH: alternateRoot } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(path.join(callerOutputs, 'sample-book', 'docs/_config.yml')),
    true,
  );
  assert.equal(existsSync(path.join(alternateOutputs, 'sample-book')), false);
});

test('copied PR template uses the requested Pages owner and repository', () => {
  const root = makeTemporaryRoot('pr-template-owner');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(root, [
    'sample-owner',
    'sample-book',
    '--output',
    output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const pullRequestTemplate = readFileSync(
    path.join(output, '.github/PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.match(
    pullRequestTemplate,
    /https:\/\/sample-owner\.github\.io\/sample-book\//,
  );
  assert.doesNotMatch(pullRequestTemplate, /itdojp\.github\.io|<[^>]+>/);
});

test('owner Pages repositories use a root Pages URL case-insensitively', () => {
  const root = makeTemporaryRoot('owner-pages-root');
  const output = path.join(root, 'outputs', 'owner-pages-site');
  const result = runScaffold(root, [
    'Sample-Owner',
    'sample-owner.GitHub.io',
    '--output',
    output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const config = readFileSync(path.join(output, 'docs/_config.yml'), 'utf8');
  assert.match(config, /^url: "https:\/\/Sample-Owner\.github\.io"$/m);
  assert.match(config, /^baseurl: ""$/m);
  assert.doesNotMatch(config, /baseurl: "\/sample-owner\.GitHub\.io"/);
  const pullRequestTemplate = readFileSync(
    path.join(output, '.github/PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.match(pullRequestTemplate, /https:\/\/Sample-Owner\.github\.io\//);
  assert.doesNotMatch(
    pullRequestTemplate,
    /Sample-Owner\.github\.io\/sample-owner\.GitHub\.io\//,
  );
  const navWorkflow = readFileSync(
    path.join(output, '.github/workflows/nav-link-check.yml'),
    'utf8',
  );
  assert.match(
    navWorkflow,
    /if isinstance\(bu,str\):\s+baseurl = bu\.strip\(\)\.strip/,
  );
  assert.doesNotMatch(navWorkflow, /isinstance\(bu,str\) and bu\.strip\(\)/);
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
      name: 'owner with consecutive hyphens',
      args: ['bad--owner', 'sample-book', '--output', 'sample-book'],
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
  assert.equal(calls.length, 4);
  assert.match(calls[0], /^auth status --hostname github\.com /);
  assert.match(calls[1], /^config get git_protocol --host github\.com /);
  assert.match(
    calls[2],
    /^api --hostname github\.com --silent repos\/itdojp\/sample-book /,
  );
  assert.match(calls[3], /^repo create itdojp\/sample-book --public --source /);
  assert.match(calls[3], / --remote origin --push$/);
});

test('--create ignores caller-owned Git repository and executable routing variables', () => {
  const root = makeTemporaryRoot('git-routing');
  const output = path.join(root, 'outputs', 'sample-book');
  const templateDirectory = path.join(root, 'malicious-template');
  mkdirSync(templateDirectory);
  writeFileSync(
    path.join(templateDirectory, 'config'),
    '[url "https://enterprise.example.invalid/redirect/"]\n' +
      '\tpushInsteadOf = https://github.com/\n',
  );
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    {
      extraEnv: {
        GIT_DIR: path.join(root, 'decoy.git'),
        GIT_WORK_TREE: path.join(root, 'decoy-worktree'),
        GIT_INDEX_FILE: path.join(root, 'decoy-index'),
        GIT_OBJECT_DIRECTORY: path.join(root, 'decoy-objects'),
        GIT_EXEC_PATH: path.join(root, 'malicious-git-exec-path'),
        GIT_TEMPLATE_DIR: templateDirectory,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'remote.origin.pushurl',
        GIT_CONFIG_VALUE_0: 'https://enterprise.example.invalid/redirect.git',
        GIT_SSH: path.join(root, 'malicious-ssh'),
        GIT_SSH_COMMAND: 'ssh -F malicious-config',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(git(output, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/itdojp/sample-book.git',
  );
  assert.equal(existsSync(path.join(root, 'decoy.git')), false);
  assert.equal(existsSync(path.join(root, 'decoy-index')), false);
  assert.equal(existsSync(path.join(root, 'decoy-objects')), false);
  assert.doesNotMatch(
    readFileSync(path.join(output, '.git/config'), 'utf8'),
    /pushInsteadOf|enterprise\.example\.invalid/,
  );
});

test('--create pins every gh operation to github.com despite caller GH_HOST', () => {
  const root = makeTemporaryRoot('gh-host');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    { extraEnv: { GH_HOST: 'enterprise.example.invalid' } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/itdojp/sample-book.git',
  );
  const calls = readFileSync(result.log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 4);
  assert.match(calls[1], /^config get git_protocol --host github\.com /);
  assert.match(calls[2], /^api --hostname github\.com --silent /);
  assert.match(calls[3], /^repo create itdojp\/sample-book /);
});

test('--create accepts canonical casing in the returned GitHub origin', () => {
  const root = makeTemporaryRoot('canonical-origin');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['ITDOJP', 'Sample-Book', '--output', output, '--create'],
    { ghMode: 'canonical-origin' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'https://github.com/itdojp/sample-book.git',
  );
});

test('--create reads user identity before isolating ordinary Git config', () => {
  const root = makeTemporaryRoot('global-identity');
  const output = path.join(root, 'outputs', 'sample-book');
  const formatter = copyScaffoldSourceFixture(root, {
    githubTemplates: true,
  });
  git(formatter, 'init');
  git(formatter, 'config', 'user.name', 'Formatter Automation');
  git(formatter, 'config', 'user.email', 'formatter@example.invalid');
  const customHome = path.join(root, 'home');
  mkdirSync(customHome);
  writeFileSync(
    path.join(customHome, '.gitconfig'),
    '[user]\n' +
      '\tname = Global Scaffold Author\n' +
      '\temail = global-author@example.invalid\n',
  );

  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    {
      author: false,
      extraEnv: { HOME: customHome },
      script: path.join(formatter, 'scripts/scaffold-new-book.sh'),
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(output, 'log', '-1', '--pretty=%an'), 'Global Scaffold Author');
  assert.equal(
    git(output, 'log', '-1', '--pretty=%ae'),
    'global-author@example.invalid',
  );
});

test('--create tracks the complete scaffold despite caller global ignores', () => {
  const root = makeTemporaryRoot('global-ignore');
  const output = path.join(root, 'outputs', 'sample-book');
  const excludes = path.join(root, 'global-excludes');
  const customHome = path.join(root, 'home');
  mkdirSync(customHome);
  const globalConfig = path.join(customHome, '.gitconfig');
  writeFileSync(excludes, '*\n');
  writeFileSync(
    globalConfig,
    `[core]\n\texcludesFile = ${excludes}\n` +
      '[remote "origin"]\n' +
      '\tpushurl = https://enterprise.example.invalid/redirect.git\n',
  );

  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    { extraEnv: { HOME: customHome } },
  );

  assert.equal(result.status, 0, result.stderr);
  const worktreeFiles = relativeFiles(output).filter(
    (relative) => relative !== '.git' && !relative.startsWith('.git/'),
  );
  const trackedFiles = git(output, 'ls-files').split('\n').sort();
  assert.deepEqual(trackedFiles, worktreeFiles);
  assert.ok(trackedFiles.includes('docs/_config.yml'));
  assert.ok(trackedFiles.includes('docs/index.md'));
  assert.ok(trackedFiles.includes('.github/workflows/book-qa.yml'));
  assert.match(
    readFileSync(result.evidence, 'utf8'),
    /push-url=https:\/\/github\.com\/itdojp\/sample-book\.git/,
  );
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
      name: 'SSH publication protocol',
      mode: 'ssh-protocol',
      error: /requires GitHub CLI git_protocol=https/,
      calls: 2,
    },
    {
      name: 'existing remote',
      mode: 'remote-exists',
      error: /repository already exists/,
      calls: 3,
    },
    {
      name: 'remote lookup failure',
      mode: 'lookup-fail',
      error: /Unable to prove.*is absent/,
      calls: 3,
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
  const output = path.join(root, 'outputs', 'sample\' book');
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
  assert.match(
    result.stderr,
    /GH_HOST=github\.com gh repo view itdojp\/sample-book/,
  );
  assert.match(result.stderr, /git -C .* remote -v/);
  const recoveryLine = result.stderr
    .split('\n')
    .find((line) => line.includes('Also inspect: git -C '));
  assert.ok(recoveryLine);
  const recoveryCommand = recoveryLine.slice(recoveryLine.indexOf('git -C '));
  const recovery = spawnSync('bash', ['-c', recoveryCommand], {
    encoding: 'utf8',
  });
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.match(recovery.stdout, /origin\s+https:\/\/github\.com\/itdojp\/sample-book\.git/);
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

test('a successful gh result with an SSH origin fails closed', () => {
  const root = makeTemporaryRoot('ssh-origin');
  const output = path.join(root, 'outputs', 'sample-book');
  const result = runScaffold(
    root,
    ['itdojp', 'sample-book', '--output', output, '--create'],
    { ghMode: 'ssh-origin' },
  );

  assert.notEqual(result.status, 0);
  assert.equal(git(output, 'branch', '--show-current'), 'main');
  assert.equal(
    git(output, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
  );
  assert.equal(
    git(output, 'remote', 'get-url', 'origin'),
    'git@github.com:itdojp/sample-book.git',
  );
  assert.match(result.stderr, /local repository contract is incomplete/);
});
