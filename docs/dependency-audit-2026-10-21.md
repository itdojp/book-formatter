# Dependency audit recovery after PR #191

Checked: 2026-10-21 JST. Tracking: [#194](https://github.com/itdojp/book-formatter/issues/194).
This is a dependency/compatibility record, not an assertion of complete security
or permission to update consumer pins.

## Observation and selection

The reviewed sidebar tree and merged main `1083eeb9a706faffb8f14edd17aa90c2b3a5babb`
are identical. Fresh installs reproduce the main CI failures: root high2;
isolated publication high1/moderate1. These are affected-package counts, not
independent advisory counts. Earlier audit0 results do not carry forward.

| Closure | Change | Reason / boundary |
| --- | --- | --- |
| Root Markdown parser | markdown-it14.3.2 →14.3.3 | Existing `^14.1.0` range; fixes [multiline reference](https://github.com/advisories/GHSA-gfr2-rv44-r23c) and [inline HTML](https://github.com/advisories/GHSA-vfgh-jcmw-g37q) parsing issues. No major upgrade |
| Root textlint dependency | MCP server/core2.0.0 →2.3.1 | Existing textlint `^2.0.0` range; 2.3.0 is the patched server baseline, [2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1) is the available follow-up. No new root override |
| Isolated CLI dependency | Vite8.1.0 →8.1.6 | CLI-scoped exact override; [8.1.6](https://github.com/vitejs/vite/releases/tag/v8.1.6) bundles launch-editor2.14.2. CLI11.3.3 remains fixed; latest11.4.0 still declares Vite8.1.0 at inspection |
| Isolated Vite dependency | nested picomatch4.0.7 | Satisfies Vite's `^4.0.5`; the CLI's separate exact4.0.4 remains unchanged |

MCP advisories: [request/session isolation](https://github.com/advisories/GHSA-jm63-cq47-j5jp),
[validation resource limits](https://github.com/advisories/GHSA-46jr-4wx8-v453),
[token audience](https://github.com/advisories/GHSA-rvq5-wwqv-78pq).
The latter requires appropriate application configuration; changing a dependency
is not a proof of HTTP bearer authentication safety. Formatter QA does not start
an MCP HTTP server. Textlint imports its MCP modules even for ordinary CLI use;
we retain import/registration compatibility rather than deleting that path.

Vite-bundled editor advisories: [percent handling](https://github.com/advisories/GHSA-698v-4r3x-3vcv),
[editor argument interpretation](https://github.com/advisories/GHSA-r825-w8mm-5pxw),
[Windows path check](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
A launch-editor-only override cannot replace code already bundled into Vite.
No `audit fix --force`, renderer downgrade, audit exclusion, or threshold change.

The root lock changes three package versions. The isolated lock changes Vite and
adds its nested picomatch; all other installed versions are retained. The five
selected tarballs' SHA-512 bytes were checked against lock SRI. MCP server/core
package metadata now identifies Apache-2.0 rather than the old lock's MIT.
The shipped LICENSE describes a transition: contributions without relicensing
consent remain MIT, and non-specification documentation is CC-BY-4.0. Preserve
the actual license/notice text; metadata alone is not a complete inventory.
This record is not a legal or redistribution approval. The isolated
license inventory and EPUB lock digest are regenerated; golden outputs, image,
Node, EPUBCheck and renderer versions are not changed.

## Bounded verification

- Fresh root and isolated `npm ci --ignore-scripts` and full audits; record the
  execution-time result in #194/its PR rather than assuming future audit0.
- Root tests include exact MCP lock versions, the actual textlint module's two
  independent unconnected server registrations and close, and retained CLI/PRH
  diagnostics. No HTTP/stdio transport is opened; no credentials are used.
- Three short Markdown cases fix expected multiline-reference and inline-HTML
  output. Separate old/new comparison covers nine short synthetic inputs with
  both HTML modes (18 byte-identical outputs); existing visibility, link,
  footnote, Note/Zenn/mdBook and textlint callers remain in the full root suite.
  This is not a large denial-of-service workload or arbitrary Markdown proof.
- Offline publication checks inspect CLI-resolved Vite8.1.6 and evaluate only its
  pinned, pure Windows command-string helper. Benign normal/spaced names are
  preserved; percent and line-break inputs are rejected. UNC-before-existence
  and absolute filename checks are source assertions, **not Windows editor
  execution tests**. Nothing launches an editor or executes a produced command.
- A local old/new probe invokes the fixed CLI's actual `resolveViteConfig` for
  build/preview with synthetic options, `configFile:false`, `envFile:false`,
  and no server/browser startup. Selected config results are identical.
- Vite import needs Rolldown's native addon. A diagnostic import under the
  existing no-addon Node permission gate was correctly denied. The gate is not
  weakened: bundle/closure probes run offline; native build compatibility is
  required separately in the existing containerized **two synthetic EPUB** CI
  gate, including EPUBCheck and equivalence. The local config probe is not
  claimed to run under the no-addon gate.

The inherited QA-only argparse override and its internal CLI support limits are
unchanged. Deprecation warnings are not suppressed. Synthetic EPUB evidence is
not real-book PDF/EPUB distribution approval; that remains [#152](https://github.com/itdojp/book-formatter/issues/152).
No sidebar/assets, workflows, consumer content/pins, or repository settings are
changed. Re-audit this record and the pinned internal probes when either caller
or dependency changes.
