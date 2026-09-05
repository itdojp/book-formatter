#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bootstrapApi from './ConsumerDependencyBootstrap.cjs';

const { isLegacyMutationCommand } = bootstrapApi;

const rawArgs = process.argv.slice(2);
const watchMode = rawArgs[0] === '--watch';
const args = watchMode ? rawArgs.slice(1) : rawArgs;
const command = args[0];

if (isLegacyMutationCommand(command)) {
  console.error(
    'npm lifecycle scripts do not expose legacy consumer mutation commands; '
    + 'use node src/index.js directly'
  );
  process.exitCode = 1;
} else if (watchMode) {
  const child = spawn(
    process.execPath,
    ['--watch', fileURLToPath(new URL('./index.js', import.meta.url)), ...args],
    { stdio: 'inherit', env: process.env }
  );
  child.once('error', (error) => {
    console.error(`Development watcher failed: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  await import('./index.js');
}
