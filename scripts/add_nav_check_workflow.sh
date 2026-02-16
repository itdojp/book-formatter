#!/usr/bin/env bash
set -euo pipefail

# Add/Update nav-link-check workflow in book repos.
#
# This script is intended for maintainers operating on local clones.
# It copies the workflow template from this repo into target repos and
# optionally opens PRs.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/add_nav_check_workflow.sh --repo <path> [--repo <path> ...] [--branch <name>] [--create-pr] [--dry-run]
  scripts/add_nav_check_workflow.sh --repos-file <file> [--branch <name>] [--create-pr] [--dry-run]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --branch <name>       Working branch name (default: chore/add-nav-link-check-workflow)
  --create-pr           Create a PR via gh (requires authenticated gh)
  --dry-run             Do not modify repositories
USAGE
}

BRANCH="chore/add-nav-link-check-workflow"
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

require_cmd git
if [ "$CREATE_PR" -eq 1 ]; then
  require_cmd gh
fi

TEMPLATE="$SCRIPT_DIR/../templates/.github/workflows/nav-link-check.yml"
[ -f "$TEMPLATE" ] || die "Template not found: $TEMPLATE"

RUN_DIR="$(run_dir add_nav_check_workflow)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\towner_repo\tstatus\tpr_url\tmessage\n" > "$REPORT"

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "not a git repo" >> "$REPORT"
    continue
  fi

  # Ensure working tree is clean to avoid accidental commits.
  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    log WARN "Skip (dirty working tree): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "dirty working tree" >> "$REPORT"
    continue
  fi

  owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
  base_branch="$(git_default_branch "$repo_dir")"

  log INFO "Processing: $repo_dir (base=$base_branch)"

  if [ "$DRY_RUN" -eq 1 ]; then
    log INFO "DRY-RUN: would copy workflow to $repo_dir/.github/workflows/nav-link-check.yml"
    printf "%s\t%s\tDRY_RUN\t\t%s\n" "$repo_dir" "$owner_repo" "no changes applied" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" fetch origin "$base_branch" >/dev/null

  # If the branch exists remotely, start from it (fast-forward friendly).
  git -C "$repo_dir" fetch origin "$BRANCH" >/dev/null 2>&1 || true
  if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null
  else
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$base_branch" >/dev/null
  fi

  dest="$repo_dir/.github/workflows/nav-link-check.yml"
  mkdir -p "$(dirname "$dest")"
  cp "$TEMPLATE" "$dest"

  if git -C "$repo_dir" diff --quiet -- "$dest"; then
    log INFO "No changes: $repo_dir"
    printf "%s\t%s\tNOOP\t\t%s\n" "$repo_dir" "$owner_repo" "already up to date" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" add "$dest"
  git -C "$repo_dir" commit -m "chore: add nav + pages link check workflow" >/dev/null
  git -C "$repo_dir" push -u origin "$BRANCH" >/dev/null

  pr_url=""
  if [ "$CREATE_PR" -eq 1 ] && [ -n "$owner_repo" ]; then
    # gh pr create exits non-zero if a PR already exists; tolerate that and just record.
    set +e
    pr_url="$(gh_retry pr create -R "$owner_repo" --base "$base_branch" --head "$BRANCH" --title "chore: add nav + pages link check workflow" --body "Add scheduled GitHub Pages link checks (navigation + key pages) to detect broken routes early." 2>/dev/null)"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      log WARN "PR create failed or already exists for $owner_repo (branch=$BRANCH)"
      pr_url=""
    fi
  fi

  printf "%s\t%s\tOK\t%s\t%s\n" "$repo_dir" "$owner_repo" "$pr_url" "workflow added" >> "$REPORT"
done

log INFO "Report: $REPORT"

