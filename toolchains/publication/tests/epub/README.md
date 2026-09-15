# Synthetic EPUB artifact gate

[#158](https://github.com/itdojp/book-formatter/issues/158) is the first actual-artifact experiment under [#152](https://github.com/itdojp/book-formatter/issues/152). It is **not** a book-input API, a production renderer, a KDP/BOOTH upload path, or a distribution approval. Root `PrintPublicationPlan`/BOOTH adapters still report `generated: false`. No book manuscript is accepted here.

## Frozen input and output

`pins.json` binds the reviewed fixture bytes, existing isolated npm lock, linux/amd64 Node image digest, Java image digest and EPUBCheck release checksum. Only `chapter.md` and the static `vivliostyle.config.mjs` are copied into the input mount. `not-selected.md` has synthetic paid/internal canaries; it is neither copied nor mounted. The repository, book sources, operator home, credentials, container socket and arbitrary user config are not mounted. The dependency `node_modules` and reviewed bootstrap are mounted separately, read-only.

This finite selection is **not proof of general edition/asset projection**. Same-owner concurrent mutation of the trusted checkout/dependencies/state is unsupported: install and execute serially in an exclusively owned checkout. Hash rechecks detect ordinary drift, not an atomic snapshot against a hostile same-UID process.

The one synthetic chapter includes Japanese/English text, a table, ordered list, Markdown footnote and backlink, language/author/title, version and explicit non-distribution/rights limitation. A real generated TOC is required. There is no cover image, embedded font, PDF, real citation or commercial publication in this fixture.

### Footnote decision

The first real EPUBCheck5.3.0 run failed `--failonwarnings` with RSC-017: the default VFM `pandoc` mode emits `role="doc-endnote"`, deprecated by [DPUB-ARIA1.1](https://www.w3.org/TR/dpub-aria-1.1/#doc-endnote). The fixed config now selects the existing VFM2.7.2 `vfm.footnote: 'dpub'` mode, generating `doc-footnote`, `doc-noteref` and `doc-backlink`. No dependency patch, warning suppression, manual ZIP edit, or removal of the footnote test is used. Generic publication profiles must make their own explicit footnote choice; this does not change their defaults.

## Preparation versus execution

Prerequisites: Linux x86_64, a non-root operator, Python3, curl, the installed isolated Node24.18.0 npm closure, and an available container runtime. Install with `npm ci --ignore-scripts`; run the existing audit/offline gates first.

```bash
# From the repository root. Choose a NEW, short path inside your authorized
# workspace; do not reuse another task's directory or /tmp.
python3 toolchains/publication/tests/epub/run.py prepare "$PWD/tmp-epub"
python3 toolchains/publication/tests/epub/run.py run "$PWD/tmp-epub"
```

Default mode is rootless Podman with a **dedicated** home/cache/storage/runroot. Its runroot is limited to 50 characters; if the checkout path is long, choose a shorter owned path within the encompassing workspace. `prepare` refuses an existing directory; `run` refuses an existing execution directory, fixture/pin/checker drift or mismatched runtime. No implicit cleanup/retry/fallback is performed.

CI explicitly sets `EPUB_GATE_ENGINE=docker` on a dedicated Ubuntu22.04 runner. This trusts the existing Docker daemon as infrastructure; it is **not a rootless-daemon claim**. Containers still run as the non-root operator UID with no capabilities. Docker mode never starts/configures a daemon or mounts its socket. An unavailable runtime or unsupported isolation environment fails rather than silently switching engines. A shared operator machine should use the default dedicated Podman store, not CI's Docker mode.

Preparation alone downloads fixed OCI manifests and the [EPUBCheck5.3.0 release](https://github.com/w3c/epubcheck/releases/tag/v5.3.0), verifies its GitHub-published SHA256, and records its extracted inventory. A SHA digest establishes content identity, not an independent signature or vulnerability attestation.

Execution uses `--pull=never`, `--network=none`, a read-only root, read-only input/dependency mounts, one owned writable output and bounded `/work` tmpfs. There is no default writable `/tmp`. Caps are dropped, no-new-privileges is set, and CPU1/memory1GiB/PID128/wall-time limits are requested. Actual Node probes verify effective UID/capabilities/NoNewPrivs, loopback-only interfaces, read-only mounts **and cgroup-v2 memory/CPU/PID limits** before rendering. Unsupported/delegation-less cgroups fail closed. The owned container is removed on success, failure or handled client timeout; uncatchable host termination still requires operator cleanup.

EPUBCheck runs separately with only its verified release and the generated output mounted read-only, network disabled, `--failonwarnings`, and no severity overrides. Validation rejects errors **and warnings**. No Java/browser/font package is added to root npm dependencies. If cleanup also fails after a primary run failure, the primary exception is preserved and stderr records the owned container name for manual cleanup. Cleanup failure after an otherwise successful run still fails the gate.

## Finite inspection and reproducibility

`verify.py` inspects every entry of the actual ZIP without extracting it: exact five-entry inventory, mimetype/order/compression, size limits/CRC, no duplicates/symlinks/encrypted/hidden ZIP fields, OPF language/title/creator/manifest/spine, TOC, reading order, footnotes, all local links/anchors, explicit public markers and absent synthetic excluded markers. Active HTML/foreign assets are not part of this fixture.

Two fresh renders must match the reviewed `golden.json`. **Byte-identical EPUB is not claimed**. The only normalized fields are one OPF UUIDv4, one `dcterms:modified` UTC field and ZIP entry timestamps. All other uncompressed bytes, entry order, compression method, flags and selected ZIP attributes must match. Compressed representation/CRC/size may change as a consequence of those volatile fields. The report includes the actual artifact SHA256 separately. A structurally valid but changed body still fails golden comparison.

Golden provenance: actual CLI11.3.3/VFM2.7.2 `dpub` output, Node24.18.0 fixed image and exact fixture pins, manually inspected English/Japanese text, OPF/nav/spine and backlinks, EPUBCheck5.3.0 errors/warnings0. It is a **synthetic baseline**, never generated from private/paid book text. Do not blindly regenerate golden data when a test fails. Intentional renderer/fixture changes require semantic re-review and a new provenance record.

`verify_test.py` mutates the real generated EPUB: 32 content mutations and 10 ZIP mutations, permitted volatile changes, runtime-argument/timeout cleanup and fixture-drift probes (9 test groups). Every test first proves a no-op ZIP repack still matches golden, preventing false confidence from a broken mutation writer. Test-only use of Python zipfile's `_seekable` retains the renderer's data-descriptor flags, with an explicit boolean-type guard and actionable error if Python changes its internals; this is not a production ZIP writer. Four failed/successful-run × inspection/removal-failure cases verify primary-error fidelity and cleanup failure reporting. The tests never launch scripts inserted into negative fixture data.

## Measured status and explicit release limits

The local initial `dpub` artifact passed EPUBCheck with 0 fatal/error/warning/info. The current host exposes the cgroup root without delegated `memory.max`/`pids.max`; the stronger effective-limit probe correctly fails before rendering. Do not remove that check or change host delegation from this task. The required CI gate must demonstrate the complete two-render/validation/equivalence sequence on a correctly provisioned runner; an earlier unverified-limit prototype is not sufficient.

CI prints only synthetic validation/metrics reports, not the EPUB binary. It records elapsed renderer/checker time and actual cgroup memory peak. The lock has existing deprecated packages tracked in #156; zero npm advisories is not a zero-warning claim.

Still pending in #152: general edition/input/asset isolation and leak tests; actual screen/print PDF; browser/font/ICC pins; OS-image and Java-dependency CVE/license audit; packaging/redistribution notices; cover/colophon/rights; Kindle Previewer on supported desktop OS; physical E Ink/tablet; printer/PDF-X requirements. CLI/MuPDF AGPL, Java runtime terms and EPUBCheck's bundled dependency licenses must not be inferred from this repository's MIT license. No image or JAR is redistributed by this PR. An OCI pin or EPUBCheck success does not establish commercial usability, visual quality or universal accessibility.

After collecting evidence, delete only the owned execution/output/state after confirming no owned containers remain. Do not prune a global Docker/Podman store or another task's worktree. CI runners are ephemeral; local reproducibility logs may be retained under the workspace's audit policy.
