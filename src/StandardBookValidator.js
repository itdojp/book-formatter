import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs-extra';
import YAML from 'yaml';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STANDARD_BOOK_SCHEMA = path.resolve(
  MODULE_DIR,
  '../shared/schema/book.schema.json'
);

export class StandardBookValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'StandardBookValidationError';
    this.details = details;
  }
}

function formatSchemaError(error) {
  const location = error.instancePath || '/';
  return `${location} ${error.message}`;
}

function resolveInside(bookRoot, relativePath, label) {
  const resolved = path.resolve(bookRoot, relativePath);
  const relative = path.relative(bookRoot, resolved);

  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new StandardBookValidationError(`${label} must resolve below the book root: ${relativePath}`);
  }

  return resolved;
}

async function inspectDeclaredPath(bookRoot, relativePath, label, expectedType) {
  const resolved = resolveInside(bookRoot, relativePath, label);
  const relative = path.relative(bookRoot, resolved);
  const components = relative.split(path.sep);
  let stat;

  let current = bookRoot;
  for (const component of components) {
    current = path.join(current, component);
    try {
      stat = await fs.lstat(current);
    } catch {
      throw new StandardBookValidationError(`${label} does not exist: ${relativePath}`);
    }

    if (stat.isSymbolicLink()) {
      throw new StandardBookValidationError(`${label} must not contain symbolic links: ${relativePath}`);
    }
  }

  const canonicalPath = await fs.realpath(resolved);
  const canonicalRelative = path.relative(bookRoot, canonicalPath);
  if (
    canonicalRelative === '' ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    canonicalRelative === '..' ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new StandardBookValidationError(`${label} resolves outside the book root: ${relativePath}`);
  }

  if (expectedType === 'directory' && !stat.isDirectory()) {
    throw new StandardBookValidationError(`${label} must be a real directory: ${relativePath}`);
  }
  if (expectedType === 'file' && !stat.isFile()) {
    throw new StandardBookValidationError(`${label} must be a real file: ${relativePath}`);
  }

  return canonicalPath;
}

async function requireSourceFile(bookRoot, sourceRoot, entry, label) {
  const resolved = resolveInside(bookRoot, entry.path, `${label} path`);
  const relativeToSource = path.relative(sourceRoot, resolved);

  if (
    relativeToSource === '' ||
    relativeToSource.startsWith(`..${path.sep}`) ||
    relativeToSource === '..' ||
    path.isAbsolute(relativeToSource)
  ) {
    throw new StandardBookValidationError(`${label} must be below its declared source directory: ${entry.path}`);
  }

  await inspectDeclaredPath(bookRoot, entry.path, label, 'file');
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new StandardBookValidationError(`${label} must be a valid HTTPS URL`);
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new StandardBookValidationError(`${label} must be a valid HTTPS URL without credentials`);
  }
}

function isValidGitBranch(branch) {
  const hasForbiddenCharacter = [...branch].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x20 || codePoint === 0x7f || '~^:?*[\\]'.includes(character);
  });

  if (
    branch === '@' ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.includes('//') ||
    hasForbiddenCharacter
  ) {
    return false;
  }

  return branch.split('/').every(
    (component) => component && !component.startsWith('.') && !component.endsWith('.lock')
  );
}

export async function validateStandardBook(bookDirectory, options = {}) {
  const requestedBookRoot = path.resolve(bookDirectory);
  let rootStat;
  try {
    rootStat = await fs.lstat(requestedBookRoot);
  } catch {
    throw new StandardBookValidationError(`Book directory does not exist: ${requestedBookRoot}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new StandardBookValidationError(`Book root must be a real directory: ${requestedBookRoot}`);
  }

  const bookRoot = await fs.realpath(requestedBookRoot);
  const metadataPath = await inspectDeclaredPath(bookRoot, 'book.yaml', 'book.yaml', 'file');
  const schemaPath = path.resolve(options.schemaPath || DEFAULT_STANDARD_BOOK_SCHEMA);

  let metadata;
  let schema;

  try {
    metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (error) {
    throw new StandardBookValidationError(`Cannot read book.yaml: ${error.message}`);
  }

  try {
    schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  } catch (error) {
    throw new StandardBookValidationError(`Cannot read standard-book schema: ${error.message}`);
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(metadata)) {
    const details = validate.errors.map(formatSchemaError);
    throw new StandardBookValidationError(
      `book.yaml does not satisfy schema_version 1: ${details.join('; ')}`,
      details
    );
  }

  metadata.authors.forEach((author, index) => {
    if (author.url) requireHttpsUrl(author.url, `authors[${index}].url`);
  });
  if (metadata.publisher.url) requireHttpsUrl(metadata.publisher.url, 'publisher.url');
  requireHttpsUrl(metadata.repository.url, 'repository.url');
  if (!isValidGitBranch(metadata.repository.default_branch)) {
    throw new StandardBookValidationError('repository.default_branch must be a valid Git branch name');
  }

  const sourceDirectories = new Map();
  for (const [key, relativePath] of Object.entries(metadata.source)) {
    sourceDirectories.set(
      key,
      await inspectDeclaredPath(bookRoot, relativePath, `source.${key}`, 'directory')
    );
  }

  const distinctDirectories = new Set([...sourceDirectories.values()]);
  if (distinctDirectories.size !== sourceDirectories.size) {
    throw new StandardBookValidationError('source directories must use distinct paths');
  }

  const seenIds = new Set();
  const seenPaths = new Set();
  const groups = [
    ['frontmatter', metadata.structure.frontmatter],
    ['manuscript', metadata.structure.chapters],
    ['backmatter', metadata.structure.backmatter]
  ];

  let documentCount = 0;
  for (const [sourceKey, entries] of groups) {
    for (const entry of entries) {
      if (seenIds.has(entry.id)) {
        throw new StandardBookValidationError(`structure id must be unique: ${entry.id}`);
      }
      if (seenPaths.has(entry.path)) {
        throw new StandardBookValidationError(`structure path must be unique: ${entry.path}`);
      }

      seenIds.add(entry.id);
      seenPaths.add(entry.path);
      await requireSourceFile(bookRoot, sourceDirectories.get(sourceKey), entry, `structure.${sourceKey}`);
      documentCount += 1;
    }
  }

  const editionIds = metadata.editions.map((edition) => edition.id);
  if (new Set(editionIds).size !== editionIds.length) {
    throw new StandardBookValidationError('edition ids must be unique');
  }

  return {
    bookRoot,
    metadataPath,
    schemaPath,
    schemaVersion: metadata.schema_version,
    documentCount,
    editionCount: metadata.editions.length
  };
}
