#!/usr/bin/env node

import fs from 'node:fs';

export const MAX_TARGET_BOOKS = 3;
export const WRITE_CONFIRMATION_TOKEN = 'WRITE_BOOK_SYNC';

export function validateBookSyncRequest({
  targetBooks,
  dryRun,
  confirmationToken = '',
  allowedRepositories
}) {
  if (dryRun !== 'true' && dryRun !== 'false') {
    throw new Error('dry_run must be true or false.');
  }

  if (typeof targetBooks !== 'string' || targetBooks.trim() === '') {
    throw new Error('target_books must name at least one repository.');
  }

  const books = targetBooks.split(',').map((book) => book.trim());
  if (books.some((book) => book === '')) {
    throw new Error('target_books contains an empty repository name.');
  }
  if (books.length > MAX_TARGET_BOOKS) {
    throw new Error(`target_books may contain at most ${MAX_TARGET_BOOKS} repositories.`);
  }

  if (!Array.isArray(allowedRepositories) || allowedRepositories.length === 0) {
    throw new Error('The book sync allowlist is missing or empty.');
  }
  const allowedByName = new Map(
    allowedRepositories.map((repository) => [repository.toLowerCase(), repository])
  );

  const seen = new Set();
  const canonicalBooks = [];
  for (const book of books) {
    if (book.toLowerCase() === 'all') {
      throw new Error('The all target is not allowed. List each repository explicitly.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(book)) {
      throw new Error(`Invalid repository name: ${book}`);
    }
    if (book.length > 100) {
      throw new Error(`Repository name exceeds 100 characters: ${book}`);
    }
    const normalizedName = book.toLowerCase();
    if (seen.has(normalizedName)) {
      throw new Error(`Duplicate repository name: ${book}`);
    }
    if (!allowedByName.has(normalizedName)) {
      throw new Error(`Repository is not in the book sync allowlist: ${book}`);
    }
    seen.add(normalizedName);
    canonicalBooks.push(allowedByName.get(normalizedName));
  }

  if (dryRun === 'false' && confirmationToken !== WRITE_CONFIRMATION_TOKEN) {
    throw new Error(`Write mode requires confirmation_token=${WRITE_CONFIRMATION_TOKEN}.`);
  }

  return canonicalBooks.join(',');
}

function main() {
  try {
    const allowlistPath = new URL('../config/book-sync-allowlist.json', import.meta.url);
    const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    if (allowlist.schemaVersion !== 1 || allowlist.organization !== 'itdojp') {
      throw new Error('The book sync allowlist metadata is invalid.');
    }
    const targetBooks = validateBookSyncRequest({
      targetBooks: process.env.TARGET_BOOKS,
      dryRun: process.env.DRY_RUN,
      confirmationToken: process.env.CONFIRMATION_TOKEN,
      allowedRepositories: allowlist.repositories
    });
    if (!process.env.GITHUB_OUTPUT) {
      throw new Error('GITHUB_OUTPUT is required.');
    }
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `target_books=${targetBooks}\n`, 'utf8');
    console.log(`Validated ${process.env.DRY_RUN === 'true' ? 'dry-run' : 'write'} request for: ${targetBooks}`);
  } catch (error) {
    const escapedMessage = error.message
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
    console.error(`::error::${escapedMessage}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('validate-book-sync-request.js')) {
  main();
}
