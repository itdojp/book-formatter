import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const WORKFLOW_PATH = 'docs/examples/github-pages-mdbook.yml';
const CLOUDFLARE_PATH = 'docs/examples/cloudflare-pages.md';
const CONTRACT_PATH = 'docs/web-deployment.md';

test('GitHub Pages example keeps build output, permissions, and base path explicit', async () => {
  const source = await fs.readFile(WORKFLOW_PATH, 'utf8');
  const workflow = parse(source);

  assert.deepStrictEqual(Object.keys(workflow), [
    'name',
    'on',
    'permissions',
    'concurrency',
    'env',
    'jobs'
  ]);
  assert.deepStrictEqual(workflow.on.push.branches, ['main']);
  assert.deepStrictEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.match(workflow.env.BOOK_FORMATTER_SHA, /^[0-9a-f]{40}$/u);
  assert.equal(workflow.env.BOOK_EDITION, 'free');
  assert.equal(workflow.env.MDBOOK_VERSION, '0.5.4');

  const buildSteps = workflow.jobs.build.steps;
  const actionUses = buildSteps
    .map((step) => step.uses)
    .filter(Boolean);
  assert.deepStrictEqual(actionUses, [
    'actions/checkout@v6',
    'actions/checkout@v6',
    'actions/setup-node@v6',
    'actions/upload-pages-artifact@v5'
  ]);
  assert.equal(
    buildSteps.find((step) => step.name === 'Upload GitHub Pages artifact').with.path,
    'dist/web-mdbook/book'
  );

  assert.deepStrictEqual(workflow.jobs.deploy.permissions, {
    pages: 'write',
    'id-token': 'write'
  });
  assert.equal(workflow.jobs.deploy.environment.name, 'github-pages');
  assert.equal(workflow.jobs.deploy.needs, 'build');
  assert.deepStrictEqual(
    workflow.jobs.deploy.steps.map((step) => step.uses),
    ['actions/configure-pages@v6', 'actions/deploy-pages@v5']
  );

  assert.match(source, /MDBOOK_OUTPUT__HTML__SITE_URL/u);
  assert.match(source, /site_url="\/\$REPOSITORY_NAME\/"/u);
  assert.match(source, /test -f "\$artifact\/404\.html"/u);
  assert.match(source, /searchindex-\*\.js/u);
  assert.match(source, /-links \+1/u);
  assert.match(source, /check-mdbook-responsive/u);
  assert.match(source, /check-visibility/u);
  assert.ok(
    source.indexOf('check-mdbook-responsive') < source.indexOf('MDBOOK_OUTPUT__HTML__SITE_URL="$SITE_URL"'),
    'root-mounted responsive verification must precede the production base-path build'
  );
  assert.match(source, /<base href=\\"\$\{SITE_URL\}\\">/u);
  assert.doesNotMatch(source, /secrets\./u);
  assert.doesNotMatch(source, /@main\b/u);
});

test('Cloudflare Pages example fixes the static output and does not treat cache as evidence', async () => {
  const source = await fs.readFile(CLOUDFLARE_PATH, 'utf8');

  assert.match(source, /Build output directory \| `dist\/web-mdbook\/book`/u);
  assert.match(source, /`MDBOOK_OUTPUT__HTML__SITE_URL` \| `\/`/u);
  assert.match(source, /top-level 404がないprojectをSPAとして扱う/u);
  assert.match(source, /searchindex-\*\.js/u);
  assert.match(source, /HTML、`searchindex-\*\.js`、非fingerprint assetへ`immutable`を付けない/u);
  assert.match(source, /cache hitだけでdeploy可と判定しません/u);
  assert.match(source, /preview URLをportfolio registryのproduction URLへ記録しない/u);
  assert.doesNotMatch(source, /(?:api[_ -]?token|account[_ -]?id)\s*[:=]/iu);
});

test('Jekyll legacy guidance keeps provider paths in consumer-owned settings', async () => {
  const source = await fs.readFile(CONTRACT_PATH, 'utf8');

  assert.match(source, /既存Jekyll書籍はconsumer固有workflowとPages sourceを維持します/u);
  assert.match(source, /`url` \| 公開origin。pathを含めない/u);
  assert.match(source, /`baseurl` \| 原則`\/<repository>` \| 原則空文字列/u);
  assert.match(source, /`repository` \| source linkに使う`owner\/repository`/u);
  assert.match(source, /移行は1冊1PRで行います/u);
  assert.match(source, /生成HTMLのasset\/linkが公開subpathで解決する/u);
});

test('deployment profile remains an explicit proposal outside book schema version 1', async () => {
  const [contract, schemaSource] = await Promise.all([
    fs.readFile(CONTRACT_PATH, 'utf8'),
    fs.readFile('shared/schema/book.schema.json', 'utf8')
  ]);
  const schema = JSON.parse(schemaSource);

  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.deployment_profiles, undefined);
  assert.match(contract, /この例を現行`book\.yaml`へ追加してはいけません/u);
  assert.match(contract, /provider.*github-pages.*cloudflare-pages.*static-host/su);
  assert.match(contract, /canonical_url/u);
  assert.match(contract, /output_directory/u);
  assert.match(contract, /secret、token、account ID/u);
  assert.match(contract, /現行`web-mdbook-v1`はHTMLの`<link rel="canonical">`を生成しません/u);
});
