#!/usr/bin/env node

import { LEGACY_MUTATION_COMMANDS } from './ConsumerDependencyBootstrap.js';

const command = process.argv[2];

if (LEGACY_MUTATION_COMMANDS.has(command)) {
  console.error(
    'npm lifecycle scripts do not expose legacy consumer mutation commands; '
    + 'use node src/index.js directly'
  );
  process.exitCode = 1;
} else {
  await import('./index.js');
}
