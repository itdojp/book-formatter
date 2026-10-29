import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_TIMEOUT_MS, CONTEXT_BUFFER_BYTES, PATH_ENTRY_LIMIT, PATH_LENGTH_LIMIT,
  PUBLIC_CHROME_PATHS, inspectChromeContext, collectChromeContext
} from './shared-browser-context.js';
import {
  CHROME_CANDIDATES, CHROME_DIAGNOSTIC_LIMIT, CHROME_PROBE_TIMEOUT_MS,
  discoverChrome
} from './shared-browser-discovery.js';

const noContext = () => ({ status: 'inspection-failed' });
const success = { status: 0, signal: null, stdout: 'Google Chrome 140.0.7339.207\n', stderr: '' };
const failures = [
  ['missing', { status: null, error: { code: 'ENOENT' } }],
  ['unexecutable', { status: null, error: { code: 'EACCES' } }],
  ['timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }],
  ['nonzero', { status: 1, stdout: '', stderr: 'version probe failed' }],
  ['signal', { status: null, signal: 'SIGSEGV' }],
  ['errored zero status', { status: 0, error: { code: 'ENOBUFS' } }]
];

test('default candidates preserve order, stop at success and keep bounded probe options', () => {
  const calls = [];
  let clock = 0;
  const result = discoverChrome({
    chromePath: '', inspect: noContext, now: () => clock += 5,
    probe: (command, args, options) => {
      calls.push(command);
      assert.deepEqual(args, ['--version']);
      assert.deepEqual(options, { timeout: CHROME_PROBE_TIMEOUT_MS });
      return calls.length === 2 ? success : failures[0][1];
    }
  });
  assert.deepEqual(calls, CHROME_CANDIDATES.slice(0, 2));
  assert.equal(result.chrome, CHROME_CANDIDATES[1]);
  assert.deepEqual(result.diagnostics.map(p => p.elapsedMs), [5, 5]);
  assert.equal(result.diagnostics[0].errorCode, 'ENOENT');
  assert.equal(result.diagnostics[1].stdout, success.stdout);
});

for (const [name, failure] of failures) {
  test(`${name} fails closed with classified diagnostics and no fallback for an explicit path`, () => {
    const calls = [];
    const result = discoverChrome({
      chromePath: '/owned/fixture/google-chrome', now: () => 0,
      probe: command => { calls.push(command); return failure; }
    });
    assert.deepEqual(calls, ['/owned/fixture/google-chrome']);
    assert.equal(result.chrome, null);
    assert.deepEqual(result.diagnostics, [{
      command: 'google-chrome', status: failure.status ?? null,
      signal: failure.signal ?? null, errorCode: failure.error?.code ?? null,
      elapsedMs: 0, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '',
      context: { status: 'override-redacted' }
    }]);
  });
}

test('all default failures report every probe but never produce a synthetic browser success', () => {
  const result = discoverChrome({ chromePath: '', inspect: noContext, probe: () => failures[0][1], now: () => 0 });
  assert.equal(result.chrome, null);
  assert.equal(result.diagnostics.length, CHROME_CANDIDATES.length);
  assert.deepEqual(result.diagnostics.map(p => p.command), [...CHROME_CANDIDATES]);
});

test('diagnostics bound stdout/stderr, exclude Error/environment and escape workflow-looking text', () => {
  const result = discoverChrome({
    chromePath: '/owned/fixture/chrome', now: () => 0,
    probe: () => ({
      status: 1, error: { code: 'EACCES', message: 'must not be emitted' },
      stdout: Buffer.from('x'.repeat(CHROME_DIAGNOSTIC_LIMIT + 20)),
      stderr: '\n::error::fixture\n' + 'y'.repeat(CHROME_DIAGNOSTIC_LIMIT)
    })
  });
  const [record] = result.diagnostics;
  assert.equal(record.stdout.length, CHROME_DIAGNOSTIC_LIMIT);
  assert.equal(record.stderr.length, CHROME_DIAGNOSTIC_LIMIT);
  const json = JSON.stringify(result.diagnostics);
  assert.ok(!json.includes('/owned/fixture'));
  assert.ok(!json.includes('must not be emitted'));
  assert.ok(!json.includes('\n'));
  assert.equal(record.errorCode, 'EACCES');
});

// Metadata-only fixtures: no writes to system paths and no browser/network call.
function fakeFilesystem(entries = {}) {
  const calls = [];
  const get = name => {
    calls.push(name);
    if (!entries[name]) throw Object.assign(new Error('fixture private detail'), { code: 'ENOENT' });
    return entries[name];
  };
  return {
    calls,
    statSync(name) {
      const item = get(name);
      if (item.error) throw Object.assign(new Error('fixture private detail'), { code: item.error });
      return { isFile: () => !item.directory, size: 1234 };
    },
    accessSync(name) {
      if (get(name).unexecutable) throw Object.assign(new Error('private detail'), { code: 'EACCES' });
    },
    realpathSync(name) { return get(name).realPath ?? name; }
  };
}
const runtime = { platform: 'linux', arch: 'x64', node: '24.21.0' };
const inspectFixture = (env = {}, filesystem = fakeFilesystem(), extra = {}) =>
  inspectChromeContext('google-chrome', { ...runtime, env, filesystem, cwd: '/fixture', ...extra });
const publicRecord = () => inspectFixture(
  { PATH: '/usr/bin', ImageOS: 'ubuntu24', ImageVersion: '20261020.1.0' },
  fakeFilesystem({ '/usr/bin/google-chrome': { realPath: '/opt/google/chrome/google-chrome' } })
);

test('context reports only finite public lookup/realpath metadata and recognized runner identity', () => {
  const record = publicRecord();
  assert.deepEqual(record, {
    schemaVersion: 1,
    runtime: { ...runtime, imageOS: 'ubuntu24', imageVersion: '20261020.1.0' },
    lookup: { status: 'resolved', path: '/usr/bin/google-chrome', realPath: '/opt/google/chrome/google-chrome', size: 1234 }
  });
  assert.ok(Object.isFrozen(PUBLIC_CHROME_PATHS));
});

for (const [name, env, entries] of [
  ['private first match', { PATH: '/private:/usr/bin' }, { '/private/google-chrome': {}, '/usr/bin/google-chrome': {} }],
  ['private symlink destination', { PATH: '/usr/bin' }, { '/usr/bin/google-chrome': { realPath: '/private/browser' } }],
  ['empty PATH', { PATH: '' }, { '/fixture/google-chrome': {} }],
  ['relative PATH', { PATH: 'relative' }, { '/fixture/relative/google-chrome': {} }]
]) {
  test(`context redacts ${name} rather than reporting a later public candidate`, () => {
    const filesystem = fakeFilesystem(entries);
    const result = inspectFixture(env, filesystem);
    assert.deepEqual(result.lookup, { status: 'redacted' });
    assert.ok(!JSON.stringify(result).includes('/private'));
    if (name === 'private first match') assert.ok(!filesystem.calls.includes('/usr/bin/google-chrome'));
  });
}

for (const [name, item] of [
  ['missing', undefined], ['directory', { directory: true }], ['unexecutable', { unexecutable: true }],
  ['not a directory', { error: 'ENOTDIR' }]
]) {
  test(`context skips ${name} and reports the first executable public candidate`, () => {
    const result = inspectFixture({ PATH: '/missing:/usr/bin' }, fakeFilesystem({
      '/missing/google-chrome': item, '/usr/bin/google-chrome': {}
    }));
    assert.equal(result.lookup.path, '/usr/bin/google-chrome');
  });
}

test('context default PATH, missing files and unsupported platforms have explicit outcomes', () => {
  assert.equal(inspectFixture({}, fakeFilesystem({ '/usr/bin/google-chrome': {} })).lookup.status, 'resolved');
  assert.equal(inspectFixture({ PATH: '/usr/bin' }).lookup.status, 'not-found');
  const filesystem = fakeFilesystem();
  for (const platform of ['win32', 'darwin']) {
    assert.equal(inspectFixture({}, filesystem, { platform }).lookup.status, 'unsupported-platform');
  }
  assert.equal(filesystem.calls.length, 0);
});

for (const [name, PATH] of [
  ['too long', 'x'.repeat(PATH_LENGTH_LIMIT + 1)],
  ['too many entries', Array(PATH_ENTRY_LIMIT + 1).fill('/usr/bin').join(':')],
  ['invalid type', 17]
]) {
  test(`context bounds PATH lookup: ${name}`, () => {
    const filesystem = fakeFilesystem();
    assert.equal(inspectFixture({ PATH }, filesystem).lookup.status, 'inspection-limit');
    assert.equal(filesystem.calls.length, 0);
  });
}

test('context does not log unexpected filesystem errors or arbitrary runner/environment strings', () => {
  const result = inspectFixture({ PATH: '/usr/bin', ImageOS: 'secret', ImageVersion: 'private', TOKEN: 'never-log' },
    fakeFilesystem({ '/usr/bin/google-chrome': { error: 'EIO' } }));
  assert.equal(result.lookup.status, 'unavailable');
  assert.equal(result.runtime.imageOS, null);
  assert.equal(result.runtime.imageVersion, null);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|TOKEN|never-log|detail/);
});

