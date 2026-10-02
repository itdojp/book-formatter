import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHROME_CANDIDATES, CHROME_DIAGNOSTIC_LIMIT, CHROME_PROBE_TIMEOUT_MS,
  discoverChrome
} from './shared-browser-discovery.js';

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
    chromePath: '', now: () => clock += 5,
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
      elapsedMs: 0, stdout: failure.stdout ?? '', stderr: failure.stderr ?? ''
    }]);
  });
}

test('all default failures report every probe but never produce a synthetic browser success', () => {
  const result = discoverChrome({ chromePath: '', probe: () => failures[0][1], now: () => 0 });
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
