// Best-effort evidence, never a browser-selection or security decision.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CONTEXT_TIMEOUT_MS = 1000;
export const CONTEXT_BUFFER_BYTES = 4096;
export const PATH_ENTRY_LIMIT = 64;
export const PATH_LENGTH_LIMIT = 16384;
export const PUBLIC_CHROME_PATHS = Object.freeze([
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/local/bin/google-chrome', '/usr/local/bin/google-chrome-stable',
  '/usr/local/bin/chromium', '/usr/local/bin/chromium-browser',
  '/opt/google/chrome/google-chrome', '/opt/google/chrome/chrome',
  '/usr/lib/chromium/chromium', '/usr/lib/chromium-browser/chromium-browser',
  '/snap/bin/chromium'
]);
const candidates = new Set(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
const moduleFile = fileURLToPath(import.meta.url);
const states = new Set(['resolved', 'redacted', 'not-found', 'inspection-limit', 'unavailable', 'unsupported-platform']);

function runtimeContext(env, platform, arch, node) {
  return {
    platform: ['linux', 'darwin', 'win32', 'aix', 'freebsd', 'openbsd', 'sunos', 'android'].includes(platform) ? platform : null,
    arch: ['x64', 'arm64', 'arm', 'ia32', 'ppc64', 's390x', 'riscv64'].includes(arch) ? arch : null,
    node: /^\d+\.\d+\.\d+$/.test(node ?? '') ? node : null,
    // Do not echo arbitrary environment values, even under these two names.
    imageOS: /^ubuntu(?:20|22|24|26)$/.test(env.ImageOS ?? '') ? env.ImageOS : null,
    imageVersion: /^\d{8}\.\d{1,4}\.\d{1,4}$/.test(env.ImageVersion ?? '') ? env.ImageVersion : null
  };
}

export function inspectChromeContext(candidate, {
  env = process.env, platform = process.platform, arch = process.arch,
  node = process.versions.node, filesystem = fs, cwd = process.cwd()
} = {}) {
  const result = { schemaVersion: 1, runtime: runtimeContext(env, platform, arch, node), lookup: { status: 'redacted' } };
  if (!candidates.has(candidate)) return result;
  if (platform !== 'linux') { result.lookup.status = 'unsupported-platform'; return result; }
  const searchPath = env.PATH ?? '/usr/bin:/bin';
  if (typeof searchPath !== 'string' || searchPath.length > PATH_LENGTH_LIMIT) {
    result.lookup.status = 'inspection-limit'; return result;
  }
  const entries = searchPath.split(':');
  if (entries.length > PATH_ENTRY_LIMIT) {
    result.lookup.status = 'inspection-limit'; return result;
  }
  try {
    for (const entry of entries) {
      // Empty/relative entries follow process lookup semantics but are not logged.
      const executable = path.resolve(cwd, entry, candidate);
      let stat;
      try {
        stat = filesystem.statSync(executable);
        if (!stat.isFile()) continue;
        filesystem.accessSync(executable, fs.constants.X_OK);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) continue;
        throw error;
      }
      const realPath = filesystem.realpathSync(executable);
      if (PUBLIC_CHROME_PATHS.includes(executable) && PUBLIC_CHROME_PATHS.includes(realPath)) {
        result.lookup = { status: 'resolved', path: executable, realPath, size: stat.size };
      }
      return result;
    }
    result.lookup.status = 'not-found';
  } catch {
    result.lookup.status = 'unavailable';
  }
  return result;
}

function validContext(value) {
  if (!value || value.schemaVersion !== 1 || !value.runtime || !states.has(value.lookup?.status)) return false;
  if (Object.keys(value).sort().join() !== 'lookup,runtime,schemaVersion') return false;
  const r = value.runtime;
  const normalized = runtimeContext({ ImageOS: r.imageOS, ImageVersion: r.imageVersion }, r.platform, r.arch, r.node);
  if (Object.keys(r).sort().join() !== 'arch,imageOS,imageVersion,node,platform' ||
      Object.keys(normalized).some(key => r[key] !== normalized[key])) return false;
  const l = value.lookup;
  if (l.status !== 'resolved') return Object.keys(l).join() === 'status';
  return Object.keys(l).sort().join() === 'path,realPath,size,status' &&
    PUBLIC_CHROME_PATHS.includes(l.path) && PUBLIC_CHROME_PATHS.includes(l.realPath) &&
    Number.isSafeInteger(l.size) && l.size >= 0;
}

export function collectChromeContext(candidate, { explicitOverride = false, run = spawnSync } = {}) {
  if (explicitOverride || !candidates.has(candidate)) return { status: 'override-redacted' };
  try {
    // A potentially slow PATH/filesystem must not hang the native gate. This
    // child reads metadata only; it never launches Chrome or reads file content.
    const result = run(process.execPath, [moduleFile, candidate], {
      encoding: 'utf8', timeout: CONTEXT_TIMEOUT_MS, maxBuffer: CONTEXT_BUFFER_BYTES,
      killSignal: 'SIGKILL'
    });
    if (result.status !== 0 || result.error || result.signal) return { status: 'inspection-failed' };
    const value = JSON.parse(result.stdout);
    return validContext(value) ? { status: 'observed', ...value } : { status: 'invalid-context' };
  } catch {
    return { status: 'inspection-failed' };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile) {
  process.stdout.write(JSON.stringify(inspectChromeContext(process.argv[2])));
}
