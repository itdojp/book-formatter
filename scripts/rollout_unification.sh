#!/usr/bin/env bash
set -euo pipefail

# Roll out shared UX core (layouts/includes/assets) to book repos.
#
# Implementation: wraps scripts/sync-components.js per repo and creates commits/PRs.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/rollout_unification.sh --repo <path> [--repo <path> ...] [--branch <name>] [--create-pr] [--dry-run]
  scripts/rollout_unification.sh --repos-file <file> [--branch <name>] [--create-pr] [--dry-run]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --branch <name>       Working branch name (default: chore/rollout-shared-components)
  --create-pr           Create a PR via gh (requires authenticated gh)
  --dry-run             Do not modify repositories (runs sync-components in --dry-run)
USAGE
}

BRANCH="chore/rollout-shared-components"
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

require_cmd git node
if [ "$CREATE_PR" -eq 1 ]; then
  require_cmd gh
fi

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNC_SCRIPT="$ROOT_DIR/scripts/sync-components.js"
[ -f "$SYNC_SCRIPT" ] || die "sync-components.js not found: $SYNC_SCRIPT"
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  die "node_modules not found. Run: (cd $ROOT_DIR && npm ci)"
fi

RUN_DIR="$(run_dir rollout_unification)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\towner_repo\tstatus\tpr_url\tmessage\n" > "$REPORT"

is_expected_sync_path() {
  local p=${1:-}
  case "$p" in
    docs/_layouts/*|docs/_includes/*|docs/assets/*|book-config.json) return 0 ;;
    *) return 1 ;;
  esac
}

collect_changed_paths() {
  # Usage: collect_changed_paths <repo_dir>
  # Prints changed paths (tracked unstaged/staged + untracked), de-duplicated while preserving order.
  local repo_dir=${1:-}
  local p q seen
  local -a paths out
  paths=()
  out=()

  while IFS= read -r p; do
    [ -n "$p" ] || continue
    paths+=("$p")
  done < <(git -C "$repo_dir" diff --name-only)

  while IFS= read -r p; do
    [ -n "$p" ] || continue
    paths+=("$p")
  done < <(git -C "$repo_dir" diff --cached --name-only)

  while IFS= read -r p; do
    [ -n "$p" ] || continue
    paths+=("$p")
  done < <(git -C "$repo_dir" ls-files --others --exclude-standard)

  for p in "${paths[@]}"; do
    seen=0
    for q in "${out[@]}"; do
      if [ "$q" = "$p" ]; then
        seen=1
        break
      fi
    done
    if [ "$seen" -eq 0 ]; then
      out+=("$p")
    fi
  done

  printf '%s\n' "${out[@]}"
}

preview_paths() {
  # Usage: preview_paths <max> <paths...>
  local max=${1:-5}
  shift || true
  local -a arr head
  arr=("$@")

  if [ "${#arr[@]}" -le "$max" ]; then
    local IFS=", "
    printf '%s' "${arr[*]}"
    return 0
  fi

  head=("${arr[@]:0:$max}")
  local more=$(( ${#arr[@]} - max ))
  local IFS=", "
  printf '%s' "${head[*]}"
  printf ' (and %s more)' "$more"
}

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "not a git repo" >> "$REPORT"
    continue
  fi

  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    log WARN "Skip (dirty working tree): $repo_dir"
    printf "%s\t\tSKIP\t\t%s\n" "$repo_dir" "dirty working tree" >> "$REPORT"
    continue
  fi

  owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
  base_branch="$(git_default_branch "$repo_dir")"

  log INFO "Sync shared components: $repo_dir (base=$base_branch)"

  if [ "$DRY_RUN" -eq 1 ]; then
    (cd "$ROOT_DIR" && node "$SYNC_SCRIPT" --book "$repo_dir" --dry-run) || true
    printf "%s\t%s\tDRY_RUN\t\t%s\n" "$repo_dir" "$owner_repo" "dry-run only" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" fetch origin "$base_branch" >/dev/null
  git -C "$repo_dir" fetch origin "$BRANCH" >/dev/null 2>&1 || true
  if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null
  else
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$base_branch" >/dev/null
  fi

  (cd "$ROOT_DIR" && node "$SYNC_SCRIPT" --book "$repo_dir") >/dev/null

  changed_paths=()
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    changed_paths+=("$p")
  done < <(collect_changed_paths "$repo_dir")

  if [ "${#changed_paths[@]}" -eq 0 ]; then
    log INFO "No changes: $repo_dir"
    printf "%s\t%s\tNOOP\t\t%s\n" "$repo_dir" "$owner_repo" "already up to date" >> "$REPORT"
    continue
  fi

  unexpected_paths=()
  for p in "${changed_paths[@]}"; do
    if ! is_expected_sync_path "$p"; then
      unexpected_paths+=("$p")
    fi
  done
  if [ "${#unexpected_paths[@]}" -gt 0 ]; then
    msg="unexpected paths: $(preview_paths 5 "${unexpected_paths[@]}")"
    log ERROR "Refuse to commit unexpected changes: $repo_dir"
    log ERROR "$msg"
    printf "%s\t%s\tERROR\t\t%s\n" "$repo_dir" "$owner_repo" "$msg" >> "$REPORT"
    continue
  fi

  # Stage only expected paths (avoid accidental adds).
  git -C "$repo_dir" add -u docs/_layouts docs/_includes docs/assets book-config.json 2>/dev/null || true
  git -C "$repo_dir" add docs/_layouts docs/_includes docs/assets book-config.json 2>/dev/null || true

  # Defensive check: ensure sync didn't leave anything untracked/unstaged.
  if ! git -C "$repo_dir" diff --quiet; then
    log ERROR "Unstaged changes remain; refusing to commit: $repo_dir"
    printf "%s\t%s\tERROR\t\t%s\n" "$repo_dir" "$owner_repo" "unstaged changes remain" >> "$REPORT"
    continue
  fi
  if [ -n "$(git -C "$repo_dir" ls-files --others --exclude-standard)" ]; then
    log ERROR "Untracked files remain; refusing to commit: $repo_dir"
    printf "%s\t%s\tERROR\t\t%s\n" "$repo_dir" "$owner_repo" "untracked files remain" >> "$REPORT"
    continue
  fi
  if git -C "$repo_dir" diff --cached --quiet; then
    log WARN "No staged changes after sync: $repo_dir"
    printf "%s\t%s\tSKIP\t\t%s\n" "$repo_dir" "$owner_repo" "no staged changes" >> "$REPORT"
    continue
  fi

  git -C "$repo_dir" commit -m "chore: sync shared components (book-formatter)" >/dev/null
  git -C "$repo_dir" push -u origin "$BRANCH" >/dev/null

  pr_url=""
  if [ "$CREATE_PR" -eq 1 ] && [ -n "$owner_repo" ]; then
    set +e
    pr_url="$(gh_retry pr create -R "$owner_repo" --base "$base_branch" --head "$BRANCH" --title "chore: sync shared components (book-formatter)" --body "Sync shared layouts/includes/assets from book-formatter (maintenance rollout)." 2>/dev/null)"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      log WARN "PR create failed or already exists for $owner_repo (branch=$BRANCH)"
      pr_url=""
    fi
  fi

  printf "%s\t%s\tOK\t%s\t%s\n" "$repo_dir" "$owner_repo" "$pr_url" "synced shared components" >> "$REPORT"
done

log INFO "Report: $REPORT"