test('explicit override or unknown candidate performs no metadata child or filesystem lookup', () => {
  for (const [candidate, explicitOverride] of [['google-chrome', true], ['/private/chrome', false], ['unknown', false]]) {
    assert.deepEqual(collectChromeContext(candidate, {
      explicitOverride, run: () => assert.fail('must not launch metadata child')
    }), { status: 'override-redacted' });
  }
  const filesystem = fakeFilesystem();
  assert.equal(inspectChromeContext('/private/chrome', { filesystem }).lookup.status, 'redacted');
  assert.equal(filesystem.calls.length, 0);
});

test('metadata collector uses a bounded Node child, validates output and never launches Chrome', () => {
  let calls = 0;
  const record = publicRecord();
  const result = collectChromeContext('google-chrome', { run(command, args, options) {
    calls++;
    assert.equal(command, process.execPath);
    assert.ok(args[0].endsWith('/tests/shared-browser-context.js'));
    assert.equal(args[1], 'google-chrome');
    assert.equal(args.length, 2);
    assert.deepEqual(options, {
      encoding: 'utf8', timeout: CONTEXT_TIMEOUT_MS, maxBuffer: CONTEXT_BUFFER_BYTES, killSignal: 'SIGKILL'
    });
    return { status: 0, stdout: JSON.stringify(record), stderr: 'never emit child stderr' };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'observed', ...record });
});

for (const [name, response] of [
  ['timeout', { status: null, error: { code: 'ETIMEDOUT' }, stdout: 'private' }],
  ['nonzero', { status: 1, stdout: 'private' }],
  ['signal', { status: 0, signal: 'SIGKILL', stdout: 'private' }],
  ['invalid JSON', { status: 0, stdout: 'private' }],
  ['buffer overflow', { status: 0, error: { code: 'ENOBUFS' }, stdout: 'private' }]
]) {
  test(`metadata ${name} stays diagnostic-only and emits no raw output`, () => {
    assert.deepEqual(collectChromeContext('google-chrome', { run: () => response }), { status: 'inspection-failed' });
  });
}

const invalidRecords = [
  ['schema', record => { record.schemaVersion = 2; }],
  ['extra key', record => { record.private = 'secret'; }],
  ['runtime', record => { record.runtime.imageOS = 'private-runner'; }],
  ['runtime key', record => { record.runtime.PATH = '/private'; }],
  ['path', record => { record.lookup.path = '/private/chrome'; }],
  ['realpath', record => { record.lookup.realPath = '/private/chrome'; }],
  ['size', record => { record.lookup.size = -1; }],
  ['non-resolved leak', record => { record.lookup = { status: 'redacted', path: '/private' }; }]
];
for (const [name, mutate] of invalidRecords) {
  test(`metadata schema rejects ${name} without forwarding untrusted output`, () => {
    const record = publicRecord(); mutate(record);
    assert.deepEqual(collectChromeContext('google-chrome', {
      run: () => ({ status: 0, stdout: JSON.stringify(record) })
    }), { status: 'invalid-context' });
  });
}

test('inspection runs once after each original probe and cannot change discovery outcomes or timing', () => {
  const events = [];
  let clock = 0;
  const result = discoverChrome({ chromePath: '', now: () => clock += 5,
    probe: command => { events.push(`probe:${command}`); return events.length === 3 ? success : failures[0][1]; },
    inspect: (command, options) => {
      events.push(`inspect:${command}`);
      assert.deepEqual(options, { explicitOverride: false });
      clock += 1000;
      throw new Error('metadata unavailable');
    }
  });
  assert.equal(result.chrome, CHROME_CANDIDATES[1]);
  assert.deepEqual(events, CHROME_CANDIDATES.slice(0, 2).flatMap(c => [`probe:${c}`, `inspect:${c}`]));
  assert.deepEqual(result.diagnostics.map(d => d.elapsedMs), [5, 5]);
  assert.deepEqual(result.diagnostics.map(d => d.context), Array(2).fill({ status: 'inspection-failed' }));
  assert.deepEqual(collectChromeContext('chromium', { run: () => { throw new Error('private'); } }), { status: 'inspection-failed' });
});
