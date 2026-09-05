#!/usr/bin/env node

import {
  isLegacyMutationInvocation,
  isLegacyMutationHelpInvocation,
  isNpmLifecycleInvocation,
  legacyMutationHelpText,
  runFreshDependencyBootstrap
} from './ConsumerDependencyBootstrap.js';

const args = process.argv.slice(2);
let failureContext = 'Book formatter CLI failed';

try {
  if (isLegacyMutationHelpInvocation(args)) {
    process.stdout.write(legacyMutationHelpText(args[0]));
  } else {
    if (isLegacyMutationInvocation(args)) {
      failureContext = 'Legacy consumer bootstrap failed';
      if (isNpmLifecycleInvocation()) {
        throw new Error(
          'Legacy consumer mutation must use node src/index.js directly, not npm lifecycle scripts'
        );
      }
      runFreshDependencyBootstrap(args);
      failureContext = 'Book formatter CLI failed';
    }
    await import('./cli-implementation.js');
  }
} catch (error) {
  console.error(`${failureContext}: ${error.message}`);
  process.exitCode = 1;
}
