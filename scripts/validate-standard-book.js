#!/usr/bin/env node

import path from 'path';
import {
  StandardBookValidationError,
  validateStandardBook
} from '../src/StandardBookValidator.js';

const args = process.argv.slice(2);
if (args.length > 1) {
  console.error('Usage: npm run validate:standard-book -- [book-directory]');
  process.exit(2);
}

const bookDirectory = path.resolve(args[0] || 'examples/standard-book');

try {
  const result = await validateStandardBook(bookDirectory);
  console.log(`✅ Standard book is valid: ${result.bookRoot}`);
  console.log(
    `   schema_version=${result.schemaVersion}, documents=${result.documentCount}, editions=${result.editionCount}`
  );
} catch (error) {
  if (error instanceof StandardBookValidationError) {
    console.error(`❌ Standard book validation failed: ${error.message}`);
  } else {
    console.error(`❌ Unexpected validation failure: ${error.message}`);
  }
  process.exit(1);
}
