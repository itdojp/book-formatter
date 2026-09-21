# CodeQL alerts 1–3: DOM rendering and layout diagnostics

Reviewed baseline: `3939be36bb8ab950445217727c69fd429a004374` (2026-09-21).
Tracking: [Issue #160](https://github.com/itdojp/book-formatter/issues/160).
This is a formatter-source audit, not a consumer rollout or a claim that all
possible security findings have been eliminated.

## DOM text must not become HTML

- Alert 2: `shared/assets/js/search.js` indexes current-page headings and
  paragraphs using `textContent`. Those values can legitimately contain literal
  markup examples. The old highlighter inserted unescaped strings into
  `innerHTML`, turning displayed examples back into elements. Results and empty
  states now use `createElement`/text nodes; only formatter-created `mark` nodes
  supply highlight markup. Queries are regex-escaped literals. Search remains
  page-local, with no URL/index-fetch feature added.
- Alert 3: `shared/assets/js/main.js` previously interpolated an existing image's
  `src` and `alt` into an HTML string. The modal now assigns them to a newly
  created image's properties. Quotes stay in attribute values; they cannot
  introduce attributes/elements. The existing resource is preserved, including
  local, HTTP(S), data and blob images; this is not a URL sanitizer or a new
  promise about fetching untrusted resources. Button/backdrop/Escape closure
  remains unchanged.

`tests/SharedDomSafety.test.js` executes the shipped scripts with a bounded DOM
adapter that rejects dynamic HTML assignment. It checks literal markup,
metacharacter and Japanese queries, case-insensitive highlights, ten-result
limits, replacement, click/dismissal and modal attribute boundaries. The adapter
is not an HTML parser or proof of arbitrary browser behavior. All fixtures are
inert and local; no external target or executable payload is needed.

## Alert 1: metric-only false-positive boundary

Rule: `js/incomplete-multi-character-sanitization`, at the tag-removal expression
in `scripts/check-layout-risk.js`. The expression is **not an HTML sanitizer**.
It intentionally implements a best-effort visible-length heuristic, alongside
Markdown label and autolink handling. Changing it into repeated sanitization or
adding a sanitizer would change measurement semantics without fixing a sink.

Complete in-repository data flow at the reviewed baseline:

1. The file-local `stripNonVisibleMarkdown` has one call in `scanFile`.
2. The string feeds `maxAsciiNonWhitespaceRun` (numeric threshold/summary).
3. For an overlong line only, `clampSnippet` stores a diagnostic string in
   `issue.meta.snippet`.
4. `printSummary` sends the snippet to terminal stdout with Chalk. the CLI action
   serializes the report with `fs.writeJson`. Neither renders HTML.
5. `templates/.github/workflows/book-qa.yml` uploads that JSON as an artifact;
   it does not insert the value into a website. README documents the JSON CLI.
   No other tracked consumer or HTML sink was found by repository-wide search.

The layout regression exercises the real CLI, checks numeric length, exact
terminal/JSON snippet, successful JSON round trip and the output-file inventory.
It deliberately does **not** assert that angle brackets disappear. This supports
an individual **false positive** disposition of alert 1; it does not suppress
this CodeQL query, relax CI, or claim that the string is safe HTML. An external
consumer must still encode such diagnostics if it chooses to render them.
Re-audit this disposition if a dashboard/HTML consumer is introduced.

## Completion evidence

Exact reviewed/merge SHAs, CI/CodeQL analysis IDs, regression counts and the
per-alert disposition belong in Issue #160 and its implementation PR. Check
open CodeQL findings separately from analysis execution status and npm audit:
none of those three results implies either of the others.
