# Dependency audit recovery — 2026-10-08

Refs #181 and #182. Audit thresholds and existing formatter contracts are unchanged.
On 2026-10-08 the operator explicitly authorized review of a **book-QA-only**
replacement proposal, after the general nested CLI compatibility proposal was
rejected. This document defines that narrower boundary; it is not a universal
compatibility or security guarantee.

## Supported root path: PRH and textlint

A scoped `prh → js-yaml → argparse: 2.0.1` override removes the unpatched
sprintf-js dependency (GHSA-hp3w-g68c-fv3c). PRH5.4.4 and YAML3.15.2 are unchanged:
YAML parsing/schema, dictionary imports, replacement positions and fixes remain
the supported contract. Both installed textlint-rule-prh6.1.0 and the nested
5.3.0 caller use these APIs, not the YAML CLI. PRH's own CLI uses commandpost;
its version and dictionary operations are checked separately.

## Explicitly unsupported: the dependency-internal js-yaml CLI

Calling the nested `js-yaml/bin/js-yaml.js` is not a supported formatter command.
The argparse2 replacement has known differences from argparse1:

| Direct nested CLI operation | Observed change |
| --- | --- |
| `--version` / `-v` | Exit0, but the old version output is absent. |
| Unknown option | Exit2 remains; usage moves from stdout to stderr. |
| Normal conversion | Same bounded JSON output; deprecated aliases warn on stderr. |
| `--throw-deprecation` | The nested CLI fails; this strict-warning path is unsupported. |

Tests retain these observations as explicit limitations; they do not relabel
this CLI as compatible. No `NODE_NO_WARNINGS`, audit exemption, or skipped
existing product test is used. Consumers relying on this internal CLI must not
assume compatibility or automatically adopt this revision. Re-audit PRH,
YAML schema and this override on dependency upgrades; remove the override only
when a reviewed upstream closure removes the vulnerable dependency.

## Isolated publication closure

Official source-map-js1.2.2 remains within PostCSS's existing range. Tests use
the real PostCSS caller, valid small maps, and rejection of invalid/oversized
indexed offsets without serializing oversized maps. The license inventory and
synthetic EPUB lock digest are regenerated. Existing offline, actual artifact,
CI and review gates still apply. This does not enable production PDF/EPUB
publishing or automatically update downstream books.
