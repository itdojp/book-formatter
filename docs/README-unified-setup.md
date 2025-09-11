# Book Formatter: Unified Setup Guide

This guide describes the canonical structure for new book repos:

- Use `templates/_config.yml` as the starting point (permalink: pretty, plugins, kramdown).
- Copy `docs/includes/page-navigation.html` as `docs/_includes/page-navigation.html`.
- Top page (root) does NOT render prev/next navigation; chapters and appendices do.
- Prefer directory-style links (e.g., `/src/chapter-1/`) instead of `index.html`.
- Use `jekyll-redirect-from` (optional) to map old slugs when renaming chapters.

## Steps
1. Create repo with `docs/` root.
2. Place `_config.yml` from `templates/_config.yml` (customize `title`, `baseurl`, `repository`).
3. Add `docs/_includes/page-navigation.html` from `docs/includes/page-navigation.html`.
4. Ensure `defaults.layout: book` and `permalink: pretty`.
5. For renamed pages, use redirect-from in the destination page:

```yaml
redirect_from:
  - /src/chapter-old/
```

