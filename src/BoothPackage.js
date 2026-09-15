import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs-extra';
import YAML from 'yaml';
import { zipSync } from 'fflate';

import { AdapterSafeIOError, createAdapterSafeIO } from './AdapterSafeIO.js';

export const BOOTH_IMPLEMENTATION = 'booth-plan-v1';
export const BOOTH_PLAN_VERSION = 1;
const CONFIG_LIMIT = 64 * 1024;
const SCHEMA = fileURLToPath(new URL('../shared/schema/commerce.schema.json', import.meta.url));
const NOT_READY = 'PLAN ONLY — no PDF/EPUB is included. NOT READY FOR SALE OR DISTRIBUTION.';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// All punctuation is encoded, not reinterpreted as Markdown/HTML/link metadata.
const literal = (value) => Array.from(value).map((c) => /[!-/:-@[-`{-~]/u.test(c)
  ? `&#${c.codePointAt(0)};` : c).join('');

export async function validateBoothCommerce(config, metadata, edition) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(await fs.readJson(SCHEMA));
  if (!validate(config)) throw new AdapterSafeIOError('Invalid BOOTH commerce metadata: ' +
    validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; '));
  if (config.changelog[0].version !== metadata.version ||
      new Set(config.changelog.map((entry) => entry.version)).size !== config.changelog.length) {
    throw new AdapterSafeIOError('BOOTH changelog requires unique versions and current book version first.');
  }
  if (edition.id !== config.full_edition || edition.visibility !== 'paid') {
    throw new AdapterSafeIOError('BOOTH v1 requires the configured paid full edition; free/internal output is forbidden.');
  }
  const sample = metadata.editions.find((candidate) => candidate.id === config.sample_edition);
  if (!sample || sample.id === edition.id || !['free', 'sample'].includes(sample.visibility)) {
    throw new AdapterSafeIOError('BOOTH sample must be a distinct free/sample edition.');
  }
  return sample;
}

function packageFiles(config, manifest, sample, metadata) {
  const plan = {
    plan_version: BOOTH_PLAN_VERSION,
    status: 'plan-only',
    generated: false,
    ready_for_distribution: false,
    artifact_visibility: 'not-run',
    render_validation: 'not-run',
    rights_approval: 'pending',
    book: manifest.book,
    commerce: { channel: config.channel, sku: config.sku, currency: config.currency, price: config.price },
    full_edition: { id: manifest.edition.id, visibility: manifest.edition.visibility },
    sample_edition: { id: sample.id, visibility: sample.visibility },
    source_visibility: 'passed-for-plan-snapshot',
    declared_license: metadata.license,
    artifacts: [
      { role: 'full', edition: manifest.edition.id, intended_file: 'full/book-screen.pdf', format: 'pdf' },
      { role: 'full', edition: manifest.edition.id, intended_file: 'full/book.epub', format: 'epub' },
      { role: 'sample', edition: sample.id, intended_file: 'sample/book-sample.pdf', format: 'pdf' }
    ].map((artifact) => ({ ...artifact, status: 'not-generated', sha256: null })),
    config_sha256: manifest.adapter.commerce_sha256
  };
  const title = literal(metadata.title);
  return {
    'product-description.md': `# ${title}\n\n**${NOT_READY}**\n\n` +
      `${literal(config.summary)}\n\n` +
      `- Channel: ${literal(config.channel)}\n- SKU: ${literal(config.sku)}\n` +
      `- Version: ${literal(metadata.version)}\n- Planned price: ${config.price} ${config.currency}\n` +
      `- Full edition: ${literal(manifest.edition.id)}\n- Sample edition: ${literal(sample.id)}\n\n` +
      'This archive contains planning documents only. Future full PDF/EPUB and sample PDF are separate roles, not existing downloads.\n',
    'README.txt': `${NOT_READY}\n\n${metadata.title}\nVersion: ${metadata.version}\nSKU: ${config.sku}\n\n` +
      'No manuscript, sample PDF, full PDF or EPUB is included. Do not upload this archive as a product.\n' +
      'Before release: render the selected editions, validate artifact visibility/EPUB/PDF, obtain rights and publication approval, and record actual hashes.\n' +
      'Keep the SKU and version when recording updates; check CHANGELOG.md for planned changes. No shop operation is performed.\n',
    'CHANGELOG.md': `# Changelog\n\n**${NOT_READY}**\n\n` + config.changelog.map((entry) =>
      `## ${literal(entry.version)} — ${entry.date}\n\n${entry.changes.map((change) => `- ${literal(change)}`).join('\n')}\n`
    ).join('\n'),
    'booth-package-manifest.yaml': YAML.stringify(plan, { lineWidth: 0 })
  };
}

export async function writeBoothPackage({
  standardBook, edition, manifest, visibilityReport, outputDirectory, getVisibilityReport,
  revalidateOutputDestination, revalidateReplacementDirectory, validateOnly = false
}) {
  if (manifest.adapter.target !== 'booth' || manifest.visibility.safe !== true ||
      visibilityReport?.summary.safe !== true || visibilityReport.edition.id !== edition.id ||
      typeof getVisibilityReport !== 'function' || typeof revalidateOutputDestination !== 'function' ||
      typeof revalidateReplacementDirectory !== 'function') {
    throw new AdapterSafeIOError('BOOTH package requires validated visibility and safe output callbacks.');
  }
  const io = createAdapterSafeIO({ adapterName: 'BOOTH plan', target: 'booth' });
  const { metadata, bookRoot } = standardBook;
  const rootIdentity = await io.pathObjectIdentity(bookRoot);
  const configPath = path.relative(bookRoot, path.resolve(bookRoot, metadata.source.editions, 'booth.yaml'));
  const readConfig = () => io.readFileFromHeldTree(bookRoot, rootIdentity, configPath,
    { maximumSize: CONFIG_LIMIT, pathLabel: 'BOOTH commerce' });
  const bytes = await readConfig();
  let config;
  try { config = YAML.parse(bytes.toString('utf8'), { uniqueKeys: true, maxAliasCount: 100 }); }
  catch { throw new AdapterSafeIOError('Invalid BOOTH commerce YAML.'); }
  const sample = await validateBoothCommerce(config, metadata, edition);
  const report = await getVisibilityReport(sample.id);
  if (!report.summary.safe) throw new AdapterSafeIOError('BOOTH sample visibility check failed.');
  const sourceDigests = new Map();
  for (const snapshot of [visibilityReport, report]) {
    for (const document of snapshot.documents) {
      if (sourceDigests.has(document.path) && sourceDigests.get(document.path) !== document.sourceDigest) {
        throw new AdapterSafeIOError('BOOTH full/sample source snapshots disagree.');
      }
      sourceDigests.set(document.path, document.sourceDigest);
    }
  }
  const revalidateMetadataSnapshot = async () => {
    await io.readVisibilityBoundSource(bookRoot, path.relative(bookRoot, standardBook.metadataPath), standardBook.metadataDigest);
    if (!(await readConfig()).equals(bytes)) throw new AdapterSafeIOError('BOOTH commerce changed after validation.');
    for (const [sourcePath, digest] of sourceDigests) {
      await io.readVisibilityBoundSource(bookRoot, sourcePath, digest);
    }
  };
  await revalidateMetadataSnapshot();
  Object.assign(manifest.adapter, {
    implementation: BOOTH_IMPLEMENTATION, project_format: 'booth-package-plan-v1',
    generated: false, ready_for_distribution: false,
    commerce_sha256: hash(bytes), package_path: `${config.slug}-${metadata.version}.zip`
  });
  const files = packageFiles(config, manifest, sample, metadata);
  const entries = Object.fromEntries(Object.keys(files).sort().map((name) => [name, Buffer.from(files[name], 'utf8')]));
  // ZIP timestamps encode local wall-clock components. Do not use a UTC instant.
  const zip = Buffer.from(zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 3, attrs: 0o100644 << 16 }));
  manifest.adapter.package_sha256 = hash(zip);
  await io.assertOwnedExistingOutput(outputDirectory);
  if (validateOnly) return;
  const parent = path.dirname(outputDirectory);
  await fs.ensureDir(parent);
  const parentIdentity = await io.pathObjectIdentity(parent);
  const stagingName = `.booth-plan-${process.pid}-${randomUUID()}.tmp`;
  const stagingDirectory = path.join(parent, stagingName);
  let identity;
  try {
    identity = await io.createDirectoryInHeldParent(parent, parentIdentity, stagingName);
    const staging = io.createStagingTree(stagingDirectory, identity);
    for (const name of Object.keys(files).sort()) await staging.write(name, files[name]);
    await staging.write(manifest.adapter.package_path, zip);
    await staging.write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await staging.assertTreeUnchanged();
    await revalidateOutputDestination();
    const outputIdentity = await io.assertOwnedExistingOutput(outputDirectory);
    await io.replaceOwnedDirectory({
      stagingDirectory, outputDirectory, expectedStagingIdentity: identity,
      expectedOutputIdentity: outputIdentity,
      protectedRoots: [bookRoot, standardBook.metadataPath, ...Object.values(metadata.source).map((source) => path.resolve(bookRoot, source))],
      revalidateReplacementDirectory, revalidateStagingTree: staging.assertTreeUnchanged,
      revalidateMetadataSnapshot
    });
  } catch (error) {
    if (identity) {
      try { await io.removeDirectoryByExpectedIdentity(stagingDirectory, identity, 'BOOTH staging changed before cleanup'); }
      catch (cleanupError) { throw new AdapterSafeIOError(`${error.message}; staging retained at ${stagingDirectory}; ${cleanupError.message}`); }
    }
    throw error;
  }
}
