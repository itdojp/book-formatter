// Fixed, reviewed fixture configuration ONLY. Never load a book/user config.
export default {
  title: 'Synthetic EPUB evaluation — not for distribution',
  author: 'Synthetic Publisher',
  language: 'ja',
  entryContext: '/input',
  entry: [{ path: 'chapter.md', title: 'Synthetic EPUB evaluation' }],
  toc: { title: 'Table of Contents', htmlPath: 'toc.html' },
  // The default pandoc mode emits deprecated doc-endnote roles. Use the
  // existing dpub mode, preserving real Markdown footnotes and backlinks.
  vfm: { footnote: 'dpub' },
  output: [{ path: '/output/book.epub', format: 'epub' }],
  workspaceDir: '/output/workspace',
  copyAsset: { includes: [] },
  css: { postcss: { plugins: [] } },
  viteConfigFile: false
};
