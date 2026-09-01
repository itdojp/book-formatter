#!/usr/bin/env node

import path from 'path';
import {
  BookRegistryValidationError,
  DEFAULT_BOOK_REGISTRY,
  validateBookRegistry
} from '../src/BookRegistryValidator.js';

const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: npm run validate:book-registry -- [registry.yaml|registry.yml]');
  process.exit(2);
}

const registryPath = path.resolve(args[0] || DEFAULT_BOOK_REGISTRY);

try {
  const result = await validateBookRegistry(registryPath);
  console.log('✅ Book registry is valid: ' + result.registryPath);
  console.log(
    '   schema_version=' + result.schemaVersion +
      ', books=' + result.bookCount +
      ', channels=' + result.channelCount +
      ', editions=' + result.editionCount
  );
} catch (error) {
  if (error instanceof BookRegistryValidationError) {
    console.error('❌ Book registry validation failed: ' + error.message);
  } else {
    console.error('❌ Unexpected validation failure: ' + error.message);
  }
  process.exit(1);
}
