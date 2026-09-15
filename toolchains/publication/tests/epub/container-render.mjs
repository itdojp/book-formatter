import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// These are actual container probes, not a claim of a general hostile-code sandbox.
assert.equal(process.version, 'v24.18.0');
assert.ok(process.getuid() > 0);
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /NoNewPrivs:\s+1/);
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapEff:\s+0+\n/);
assert.deepEqual(fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)
  .filter(line => line.includes(':')).map(line => line.split(':')[0].trim()), ['lo']);
assert.deepEqual(fs.readdirSync('/input').sort(), ['chapter.md', 'vivliostyle.config.mjs']);
for (const path of ['/input/probe', '/opt/toolchain/node_modules/probe', '/read-only-root-probe']) {
  assert.throws(() => fs.writeFileSync(path, 'must not be writable'), error =>
    ['EROFS', 'EACCES'].includes(error.code));
}
assert.equal(fs.existsSync('/input/not-selected.md'), false);
// cgroup v2 limits must actually be applied, not merely accepted as CLI flags.
assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), '1073741824');
assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(), '128');
const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' ').map(Number);
assert.equal(quota / period, 1);
const result = spawnSync(process.execPath, [
  '/opt/toolchain/node_modules/@vivliostyle/cli/dist/cli.js', 'build',
  '--config', '/input/vivliostyle.config.mjs', '--no-vite-config-file'
], { stdio: 'inherit', timeout: 90000 });
assert.ifError(result.error);
assert.equal(result.status, 0, `renderer failed: ${result.signal}`);
fs.writeFileSync('/output/container-metrics.json', JSON.stringify({
  node: process.version,
  memoryPeakBytes: Number(fs.readFileSync('/sys/fs/cgroup/memory.peak', 'utf8').trim()),
  memoryMaxBytes: 1073741824,
  cpuQuota: 1,
  pidsMax: 128,
  interfaces: ['lo']
}, null, 2) + '\n');
