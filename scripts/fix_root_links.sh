#!/usr/bin/env bash
set -euo pipefail

# Detect (and optionally rewrite) root-absolute internal links that ignore site.baseurl.
#
# For GitHub Pages project sites, links like "/chapters/..." often break because the
# site is served under "/<repo>/". This script audits those patterns and can rewrite
# to Liquid + relative_url where safe.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/fix_root_links.sh --repo <path> [--repo <path> ...] [--apply] [--branch <name>] [--create-pr]
  scripts/fix_root_links.sh --repos-file <file> [--apply] [--branch <name>] [--create-pr]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --apply               Rewrite links and create a commit (default: audit only)
  --branch <name>       Working branch name (default: chore/fix-root-absolute-links)
  --create-pr           Create a PR via gh (requires authenticated gh; only with --apply)
USAGE
}

APPLY=0
BRANCH="chore/fix-root-absolute-links"
CREATE_PR=0
REPOS=()
REPOS_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPOS+=("${2:-}")
      shift 2
      ;;
    --repos-file)
      REPOS_FILE="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --create-pr)
      CREATE_PR=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

if [ -n "$REPOS_FILE" ]; then
  [ -f "$REPOS_FILE" ] || die "--repos-file not found: $REPOS_FILE"
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    REPOS+=("$line")
  done < "$REPOS_FILE"
fi

if [ "${#REPOS[@]}" -eq 0 ]; then
  usage
  die "No repositories specified"
fi

require_cmd git python3
if [ "$APPLY" -eq 1 ] && [ "$CREATE_PR" -eq 1 ]; then
  require_cmd gh
fi

RUN_DIR="$(run_dir fix_root_links)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\tfile\tline\tkind\tvalue\n" > "$REPORT"

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    continue
  fi

  base_dir="$repo_dir"
  if [ -d "$repo_dir/docs" ]; then
    base_dir="$repo_dir/docs"
  fi

  if [ "$APPLY" -eq 1 ]; then
    if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
      log WARN "Skip (dirty working tree): $repo_dir"
      continue
    fi

    owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
    base_branch="$(git_default_branch "$repo_dir")"
    git -C "$repo_dir" fetch origin "$base_branch" >/dev/null
    git -C "$repo_dir" fetch origin "$BRANCH" >/dev/null 2>&1 || true
    if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
      git -C "$repo_dir" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null
    else
      git -C "$repo_dir" checkout -B "$BRANCH" "origin/$base_branch" >/dev/null
    fi
  fi

  python3 - <<'PY' "$repo_dir" "$base_dir" "$REPORT" "$APPLY"
from __future__ import annotations

import re
import sys
from pathlib import Path

repo_dir, base_dir, report_path, apply_s = sys.argv[1:]
apply = apply_s == "1"

base = Path(base_dir)
if not base.exists():
    raise SystemExit(0)

targets: list[Path] = []
for ext in (".md", ".html", ".htm"):
    targets.extend(sorted(base.rglob(f"*{ext}")))

# Patterns:
# - Markdown: ](/path/...)
# - HTML: href="/path/..." or src="/path/..." (but not //example.com)
md_pat = re.compile(r"\\]\\((/[^)\\s]+)\\)")
href_pat = re.compile(r'\\bhref=\"/([^\"/][^\"]*)\"')
src_pat = re.compile(r'\\bsrc=\"/([^\"/][^\"]*)\"')

def to_liquid(path: str) -> str:
    # -> {{ '/path' | relative_url }}
    return "{{ '" + path + "' | relative_url }}"

def fix_line(line: str) -> str:
    # Avoid double-wrapping if already contains Liquid.
    if "{{" in line:
        return line

    def md_repl(m: re.Match[str]) -> str:
        p = m.group(1)
        return "](" + to_liquid(p) + ")"

    def href_repl(m: re.Match[str]) -> str:
        p = "/" + m.group(1)
        return 'href=\"' + to_liquid(p) + '\"'

    def src_repl(m: re.Match[str]) -> str:
        p = "/" + m.group(1)
        return 'src=\"' + to_liquid(p) + '\"'

    line2 = md_pat.sub(md_repl, line)
    line2 = href_pat.sub(href_repl, line2)
    line2 = src_pat.sub(src_repl, line2)
    return line2

def report(kind: str, value: str, file: Path, line_no: int) -> None:
    with open(report_path, "a", encoding="utf-8") as f:
        f.write(f\"{repo_dir}\\t{file}\\t{line_no}\\t{kind}\\t{value}\\n\")

for file in targets:
    text = file.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines(True)

    changed = False
    for i, line in enumerate(lines, start=1):
        for m in md_pat.finditer(line):
            report("md", m.group(1), file, i)
        # href/src: capture path without leading slash
        for m in href_pat.finditer(line):
            report("href", "/" + m.group(1), file, i)
        for m in src_pat.finditer(line):
            report("src", "/" + m.group(1), file, i)

        if apply:
            new_line = fix_line(line)
            if new_line != line:
                lines[i - 1] = new_line
                changed = True

    if apply and changed:
        file.write_text("".join(lines), encoding="utf-8")
PY

  if [ "$APPLY" -eq 1 ]; then
    if git -C "$repo_dir" diff --quiet; then
      log INFO "No changes: $repo_dir"
      continue
    fi

    # Stage tracked changes only (avoid accidental new files).
    git -C "$repo_dir" add -u
    git -C "$repo_dir" commit -m "chore: fix root-absolute links (use relative_url)" >/dev/null
    git -C "$repo_dir" push -u origin "$BRANCH" >/dev/null

    if [ "$CREATE_PR" -eq 1 ]; then
      owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
      base_branch="$(git_default_branch "$repo_dir")"
      if [ -n "$owner_repo" ]; then
        set +e
        gh_retry pr create -R "$owner_repo" --base "$base_branch" --head "$BRANCH" --title "chore: fix root-absolute links" --body "Rewrite root-absolute internal links to use Liquid + relative_url (GitHub Pages project site compatibility)." >/dev/null 2>&1
        set -e
      fi
    fi
  fi
done

log INFO "Report: $REPORT"

