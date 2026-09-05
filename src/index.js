#!/usr/bin/env node

import bootstrapApi from './ConsumerDependencyBootstrap.cjs';

const {
  isLegacyMutationInvocation,
  isLegacyMutationHelpInvocation,
  isNpmLifecycleInvocation,
  legacyMutationHelpText,
  runFreshLegacyMutationProcess
} = bootstrapApi;

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
      runFreshLegacyMutationProcess(args, { stdio: 'inherit' });
      failureContext = 'Book formatter CLI failed';
    } else {
      await import('./cli-implementation.js');
    }
  }
} catch (error) {
  console.error(`${failureContext}: ${error.message}`);
  process.exitCode = 1;
}
