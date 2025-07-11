#!/usr/bin/env node

import { BookGenerator } from './src/BookGenerator.js';
import path from 'path';

const generator = new BookGenerator();
const configPath = process.argv[2];
const outputPath = process.argv[3];

if (!configPath || !outputPath) {
  console.error('Usage: node generate-book.js <config-file> <output-directory>');
  process.exit(1);
}

const absoluteConfigPath = path.resolve(configPath);
const absoluteOutputPath = path.resolve(outputPath);

console.log(`📚 Generating book from config: ${absoluteConfigPath}`);
console.log(`📂 Output directory: ${absoluteOutputPath}`);
console.log('');

try {
  await generator.createBook(absoluteConfigPath, absoluteOutputPath);
  console.log('');
  console.log('🎉 Book generation completed successfully!');
} catch (error) {
  console.error('❌ Failed to generate book:', error.message);
  process.exit(1);
}