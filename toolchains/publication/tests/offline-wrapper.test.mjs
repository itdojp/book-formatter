import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));

for (const mode of ['unchanged namespace', 'unshare failure', 'namespace probe failure', 'namespace probe empty', 'child probe failure', 'child probe empty']) {
  test(`offline wrapper fails closed before Node: ${mode}`, async () => {
    // Deliberate command doubles only in this unit test. The real offline gate is run separately in CI.
    const bin = await mkdtemp(path.join(root, 'tests/.wrapper-'));
    try {
      await writeFile(path.join(bin, 'node'), '#!/bin/sh\necho WRAPPER_NODE_STARTED\nexit 0\n', { mode: 0o700 });
      const injectProbe = mode.startsWith('child probe')
        ? `shift\nshift\nexec /usr/bin/env -i 'BASH_FUNC_readlink%%=() { return ${mode === 'child probe failure' ? 44 : 0}; }' "$@"\n`
        : 'exec "$@"\n';
      await writeFile(path.join(bin, 'unshare'), mode === 'unshare failure' ? '#!/bin/sh\nexit 42\n' :
        '#!/bin/sh\nset -eu\nwhile [ "$1" != "--" ]; do shift; done\nshift\n' + injectProbe, { mode: 0o700 });
      if (mode.startsWith('namespace probe')) await writeFile(path.join(bin, 'readlink'), `#!/bin/sh\nexit ${mode === 'namespace probe failure' ? 44 : 0}\n`, { mode: 0o700 });
      const result = spawnSync('/bin/bash', ['tests/offline.sh'], { cwd: root, env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8', timeout: 10_000 });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /WRAPPER_NODE_STARTED/);
    } finally { await rm(bin, { recursive: true }); }
  });
}
