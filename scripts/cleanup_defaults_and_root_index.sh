#!/usr/bin/env bash
set -euo pipefail

# Audit for template placeholders / duplicated root index files in book repos.
#
# This script is intentionally conservative: it reports suspicious defaults that
# likely indicate "template leftovers" (e.g., <BOOK TITLE>) without auto-editing.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/cleanup_defaults_and_root_index.sh --repo <path> [--repo <path> ...]
  scripts/cleanup_defaults_and_root_index.sh --repos-file <file>

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
USAGE
}

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

require_cmd python3

RUN_DIR="$(run_dir cleanup_defaults)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\tfile\tline\tmatch\n" > "$REPORT"

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir" ]; then
    log WARN "Skip (not found): $repo_dir"
    continue
  fi

  python3 - <<'PY' "$repo_dir" "$REPORT"
from __future__ import annotations

import re
import sys
from pathlib import Path

repo_dir, report_path = sys.argv[1:]
repo = Path(repo_dir)

base = repo / "docs" if (repo / "docs").is_dir() else repo

patterns = [
    r"<BOOK TITLE>",
    r"<SHORT DESCRIPTION>",
    r"<AUTHOR>",
    r"<owner>",
    r"<repo>",
    r"Book description",
]

rx = re.compile("|".join(patterns))

targets = []
for ext in (".md", ".yml", ".yaml", ".html", ".htm"):
    targets.extend(sorted(base.rglob(f"*{ext}")))

def report(file: Path, line_no: int, m: str) -> None:
    with open(report_path, "a", encoding="utf-8") as f:
        f.write(f\"{repo_dir}\\t{file}\\t{line_no}\\t{m}\\n\")

for file in targets:
    try:
        text = file.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), start=1):
        m = rx.search(line)
        if m:
            report(file, i, m.group(0))

# Extra: duplicated index.md under root and docs/
root_index = repo / "index.md"
docs_index = repo / "docs" / "index.md"
if root_index.is_file() and docs_index.is_file():
    report(root_index, 0, "duplicated index.md exists under root and docs/")
PY
done

log INFO "Report: $REPORT"

