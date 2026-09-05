#!/usr/bin/env node

import {
  isLegacyMutationInvocation,
  isLegacyMutationHelpInvocation,
  isNpmLifecycleInvocation,
  legacyMutationHelpText,
  runFreshDependencyBootstrap
} from './ConsumerDependencyBootstrap.js';

const args = process.argv.slice(2);

try {
  if (isLegacyMutationHelpInvocation(args)) {
    process.stdout.write(legacyMutationHelpText(args[0]));
  } else {
    if (isLegacyMutationInvocation(args)) {
      if (isNpmLifecycleInvocation()) {
        throw new Error(
          'Legacy consumer mutation must use node src/index.js directly, not npm lifecycle scripts'
        );
      }
      runFreshDependencyBootstrap(args);
    }
    await import('./cli-implementation.js');
  }
} catch (error) {
  console.error(`Legacy consumer bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}
