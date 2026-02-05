# Troubleshooting: Pages builds, workflows, and navigation

This guide documents common pitfalls and fixes when rolling out book-formatter v3 across book repositories.

## GitHub Actions: Workflow overwrite/merge issues
- Symptom: A PR adding `.github/workflows/nav-link-check.yml` conflicts with an existing file, or overwrites customizations.
- Cause: An older workflow exists or a downstream repo added local changes.
- Fix/Guidance:
  - Prefer creating a PR only when the content differs from the canonical template.
  - In PRs, keep local customizations if they are intentional; otherwise replace with the canonical template.
  - If you need per-repo tweaks, document them inline and add owners via `CODEOWNERS`.
  - Scripts now avoid absolute paths and compare templates before proposing changes.

## GitHub Pages build failures (YAML)
- Symptom: Pages fails with YAML parse errors or navigation missing.
- Known cases and fixes:
  - `syntax_highlighter: rougepermalink: pretty` → Merge artifact; split into separate lines. Ensure `permalink: pretty` exists at top-level.
  - Plugin bullets under `kramdown` or random sections → Move to a top-level `plugins:` block:
    - `- jekyll-relative-links`
    - `- jekyll-optional-front-matter`
  - Conflicting or duplicate `permalink:` entries → Keep a single `permalink: pretty` at top-level.

## Bottom navigation: no nav on top page
- Symptom: “前へ/次へ” shows on the top page, or links point to `/` instead of `/<repo>/` on project Pages.
- Fix:
  - The canonical include detects the top page by stripping `site.baseurl` and suppresses bottom navigation on root.
  - Avoid `permalink: /` on `docs/index.md` for project Pages. Let Jekyll emit top at `/<repo>/`.

## Link checks and flakiness
- Symptom: Scheduled Nav + Pages Link Check fails intermittently.
- Guidance:
  - Re-run the workflow. The job tolerates YAML parsing differences for `baseurl` and builds paths from `_data/navigation.yml` when present.
  - For heavy repo sets, API rate limits may cause failures; stagger runs or reduce frequency.

## Book QA workflow (unicode + internal links + textlint)
- Symptom: `book-qa` fails on unicode warnings (e.g. invisible chars, compatibility ideographs, U+2212).
- Guidance:
  - Prefer fixing the source (replace confusable characters with ASCII, remove invisible chars).
  - If a character is intentional (math notation, domain-specific symbols), add an allowlist file:
    - `.book-formatter/unicode-allowlist.json` (recommended) or `unicode-allowlist.json` at repo root
  - The checker auto-detects these files when running `check-unicode`.

- Symptom: `book-qa` shows textlint(PRH) suggestions in logs.
- Guidance:
  - Add a book-local PRH dictionary to tune corrections:
    - `.book-formatter/prh.yml` (recommended) or `prh.yml` at repo root
  - The workflow template runs textlint as non-blocking by default. If you want to gate on findings, run `check-textlint` with `--fail-on warn|error`.

## Redirects and legacy slugs
- Symptom: Old URLs 404 after restructuring chapters.
- Fix:
  - Add `redirect_from:` to moved pages, or create minimal stub pages under the old path to preserve inbound links.
