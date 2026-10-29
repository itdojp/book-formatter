# Root audit repair and isolated publication hold (2026-10-30)

## Scope and decision

PR #204 originally adds bounded Chrome-probe diagnostics for [#197](https://github.com/itdojp/book-formatter/issues/197).
The user subsequently authorized necessary CI repairs and normal merge of **only
PR #204**, subject to the existing checks. This extension repairs the root audit;
it does not waive the isolated publication gate or close [#201](https://github.com/itdojp/book-formatter/issues/201).
The diagnostic timeout, candidate order, failure behavior and redaction are
unchanged. No workflow, audit threshold, isolated lock, consumer pin or repository
setting changes are included.

## Root changes and official sources

Only two root lock entries change, within their existing callers' dependency
ranges; there is no new override or major-version downgrade:

| Package | Previous | Selected | Actual root callers |
| --- | --- | --- | --- |
| fast-uri | 3.1.8 | 3.1.9 | Ajv |
| zod | 4.4.3 | 4.6.7 | textlint and its MCP core/server dependencies |

The official advisory ranges identify fast-uri 3.1.9 as the patched 3.x release:
[encoded scheme](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[relative path](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
[host canonicalization](https://github.com/advisories/GHSA-wjr9-j795-jxcr), and
[suffix reference](https://github.com/advisories/GHSA-333x-w4r6-6crp).
The [Zod constrained-collection advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
identifies 4.6.6 as the first patched release; the selected 4.6.7 contains the
leading size checks. Both selected npm tarballs were verified against the
registry SHA-512 SRI and the lock entries. Their MIT license metadata and funding
entries are unchanged. The upstream source changes were inspected, including
scheme/host/relative normalization and array/set/map size checks before element
parsing; this is not a full third-party-code audit.

`tests/AuditDependencyCompatibility.test.js` resolves dependencies from the real
callers rather than assuming a top-level package is used. Six bounded tests cover
exact versions, normal and ambiguous URI references, malformed schemes/hosts,
and array/set/map rejection before refinement. Three short strings with max(2)
exercise the rejection, while two strings retain normal behavior. All six tests
fail against the previous installed lock (negative control). They start no MCP
listener, browser, server or network request and use no large DoS workload.
The root test suite retains the existing textlint/MCP registration, schema,
publication, Markdown and compatibility checks.

## Residual isolated blocker (not a root success claim)

At this checkpoint, a fresh install of the **unchanged** isolated lock succeeds
but its full audit reports critical 2, high 4, moderate 2 (affected-package
counts, not unique advisory counts). The root lock repair does not repair that
tree. Known DOMPurify, ip-address, fast-uri, undici and Zod dependency paths remain
tracked in #201 and existing PRs. Do not use `audit fix --force`, suppress an audit,
or merge another PR under PR #204's authorization.

The official latest chromium-bidi 159.0.8131-0 tarball was also checked on
2026-10-30. Its SRI is valid and its mapper bundle SHA-256 is
`e50d00486530e0b9520f68855ecd3a77ff40b85cef7767aefb77f3fedebff5fa`.
This hash differs from the previous inspected release, but the bundle still
contains Zod 4.6.5 without the leading size cap. A bounded parser-only VM probe,
stopped before mapper startup with a three-second timeout and no I/O, rejects
three short strings at max(2) only after all three refinements run. This establishes
an uncorrected bundled behavior, **not exploit reachability through current CDP**.
Updating an external Zod package does not replace that embedded copy.

The latest Puppeteer-core 25.16.0 pins chromium-bidi 157.0.8090-0; Vivliostyle CLI
11.4.0 still pins Puppeteer-core 25.10.0. Neither metadata alone nor a newer
external dependency proves that the bundled prerequisite is satisfied. A corrected
official distribution (or a separately reviewed compatible alternative) and full
isolated audit/publication validation remain necessary before merge. This PR
must stay Draft/unmerged if those gates remain red.

## Verification record

Re-run fresh install and `npm audit --audit-level=moderate`, the full root suite,
lint/build/Actions checks, native DOM/sidebar/header/search suites and exact-head
GitHub checks. Record results and review IDs in PR #204 rather than treating this
dated audit as a promise of future audit success. Keep failed original audits as
evidence. CodeQL execution success is not a claim that the alert inventory is
empty. Synthetic publication checks do not authorize real-book distribution.
