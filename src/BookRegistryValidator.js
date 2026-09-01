import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs-extra';
import YAML from 'yaml';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '..');

export const DEFAULT_BOOK_REGISTRY = path.join(
  REPOSITORY_ROOT,
  'book-registry.example.yaml'
);
export const DEFAULT_BOOK_REGISTRY_SCHEMA = path.join(
  REPOSITORY_ROOT,
  'shared/schema/book-registry.schema.json'
);

export class BookRegistryValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'BookRegistryValidationError';
    this.details = details;
  }
}

function formatSchemaError(error) {
  const location = error.instancePath || '/';
  return location + ' ' + error.message;
}

async function readRegistryFile(registryPath) {
  const requestedPath = path.resolve(registryPath);
  let stat;
  try {
    stat = await fs.lstat(requestedPath);
  } catch {
    throw new BookRegistryValidationError('Registry file does not exist: ' + requestedPath);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new BookRegistryValidationError('Registry must be a real file: ' + requestedPath);
  }

  const canonicalPath = await fs.realpath(requestedPath);
  const extension = path.extname(canonicalPath).toLowerCase();
  const content = await fs.readFile(canonicalPath, 'utf8');

  try {
    if (extension === '.yaml' || extension === '.yml') {
      return {
        canonicalPath,
        registry: YAML.parse(content, { uniqueKeys: true })
      };
    }
  } catch (error) {
    throw new BookRegistryValidationError('Cannot parse registry: ' + error.message);
  }

  throw new BookRegistryValidationError(
    'Registry extension must be .yaml or .yml: ' + extension
  );
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new BookRegistryValidationError(label + ' must be a valid HTTPS URL');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new BookRegistryValidationError(
      label + ' must be a valid HTTPS URL without credentials'
    );
  }

  return parsed;
}

function requireRepositoryKeyMatch(repositoryKey, repositoryUrl) {
  const parsed = requireHttpsUrl(repositoryUrl, 'books.' + repositoryKey + '.repository.url');
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const urlRepository = (pathParts[1] || '').replace(/\.git$/, '');

  if (
    parsed.hostname.toLowerCase() !== 'github.com' ||
    pathParts.length !== 2 ||
    urlRepository !== repositoryKey
  ) {
    throw new BookRegistryValidationError(
      'books.' + repositoryKey + '.repository.url must end with /' + repositoryKey
    );
  }
}

function validateSemanticRelationships(registry) {
  let channelCount = 0;
  let editionCount = 0;

  for (const [repositoryKey, book] of Object.entries(registry.books)) {
    requireRepositoryKeyMatch(repositoryKey, book.repository.url);

    const declaredChannels = new Set(Object.keys(book.channels));
    channelCount += declaredChannels.size;

    for (const [channelName, channel] of Object.entries(book.channels)) {
      if (channel.url) {
        requireHttpsUrl(channel.url, 'books.' + repositoryKey + '.channels.' + channelName + '.url');
      }
    }

    for (const [editionId, edition] of Object.entries(book.editions)) {
      editionCount += 1;
      for (const channelName of edition.channels) {
        if (!declaredChannels.has(channelName)) {
          throw new BookRegistryValidationError(
            'books.' + repositoryKey + '.editions.' + editionId +
              '.channels references undeclared channel: ' + channelName
          );
        }
      }
    }
  }

  return { channelCount, editionCount };
}

export async function validateBookRegistry(registryPath = DEFAULT_BOOK_REGISTRY, options = {}) {
  const { canonicalPath, registry } = await readRegistryFile(registryPath);
  const schemaPath = path.resolve(options.schemaPath || DEFAULT_BOOK_REGISTRY_SCHEMA);
  let schema;

  try {
    schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  } catch (error) {
    throw new BookRegistryValidationError('Cannot read book-registry schema: ' + error.message);
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(registry)) {
    const details = validate.errors.map(formatSchemaError);
    throw new BookRegistryValidationError(
      'Registry does not satisfy schema_version 1: ' + details.join('; '),
      details
    );
  }

  const { channelCount, editionCount } = validateSemanticRelationships(registry);

  return {
    registry,
    registryPath: canonicalPath,
    schemaPath,
    schemaVersion: registry.schema_version,
    bookCount: Object.keys(registry.books).length,
    channelCount,
    editionCount
  };
}
