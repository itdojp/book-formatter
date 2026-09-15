import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Package files/legacy licenses metadata inspected on 2026-09-15. Not a redistribution approval.
const legacy = {
  'cli-table@0.3.11': 'MIT', // shipped LICENSE
  'format@0.2.2': 'MIT', // package.json licenses[]
  'not@0.1.0': 'MIT', // shipped LICENCE and licenses[]
  'rechoir@0.6.2': 'MIT', // shipped LICENSE and licenses[]
  'trim@0.0.3': 'MIT' // shipped Readme.md License section
};
export function licenseInventory() {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const packages = Object.entries(lock.packages).filter(([key]) => key).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, p]) => {
    const name = key.split('node_modules/').at(-1);
    const license = p.license || legacy[`${name}@${p.version}`];
    if (!license) throw new Error(`Missing license disposition: ${key}@${p.version}`);
    return { path: key, version: p.version, license, evidence: p.license ? 'lock metadata' : 'inspected package license/legacy licenses metadata' };
  });
  return { scope: 'npm lock including optional platforms; browser/fonts/EPUBCheck not installed; no redistribution approval', packages };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(licenseInventory(), null, 2));
