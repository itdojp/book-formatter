import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

import { AdapterSafeIOError, createAdapterSafeIO } from './AdapterSafeIO.js';

export const PRINT_PLAN_VERSION = 1;
const PROFILE_PATH = fileURLToPath(new URL('../shared/print/profiles.json', import.meta.url));
const PROFILE_IDS = ['screen-pdf', 'print-pdf', 'epub'];
const PROFILE_FIELDS = ['id', 'target', 'format', 'intended_file', 'stylesheet', 'layout', 'validation'];
const PROFILE_FILES = ['book-screen.pdf', 'book-print.pdf', 'book.epub'];

export async function loadPrintProfiles() {
  const data = await fs.readJson(PROFILE_PATH);
  if (
    data?.schema_version !== PRINT_PLAN_VERSION ||
    Object.keys(data).sort().join(',') !== 'profiles,schema_version' ||
    !Array.isArray(data.profiles) ||
    data.profiles.some((profile) =>
      !profile || typeof profile !== 'object' ||
      Object.keys(profile).length !== PROFILE_FIELDS.length ||
      PROFILE_FIELDS.some((field) => typeof profile[field] !== 'string' || !profile[field].trim())
    ) ||
    data.profiles.map((profile) => profile.id).join(',') !== PROFILE_IDS.join(',') ||
    data.profiles.some((profile, index) =>
      profile.intended_file !== PROFILE_FILES[index] ||
      profile.target !== (profile.id === 'epub' ? 'kindle' : 'pdf') ||
      profile.format !== (profile.id === 'epub' ? 'epub' : 'pdf') ||
      profile.stylesheet !== `shared/print/${profile.id}.css`
    )
  ) throw new AdapterSafeIOError('Invalid finite print publication profile registry.');
  return data.profiles;
}

function checklist(target) {
  return `# ${target === 'kindle' ? 'Kindle / EPUB' : 'PDF'} publication checklist\n\n` +
    '**PLAN ONLY — no rendered PDF/EPUB exists. Not ready for distribution.**\n\n' +
    '- [ ] Choose and pin an isolated renderer, browser and validation toolchain; record audit/license results.\n' +
    '- [ ] Re-run source visibility validation and project only the selected edition before rendering.\n' +
    '- [ ] Verify the rendered artifact for excluded paid/internal text, metadata, attachments and assets.\n' +
    '- [ ] Confirm title, language, author, publisher, edition/version, publication date and identifier.\n' +
    '- [ ] Approve cover, colophon and copyright/usage statements; metadata license is not a rights clearance.\n' +
    '- [ ] Verify font licenses/embedding, figures, tables, code, links, contents and reading order.\n' +
    (target === 'kindle'
      ? '- [ ] Run EPUBCheck and record its pinned version and diagnostics.\n' +
        '- [ ] Inspect reflow/font changes and E Ink/tablet views with Kindle Previewer; record reviewer and result.\n' +
        '- [ ] Use EPUB as the Kindle manuscript; no KDP upload or approval is performed by this adapter.\n'
      : '- [ ] Inspect screen PDF on desktop/mobile, links, text extraction and accessibility.\n' +
        '- [ ] Agree trim/bleed/color/PDF-X specifications with the printer and inspect the print proof.\n') +
    '- [ ] Record artifact hashes, actual tool versions, limitations and publication approval before release.\n';
}

export async function writePrintPublicationPlan({
  standardBook, edition, manifest, outputDirectory,
  revalidateOutputDestination, revalidateReplacementDirectory, validateOnly = false
}) {
  const target = manifest.adapter.target;
  if (
    !['pdf', 'kindle'].includes(target) || manifest.visibility.safe !== true ||
    typeof revalidateOutputDestination !== 'function' ||
    typeof revalidateReplacementDirectory !== 'function'
  ) throw new AdapterSafeIOError('Print plan requires a validated target, visibility and safe output callbacks.');
  const io = createAdapterSafeIO({ adapterName: `${target} plan`, target });
  const revalidateMetadataSnapshot = () => io.readVisibilityBoundSource(
    standardBook.bookRoot,
    path.relative(standardBook.bookRoot, standardBook.metadataPath),
    standardBook.metadataDigest
  );
  await revalidateMetadataSnapshot();
  const profiles = (await loadPrintProfiles()).filter((profile) => profile.target === target);
  Object.assign(manifest.adapter, {
    implementation: 'skeleton',
    project_format: 'publication-plan-v1',
    generated: false,
    ready_for_distribution: false,
    profiles: profiles.map((profile) => profile.id),
    checklist_path: 'publication-checklist.md'
  });
  const metadata = standardBook.metadata;
  const plan = {
    plan_version: PRINT_PLAN_VERSION,
    status: 'plan-only',
    generated: false,
    ready_for_distribution: false,
    source_visibility: 'passed-for-plan-snapshot',
    artifact_visibility: 'not-run',
    render_validation: 'not-run',
    book: manifest.book,
    edition: manifest.edition,
    colophon: {
      title: metadata.title,
      authors: metadata.authors.map((author) => author.name),
      publisher: metadata.publisher.name,
      language: metadata.language,
      version: metadata.version,
      edition: edition.id,
      declared_license: metadata.license,
      copyright_statement: null,
      publication_date: null,
      publication_identifier: null,
      cover_source: null,
      rights_approval: 'pending'
    },
    renderer: null,
    artifact_sha256: null
  };
  await io.assertOwnedExistingOutput(outputDirectory);
  if (validateOnly) return;
  const parent = path.dirname(outputDirectory);
  await fs.ensureDir(parent);
  const parentIdentity = await io.pathObjectIdentity(parent);
  const stagingName = `.${target}-plan-${process.pid}-${randomUUID()}.tmp`;
  const stagingDirectory = path.join(parent, stagingName);
  let identity;
  try {
    identity = await io.createDirectoryInHeldParent(parent, parentIdentity, stagingName);
    const staging = io.createStagingTree(stagingDirectory, identity);
    for (const profile of profiles) {
      await staging.write(`${profile.id}.placeholder.json`, `${JSON.stringify({ ...plan, profile }, null, 2)}\n`);
    }
    await staging.write('publication-checklist.md', checklist(target));
    await staging.write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await staging.assertTreeUnchanged();
    await revalidateOutputDestination();
    const outputIdentity = await io.assertOwnedExistingOutput(outputDirectory);
    await io.replaceOwnedDirectory({
      stagingDirectory, outputDirectory,
      expectedStagingIdentity: identity,
      expectedOutputIdentity: outputIdentity,
      protectedRoots: [standardBook.bookRoot, standardBook.metadataPath,
        ...Object.values(metadata.source).map((source) => path.resolve(standardBook.bookRoot, source))],
      revalidateReplacementDirectory,
      revalidateStagingTree: staging.assertTreeUnchanged,
      revalidateMetadataSnapshot
    });
  } catch (error) {
    if (identity) {
      try {
        await io.removeDirectoryByExpectedIdentity(stagingDirectory, identity, 'Print plan staging changed before cleanup');
      } catch (cleanupError) {
        throw new AdapterSafeIOError(`${error.message}; staging retained at ${stagingDirectory}; ${cleanupError.message}`);
      }
    }
    throw error;
  }
}
