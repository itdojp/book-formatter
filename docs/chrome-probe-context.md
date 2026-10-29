# Chrome discovery context (Issue #197)

Audience: maintainers diagnosing native-browser CI failures. This is bounded
evidence collection, not a repair of the intermittent timeout or a substitute
for a real browser. See [Issue #197](https://github.com/itdojp/book-formatter/issues/197).

## Unchanged gate

`tests/shared-browser-discovery.js` still tries `google-chrome`,
`google-chrome-stable`, `chromium`, then `chromium-browser`, stopping at the
first successful `--version` invocation. Each original invocation retains its
3,000 ms timeout and failure classification. An explicit `CHROME_PATH` still
has no fallback. Missing Chrome never becomes a synthetic browser success.
No workflow, retry, browser pin, dependency, audit or native assertion changes.
Candidate names are defined once in `shared-browser-context.js` and re-exported
by discovery, preserving its existing public API without a circular import.

## Additive context

After timing each original probe, one Node child may inspect metadata. It does
not execute another browser, read executable contents or retry discovery. Its
timeout is 1,000 ms, output buffer limit 4,096 bytes, timeout signal `SIGKILL`.
These are child-process limits, not a guaranteed OS-level wall-clock deadline.
The extra process can affect warming/scheduling and adds latency; `elapsedMs`
continues to measure **only** the original browser invocation, not inspection.

The child returns schema version 1 with:

- Runtime: finite OS/architecture identifiers, numeric Node version, recognized
  `ImageOS` (`ubuntu20/22/24/26`) and `ImageVersion` (date/build numeric shape).
  Unknown identity values become `null`, never an arbitrary environment dump.
- Linux lookup: first executable file in PATH order, after the probe, inspecting
  at most 64 entries and 16,384 PATH characters. Empty and relative entries are
  considered, but their values are not emitted. Unset PATH uses `/usr/bin:/bin`.
- Only pairs of executable and resolved paths in `PUBLIC_CHROME_PATHS` are
  emitted, with file size. The finite list lives in
  `tests/shared-browser-context.js`. A non-public first match stays redacted;
  it does not fall through to report a different public candidate.

The parent checks the exact schema and allowlists before including `context`
in the existing JSON diagnostic. Raw child stdout/stderr, filesystem errors,
PATH, arbitrary runner names and overrides are never forwarded by this new
collector. Original browser stdout/stderr retain their existing 1,024-character
limits; this change does not claim to sanitize arbitrary browser output.
Explicit `CHROME_PATH` uses `override-redacted` and starts no inspector.

`context.status` is `observed`, `override-redacted`, `inspection-failed` or
`invalid-context`. An observed lookup reports `resolved`, `redacted`,
`not-found`, `inspection-limit`, `unavailable` or `unsupported-platform`.
Non-Linux hosts retain the native gate and runtime fields, without PATH
inspection. Metadata failure is not Chrome success or Chrome failure.

## Interpretation and limits

A resolved record is a **post-probe lookup observation**, not proof of the
executed inode. Files/PATH may change, wrappers may delegate, and OS lookup
details may differ. Size is metadata, not a binary hash or authenticity check.
Do not infer load, bootstrap, installation or Node defects from this record
alone. A successful rerun does not prove a permanent repair.

For a recurrence retain exact commit, workflow run/attempt, native suite,
original status/signal/error code/elapsed time and this bounded context.
Correlate with the runner's public image record. Report missing/redacted
evidence as such. Only propose a separate minimal causal fix after reproducing
a defect; do not broaden timeout/retries or weaken any audit/native gate.

## Finite verification

`tests/SharedBrowserDiscovery.test.js` uses in-memory filesystem/process
fixtures for path order, public/private paths, symlinks, unsupported platforms,
identity/schema rejection, lookup limits and child failures. Existing probe
order, stop-at-success, explicit override and failure tests remain required.
Native DOM/sidebar/header/search gates exercise the collector with a real
browser. Fixture tests are not a reproduction of the historical CI timeout.
