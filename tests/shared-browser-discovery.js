// Discovery diagnostics only: this never substitutes for the native DOM gate.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const CHROME_CANDIDATES = Object.freeze([
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'
]);
export const CHROME_PROBE_TIMEOUT_MS = 3000;
export const CHROME_DIAGNOSTIC_LIMIT = 1024;

function boundedOutput(value) {
  return String(value ?? '').slice(0, CHROME_DIAGNOSTIC_LIMIT);
}

export function discoverChrome({
  chromePath = process.env.CHROME_PATH,
  probe = spawnSync,
  now = () => performance.now()
} = {}) {
  const candidates = chromePath ? [chromePath] : CHROME_CANDIDATES;
  const diagnostics = [];
  for (const candidate of candidates) {
    const started = now();
    const result = probe(candidate, ['--version'], {
      encoding: 'utf8', timeout: CHROME_PROBE_TIMEOUT_MS,
      maxBuffer: 16 * 1024
    });
    const elapsedMs = Math.max(0, Math.round(now() - started));
    // Do not dump the environment, absolute override path or Error object.
    // JSON output escapes newlines rather than emitting workflow commands.
    diagnostics.push({
      command: path.basename(candidate),
      status: result.status ?? null,
      signal: result.signal ?? null,
      errorCode: result.error?.code ?? null,
      elapsedMs,
      stdout: boundedOutput(result.stdout),
      stderr: boundedOutput(result.stderr)
    });
    if (result.status === 0 && !result.error && !result.signal) {
      return { chrome: candidate, diagnostics };
    }
  }
  return { chrome: null, diagnostics };
}
