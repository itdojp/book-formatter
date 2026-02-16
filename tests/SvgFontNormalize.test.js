import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT_PATH = path.resolve('scripts/svg-font-normalize.js');

async function withTempDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'book-formatter-svg-font-normalize-'));
  try {
    await fn(tmpRoot);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function runSvgFontNormalize(targetDir, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, targetDir, ...args], { encoding: 'utf8' });
}

test('svg-font-normalize: --check fails when changes are needed, --apply fixes them, then --check passes', async () => {
  await withTempDir(async (tmpRoot) => {
    const svgPath = path.join(tmpRoot, 'diagram.svg');
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">',
      '  <defs>',
      '    <style>',
      '      .t { font-family: system-ui, sans-serif; }',
      '      .m { font-family: monospace; }',
      '      .sh { font: 600 16px Inter, sans-serif; }',
      '      .sh2 { font: 20px sans-serif; font-weight: 600; }',
      '      .sh3 { font: 400 12px/1.5 sans-serif; }',
      '      .noSemiFam { font-family: system-ui, sans-serif }',
      '      .noSemiFont { font:600 10px sans-serif }',
      '      .math { font-family: \'STIX Two Math\', serif; }',
      '    </style>',
      '  </defs>',
      '  <text x="0" y="10" class="t">Hello</text>',
      '  <text x="0" y="20" style="font-family: monospace;">code</text>',
      '  <text x="0" y="25" style="font: 500 10px Inter, sans-serif; fill: #000;">inline</text>',
      '  <text x="0" y="30" font-family=\'system-ui, sans-serif\'>attr</text>',
      '  <text x="0" y="40" font-family="-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif" font-size="12">broken</text>',
      '</svg>',
      ''
    ].join('\n');
    await fs.writeFile(svgPath, svg, 'utf8');

    const firstCheck = runSvgFontNormalize(tmpRoot, ['--check']);
    assert.equal(
      firstCheck.status,
      1,
      `expected exit code 1 for --check when changes are needed, got ${firstCheck.status}\n${firstCheck.stderr}`
    );

    const apply = runSvgFontNormalize(tmpRoot, ['--apply']);
    assert.equal(apply.status, 0, `expected exit code 0 for --apply, got ${apply.status}\n${apply.stderr}`);

    const secondCheck = runSvgFontNormalize(tmpRoot, ['--check']);
    assert.equal(
      secondCheck.status,
      0,
      `expected exit code 0 for --check after --apply, got ${secondCheck.status}\n${secondCheck.stderr}`
    );

    const updated = await fs.readFile(svgPath, 'utf8');

    // Sans + mono stacks should be normalized.
    assert.match(updated, /font-family:\s*-apple-system,\s*BlinkMacSystemFont,/);
    assert.match(updated, /font-family:\s*'Monaco',\s*'Menlo'/);
    assert.match(updated, /font:\s*600\s+16px\s+-apple-system,\s*BlinkMacSystemFont,/);
    assert.match(updated, /font:\s*20px\s+-apple-system,\s*BlinkMacSystemFont,/);
    assert.match(updated, /font:\s*400\s+12px\/1\.5\s+-apple-system,\s*BlinkMacSystemFont,/);
    assert.match(updated, /noSemiFam\s*\{\s*font-family:\s*-apple-system,\s*BlinkMacSystemFont,/);
    assert.match(updated, /noSemiFont\s*\{\s*font:\s*600\s+10px\s+-apple-system,\s*BlinkMacSystemFont,/);

    // Math stacks must be preserved.
    assert.match(updated, /font-family:\s*'STIX Two Math',\s*serif/);

    // Broken attribute quoting should be repaired (no raw double-quoted family names remain).
    assert.doesNotMatch(updated, /"Segoe UI"/);
  });
});
