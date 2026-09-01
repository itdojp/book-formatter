# Standard Markdown contract

## Status

This directory defines the canonical Markdown contract for standard-book format version 1. It is an input contract for validators and future adapters; it is not an output adapter and is not synchronized to existing consumer repositories by the current `sync-components` command.

The normative authoring guidance is [`docs/markdown-rules.md`](../../docs/markdown-rules.md).

## Callout grammar version 1

The version 1 callout vocabulary is finite:

```text
note
tip
warning
paid
internal
```

A canonical callout has the following grammar:

```text
CALLOUT = OPEN NEWLINE BODY NEWLINE CLOSE
OPEN    = ":::" TYPE
CLOSE   = ":::"
TYPE    = "note" | "tip" | "warning" | "paid" | "internal"
```

Example:

```markdown
:::note
The canonical manuscript remains independent from its generated outputs.
:::
```

### Required structural properties

- `OPEN` and `CLOSE` start in column 1.
- `TYPE` is lowercase and has no title, option, or attribute suffix.
- A callout is not nested in another callout.
- An opening delimiter has exactly one closing delimiter.
- A delimiter inside a fenced code block is literal example text, not a callout.
- Unknown types fail closed.

Blank lines around a callout are recommended for source readability but are not part of the version 1 parser contract.

## Type semantics

| Type | Canonical meaning | Adapter responsibility |
| --- | --- | --- |
| `note` | Supplemental facts or assumptions | Render as a neutral note |
| `tip` | Recommended practice | Render as guidance, not a mandatory requirement |
| `warning` | Risk, constraint, or stop condition | Preserve prominence and accessible text |
| `paid` | Candidate paid-edition region | Apply the version 1 visibility decision before output |
| `internal` | Candidate internal-only region | Exclude from public output under the version 1 visibility decision |

`paid` and `internal` are markers, not access controls. `check-visibility` classifies the complete canonical document set and can scan bounded generated text artifacts. A consumer must not claim that free-output separation is safe until its adapter applies the manifest and validates its target artifact.

## Parser boundary

`check-markdown-structure` performs only a bounded line-level structural check. It enables this contract only with `--standard-callouts`; the presence of `book.yaml` does not change legacy behavior. Callers must scope the file pattern to canonical `frontmatter/`, `manuscript/`, and `backmatter/` content. When enabled, it validates delimiters outside YAML Front Matter and valid fenced code blocks. It does not implement CommonMark, Kramdown, Zenn, note, mdBook, or HTML rendering semantics.

The checker currently rejects:

- a type outside the finite set;
- malformed delimiter text;
- indentation before a delimiter;
- nested callouts;
- a closing delimiter without an open callout;
- an open callout without a close delimiter.

AST-sensitive placement, titles/options in a future grammar, and output conversion require separate versioned contracts. Visibility extraction is defined in [`docs/paid-editions.md`](../../docs/paid-editions.md) and reuses this finite delimiter/fence parser. New behavior must not be added as implicit regex handling.

## Adapter boundary

Adapters consume canonical Markdown and may translate the finite callout types to target-specific components. An adapter must:

1. parse and validate canonical input before conversion;
2. apply the version 1 edition/visibility decisions before generating public output;
3. map callouts without changing their semantic type;
4. reject unsupported conversion rather than silently exposing or dropping content;
5. validate generated output under the target contract.

Adapter implementation starts in Issue #94. Target-specific behavior belongs to Issues #95–#101. This directory intentionally contains no conversion code.
