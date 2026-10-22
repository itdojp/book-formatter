import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertIconLinks, iconPaths } from './shared-icons-fixture.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = fs.mkdtempSync(path.join(root, 'tests/tmp-shared-icons-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64');
// A synthetic one-pixel ICO container; no book-specific logo is distributed.
const icoHeader = Buffer.from([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0]);
icoHeader.writeUInt32LE(png.length, 14);
const assets = { '/assets/favicon.ico': Buffer.concat([icoHeader, png]), '/assets/apple-touch-icon.png': png };
const profiles = [
  { name: 'absent', files: [], exclude: [] },
  { name: 'favicon', files: [iconPaths.icon], exclude: [] },
  { name: 'touch', files: [iconPaths['apple-touch-icon']], exclude: [] },
  { name: 'both', files: Object.values(iconPaths), exclude: [] },
  { name: 'exclude-favicon', files: Object.values(iconPaths), exclude: [iconPaths.icon] },
  { name: 'exclude-touch', files: Object.values(iconPaths), exclude: [iconPaths['apple-touch-icon']] },
  { name: 'exclude-directory', files: Object.values(iconPaths), exclude: ['/assets'] }
];
const baseurls = ['', '/book', '/book&guide'];
const pages = [
  { layout: 'book', file: 'index.html' },
  { layout: 'book', file: 'chapters/one/index.html' },
  { layout: 'default', file: 'plain/index.html' },
  { layout: 'default', file: 'plain/chapters/one/index.html' }
];
let builds = 0, checkedPages = 0, negativeControls = 0;

function jekyll(args) {
  const command = process.env.BUNDLE_GEMFILE ? 'bundle' : 'jekyll';
  const actual = process.env.BUNDLE_GEMFILE ? ['exec', 'jekyll', ...args] : args;
  const result = spawnSync(command, actual, { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
function build(profile, baseurl, mutate = null) {
  const dir = path.join(temporary, String(builds++));
  const source = path.join(dir, 'source'), destination = path.join(dir, 'site');
  fs.mkdirSync(source, { recursive: true });
  for (const component of ['layouts', 'includes']) fs.cpSync(path.join(root, 'shared', component), path.join(source, `_${component}`), { recursive: true });
  if (mutate) mutate(source);
  const config = { source, destination, title: 'Synthetic icon fixture', url: 'https://book.example', baseurl,
    exclude: profile.exclude.map(file => file.slice(1)), plugins: [], quiet: true };
  const configPath = path.join(source, '_config.yml');
  fs.writeFileSync(configPath, JSON.stringify(config));
  for (const page of pages) {
    const file = path.join(source, page.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\nlayout: ${page.layout}\ntitle: Synthetic page\n---\n<p>Readable content</p>\n`);
  }
  for (const file of profile.files) {
    const output = path.join(source, file.slice(1));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, assets[file]);
  }
  jekyll(['build', '--config', configPath, '--disable-disk-cache']);
  const published = profile.files.filter(file => !profile.exclude.some(excluded => file === excluded || file.startsWith(`${excluded}/`)));
  for (const file of Object.values(iconPaths)) {
    const target = path.join(destination, file.slice(1));
    assert.equal(fs.existsSync(target), published.includes(file), `${profile.name}: published file set`);
    if (published.includes(file)) assert.deepEqual(fs.readFileSync(target), assets[file]);
  }
  return pages.map(page => ({ html: fs.readFileSync(path.join(destination, page.file), 'utf8'), options: { layout: page.layout, baseurl, published } }));
}
try {
  console.log(jekyll(['--version']).trim());
  for (const profile of profiles) for (const baseurl of baseurls) {
    for (const page of build(profile, baseurl)) { assertIconLinks(page.html, page.options); checkedPages++; }
  }
  const controls = [
    { name: 'unconditional missing icon', profile: profiles[0], replace: text => text.replace('{% if shared_favicon_file %}', '{% if true %}') },
    { name: 'valid icon dropped', profile: profiles[3], replace: text => text.replace('{% if shared_favicon_file %}', '{% if false %}') },
    { name: 'baseurl lost', profile: profiles[3], replace: text => text.replace('\'/assets/favicon.ico\' | relative_url | escape', '\'/assets/favicon.ico\' | escape') }
  ];
  for (const control of controls) {
    const output = build(control.profile, '/book', source => {
      for (const layout of ['book', 'default']) {
        const file = path.join(source, '_layouts', `${layout}.html`), before = fs.readFileSync(file, 'utf8');
        const after = control.replace(before); assert.notEqual(after, before); fs.writeFileSync(file, after);
      }
    });
    for (const page of output) assert.throws(() => assertIconLinks(page.html, page.options), assert.AssertionError, control.name);
    negativeControls++;
  }
  console.log(JSON.stringify({ profiles: profiles.length, baseurls, builds, checkedPages, negativeControls, negativePages: negativeControls * pages.length, passed: true }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
