import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import fs from 'fs-extra';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import YAML from 'yaml';

import {
  AdapterBuildError,
  buildStandardBookAdapter
} from '../src/AdapterBuild.js';

const REPOSITORY_ROOT = process.cwd();
const SAMPLE_BOOK = path.join(REPOSITORY_ROOT, 'examples/standard-book');
const temporaryDirectories = [];

async function temporaryDirectory(prefix) {
  const directory = await fs.mkdtemp(path.join(REPOSITORY_ROOT, `tests/${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}

async function copySampleBook() {
  const directory = await temporaryDirectory('tmp-note-book-');
  await fs.copy(SAMPLE_BOOK, directory);
  return directory;
}

async function updateMetadata(bookDirectory, mutate) {
  const metadataPath = path.join(bookDirectory, 'book.yaml');
  const metadata = YAML.parse(await fs.readFile(metadataPath, 'utf8'), { uniqueKeys: true });
  mutate(metadata);
  await fs.writeFile(metadataPath, YAML.stringify(metadata));
}

async function appendWorkflow(bookDirectory, markdown) {
  await fs.appendFile(path.join(bookDirectory, 'manuscript/02-workflow.md'), markdown, 'utf8');
}

async function build(bookDirectory, outputRoot, editionId = 'paid', dryRun = false) {
  return buildStandardBookAdapter({
    bookDirectory,
    target: 'note',
    editionId,
    outputRoot,
    dryRun
  });
}

function packageDirectory(result) {
  return path.join(result.outputDirectory, 'standard-book-example');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
});

describe('NoteAdapter', () => {
  for (const heading of ['# Late heading', 'Late heading\n============']) {
    for (const prefix of ['Free prose.', '# Canonical\n\nFree prose.']) {
      test(`source-leading H1/reject projected late/${heading}/${prefix}`, async () => {
        const book = await copySampleBook();
        await updateMetadata(book, (metadata) => {
          metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
        });
        await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'),
          `${prefix}\n\n:::paid\n\n${heading}\n\nPaid prose.\n\n:::\n`);
        const out = await temporaryDirectory('tmp-note-source-h1-');
        await assert.rejects(() => build(book, out), /h1 must be the first content block/u);
        assert.deepStrictEqual(await fs.readdir(out), []);
      });
    }
    for (const mode of ['split', 'paid-only']) {
      test(`source-leading H1/preserve canonical/${heading}/${mode}`, async () => {
        const book = await copySampleBook();
        if (mode === 'split') {
          await updateMetadata(book, (metadata) => {
            metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
          });
        }
        const body = mode === 'split' ? 'Free prose.\n\n:::paid\n\nPaid prose.\n\n:::' : 'Paid prose.';
        await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'), `\n\n${heading}\n\n${body}\n`);
        const result = await build(book, await temporaryDirectory('tmp-note-source-h1-'));
        for (const extension of ['md', 'html']) {
          const paid = await fs.readFile(path.join(packageDirectory(result), `02-paid-body.${extension}`), 'utf8');
          assert.ok(paid.includes('Paid prose.'));
          assert.ok(!paid.includes('Late heading'));
          if (mode === 'split') {
            const free = await fs.readFile(path.join(packageDirectory(result), `01-free-sample.${extension}`), 'utf8');
            assert.ok(free.includes('Free prose.'));
            assert.ok(!free.includes('Late heading'));
          }
        }
      });
    }
  }
  for (const mode of ['free', 'paid']) {
    const sourcePath = mode === 'free' ? 'frontmatter/preface.md' : 'manuscript/02-workflow.md';
    for (const close of ['---', '...']) {
      for (const format of ['LF', 'BOM-CRLF']) {
        for (const h1 of [false, true]) {
          test(`source front matter/reject/${mode}/${close}/${format}/h1=${h1}`, async () => {
            const book = await copySampleBook();
            let source = `--- \t\nsource_marker: NOTE_SYNTHETIC_FRONTMATTER_ONLY\n${close} \t\n\n${h1 ? '# Probe\n\n' : ''}Visible body.\n`;
            if (format === 'BOM-CRLF') source = '\uFEFF' + source.replace(/\n/g, '\r\n');
            await fs.writeFile(path.join(book, sourcePath), source);
            const out = await temporaryDirectory('tmp-note-frontmatter-');
            await assert.rejects(() => build(book, out), (error) => {
              assert.ok(error instanceof AdapterBuildError);
              assert.ok(error.message.includes('Source YAML Front Matter is not supported by the note adapter'));
              assert.ok(error.message.includes(sourcePath));
              assert.ok(error.message.includes('book.yaml'));
              assert.ok(!error.message.includes('NOTE_SYNTHETIC_FRONTMATTER_ONLY'));
              return true;
            });
            assert.deepStrictEqual(await fs.readdir(out), []);
          });
        }
      }
    }
    for (const [kind, source] of [
      ['invalid', '---\nbroken: [\n---\nVisible body.\n'],
      ['duplicate', '---\nkey: one\nkey: two\n...\nVisible body.\n'],
      ['unclosed', '---\nsource_marker: NOTE_SYNTHETIC_FRONTMATTER_ONLY\n']
    ]) {
      test(`source front matter/visibility-reject/${mode}/${kind}`, async () => {
        const book = await copySampleBook();
        await fs.writeFile(path.join(book, sourcePath), source);
        const out = await temporaryDirectory('tmp-note-frontmatter-');
        await assert.rejects(() => build(book, out), AdapterBuildError);
        assert.deepStrictEqual(await fs.readdir(out), []);
      });
    }
    for (const [kind, source] of [
      ['ATX', '# Probe\n\nVisible body.\n'],
      ['Setext', 'Probe\n=====\n\nVisible body.\n'],
      ['plain', 'Visible body.\n'],
      ['thematic-break', 'Visible body.\n\n---\nOther paragraph.\n'],
      ['fenced-literal', '# Probe\n\nVisible body.\n\n```yaml\n---\nsource_marker: NOTE_SYNTHETIC_LITERAL\n...\n```\n']
    ]) {
      test(`source front matter/no-metadata/${mode}/${kind}`, async () => {
        const book = await copySampleBook();
        await fs.writeFile(path.join(book, sourcePath), source);
        const result = await build(book, await temporaryDirectory('tmp-note-frontmatter-'));
        const fragment = mode === 'free' ? '01-free-sample' : '02-paid-body';
        const directory = packageDirectory(result);
        const markdown = await fs.readFile(path.join(directory, `${fragment}.md`), 'utf8');
        const html = await fs.readFile(path.join(directory, `${fragment}.html`), 'utf8');
        assert.ok(markdown.includes('Visible body.'));
        assert.ok(html.includes('Visible body.'));
        assert.ok(!markdown.includes('NOTE_SYNTHETIC_FRONTMATTER_ONLY'));
        if (kind === 'thematic-break') assert.ok(html.includes('<hr>'));
        if (kind === 'fenced-literal') {
          assert.ok(markdown.includes('source_marker: NOTE_SYNTHETIC_LITERAL'));
          assert.ok(html.includes('<code class="language-yaml">'));
        }
      });
    }
  }
  for (const shape of ['named-plain', 'named-quote', 'named-multiline', 'inline', 'inline-after-multiline', 'after-multiline']) {
    for (const mode of ['free', 'paid']) {
      test(`footnote warning provenance/${shape}/${mode}`, async () => {
        const book = await copySampleBook();
        await updateMetadata(book, (metadata) => {
          metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
        });
        await fs.outputFile(path.join(book, 'assets/cover.png'), 'synthetic image');
        const detail = '[relative](./next.md) <span>synthetic</span> ![local](../assets/cover.png)';
        const body = shape === 'inline' ? `Read ^[${detail}].`
          : shape === 'inline-after-multiline' ? `Read ^[First\nsecond] and ^[${detail}].`
            : shape === 'after-multiline' ? `Read ^[First\nsecond] and ${detail}.`
              : shape === 'named-multiline'
                ? `Read [^shared].\n\n[^shared]: First sentence.\n    ${detail}`
                : `Read [^shared].\n\n${shape === 'named-quote' ? '> ' : ''}[^shared]: ${detail}`;
        const [use, ...definition] = body.split('\n\n');
        const source = mode === 'free' ? `# Probe\n\n${body}\n\nUnrelated final paragraph.\n`
          : `# Probe\n\nFree before.\n\n:::paid\n\n${use}\n\nUnrelated paid paragraph.\n\n:::\n\n${definition.join('\n\n')}\n`;
        await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'), source);
        const result = await build(book, await temporaryDirectory('tmp-note-warning-'));
        const manifest = YAML.parse(await fs.readFile(path.join(packageDirectory(result), 'note-publish-manifest.yaml'), 'utf8'));
        const line = source.split('\n').findIndex((value) => value.includes('[relative]')) + 1;
        assert.deepStrictEqual(manifest.warnings.filter((warning) => warning.file === 'manuscript/02-workflow.md'),
          ['image_requires_manual_upload', 'raw_html_requires_manual_review', 'relative_link_requires_manual_review']
            .map((code) => ({ code, file: 'manuscript/02-workflow.md', line })));
        assert.ok(await fs.pathExists(path.join(packageDirectory(result), 'assets/cover.png')));
      });
    }
  }

  // Global parser binding must survive local duplicate definitions in either projection.
  for (const kind of ['reference', 'footnote']) {
    for (const [container, prefix] of [['plain', ''], ['quote', '> '], ['list', '- '], ['nested', '> - ']]) {
      for (const mode of ['same-free', 'same-paid', 'visible-effective-elsewhere', 'hidden-effective', 'hidden-control']) {
        test(`effective-definition closure/${kind}/${container}/${mode}`, async () => {
          const book = await copySampleBook();
          await updateMetadata(book, (metadata) => {
            metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
          });
          const isReference = kind === 'reference';
          const use = isReference ? 'Read [Shared label].' : 'Read [^shared].';
          const first = prefix + (isReference
            ? '[SHARED LABEL]: https://first.example/ "first title"'
            : '[^shared]: Earlier synthetic note.');
          const last = prefix + (isReference
            ? '[shared label]: https://second.example/ "second title"'
            : '[^shared]: Later synthetic note.');
          const paid = (text) => `:::paid\n\n${text}\n\n:::`;
          let body;
          if (mode === 'same-free' || mode === 'same-paid') {
            const same = `${first}\n\n${use}\n\n${last}`;
            body = mode === 'same-free' ? same : `Free before.\n\n${paid(same)}`;
          } else if (mode === 'visible-effective-elsewhere') {
            body = isReference
              ? `Free before.\n\n${first}\n\n${paid(`${use}\n\n${last}`)}`
              : `Free before.\n\n${paid(`${first}\n\n${use}`)}\n\n${last}`;
          } else {
            const duplicate = mode === 'hidden-control' ? '' : isReference ? last : first;
            body = isReference
              ? `${paid(first)}\n\n${use}\n\n${duplicate}`
              : `${use}\n\n${duplicate}\n\n${paid(last)}`;
          }
          const source = `# Probe\n\n${body}\n`;
          await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'), source);
          const render = (text) => new MarkdownIt({ html: true }).use(markdownItFootnote).render(text);
          const binding = (html) => isReference
            ? [...html.matchAll(/href="(https:\/\/(?:first|second)\.example\/)" title="([^"]+)"/gu)]
              .map((match) => [match[1], match[2]])
            : [...html.matchAll(/(?:Earlier|Later) synthetic note\./gu)].map((match) => match[0]);
          const expected = isReference
            ? [['https://first.example/', 'first title']]
            : ['Later synthetic note.'];
          assert.deepStrictEqual(binding(render(source)), expected, 'pinned original parser binding');
          const out = await temporaryDirectory('tmp-note-effective-');
          if (mode.startsWith('hidden-')) {
            await assert.rejects(build(book, out), new RegExp(`${kind} definition is outside its visible source`, 'u'));
            assert.ok(!(await fs.pathExists(path.join(out, 'note'))));
            return;
          }
          const result = await build(book, out);
          const fragment = mode === 'same-free' ? '01-free-sample' : '02-paid-body';
          const md = await fs.readFile(path.join(packageDirectory(result), `${fragment}.md`), 'utf8');
          const html = await fs.readFile(path.join(packageDirectory(result), `${fragment}.html`), 'utf8');
          assert.deepStrictEqual(binding(html), expected, 'comparison HTML');
          assert.deepStrictEqual(binding(render(md)), expected, 'combined Markdown');
          assert.doesNotMatch(html, /\[shared label\]:|\[SHARED LABEL\]:|\[\^shared\]:/u);
        });
      }
    }
  }

  for (const [container, prefix] of [
    ['plain', ''], ['quote', '> '], ['list', '- '], ['nested', '> - ']
  ]) {
    for (const [fragment, file, outputName] of [
      ['free', 'frontmatter/preface.md', '01-free-sample'],
      ['paid', 'manuscript/02-workflow.md', '02-paid-body']
    ]) {
      test(`label境界はparserの保護span内の括弧を無視する/${container}/${fragment}`, async () => {
        const book = await copySampleBook();
        await fs.outputFile(path.join(book, 'assets/cover.png'), 'synthetic image');
        const labels = [
          '[text `]`][shared]',
          '[text `[`][shared]',
          '[text <span title="]">HTML</span>][shared]',
          '![image `]`][image]'
        ];
        const source = labels.map((label) => `${prefix}${label}`).join('\n\n') +
          '\n\n[shared]: https://reference.example/\n[image]: ../assets/cover.png\n';
        const expected = new MarkdownIt({ html: true }).render(source);
        assert.strictEqual((expected.match(/href="https:\/\/reference.example\/"/gu) || []).length, 3);
        assert.match(expected, /alt="image "/u);
        await fs.writeFile(path.join(book, file), `# Owner\n\n${source}`);
        const result = await build(book, await temporaryDirectory('tmp-note-label-boundary-'));
        const output = packageDirectory(result);
        const md = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        for (const rendered of [html, new MarkdownIt().render(md)]) {
          assert.strictEqual((rendered.match(/href="https:\/\/reference.example\/"/gu) || []).length, 3);
          assert.match(rendered, /text <code>\]<\/code><\/a>/u);
          assert.match(rendered, /text <code>\[<\/code><\/a>/u);
          assert.match(rendered, /alt="image "/u);
        }
        assert.ok(md.includes('<span title="]">HTML</span>'));
        assert.strictEqual(await fs.readFile(path.join(output, 'assets/cover.png'), 'utf8'), 'synthetic image');
      });
    }
  }

  for (const [fragment, owner, file, outputName] of [
    ['free', 'preface', 'frontmatter/preface.md', '01-free-sample'],
    ['paid', 'workflow', 'manuscript/02-workflow.md', '02-paid-body']
  ]) {
    for (const reference of ['[credit][shared]', '[shared][]', '[shared]']) {
      test(`inline image ALT参照を保持する/${reference}/${fragment}`, async () => {
        const book = await copySampleBook();
        await fs.outputFile(path.join(book, 'assets/cover.png'), 'synthetic image');
        const image = `![cover ${reference}](../assets/cover.png "title [shared]")`;
        const protectedImage = '![code `[shared]`](../assets/cover.png)';
        const body = `${image}\n\n[download ${image}](https://download.example/)\n\n` +
          `${protectedImage}\n\n[shared]: https://credit.example/\n`;
        const sourceHtml = new MarkdownIt().render(body);
        await fs.writeFile(path.join(book, file), `# Owner\n\n${body}`);
        const result = await build(book, await temporaryDirectory('tmp-note-alt-'));
        const output = packageDirectory(result);
        const md = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        const altValues = (text) => [...text.matchAll(/<img [^>]*alt="([^"]*)"/gu)].map((match) => match[1]);
        assert.deepStrictEqual(altValues(html), altValues(sourceHtml));
        assert.deepStrictEqual(altValues(new MarkdownIt().render(md)), altValues(sourceHtml));
        assert.ok(md.includes(`[note-${owner}-${fragment}-ref-1]`));
        assert.ok(md.includes('"title [shared]"'));
        assert.ok(md.includes(protectedImage));
        assert.match(html, /<a href="https:\/\/download.example\/">download <img /u);
        const manifestPath = path.join(output, 'note-publish-manifest.yaml');
        const manifest = await fs.readFile(manifestPath, 'utf8');
        assert.deepStrictEqual(YAML.parse(manifest).image_candidates, [{
          source: 'assets/cover.png', destination: 'assets/cover.png', documents: [file]
        }]);
        assert.strictEqual(await fs.readFile(path.join(output, 'assets/cover.png'), 'utf8'), 'synthetic image');
        await build(book, path.dirname(result.outputDirectory));
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.md`), 'utf8'), md);
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.html`), 'utf8'), html);
        assert.strictEqual(await fs.readFile(manifestPath, 'utf8'), manifest);
      });
    }

    for (const heading of ['# Chapter', 'Chapter\n=======', 'Chapter\ncontinued\n=======']) {
      test(`先頭H1のparser map全行を除去する/${heading}/${fragment}`, async () => {
        const book = await copySampleBook();
        const body = 'Visible line  \nhard break.\n\nSection\n-------\n\n```text\n# code heading\n```\n';
        const source = `\n\n${heading}\n\n${body}\n:::note\nA note.\n:::\n`;
        await fs.writeFile(path.join(book, file), source);
        const result = await build(book, await temporaryDirectory('tmp-note-setext-'));
        const output = packageDirectory(result);
        const md = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        assert.ok(md.includes(body.trimEnd()), 'body, hard break, Setext H2 and fenced code preserved');
        assert.ok(!md.includes('Chapter'), 'canonical H1 removed in full');
        assert.ok(!md.includes('continued'));
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        assert.match(html, /Visible line<br>\nhard break/u);
        assert.match(html, /<h2>Section<\/h2>/u);
        const manifest = YAML.parse(await fs.readFile(path.join(output, 'note-publish-manifest.yaml'), 'utf8'));
        assert.deepStrictEqual(manifest.warnings.filter((warning) => warning.file === file), [{
          code: 'callout_degraded_to_blockquote', file,
          line: source.split('\n').indexOf(':::note') + 1
        }], 'warnings retain the physical source line after multi-line H1 removal');
      });
    }

    test(`非先頭Setext H1を拒否する/${fragment}`, async () => {
      const book = await copySampleBook();
      await fs.writeFile(path.join(book, file), 'Visible before.\n\nChapter\n=======\n\nBody.\n');
      await assert.rejects(build(book, await temporaryDirectory('tmp-note-late-h1-')), /h1 must be the first content block/u);
    });
  }

  for (const hidden of ['paid', 'internal']) {
    test(`inline image ALTの不可視${hidden}参照定義を拒否する`, async () => {
      const book = await copySampleBook();
      await fs.outputFile(path.join(book, 'assets/cover.png'), 'synthetic image');
      await updateMetadata(book, (metadata) => metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow'));
      await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'),
        '# Owner\n\n![cover [credit][shared]](../assets/cover.png)\n\n' +
        `:::${hidden}\n\n[shared]: https://credit.example/\n\n:::\n`);
      const output = await temporaryDirectory('tmp-note-hidden-alt-');
      await assert.rejects(build(book, output), /reference definition is outside its visible source/u);
      assert.strictEqual(await fs.pathExists(path.join(output, 'note')), false);
    });
  }

  for (const definition of [
    '[^unused]: Synthetic unused note.',
    '[^unused]: First paragraph.\n\n    Second paragraph.',
    '[^unused]:',
    '[^unused]: First definition.\n\n[^unused]: Last definition.'
  ]) {
    test(`未参照脚注定義はpaid reader境界を開始しない/${definition}`, async () => {
      const book = await copySampleBook();
      await updateMetadata(book, (metadata) => metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow'));
      await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'),
        `# Probe\n\nFree before.\n\n:::paid\n\n${definition}\n\n:::\n\nFree after.\n`);
      const result = await build(book, await temporaryDirectory('tmp-note-unused-footnote-'));
      const output = packageDirectory(result);
      const free = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
      const paid = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');
      assert.match(free, /Free before\./u);
      assert.match(free, /Free after\./u);
      assert.doesNotMatch(free + paid, /unused|First paragraph|Second paragraph|First definition|Last definition/u);
    });
  }

  for (const paidBody of [
    '[^unused]: Hidden.\n\nActual paid prose.',
    '```text\n[^unused]: Literal code.\n```'
  ]) {
    test(`脚注風code/実際のpaid本文は境界を開始する/${paidBody}`, async () => {
      const book = await copySampleBook();
      await updateMetadata(book, (metadata) => metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow'));
      await fs.writeFile(path.join(book, 'manuscript/02-workflow.md'),
        `# Probe\n\nFree before.\n\n:::paid\n\n${paidBody}\n\n:::\n\nFree after.\n`);
      await assert.rejects(build(book, await temporaryDirectory('tmp-note-visible-footnote-control-')), /single prefix/u);
    });
  }

  for (const [fragment, owner, file, outputName] of [
    ['free', 'preface', 'frontmatter/preface.md', '01-free-sample'],
    ['paid', 'workflow', 'manuscript/02-workflow.md', '02-paid-body']
  ]) {
    for (const image of ['![cover][image]', '![image][]', '![image]']) {
      test(`inline link label内の参照画像 ${image}/${fragment} を変換・stageする`, async () => {
        const bookDirectory = await copySampleBook();
        await fs.outputFile(path.join(bookDirectory, 'assets/cover.png'), 'synthetic png bytes');
        await fs.outputFile(path.join(bookDirectory, 'assets/standalone.png'), 'control png bytes');
        const metadata = '(https://download.example/[image] "title [image]")';
        const code = '`![cover][image]`';
        const htmlMetadata = '<span title="![cover][image]">metadata</span>';
        const standalone = image.replaceAll('image', 'standalone');
        const body = `[download ${image}]${metadata}\n\n${standalone}\n\n` +
          `[download]${metadata}\n\n${code} ${htmlMetadata}\n\n` +
          '[download]: https://unused.example/\n[image]: ../assets/cover.png\n' +
          '[standalone]: ../assets/standalone.png\n';
        await fs.writeFile(path.join(bookDirectory, file), `# Owner\n\n${body}`);
        const result = await build(bookDirectory, await temporaryDirectory('tmp-note-linked-image-'));
        const output = packageDirectory(result);
        const markdown = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        const label = `note-${owner}-${fragment}-ref-2`;
        const converted = image === '![cover][image]' ? `![cover][${label}]` : `![image][${label}]`;
        assert.ok(markdown.includes(`[download ${converted}]${metadata}`));
        const control = image === '![cover][image]'
          ? `![cover][note-${owner}-${fragment}-ref-3]` : `![standalone][note-${owner}-${fragment}-ref-3]`;
        assert.ok(markdown.includes(`\n${control}\n`), 'standalone image remains resolved');
        assert.ok(markdown.includes(`[download]${metadata}`), 'inline label is not a shortcut reference');
        assert.ok(markdown.includes(code));
        assert.ok(markdown.includes(htmlMetadata));
        const combinedHtml = new MarkdownIt({ html: true }).render(markdown);
        for (const rendered of [html, combinedHtml]) {
          assert.strictEqual((rendered.match(/<img /gu) || []).length, 2);
          assert.match(rendered, /<a [^>]+>download <img [^>]+><\/a>/u);
        }
        assert.match(html, /src="assets\/cover.png"/u);
        const manifestFile = path.join(output, 'note-publish-manifest.yaml');
        const manifest = await fs.readFile(manifestFile, 'utf8');
        assert.deepStrictEqual(YAML.parse(manifest).image_candidates, [{
          source: 'assets/cover.png', destination: 'assets/cover.png', documents: [file]
        }, {
          source: 'assets/standalone.png', destination: 'assets/standalone.png', documents: [file]
        }]);
        assert.strictEqual(await fs.readFile(path.join(output, 'assets/cover.png'), 'utf8'), 'synthetic png bytes');
        assert.strictEqual(await fs.readFile(path.join(output, 'assets/standalone.png'), 'utf8'), 'control png bytes');
        await build(bookDirectory, path.dirname(result.outputDirectory));
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.md`), 'utf8'), markdown);
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.html`), 'utf8'), html);
        assert.strictEqual(await fs.readFile(manifestFile, 'utf8'), manifest);
      });
    }

    test(`parserが拒否するnested reference linkをinline linkに変えない/${fragment}`, async () => {
      const bookDirectory = await copySampleBook();
      const body = '[outer [inner][reference]](https://download.example/)';
      const source = `# Owner\n\n${body}\n\n[reference]: https://docs.example/\n`;
      const originalHtml = new MarkdownIt().render(source);
      assert.strictEqual((originalHtml.match(/<a /gu) || []).length, 1);
      assert.ok(!originalHtml.includes('href="https://download.example/"'));
      await fs.writeFile(path.join(bookDirectory, file), source);
      const result = await build(bookDirectory, await temporaryDirectory('tmp-note-nested-link-'));
      const output = packageDirectory(result);
      const markdown = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
      assert.ok(markdown.includes(body.replace('[reference]', `[note-${owner}-${fragment}-ref-1]`)));
      for (const rendered of [
        await fs.readFile(path.join(output, `${outputName}.html`), 'utf8'),
        new MarkdownIt().render(markdown)
      ]) {
        assert.match(rendered, /href="https:\/\/docs\.example\/">inner<\/a>/u);
        assert.ok(!rendered.includes('href="https://download.example/"'));
        assert.doesNotMatch(rendered, /<a [^>]+>[^<]*<a /u);
      }
    });
  }

  for (const hidden of ['paid', 'internal']) {
    test(`inline link内の画像が不可視${hidden}定義へ依存すると拒否する`, async () => {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
      });
      await fs.outputFile(path.join(bookDirectory, 'assets/cover.png'), 'synthetic png bytes');
      await fs.writeFile(path.join(bookDirectory, 'manuscript/02-workflow.md'),
        '# Owner\n\n[download ![cover][image]](https://download.example/)\n\n' +
        `:::${hidden}\n\n[image]: ../assets/cover.png\nhidden body\n\n:::\n`);
      const outputRoot = await temporaryDirectory('tmp-note-hidden-linked-image-');
      await assert.rejects(build(bookDirectory, outputRoot), /reference definition is outside its visible source/u);
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'note')), false);
    });
  }

  for (const [container, prefix, continuation] of [
    ['plain', '', ''],
    ['quote', '> ', '> '],
    ['list', '- ', '  '],
    ['nested-quote-list', '> - ', '>   ']
  ]) {
    for (const [fragment, owner, file, outputName] of [
      ['free', 'preface', 'frontmatter/preface.md', '01-free-sample'],
      ['paid', 'workflow', 'manuscript/02-workflow.md', '02-paid-body']
    ]) {
      test(`parser labelで${container}/${fragment}のmultiline shortcut/collapsed参照を解決する`, async () => {
        const bookDirectory = await copySampleBook();
        const body = `${prefix}[shared\n${continuation}label] and ` +
          `[shared\n${continuation}label][] and [display\n${continuation}text][shared label] and ` +
          `[literal][unknown\n${continuation}label]`;
        await fs.writeFile(path.join(bookDirectory, file),
          `# Owner\n\n${body}\n\n[shared label]: https://docs.example/reference\n`);
        const outputRoot = await temporaryDirectory('tmp-note-multiline-labels-');
        const result = await build(bookDirectory, outputRoot);
        const output = packageDirectory(result);
        const markdown = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        const label = `note-${owner}-${fragment}-ref-1`;
        assert.ok(markdown.includes(`${prefix}[shared\n${continuation}label][${label}]`));
        assert.ok(markdown.includes(`[shared\n${continuation}label][${label}] and ` +
          `[display\n${continuation}text][${label}]`));
        assert.ok(markdown.includes(`[literal][unknown\n${continuation}label]`));
        const combinedHtml = new MarkdownIt({ html: true }).render(markdown);
        for (const rendered of [html, combinedHtml]) {
          assert.strictEqual((rendered.match(/href="https:\/\/docs\.example\/reference"/gu) || []).length, 3);
        }
        await build(bookDirectory, outputRoot);
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.md`), 'utf8'), markdown);
      });

      test(`source行所有権を変える${container}/${fragment}のmultiline explicit labelはfail closed`, async () => {
        const bookDirectory = await copySampleBook();
        await fs.writeFile(path.join(bookDirectory, file),
          `# Owner\n\n${prefix}[text][shared\n${continuation}label]\n\n` +
          '[shared label]: https://docs.example/reference\n');
        const outputRoot = await temporaryDirectory('tmp-note-multiline-explicit-');
        await assert.rejects(build(bookDirectory, outputRoot), /multiline explicit reference label/u);
        assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'note')), false);
      });
    }
  }

  for (const [container, prefix, continuation] of [
    ['quote', '> ', '> '],
    ['quote-tab', '> \t', '> \t'],
    ['nested-quote', '> > ', '> > '],
    ['list', '- ', '  '],
    ['ordered-list', '1. ', '   '],
    ['quote-list', '> - ', '>   '],
    ['list-quote', '- > ', '  > ']
  ]) {
    for (const [fragment, owner, file, outputName] of [
      ['free', 'preface', 'frontmatter/preface.md', '01-free-sample'],
      ['paid', 'workflow', 'manuscript/02-workflow.md', '02-paid-body']
    ]) {
      test(`container-stripped spanで${container}/${fragment}のmetadataを保持する`, async () => {
        const bookDirectory = await copySampleBook();
        const body = [
          '[before][shared] Real [^note]',
          '',
          '<span',
          'title="[shared] [^note]">metadata</span> [after-html][shared]',
          '',
          'Text <span',
          'title="[shared] [^note]">inline metadata</span>',
          '',
          '`[shared]',
          '[^note]` [after-code][shared]',
          '',
          '[inline](https://docs.example/[shared]',
          ' "title [shared] [^note]") [after-link][shared]',
          '',
          '<https://docs.example/[shared]> [after-autolink][shared]'
        ].map((line, index) => `${index === 0 ? prefix : continuation}${line}`).join('\n');
        await fs.writeFile(path.join(bookDirectory, file),
          `# Owner\n\n${body}\n\n[shared]: https://docs.example/reference\n[^note]: Real note.\n`);
        const outputRoot = await temporaryDirectory('tmp-note-container-spans-');
        const result = await build(bookDirectory, outputRoot);
        const output = packageDirectory(result);
        const markdown = await fs.readFile(path.join(output, `${outputName}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${outputName}.html`), 'utf8');
        const expected = body
          .replace(/\[(before|after-html|after-code|after-link|after-autolink)\]\[shared\]/gu,
            `[$1][note-${owner}-${fragment}-ref-1]`)
          .replace('Real [^note]', `Real [^note-${owner}-${fragment}-fn-1]`);
        assert.ok(markdown.includes(expected), 'only actual references may change; container/metadata stay literal');
        const combinedHtml = new MarkdownIt({ html: true }).use(markdownItFootnote).render(markdown);
        assert.ok(combinedHtml.includes('title="[shared] [^note]"'));
        for (const rendered of [html, combinedHtml]) {
          assert.strictEqual((rendered.match(/href="https:\/\/docs\.example\/reference"/gu) || []).length, 5);
          assert.strictEqual((rendered.match(/class="footnote-ref"/gu) || []).length, 1);
        }
        await build(bookDirectory, outputRoot);
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.md`), 'utf8'), markdown);
        assert.strictEqual(await fs.readFile(path.join(output, `${outputName}.html`), 'utf8'), html);
      });
    }
  }

  test('table cellのparser親mapを利用してcodeとHTML metadataを保持する', async () => {
    const bookDirectory = await copySampleBook();
    const table = '| Code | HTML | Reference |\n| --- | --- | --- |\n' +
      '| `[shared]` | <span title="[shared]">metadata</span> | [real][shared] |';
    await fs.writeFile(path.join(bookDirectory, 'frontmatter/preface.md'),
      `# Table\n\n${table}\n\n[shared]: https://docs.example/reference\n`);
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-table-spans-'));
    const markdown = await fs.readFile(path.join(packageDirectory(result), '01-free-sample.md'), 'utf8');
    assert.ok(markdown.includes(table.replace('[real][shared]', '[real][note-preface-free-ref-1]')));
  });

  test('dependencyとして補完するfootnote定義の保護metadataも元のblock mapへ束縛する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    const definition = '[^note]: `literal [shared]`\n\n    <span\n    title="[shared]">metadata</span>';
    await fs.writeFile(path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Split\n\nFree [^note]\n\n:::paid\nPaid [real][shared] [^note]\n:::\n\n' +
      `[shared]: https://docs.example/reference\n${definition}\n`);
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-definition-spans-'));
    for (const [fragment, file] of [['free', '01-free-sample.md'], ['paid', '02-paid-body.md']]) {
      const markdown = await fs.readFile(path.join(packageDirectory(result), file), 'utf8');
      assert.ok(markdown.includes(definition.replace('[^note]', `[^note-workflow-${fragment}-fn-1]`)));
    }
  });

  test('inline footnote内のcodeはsource mapを持たない生成tailと混同しない', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(path.join(bookDirectory, 'frontmatter/preface.md'),
      '# Inline note\n\nInline ^[code `[shared]`] [real][shared]\n\n' +
      '[shared]: https://docs.example/reference\n');
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-inline-footnote-spans-'));
    const markdown = await fs.readFile(path.join(packageDirectory(result), '01-free-sample.md'), 'utf8');
    assert.ok(markdown.includes('Inline ^[code `[shared]`] [real][note-preface-free-ref-1]'));
  });

  for (const [name, text] of [
    ['ambiguous table cell', '| A | B |\n| --- | --- |\n| `[shared]` | `[shared]` |'],
    ['ambiguous inline child', 'code `[shared]` plus ^[code `[shared]`]'],
    ['expanded tab', '- Text <span\n\ttitle="[shared]">metadata</span>']
  ]) {
    test(`一意のsource offsetが証明できない${name}はfail closed`, async () => {
      const bookDirectory = await copySampleBook();
      await fs.writeFile(path.join(bookDirectory, 'frontmatter/preface.md'),
        `# Unmappable\n\n${text}\n\n[shared]: https://docs.example/reference\n`);
      const outputRoot = await temporaryDirectory('tmp-note-unmappable-spans-');
      await assert.rejects(build(bookDirectory, outputRoot), /cannot uniquely map protected inline content/u);
      assert.deepStrictEqual(await fs.readdir(outputRoot), []);
    });
  }

  for (const [fragment, owner, later, filename] of [
    ['free', 'preface', 'introduction', '01-free-sample'],
    ['paid', 'workflow', 'afterword', '02-paid-body']
  ]) {
    for (const placement of ['same-document', 'later-document']) {
      test(`generated labelを${fragment}/${placement}の全candidateから隔離する`, async () => {
        const bookDirectory = await copySampleBook();
        const paths = {
          preface: 'frontmatter/preface.md',
          introduction: 'manuscript/01-introduction.md',
          workflow: 'manuscript/02-workflow.md',
          afterword: 'backmatter/afterword.md'
        };
        const prefix = `note-${owner}-${fragment}`;
        const candidates = [
          `[${prefix}-ref-1]`,
          `[full][${prefix}-ref-2]`,
          `[${prefix}-ref-3][]`,
          `[  ${prefix.toUpperCase()}-REF-4  ]`,
          `[outer [${prefix}-ref-5]]`,
          `![image][${prefix}-ref-6]`,
          `[^${prefix}-fn-1]`
        ].join('\n\n');
        await fs.writeFile(path.join(bookDirectory, paths[owner]),
          '# Owner\n\n[real][shared] [^note] [^note]\n\n' +
          (placement === 'same-document' ? `${candidates}\n\n` : '') +
          '[shared]: https://docs.example/reference\n[^note]: Real note.\n');
        if (placement === 'later-document') {
          await fs.writeFile(path.join(bookDirectory, paths[later]), `# Later\n\n${candidates}\n`);
        }
        const outputRoot = await temporaryDirectory('tmp-note-reserved-labels-');
        const result = await build(bookDirectory, outputRoot);
        const output = packageDirectory(result);
        const markdown = await fs.readFile(path.join(output, `${filename}.md`), 'utf8');
        const html = await fs.readFile(path.join(output, `${filename}.html`), 'utf8');
        assert.ok(markdown.includes(candidates));
        assert.ok(markdown.includes(`[real][${prefix}-ref-7]`));
        assert.ok(markdown.includes(`[^${prefix}-fn-2]`));
        // Parse the combined Markdown too: HTML sections have separate envs,
        // whereas pasted Markdown definitions can resolve across documents.
        const combinedHtml = new MarkdownIt().use(markdownItFootnote).render(markdown);
        for (const rendered of [html, combinedHtml]) {
          assert.ok(rendered.includes(`[${prefix}-ref-1]`));
          assert.ok(rendered.includes(`[^${prefix}-fn-1]`));
          assert.strictEqual((rendered.match(/href="https:\/\/docs\.example\/reference"/gu) || []).length, 1);
          assert.strictEqual((rendered.match(/class="footnote-ref"/gu) || []).length, 2);
        }
        await build(bookDirectory, outputRoot);
        assert.strictEqual(await fs.readFile(path.join(output, `${filename}.md`), 'utf8'), markdown);
        assert.strictEqual(await fs.readFile(path.join(output, `${filename}.html`), 'utf8'), html);
      });
    }
  }

  test('label予約はcode・escape・HTML/link metadataを再解釈しない', async () => {
    const bookDirectory = await copySampleBook();
    const label = '[note-preface-free-ref-1]';
    const footnote = '[^note-preface-free-fn-1]';
    const protectedText = `${label} ${footnote}`;
    await fs.writeFile(path.join(bookDirectory, 'frontmatter/preface.md'),
      '# Owner\n\n[real][shared] [^note]\n\n' +
      `\\${label} \\${footnote}\n\n` +
      `\`${protectedText}\`\n\n` +
      `    ${protectedText}\n\n` +
      `\`\`\`text\n${protectedText}\n\`\`\`\n\n` +
      `<span title="${protectedText}">metadata</span>\n\n` +
      `<!-- ${protectedText} -->\n\n` +
      `<https://docs.example/${label}>\n\n` +
      `[inline](https://docs.example/${label} "${protectedText}")\n\n` +
      `![alt](https://images.example/image.png "${protectedText}")\n\n` +
      `[shared]: https://docs.example/reference "${protectedText}"\n` +
      '[^note]: Real note.\n');
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-protected-labels-'));
    const markdown = await fs.readFile(path.join(packageDirectory(result), '01-free-sample.md'), 'utf8');
    assert.ok(markdown.includes('[real][note-preface-free-ref-1]'));
    assert.ok(markdown.includes('[^note-preface-free-fn-1]: Real note.'));
    assert.ok(markdown.includes(`\\${label}`));
    assert.ok(markdown.includes(`\`${protectedText}\``));
  });

  test('fragment予約はfree/paidを分離しinternal candidateを含めない', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(path.join(bookDirectory, 'frontmatter/preface.md'),
      '# Free\n\n[real][shared] [^note]\n\n' +
      ':::internal\nInternal-only audit hint: [note-preface-free-ref-1] [^note-preface-free-fn-1]\n:::\n\n' +
      '[shared]: https://docs.example/reference\n[^note]: Real note.\n');
    await fs.writeFile(path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Paid\n\nPaid-only audit hint: [note-preface-free-ref-1] [^note-preface-free-fn-1]\n');
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-fragment-reservations-'));
    const output = packageDirectory(result);
    const free = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const paid = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    assert.ok(free.includes('[real][note-preface-free-ref-1]'));
    assert.ok(paid.includes('[note-preface-free-ref-1] [^note-preface-free-fn-1]'));
    assert.doesNotMatch(paid, /Real note|https:\/\/docs\.example\/reference/u);
  });

  test('paid側へ補完する可視footnote本文内のcandidateも割当前に予約する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    await fs.writeFile(path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# Split\n\nFree [^shared]\n\n' +
      ':::paid\nPaid [real][reference] [^shared]\n:::\n\n' +
      '[reference]: https://docs.example/reference\n' +
      '[^shared]: Plain [note-workflow-paid-ref-1] and [^note-workflow-paid-fn-1].\n');
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-dependency-reservations-'));
    const paid = await fs.readFile(path.join(packageDirectory(result), '02-paid-body.md'), 'utf8');
    assert.ok(paid.includes('[real][note-workflow-paid-ref-2]'));
    assert.ok(paid.includes('[^note-workflow-paid-fn-2]'));
    assert.ok(paid.includes('Plain [note-workflow-paid-ref-1] and [^note-workflow-paid-fn-1].'));
  });

  test('paid editionを無料・有料fragmentと手動公開packageへ決定的に分離する', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-output-');
    const first = await build(bookDirectory, outputRoot);
    const output = packageDirectory(first);
    const freeMarkdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const freeHtml = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');
    const noteManifest = YAML.parse(
      await fs.readFile(path.join(output, 'note-publish-manifest.yaml'), 'utf8'),
      { uniqueKeys: true }
    );
    const checklist = await fs.readFile(path.join(output, 'publish-checklist.md'), 'utf8');
    const commonManifest = await fs.readFile(first.manifestPath, 'utf8');
    const firstNoteManifest = await fs.readFile(
      path.join(output, 'note-publish-manifest.yaml'),
      'utf8'
    );

    assert.strictEqual(first.manifest.adapter.implementation, 'note-v1');
    assert.strictEqual(first.manifest.adapter.project_format, 'note-manual-package');
    assert.strictEqual(first.manifest.adapter.manual_operation_required, true);
    assert.deepStrictEqual(noteManifest.paid_line, {
      placement: 'between-paragraphs',
      after: '01-free-sample.md',
      before: '02-paid-body.md'
    });
    assert.deepStrictEqual(noteManifest.fragments.free_sample.document_ids, [
      'preface',
      'introduction'
    ]);
    assert.deepStrictEqual(noteManifest.fragments.paid_body.document_ids, [
      'workflow',
      'afterword'
    ]);
    assert.deepStrictEqual(noteManifest.warnings, [
      {
        code: 'relative_link_requires_manual_review',
        file: 'manuscript/02-workflow.md',
        line: 15
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 31
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 35
      },
      {
        code: 'callout_degraded_to_blockquote',
        file: 'manuscript/02-workflow.md',
        line: 39
      }
    ]);
    assert.match(freeMarkdown, /^## はじめに$/mu);
    assert.match(freeMarkdown, /^## 標準書籍フォーマットとは$/mu);
    assert.doesNotMatch(freeMarkdown, /有償edition候補|内部向け候補/u);
    assert.match(paidMarkdown, /^## 正本から出力する流れ$/mu);
    assert.match(paidMarkdown, /この範囲は有償edition候補です/u);
    assert.doesNotMatch(paidMarkdown, /この範囲は内部向け候補です/u);
    assert.doesNotMatch(`${freeMarkdown}${paidMarkdown}`, /:::paid|:::internal/u);
    assert.match(paidMarkdown, /> \*\*NOTE\*\*/u);
    assert.match(paidHtml, /<blockquote>/u);
    assert.doesNotMatch(`${freeHtml}${paidHtml}`, /:::paid|:::internal/u);
    assert.match(checklist, /noteへ自動投稿しません/u);
    assert.match(checklist, /シークレットモード/u);
    assert.ok(!commonManifest.includes(bookDirectory));
    assert.ok(!commonManifest.includes('内部向け候補'));

    await fs.writeFile(path.join(first.outputDirectory, 'stale.txt'), 'stale\n');
    const second = await build(bookDirectory, outputRoot);
    assert.strictEqual(await fs.pathExists(path.join(second.outputDirectory, 'stale.txt')), false);
    assert.strictEqual(await fs.readFile(second.manifestPath, 'utf8'), commonManifest);
    assert.strictEqual(
      await fs.readFile(path.join(packageDirectory(second), 'note-publish-manifest.yaml'), 'utf8'),
      firstNoteManifest
    );
  });

  test('sample内のpaid blockをfreeから除外しpaid側だけへ配置する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        'adapterによる変換は後続Issueで扱います。\n\n' +
        ':::paid\n' +
        'この範囲は有償edition候補です。\n' +
        ':::\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-regions-'));
    const freeMarkdown = await fs.readFile(
      path.join(packageDirectory(result), '01-free-sample.md'),
      'utf8'
    );
    const paidMarkdown = await fs.readFile(
      path.join(packageDirectory(result), '02-paid-body.md'),
      'utf8'
    );
    const freeHtml = await fs.readFile(
      path.join(packageDirectory(result), '01-free-sample.html'),
      'utf8'
    );
    const paidHtml = await fs.readFile(
      path.join(packageDirectory(result), '02-paid-body.html'),
      'utf8'
    );

    assert.match(freeMarkdown, /adapterによる変換は後続Issueで扱います/u);
    assert.doesNotMatch(freeMarkdown, /この範囲は有償edition候補です/u);
    assert.match(paidMarkdown, /この範囲は有償edition候補です/u);
    assert.doesNotMatch(paidMarkdown, /adapterによる変換は後続Issueで扱います/u);
    assert.strictEqual(
      `${freeMarkdown}${paidMarkdown}`.match(/^## 正本から出力する流れ$/gmu)?.length,
      1
    );
    assert.doesNotMatch(paidMarkdown, /^## 正本から出力する流れ$/mu);
    assert.strictEqual(
      `${freeHtml}${paidHtml}`.match(/<h2>正本から出力する流れ<\/h2>/gu)?.length,
      1
    );
    assert.doesNotMatch(paidHtml, /<h2>正本から出力する流れ<\/h2>/u);
  });

  test('読者可視の有料本文がないpackageを拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        '無料で読める本文です。\n\n' +
        ':::paid\n\n' +
        '[paid-only]: https://paid.example/reference\n\n' +
        ':::\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents = ['workflow'];
      metadata.editions.find((edition) => edition.id === 'paid').documents = ['workflow'];
    });

    await assert.rejects(
      build(bookDirectory, await temporaryDirectory('tmp-note-no-visible-paid-')),
      /note paid-body fragment must not be empty/
    );
  });

  test('読者可視の無料本文がないpackageを拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        '[free-only]: https://free.example/reference\n\n' +
        ':::paid\n\n' +
        '有料で読める本文です。\n\n' +
        ':::\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents = ['workflow'];
      metadata.editions.find((edition) => edition.id === 'paid').documents = ['workflow'];
    });

    await assert.rejects(
      build(bookDirectory, await temporaryDirectory('tmp-note-no-visible-free-')),
      /note free-sample fragment must not be empty/
    );
  });

  test('無料範囲が有料範囲の後へ再出現する非単調構成を拒否する', async () => {
    const bookDirectory = await copySampleBook();
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });
    await appendWorkflow(bookDirectory, '\n<!-- editorial note -->\n');
    await build(bookDirectory, await temporaryDirectory('tmp-note-comment-after-paid-'));
    await appendWorkflow(bookDirectory, '\n有料block後に再出現する無料本文です。\n');

    await assert.rejects(
      build(bookDirectory, await temporaryDirectory('tmp-note-non-monotonic-')),
      /Free-sample content must be a single prefix before the note paid line/
    );
  });

  test('editionの宣言順でfragmentを構成しfree sampleのprefix関係を検証する', async () => {
    const reorderedBook = await copySampleBook();
    await updateMetadata(reorderedBook, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents = [
        'introduction',
        'preface'
      ];
      metadata.editions.find((edition) => edition.id === 'paid').documents = [
        'introduction',
        'preface',
        'workflow',
        'afterword'
      ];
    });
    const reordered = await build(
      reorderedBook,
      await temporaryDirectory('tmp-note-reordered-')
    );
    const freeMarkdown = await fs.readFile(
      path.join(packageDirectory(reordered), '01-free-sample.md'),
      'utf8'
    );
    assert.ok(
      freeMarkdown.indexOf('## 標準書籍フォーマットとは') <
        freeMarkdown.indexOf('## はじめに')
    );

    const nonPrefixBook = await copySampleBook();
    await updateMetadata(nonPrefixBook, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents = [
        'introduction',
        'preface'
      ];
      metadata.editions.find((edition) => edition.id === 'paid').documents = [
        'preface',
        'introduction',
        'workflow',
        'afterword'
      ];
    });
    await assert.rejects(
      build(nonPrefixBook, await temporaryDirectory('tmp-note-reordered-non-prefix-')),
      /Free-sample documents must match the leading document order of the paid edition/
    );
  });

  test('fragment先頭のcode indentと末尾のMarkdown空白を保持する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        '    paid code\n' +
        '\n' +
        'paid hard break  \n' +
        'next paid line\n\n' +
        ':::note\n' +
        '```text\n' +
        'literal code  \n' +
        '```\n' +
        ':::\n',
      'utf8'
    );

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-whitespace-'));
    const output = packageDirectory(result);
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');

    assert.match(paidMarkdown, /\n {4}paid code\n\npaid hard break {2}\nnext paid line/u);
    assert.match(paidMarkdown, /> literal code {2}\n/u);
    assert.match(paidHtml, /<pre><code>paid code\n<\/code><\/pre>/u);
    assert.match(paidHtml, /paid hard break<br>\nnext paid line/u);
    assert.match(paidHtml, /literal code {2}\n/u);
  });

  test('文書間で重複するreferenceとfootnoteをnamespaceしcode literalを保持する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'frontmatter/preface.md'),
      '# はじめに\n\n' +
        '[first][shared] [shared][] [quoted][z-quoted] [metadata][zz-metadata] [^note] [^note]\n\n' +
        'x < [shared] > y\n\n' +
        'Nested [outer [shared]] remains linked.\n\n' +
        'Text [shared]: remains visible.\n\n' +
        '`[shared] [^note]`\n\n' +
        '`literal\\` [after][shared] `later`\n\n' +
        '`unclosed\n\n' +
        '[between][shared]\n\n' +
        '`later`\n\n' +
        '[broken](\n\n' +
        '[between-link][shared]\n\n' +
        ')\n\n' +
        '[broken\n\n' +
        '[between-bracket][shared]\n\n' +
        '```text\n[shared] [^note]\n```\n\n' +
        '<span data-test="1 > 0" data-label="[shared]">metadata</span>\n\n' +
        '<span\n data-label="[shared]">multiline metadata</span>\n\n' +
        '<span title="\n\n' +
        '[between-html][shared]\n\n' +
        '">\n\n' +
        '[shared]: https://first.example/reference\n' +
        '> [z-quoted]: https://first.example/quoted\n' +
        '[shared]: https://ignored.example/duplicate\n' +
        '[zz-metadata]: https://metadata.example/[shared] "title [shared]"\n' +
        '[^note]: first footnote\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/01-introduction.md'),
      '# 第1章 標準書籍フォーマットとは\n\n' +
        '[second][shared] [shared] [^note]\n\n' +
        '[inline](https://second.example/[shared])\n\n' +
        '[shared]: https://second.example/reference\n' +
        '[^note]: second footnote\n',
      'utf8'
    );

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-labels-'));
    const output = packageDirectory(result);
    const markdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const html = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');

    assert.match(markdown, /\[first\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[shared\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[quoted\]\[note-preface-free-ref-2\]/u);
    assert.match(markdown, /x < \[shared\]\[note-preface-free-ref-1\] > y/u);
    assert.match(
      markdown,
      /Nested \[outer \[shared\]\[note-preface-free-ref-1\]\] remains linked\./u
    );
    assert.match(markdown, /Text \[shared\]\[note-preface-free-ref-1\]: remains visible\./u);
    assert.match(markdown, /\[\^note-preface-free-fn-1\]/u);
    assert.match(markdown, /\[note-preface-free-ref-1\]: https:\/\/first\.example\/reference/u);
    assert.match(markdown, /> \[note-preface-free-ref-2\]: https:\/\/first\.example\/quoted/u);
    assert.match(
      markdown,
      /\[note-preface-free-ref-3\]: https:\/\/metadata\.example\/\[shared\] "title \[shared\]"/u
    );
    assert.match(markdown, /\[\^note-preface-free-fn-1\]: first footnote/u);
    assert.match(markdown, /\[second\]\[note-introduction-free-ref-1\]/u);
    assert.match(markdown, /\[shared\]\[note-introduction-free-ref-1\]/u);
    assert.match(markdown, /\[\^note-introduction-free-fn-1\]/u);
    assert.match(
      markdown,
      /\[note-introduction-free-ref-1\]: https:\/\/second\.example\/reference/u
    );
    assert.match(markdown, /\[\^note-introduction-free-fn-1\]: second footnote/u);
    assert.match(markdown, /`\[shared\] \[\^note\]`/u);
    assert.match(markdown, /`literal\\` \[after\]\[note-preface-free-ref-1\] `later`/u);
    assert.match(markdown, /\[between\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[between-link\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[between-bracket\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /```text\n\[shared\] \[\^note\]\n```/u);
    assert.match(markdown, /<span data-test="1 > 0" data-label="\[shared\]">metadata<\/span>/u);
    assert.match(markdown, /<span\n data-label="\[shared\]">multiline metadata<\/span>/u);
    assert.match(markdown, /\[between-html\]\[note-preface-free-ref-1\]/u);
    assert.match(markdown, /\[inline\]\(https:\/\/second\.example\/\[shared\]\)/u);
    assert.doesNotMatch(markdown, /^\[shared\]:/mu);
    assert.doesNotMatch(markdown, /^\[\^note\]:/mu);

    assert.match(html, /href="https:\/\/first\.example\/reference"/u);
    assert.doesNotMatch(html, /ignored\.example\/duplicate/u);
    assert.match(html, /href="https:\/\/first\.example\/quoted"/u);
    assert.match(html, /href="https:\/\/second\.example\/reference"/u);
    assert.match(html, /x &lt; <a href="https:\/\/first\.example\/reference">shared<\/a> &gt; y/u);
    assert.match(html, /id="fnref-preface-1"/u);
    assert.match(html, /id="fnref-preface-1:1"/u);
    assert.match(html, /id="fn-preface-1"/u);
    assert.match(html, /id="fnref-introduction-2"/u);
    assert.match(html, /id="fn-introduction-2"/u);
    assert.match(html, /href="#fn-preface-1"[^>]*>\[1\]<\/a>/u);
    assert.match(html, /href="#fnref-preface-1:1" class="footnote-backref"/u);
    assert.match(html, /href="#fn-introduction-2"[^>]*>\[2\]<\/a>/u);
    assert.match(html, /<ol class="footnotes-list" start="2">/u);
    assert.doesNotMatch(html, />note-(?:preface|introduction)-ref-/u);
    assert.strictEqual(new Set([...html.matchAll(/id="(fn(?:ref)?-[^"]+)"/gu)]
      .map((match) => match[1])).size, 5);
  });

  test('freeとpaid fragmentへ可視なreferenceとfootnote定義を補完する', async () => {
    const bookDirectory = await copySampleBook();
    await fs.writeFile(
      path.join(bookDirectory, 'manuscript/02-workflow.md'),
      '# 第2章 正本から出力する流れ\n\n' +
        'free [shared] [^note]\n\n' +
        ':::paid\n' +
        'paid [shared] [^note]\n' +
        ':::\n\n' +
        '[shared]: <https://shared.example/a%20b>\n' +
        '  "Shared title"\n' +
        '[shared]: https://ignored.example/duplicate\n' +
        '[z-nested]: https://shared.example/nested\n' +
        '[^note]: shared footnote with [z-nested]\n',
      'utf8'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
    });

    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-shared-defs-'));
    const output = packageDirectory(result);
    const freeMarkdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const paidMarkdown = await fs.readFile(path.join(output, '02-paid-body.md'), 'utf8');
    const freeHtml = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const paidHtml = await fs.readFile(path.join(output, '02-paid-body.html'), 'utf8');

    assert.match(freeMarkdown, /free \[shared\]\[note-workflow-free-ref-1\] \[\^note-workflow-free-fn-1\]/u);
    assert.match(freeMarkdown, /\[note-workflow-free-ref-1\]: <https:\/\/shared\.example\/a%20b>\n {2}"Shared title"/u);
    assert.match(freeMarkdown, /\[\^note-workflow-free-fn-1\]: shared footnote with \[z-nested\]\[note-workflow-free-ref-2\]/u);
    assert.match(paidMarkdown, /paid \[shared\]\[note-workflow-paid-ref-1\] \[\^note-workflow-paid-fn-1\]/u);
    assert.match(paidMarkdown, /\[note-workflow-paid-ref-1\]: <https:\/\/shared\.example\/a%20b> "Shared title"/u);
    assert.match(paidMarkdown, /\[\^note-workflow-paid-fn-1\]: shared footnote with \[z-nested\]\[note-workflow-paid-ref-2\]/u);
    assert.match(paidMarkdown, /\[note-workflow-paid-ref-2\]: <https:\/\/shared\.example\/nested>/u);
    assert.doesNotMatch(paidMarkdown, /%2520/u);
    assert.match(freeHtml, /href="https:\/\/shared\.example\/a%20b" title="Shared title"/u);
    assert.match(paidHtml, /href="https:\/\/shared\.example\/a%20b" title="Shared title"/u);
    assert.doesNotMatch(freeHtml, /ignored\.example\/duplicate/u);
    assert.doesNotMatch(paidHtml, /ignored\.example\/duplicate/u);
    assert.match(freeHtml, /id="fn-workflow-1"/u);
    assert.match(paidHtml, /id="fn-workflow-2"/u);
    assert.match(paidHtml, /href="#fn-workflow-2"[^>]*>\[2\]<\/a>/u);
    assert.match(paidHtml, /<ol class="footnotes-list" start="2">/u);
  });

  test('free fragmentから不可視なreferenceまたはfootnote定義への依存を拒否する', async () => {
    const cases = [
      {
        body: 'free [hidden]\n\n:::paid\n\n[hidden]: https://hidden.example/reference\npaid body\n\n:::\n',
        expected: /free-sample fragment reference definition is outside its visible source/
      },
      {
        body: 'free [^hidden]\n\n:::paid\n\n[^hidden]: hidden footnote\npaid body\n\n:::\n',
        expected: /free-sample fragment footnote definition is outside its visible source/
      }
    ];
    for (const [index, item] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      await fs.writeFile(
        path.join(bookDirectory, 'manuscript/02-workflow.md'),
        `# 第2章 正本から出力する流れ\n\n${item.body}`,
        'utf8'
      );
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.editions.find((edition) => edition.id === 'sample').documents.push('workflow');
      });
      await assert.rejects(
        build(bookDirectory, await temporaryDirectory(`tmp-note-hidden-def-${index}-`)),
        item.expected,
        `hidden definition case ${index} must fail closed`
      );
    }
  });

  test('生成titleは可視single-lineに制限しMarkdown punctuationをescapeする', async () => {
    const multilineBook = await copySampleBook();
    await updateMetadata(multilineBook, (metadata) => {
      metadata.structure.frontmatter[0].title = 'unsafe\n## injected';
    });
    await assert.rejects(
      build(multilineBook, await temporaryDirectory('tmp-note-title-line-')),
      /structure title preface must be a visible single-line string/
    );

    const multilineBookTitle = await copySampleBook();
    await updateMetadata(multilineBookTitle, (metadata) => {
      metadata.title = 'unsafe\n# injected';
    });
    await assert.rejects(
      build(multilineBookTitle, await temporaryDirectory('tmp-note-book-title-line-')),
      /book title must be a visible single-line string/
    );

    const escapedBook = await copySampleBook();
    await updateMetadata(escapedBook, (metadata) => {
      metadata.title = '[Book](https://book.example)';
      metadata.structure.frontmatter[0].title = '[Generated](https://title.example)';
    });
    const result = await build(escapedBook, await temporaryDirectory('tmp-note-title-escape-'));
    const output = packageDirectory(result);
    const markdown = await fs.readFile(path.join(output, '01-free-sample.md'), 'utf8');
    const html = await fs.readFile(path.join(output, '01-free-sample.html'), 'utf8');
    const checklist = await fs.readFile(path.join(output, 'publish-checklist.md'), 'utf8');

    assert.ok(markdown.includes('## \\[Generated\\]\\(https\\:\\/\\/title\\.example\\)\n'));
    assert.match(html, /<h2>\[Generated\]\(https:\/\/title\.example\)<\/h2>/u);
    assert.doesNotMatch(html, /href="https:\/\/title\.example/u);
    assert.ok(checklist.includes('「\\[Book\\]\\(https\\:\\/\\/book\\.example\\)」'));
    assert.doesNotMatch(checklist, /\[Book\]\(https:\/\/book\.example\)/u);
  });

  test('checklistのhashtagはMarkdown表示でも設定値を保持する', async () => {
    const bookDirectory = await copySampleBook();
    const hashtags = ['_draft_', '__draft__', '_', '__', 'a_b', '技術', 'ＡＩ'];
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.targets.note.hashtags = hashtags;
    });
    const result = await build(bookDirectory, await temporaryDirectory('tmp-note-hashtags-'));
    const output = packageDirectory(result);
    const checklist = await fs.readFile(path.join(output, 'publish-checklist.md'), 'utf8');
    const manifest = YAML.parse(await fs.readFile(path.join(output, 'note-publish-manifest.yaml'), 'utf8'));
    const rendered = new MarkdownIt().render(checklist);
    assert.ok(rendered.includes(`ハッシュタグを確認した: ${hashtags.map((tag) => `#${tag}`).join(' ')}`));
    assert.doesNotMatch(rendered, /<(?:em|strong)>/u);
    assert.deepStrictEqual(manifest.publication.hashtags, hashtags);
  });

  test('画像とPDFを候補としてcopyし外部・非対応画像をredacted warningにする', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-assets-');
    await fs.ensureDir(path.join(bookDirectory, 'assets/figures'));
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow.png'), 'png bytes');
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/flow#detail.png'), 'hash bytes');
    await fs.writeFile(path.join(bookDirectory, 'assets/figures/vector.svg'), '<svg></svg>');
    await fs.writeFile(path.join(bookDirectory, 'assets/guide.pdf'), '%PDF-1.4\n');
    await appendWorkflow(
      bookDirectory,
      '\n![flow](../assets/figures/flow.png)\n' +
        '![hash](../assets/figures/flow%23detail.png)\n' +
        '![vector](../assets/figures/vector.svg)\n' +
        '![external](https://assets.example/image.png)\n'
    );
    await updateMetadata(bookDirectory, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/guide.pdf'];
    });

    const result = await build(bookDirectory, outputRoot);
    const noteManifest = YAML.parse(
      await fs.readFile(
        path.join(packageDirectory(result), 'note-publish-manifest.yaml'),
        'utf8'
      ),
      { uniqueKeys: true }
    );
    assert.deepStrictEqual(noteManifest.image_candidates, [
      {
        source: 'assets/figures/flow#detail.png',
        destination: 'assets/figures/flow#detail.png',
        documents: ['manuscript/02-workflow.md']
      },
      {
        source: 'assets/figures/flow.png',
        destination: 'assets/figures/flow.png',
        documents: ['manuscript/02-workflow.md']
      }
    ]);
    assert.deepStrictEqual(noteManifest.attachment_candidates, [{
      source: 'assets/guide.pdf',
      destination: 'assets/guide.pdf'
    }]);
    assert.deepStrictEqual(
      noteManifest.warnings.filter((warning) => warning.file === 'manuscript/02-workflow.md')
        .map((warning) => warning.code),
      [
        'relative_link_requires_manual_review',
        'callout_degraded_to_blockquote',
        'callout_degraded_to_blockquote',
        'callout_degraded_to_blockquote',
        'image_requires_manual_upload',
        'image_requires_manual_upload',
        'unsupported_image_requires_manual_conversion',
        'external_or_root_image_requires_manual_upload'
      ]
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(packageDirectory(result), 'assets/figures/flow.png')),
      Buffer.from('png bytes')
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(packageDirectory(result), 'assets/figures/flow#detail.png')),
      Buffer.from('hash bytes')
    );
    assert.deepStrictEqual(
      await fs.readFile(path.join(packageDirectory(result), 'assets/guide.pdf')),
      Buffer.from('%PDF-1.4\n')
    );
    const html = await fs.readFile(path.join(packageDirectory(result), '02-paid-body.html'), 'utf8');
    assert.match(html, /src="assets\/figures\/flow\.png"/u);
    assert.match(html, /src="assets\/figures\/flow%23detail\.png"/u);
    assert.doesNotMatch(html, /src="assets\/figures\/flow#detail\.png"/u);
    assert.match(html, /\[画像を手動挿入: vector\]/u);
    assert.ok(!JSON.stringify(noteManifest).includes(bookDirectory));
  });

  test('画像・添付のroot外、symlink、過大fileをfail closedで拒否する', async (context) => {
    const outsideBook = await copySampleBook();
    await appendWorkflow(outsideBook, '\n![outside](../../outside.png)\n');
    await assert.rejects(
      build(outsideBook, await temporaryDirectory('tmp-note-outside-')),
      /must be below the declared assets directory/
    );

    const largeAttachmentBook = await copySampleBook();
    const largePath = path.join(largeAttachmentBook, 'assets/large.pdf');
    await fs.writeFile(largePath, '%PDF');
    await fs.truncate(largePath, 50 * 1024 * 1024 + 1);
    await updateMetadata(largeAttachmentBook, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/large.pdf'];
    });
    await assert.rejects(
      build(largeAttachmentBook, await temporaryDirectory('tmp-note-large-')),
      /exceeds 50MB/
    );

    if (process.platform === 'win32') {
      context.diagnostic('symbolic-link assertion is skipped on Windows');
      return;
    }
    const symlinkBook = await copySampleBook();
    await fs.writeFile(path.join(symlinkBook, 'assets/real.pdf'), '%PDF');
    await fs.symlink('real.pdf', path.join(symlinkBook, 'assets/link.pdf'));
    await updateMetadata(symlinkBook, (metadata) => {
      metadata.targets.note.attachment_candidates = ['assets/link.pdf'];
    });
    await assert.rejects(
      build(symlinkBook, await temporaryDirectory('tmp-note-symlink-')),
      /must not contain symbolic links/
    );
  });

  test('検証後にsymlinkへ差し替えられたasset rootの全componentを拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('asset-root symbolic-link race assertion is skipped on Windows');
      return;
    }
    for (const nested of [false, true]) {
      const bookDirectory = await copySampleBook();
      const outputRoot = await temporaryDirectory('tmp-note-asset-root-race-output-');
      const outside = await temporaryDirectory('tmp-note-asset-root-race-outside-');
      const outsideAssetRoot = path.join(outside, 'assets');
      await fs.ensureDir(outsideAssetRoot);
      let assetRoot = path.join(bookDirectory, 'assets');
      let swappedPath = assetRoot;
      let displacedPath = path.join(bookDirectory, 'assets.displaced');
      let symlinkTarget = outsideAssetRoot;
      let validatedFileAfterSwap = path.join(displacedPath, 'guide.pdf');
      let sourceAssets = 'assets';
      if (nested) {
        assetRoot = path.join(bookDirectory, 'content/assets');
        await fs.ensureDir(path.dirname(assetRoot));
        await fs.move(path.join(bookDirectory, 'assets'), assetRoot);
        swappedPath = path.join(bookDirectory, 'content');
        displacedPath = path.join(bookDirectory, 'content.displaced');
        symlinkTarget = outside;
        validatedFileAfterSwap = path.join(displacedPath, 'assets/guide.pdf');
        sourceAssets = 'content/assets';
      }
      await fs.writeFile(path.join(assetRoot, 'guide.pdf'), 'validated bytes');
      await fs.writeFile(path.join(outsideAssetRoot, 'guide.pdf'), 'outside bytes');
      await updateMetadata(bookDirectory, (metadata) => {
        metadata.source.assets = sourceAssets;
        metadata.targets.note.attachment_candidates = [`${sourceAssets}/guide.pdf`];
      });

      const originalLstat = fs.lstat;
      let bookRootLstatCalls = 0;
      fs.lstat = async (candidate, ...args) => {
        const result = await originalLstat(candidate, ...args);
        if (path.resolve(candidate) === bookDirectory && ++bookRootLstatCalls === 4) {
          await fs.rename(swappedPath, displacedPath);
          await fs.symlink(symlinkTarget, swappedPath, 'dir');
        }
        return result;
      };
      try {
        await assert.rejects(
          build(bookDirectory, outputRoot),
          /note asset root path must not contain symbolic links/
        );
      } finally {
        fs.lstat = originalLstat;
      }
      assert.ok(bookRootLstatCalls >= 4);
      assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'note')), false);
      assert.strictEqual(await fs.readFile(validatedFileAfterSwap, 'utf8'), 'validated bytes');
      assert.strictEqual(
        await fs.readFile(path.join(outsideAssetRoot, 'guide.pdf'), 'utf8'),
        'outside bytes'
      );
    }
  });

  test('paid対象・sample部分集合・metadata有限契約をfail closedで検証する', async () => {
    await assert.rejects(
      build(await copySampleBook(), await temporaryDirectory('tmp-note-free-'), 'free'),
      /requires a paid edition/
    );

    const missingTarget = await copySampleBook();
    await updateMetadata(missingTarget, (metadata) => delete metadata.targets.note);
    await assert.rejects(
      build(missingTarget, await temporaryDirectory('tmp-note-no-target-')),
      (error) => error instanceof AdapterBuildError && /targets\.note/.test(error.message)
    );

    const wrongSample = await copySampleBook();
    await updateMetadata(wrongSample, (metadata) => {
      metadata.targets.note.free_sample_edition = 'internal';
    });
    await assert.rejects(
      build(wrongSample, await temporaryDirectory('tmp-note-wrong-sample-')),
      /distinct free or sample/
    );

    const notSubset = await copySampleBook();
    await updateMetadata(notSubset, (metadata) => {
      metadata.editions.find((edition) => edition.id === 'paid').documents =
        metadata.editions.find((edition) => edition.id === 'paid').documents
          .filter((documentId) => documentId !== 'preface');
    });
    await assert.rejects(
      build(notSubset, await temporaryDirectory('tmp-note-not-subset-')),
      /Free-sample documents must be included in the paid edition: preface/
    );
  });

  test('schemaはnote slug、price、hashtag、添付pathをfail closedで検証する', async () => {
    const cases = [
      [(metadata) => { metadata.targets.note.slug = 'Invalid_Slug'; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.price = 99; }, /must be >= 100/],
      [(metadata) => { metadata.targets.note.price = 50001; }, /must be <= 50000/],
      [(metadata) => { metadata.targets.note.hashtags = []; }, /must NOT have fewer than 1 items/],
      [(metadata) => { metadata.targets.note.hashtags = ['invalid-tag']; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.hashtags = ['a'.repeat(31)]; }, /must NOT have more than 30 characters/],
      [(metadata) => { metadata.targets.note.attachment_candidates = ['../book.pdf']; }, /must match pattern/],
      [(metadata) => { metadata.targets.note.attachment_candidates = ['assets/not-pdf.txt']; }, /must match pattern/]
    ];
    for (const [index, [mutate, expected]] of cases.entries()) {
      const bookDirectory = await copySampleBook();
      await updateMetadata(bookDirectory, mutate);
      await assert.rejects(
        build(bookDirectory, await temporaryDirectory(`tmp-note-schema-${index}-`)),
        expected
      );
    }
  });

  test('dry-runはpackageを書かずunknown ownerを置換しない', async () => {
    const bookDirectory = await copySampleBook();
    const outputRoot = await temporaryDirectory('tmp-note-dry-');
    const dry = await build(bookDirectory, outputRoot, 'paid', true);
    assert.strictEqual(dry.written, false);
    assert.strictEqual(await fs.pathExists(dry.outputDirectory), false);
    assert.strictEqual(dry.manifest.adapter.implementation, 'note-v1');

    await fs.ensureDir(dry.outputDirectory);
    await fs.writeFile(path.join(dry.outputDirectory, 'unrelated.txt'), 'keep\n');
    await assert.rejects(build(bookDirectory, outputRoot), /valid adapter manifest/);
    assert.strictEqual(
      await fs.readFile(path.join(dry.outputDirectory, 'unrelated.txt'), 'utf8'),
      'keep\n'
    );
  });

  test('可視性検査後に変更されたsourceを出力前に拒否する', async (context) => {
    if (process.platform === 'win32') {
      context.diagnostic('source race assertion is skipped on Windows');
      return;
    }
    const bookDirectory = await copySampleBook();
    const sourcePath = path.join(bookDirectory, 'manuscript/02-workflow.md');
    const outputRoot = await temporaryDirectory('tmp-note-source-race-');
    const originalReadFile = fs.readFile;
    let changed = false;
    fs.readFile = async (candidate, ...args) => {
      const contents = await originalReadFile(candidate, ...args);
      if (!changed && path.resolve(candidate) === sourcePath) {
        changed = true;
        await fs.writeFile(sourcePath, '# changed\n\npaid replacement\n');
      }
      return contents;
    };
    try {
      await assert.rejects(
        build(bookDirectory, outputRoot),
        /(?:changed after visibility validation|Visibility reports disagree on source digest)/
      );
    } finally {
      fs.readFile = originalReadFile;
    }
    assert.strictEqual(changed, true);
    assert.strictEqual(await fs.pathExists(path.join(outputRoot, 'note')), false);
  });
});
