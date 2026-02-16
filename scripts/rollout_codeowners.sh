#!/usr/bin/env bash
set -euo pipefail

# Ensure CODEOWNERS covers .book-formatter/** across book repos.
#
# This script is intended for maintainers operating on local clones.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/rollout_codeowners.sh --repo <path> [--repo <path> ...] [--branch <name>] [--create-pr] [--dry-run]
  scripts/rollout_codeowners.sh --repos-file <file> [--branch <name>] [--create-pr] [--dry-run]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --branch <name>       Working branch name (default: chore/rollout-codeowners-book-formatter)
  --create-pr           Create a PR via gh (requires authenticated gh)
  --dry-run             Do not modify repositories
USAGE
}

BRANCH="chore/rollout-codeowners-book-formatter"
CREATE_PR=0
DRY_RUN=0
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
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --create-pr)
      CREATE_PR=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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
if [ "$CREATE_PR" -eq 1 ]; then
  require_cmd gh
fi

RUN_DIR="$(run_dir rollout_codeowners)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\towner_repo\tstatus\tpr_url\tmessage\n" > "$REPORT"

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "not a git repo" >> "$REPORT"
    continue
  fi

  codeowners="$repo_dir/.github/CODEOWNERS"
  if [ ! -f "$codeowners" ]; then
    log INFO "Skip (no CODEOWNERS): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "no CODEOWNERS" >> "$REPORT"
    continue
  fi

  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    log WARN "Skip (dirty working tree): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "dirty working tree" >> "$REPORT"
    continue
  fi

  owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
  base_branch="$(git_default_branch "$repo_dir")"

  log INFO "Processing: $repo_dir (base=$base_branch)"

  if [ "$DRY_RUN" -eq 1 ]; then
    log INFO "DRY-RUN: would ensure CODEOWNERS contains /.book-formatter/** rule"
    printf "%s\t%s\tDRY_RUN\t\t%s\n" "$repo_dir" "$owner_repo" "no changes applied" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" fetch origin "$base_branch" >/dev/null
  git -C "$repo_dir" fetch origin "$BRANCH" >/dev/null 2>&1 || true
  if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null
  else
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$base_branch" >/dev/null
  fi

  python3 - <<'PY' "$codeowners"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

rule = "/.book-formatter/**                   @itdojp/book-formatter"

if rule in text:
    raise SystemExit(0)

lines = text.splitlines(True)

# Insert before the first catch-all rule (*) if present; otherwise append.
insert_at = None
for i, line in enumerate(lines):
    if line.lstrip().startswith("*"):
        insert_at = i
        break

to_insert = [rule + "\n"]

if insert_at is None:
    if not text.endswith("\n"):
        lines.append("\n")
    lines.extend(to_insert)
else:
    # Keep a blank line separation if needed.
    if insert_at > 0 and lines[insert_at - 1].strip() != "":
        lines.insert(insert_at, "\n")
        insert_at += 1
    for j, ins in enumerate(to_insert):
        lines.insert(insert_at + j, ins)

path.write_text("".join(lines), encoding="utf-8")
PY

  if git -C "$repo_dir" diff --quiet -- "$codeowners"; then
    log INFO "No changes: $repo_dir"
    printf "%s\t%s\tNOOP\t\t%s\n" "$repo_dir" "$owner_repo" "already up to date" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" add ".github/CODEOWNERS"
  git -C "$repo_dir" commit -m "chore: add CODEOWNERS for .book-formatter" >/dev/null
  git -C "$repo_dir" push -u origin "$BRANCH" >/dev/null

  pr_url=""
  if [ "$CREATE_PR" -eq 1 ] && [ -n "$owner_repo" ]; then
    set +e
    pr_url="$(gh_retry pr create -R "$owner_repo" --base "$base_branch" --head "$BRANCH" --title "chore: add CODEOWNERS for .book-formatter" --body "Add CODEOWNERS entry for .book-formatter/** so per-book QA allowlists/dictionaries have clear ownership." 2>/dev/null)"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      log WARN "PR create failed or already exists for $owner_repo (branch=$BRANCH)"
      pr_url=""
    fi
  fi

  printf "%s\t%s\tOK\t%s\t%s\n" "$repo_dir" "$owner_repo" "$pr_url" "CODEOWNERS updated" >> "$REPORT"
done

log INFO "Report: $REPORT"

