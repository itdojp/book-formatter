# Isolated publication dependency recovery after PR #198

Checked: 2026-10-23 JST. Tracking: [#199](https://github.com/itdojp/book-formatter/issues/199).
This is a bounded dependency/compatibility record, not a general security or
real-book distribution approval. No consumer pin is changed.

## Observation and exact change

User-merged PR198 main `44444af46a3e213c7d2b4c25183f79f5cc8d88cf` is tree-identical
to reviewed `99667723788ce36630fb595c4fa46887173b54e4`. Publication run
[39875022157](https://github.com/itdojp/book-formatter/actions/runs/39875022157)
fails the isolated audit; rendering is skipped. Fresh root audit is zero.
The isolated report counts critical2/moderate1/high0 affected packages, not two
independent critical advisories. Earlier audit0 results cannot be reused.

| Dependency | Selection | Reason / limit |
| --- | --- | --- |
| CLI → DOMPurify | 3.4.16 → 3.4.17, existing CLI-scoped override | Three upstream advisories identify 3.4.17 as patched. CLI11.3.3 and latest11.4.0 still declare3.4.13; a CLI upgrade is not needed for this fix |
| CLI → arborist → registry-fetch → make-fetch-happen → npm agent → socks-proxy-agent → socks → ip-address | 10.7.2 → 10.7.4, lock-only | Fits socks2.8.10's existing `^10.1.1`; no additional override |

The lock changes exactly these two package entries. Root dependencies, CLI,
Node, image/EPUBCheck, five VFM golden fixtures, audit threshold and isolation
settings are unchanged. The license inventory and EPUB lock SHA attestation
are regenerated. Both old and new tarball bytes match their published/locked
SHA-512 SRI. DOMPurify retains `(MPL-2.0 OR Apache-2.0)` and both license files;
ip-address retains MIT and identical LICENSE text. This is not a complete
redistribution approval.

## Primary advisories and actual use

- [DOMPurify shadow-root template handling](https://github.com/advisories/GHSA-cg2g-xh64-v4q7): critical, affects3.4.4–3.4.16 with `SAFE_FOR_TEMPLATES` and DOM-return modes.
- [DOMPurify detached parent/sibling hooks](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr): high, affects≤3.4.16 with `IN_PLACE` mutation hooks.
- [DOMPurify XHTML attributeName handling](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f): low, affects≤3.4.16 with non-default XHTML/SMIL settings.
- [ip-address zone scan](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5): moderate, affects≤10.7.3; indexed zone extraction replaces the repeatedly attempted zone regex before the address-length guard.

The inspected fixed CLI11.3.3 `server-96BNRrbl.js` creates DOMPurify with its
JSDOM window and sanitizes heading `innerHTML` with default string options.
This caller inspection does not establish reachability of the three non-default
DOM modes in published books, or assert a site compromise. The direct dependency
regressions below are retained even though those modes are not used by this
heading call. Re-audit the pinned caller guard when upgrading the CLI.

The real socks helper uses `net.isIPv6` before `Address6` conversion and uses
`Address6.fromByteArray` for received address bytes. The tests invoke its pure
conversion helpers, not a proxy connection. No statement is made that a remote
request can reach the advisory through this particular caller.

## Verification and limits

Six new mandatory offline tests bring31 to37 (skip0), plus6 wrapper tests:

- CLI-resolved DOMPurify version/caller guards and four benign heading strings;
  this is not execution of the CLI file loader. The existing six ordinary
  sanitation cases and five frozen VFM goldens are retained.
- Five hooks × parent/later-sibling removal: ten inert empty-event-attribute
  cases fail the intended removal assertion on3.4.16 and pass on3.4.17.
  No event dispatch, loaded resource or executable handler is supplied.
- Attached open shadow root, split literal template delimiters, `IN_PLACE`:
 3.4.16 leaves the literal assembled expression,3.4.17 removes it. No template
  engine evaluates the result; other DOM-return modes are not claimed tested.
- XHTML/HTML SMIL guard with local fragments only: retain the allowed element
  and benign values, remove the href-changing attribute. The XHTML assertion
  fails on3.4.16 and passes on3.4.17; no script URL or browser animation runs.
- Actual socks resolution/range/license and pure IPv4/IPv6 conversion,
  documentation addresses, scope/CIDR handling and malformed input.
- Four short malformed zone suffixes retain rejection; source assertions bind
  the patched index/slice implementation. This is not a complexity benchmark:
  no oversized denial-of-service input is executed on either version.

A separate old/new API comparison preserves ten ordinary sanitation outputs
and nine short IPv6 parse/error outcomes exactly. This finite corpus is not
arbitrary HTML or address equivalence.

Existing confinement requires a separate network namespace, no external
interface, no write/child-process permission and no outside read; it is not
relaxed to accommodate these tests. Installation/audit registry traffic is a
separate phase from offline tests. No real book, credentials or customer data
is used. General native/browser behavior is covered only to the extent of the
existing two synthetic EPUB CI runs with EPUBCheck and structural equivalence.
No new PDF renderer or real-book PDF acceptance is claimed; [#152](https://github.com/itdojp/book-formatter/issues/152)
continues to own those requirements.

Record exact-head full tests, fresh audits, CI and review state in #199/its PR;
this document does not claim that any future run is already green. Normal merge
and actual-main revalidation precede consumer adoption. Icon/layout, Chrome
probe diagnosis, workflows and repository settings are outside this change.
