import { randomUUID } from 'node:crypto';
import path from 'node:path';

import fs from 'fs-extra';

import {
  checkBookVisibility,
  VISIBILITY_CONTRACT_VERSION
} from './VisibilityChecker.js';
import { validateStandardBook } from './StandardBookValidator.js';
import {
  DEFAULT_WEB_MDBOOK_CSS,
  WEB_MDBOOK_COMPATIBILITY_VERSION,
  WEB_MDBOOK_IMPLEMENTATION,
  WebMdbookAdapterError,
  writeWebMdbookProject
} from './WebMdbookAdapter.js';

export const ADAPTER_MANIFEST_VERSION = 1;

export const ADAPTER_TARGETS = Object.freeze([
  'web-mdbook',
  'web-jekyll-legacy',
  'zenn',
  'note',
  'kindle',
  'booth',
  'pdf'
]);

const ADAPTER_TARGET_SET = new Set(ADAPTER_TARGETS);

export class AdapterBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdapterBuildError';
  }
}

function requireTarget(target) {
  if (!ADAPTER_TARGET_SET.has(target)) {
    throw new AdapterBuildError(
      `Unknown adapter target: ${target || '(missing)'}. ` +
        `Expected one of: ${ADAPTER_TARGETS.join(', ')}`
    );
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function lstatIfExists(candidate) {
  try {
    return await fs.lstat(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function rejectSymlinkComponents(outputDirectory) {
  const parsed = path.parse(outputDirectory);
  const components = outputDirectory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;

  for (const component of components) {
    current = path.join(current, component);
    const stat = await lstatIfExists(current);
    if (!stat) break;

    if (stat.isSymbolicLink()) {
      throw new AdapterBuildError(
        `Output directory must not contain symbolic links: ${outputDirectory}`
      );
    }
    if (!stat.isDirectory()) {
      throw new AdapterBuildError(
        `Output directory path contains a non-directory component: ${current}`
      );
    }
  }
}

function sameFileSystemIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileSystemIdentityKey(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function outputOverlapError(outputDirectory) {
  return new AdapterBuildError(
    `Output directory must not overlap the canonical book or declared sources: ${outputDirectory}`
  );
}

export async function assertOutputDoesNotOverlapBookSources(
  bookRoot,
  sourceDirectories,
  outputDirectory,
  {
    lstat = lstatIfExists,
    readdir = fs.readdir,
    realpath = fs.realpath,
    stat = fs.stat
  } = {}
) {
  if (isPathInside(outputDirectory, bookRoot)) {
    throw outputOverlapError(outputDirectory);
  }
  for (const sourceDirectory of sourceDirectories) {
    if (isPathInside(sourceDirectory, outputDirectory)) throw outputOverlapError(outputDirectory);
  }

  const protectedRoots = [bookRoot, ...sourceDirectories];
  const physicalProtectedRoots = await Promise.all(protectedRoots.map((root) => realpath(root)));
  const protectedRootIdentities = await Promise.all(physicalProtectedRoots.map((root) => stat(root)));
  const protectedIdentityKeys = new Set();

  async function collectProtectedTree(candidate, ancestorIdentities = new Set()) {
    const entry = await lstat(candidate);
    if (!entry || entry.isSymbolicLink()) return;

    const identity = await stat(candidate);
    const identityKey = fileSystemIdentityKey(identity);
    protectedIdentityKeys.add(identityKey);
    if (!entry.isDirectory() || ancestorIdentities.has(identityKey)) return;

    const nextAncestors = new Set(ancestorIdentities);
    nextAncestors.add(identityKey);
    const names = (await readdir(candidate)).sort();
    for (const name of names) {
      await collectProtectedTree(path.join(candidate, name), nextAncestors);
    }
  }

  for (const sourceDirectory of physicalProtectedRoots.slice(1)) {
    await collectProtectedTree(sourceDirectory);
  }
  await collectProtectedTree(path.join(physicalProtectedRoots[0], 'book.yaml'));

  let existingAncestor = outputDirectory;
  while (!(await lstat(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }

  for (let current = existingAncestor; ; current = path.dirname(current)) {
    const currentEntry = await lstat(current);
    if (currentEntry) {
      const currentIdentity = await stat(current);
      if (protectedRootIdentities.slice(1).some((identity) =>
        sameFileSystemIdentity(currentIdentity, identity))) {
        throw outputOverlapError(outputDirectory);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
  }

  const outputEntry = await lstat(outputDirectory);
  if (!outputEntry) return;

  const physicalOutput = await realpath(outputDirectory);
  for (const [index, protectedRoot] of physicalProtectedRoots.entries()) {
    if (
      isPathInside(physicalOutput, protectedRoot) ||
      (index > 0 && isPathInside(protectedRoot, physicalOutput))
    ) {
      throw outputOverlapError(outputDirectory);
    }
  }

  async function scanOutputTree(candidate, ancestorIdentities = new Set()) {
    const entry = await lstat(candidate);
    if (!entry) return;
    // Recursive removal unlinks a symbolic link instead of following it, so it
    // cannot expose a protected directory identity to backup cleanup.
    if (entry.isSymbolicLink()) return;
    const candidateIdentity = await stat(candidate);
    const candidateIdentityKey = fileSystemIdentityKey(candidateIdentity);
    if (
      protectedRootIdentities.some((identity) =>
        sameFileSystemIdentity(candidateIdentity, identity)) ||
      protectedIdentityKeys.has(candidateIdentityKey)
    ) {
      throw outputOverlapError(outputDirectory);
    }
    if (!entry.isDirectory() || ancestorIdentities.has(candidateIdentityKey)) return;

    const nextAncestors = new Set(ancestorIdentities);
    nextAncestors.add(candidateIdentityKey);
    const names = (await readdir(candidate)).sort();
    for (const name of names) {
      await scanOutputTree(path.join(candidate, name), nextAncestors);
    }
  }

  await scanOutputTree(outputDirectory);
}

async function validateOutputDestination(bookRoot, metadata, outputDirectory) {
  const sourceDirectories = Object.values(metadata.source).map(
    (relativeSource) => path.resolve(bookRoot, relativeSource)
  );
  for (const [sourceName, relativeSource] of Object.entries(metadata.source)) {
    const sourceDirectory = path.resolve(bookRoot, relativeSource);
    if (isPathInside(sourceDirectory, outputDirectory)) {
      throw new AdapterBuildError(
        `Output directory must not be inside source.${sourceName}: ${outputDirectory}`
      );
    }
  }

  await rejectSymlinkComponents(outputDirectory);
  await assertOutputDoesNotOverlapBookSources(
    bookRoot,
    sourceDirectories,
    outputDirectory
  );

  const outputStat = await lstatIfExists(outputDirectory);
  if (outputStat) {
    if (!outputStat.isDirectory()) {
      throw new AdapterBuildError(`Output directory must be a directory: ${outputDirectory}`);
    }
  }

  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const manifestStat = await lstatIfExists(manifestPath);
  if (manifestStat) {
    if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
      throw new AdapterBuildError(
        `Manifest destination must be a regular file: ${manifestPath}`
      );
    }
  }

  return manifestPath;
}

async function assertReplacementDirectorySafe(bookRoot, metadata, outputDirectory) {
  const sourceDirectories = Object.values(metadata.source).map(
    (relativeSource) => path.resolve(bookRoot, relativeSource)
  );
  await rejectSymlinkComponents(outputDirectory);
  await assertOutputDoesNotOverlapBookSources(
    bookRoot,
    sourceDirectories,
    outputDirectory
  );
}

function createManifest(metadata, target, edition, visibilityReport) {
  const documents = visibilityReport.documents
    .filter((document) => document.decision === 'include')
    .map((document) => ({
      id: document.id,
      section: document.section,
      path: document.path,
      visibility: document.visibility,
      decision: 'include',
      visibility_regions: document.protectedRegions.map((region) => ({
        visibility: region.visibility,
        start_line: region.startLine,
        end_line: region.endLine,
        digest: region.digest,
        decision: region.decision
      }))
    }));

  return {
    manifest_version: ADAPTER_MANIFEST_VERSION,
    kind: 'book-formatter.adapter-build',
    adapter: {
      target,
      implementation: target === 'web-mdbook' ? WEB_MDBOOK_IMPLEMENTATION : 'skeleton',
      ...(target === 'web-mdbook'
        ? {
          project_format: 'mdbook',
          verified_mdbook_version: WEB_MDBOOK_COMPATIBILITY_VERSION,
          build_directory: 'book'
        }
        : {})
    },
    book: {
      id: metadata.id,
      title: metadata.title,
      version: metadata.version,
      language: metadata.language
    },
    edition: {
      id: edition.id,
      title: edition.title,
      status: edition.status,
      visibility: edition.visibility
    },
    visibility: {
      contract_version: VISIBILITY_CONTRACT_VERSION,
      safe: visibilityReport.summary.safe,
      included_documents: visibilityReport.summary.includedDocuments,
      excluded_documents: visibilityReport.summary.excludedDocuments,
      protected_regions: visibilityReport.summary.protectedRegions,
      findings: visibilityReport.summary.findings
    },
    documents
  };
}

async function writeManifest(manifestPath, manifest) {
  await fs.ensureDir(path.dirname(manifestPath));
  const temporaryPath = path.join(
    path.dirname(manifestPath),
    `.manifest.json.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    await fs.rename(temporaryPath, manifestPath);
  } finally {
    await fs.remove(temporaryPath);
  }
}

export async function buildStandardBookAdapter(options) {
  const {
    bookDirectory,
    target,
    editionId,
    outputRoot,
    dryRun = false
  } = options;

  requireTarget(target);
  if (!editionId) throw new AdapterBuildError('Edition ID is required.');

  const standardBook = await validateStandardBook(bookDirectory);
  const edition = standardBook.metadata.editions.find(
    (candidate) => candidate.id === editionId
  );
  if (!edition) throw new AdapterBuildError(`Unknown edition: ${editionId}`);

  const visibilityReport = await checkBookVisibility(standardBook.bookRoot, editionId);
  if (!visibilityReport.summary.safe) {
    throw new AdapterBuildError(
      `Visibility check failed for edition ${editionId}: ` +
        `${visibilityReport.summary.findings} finding(s)`
    );
  }

  const resolvedOutputRoot = outputRoot
    ? path.resolve(outputRoot)
    : path.join(standardBook.bookRoot, 'dist');
  const outputDirectory = path.join(resolvedOutputRoot, target);
  const revalidateOutputDestination = () => validateOutputDestination(
    standardBook.bookRoot,
    standardBook.metadata,
    outputDirectory
  );
  const revalidateReplacementDirectory = (candidate) => assertReplacementDirectorySafe(
    standardBook.bookRoot,
    standardBook.metadata,
    candidate
  );
  const manifestPath = await revalidateOutputDestination();
  const manifest = createManifest(
    standardBook.metadata,
    target,
    edition,
    visibilityReport
  );

  if (target === 'web-mdbook') {
    try {
      await writeWebMdbookProject({
        standardBook,
        edition,
        visibilityReport,
        outputDirectory,
        manifest,
        sharedCssPath: DEFAULT_WEB_MDBOOK_CSS,
        revalidateOutputDestination,
        revalidateReplacementDirectory,
        validateOnly: dryRun
      });
    } catch (error) {
      if (error instanceof WebMdbookAdapterError) throw new AdapterBuildError(error.message);
      throw error;
    }
  } else if (!dryRun) {
    await writeManifest(manifestPath, manifest);
  }

  return {
    manifest,
    manifestPath,
    outputDirectory,
    written: !dryRun
  };
}
