#!/usr/bin/env bash
set -euo pipefail

# Check deployed GitHub Pages URLs for book repos (HTTP-level smoke).
# - Top page + common assets
# - Navigation-derived pages (sample or full)
#
# Intended for maintainers. Requires local clones to read navigation.yml.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/check_pages.sh --repo <path> [--repo <path> ...] [--full] [--dry-run]
  scripts/check_pages.sh --repos-file <file> [--full] [--dry-run]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --full                Check all navigation paths (default: sample 3 pages)
  --dry-run             Do not perform HTTP requests (lists computed URLs)
USAGE
}

FULL=0
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
    --full)
      FULL=1
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

require_cmd curl git awk sed

RUN_DIR="$(run_dir check_pages)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\tpages_base\tpath\turl\thttp_code\n" > "$REPORT"

COMMON_ASSETS=(
  "assets/css/main.css"
  "assets/css/syntax-highlighting.css"
  "assets/js/theme.js"
  "assets/js/search.js"
  "assets/js/code-copy-lightweight.js"
)

trim_quotes() {
  # Remove one pair of surrounding quotes if present.
  local s=${1:-}
  s="${s#\"}"; s="${s%\"}"
  s="${s#\'}"; s="${s%\'}"
  printf '%s' "$s"
}

read_config_value() {
  # Usage: read_config_value <config.yml> <key>
  # Naive YAML scalar reader (first match). Strips comments and surrounding quotes.
  local file=${1:-}
  local key=${2:-}
  awk -v k="$key" '
    BEGIN{found=0}
    /^[[:space:]]*#/ {next}
    $0 ~ "^[[:space:]]*" k ":[[:space:]]*" && found==0 {
      sub("^[[:space:]]*" k ":[[:space:]]*", "", $0)
      sub("[[:space:]]+#.*$", "", $0)
      print $0
      found=1
    }
  ' "$file" | head -n1
}

extract_nav_paths() {
  # Usage: extract_nav_paths <navigation.yml>
  # Prints paths (one per line). Keeps order but may include duplicates.
  local nav=${1:-}
  awk '
    /^[[:space:]]*path:[[:space:]]*/ {
      sub(/^[[:space:]]*path:[[:space:]]*/, "", $0)
      sub(/[[:space:]]+#.*$/, "", $0)
      gsub(/^[\"'\'' ]+|[\"'\'' ]+$/, "", $0)
      if ($0 != "") print $0
    }
  ' "$nav"
}

normalize_path() {
  local p=${1:-}
  p="$(trim_quotes "$p")"
  [ -n "$p" ] || return 0
  # Skip external / mailto
  case "$p" in
    http://*|https://*|mailto:*) return 0 ;;
  esac
  if [[ "$p" != /* ]]; then
    p="/$p"
  fi
  # Keep file-like paths; otherwise ensure trailing slash.
  case "${p,,}" in
    *.md|*.html|*.htm|*.pdf|*.txt) printf '%s\n' "$p" ;;
    *) [[ "$p" == */ ]] && printf '%s\n' "$p" || printf '%s/\n' "$p" ;;
  esac
}

dedup_keep_order() {
  awk '!seen[$0]++'
}

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    continue
  fi

  owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
  owner="${owner_repo%%/*}"
  repo_name="${owner_repo##*/}"
  if [ -z "$owner_repo" ] || [ -z "$owner" ] || [ -z "$repo_name" ]; then
    # Fallback to directory name (best effort)
    owner="unknown"
    repo_name="$(basename "$repo_dir")"
  fi

  base_dir="$repo_dir"
  if [ -d "$repo_dir/docs" ]; then
    base_dir="$repo_dir/docs"
  fi

  cfg="$base_dir/_config.yml"
  pages_url="https://${owner}.github.io"
  baseurl="/${repo_name}"
  if [ -f "$cfg" ]; then
    v="$(read_config_value "$cfg" url | tr -d '\r' | xargs || true)"
    if [ -n "$v" ]; then
      pages_url="$(trim_quotes "$v")"
    fi
    v="$(read_config_value "$cfg" baseurl | tr -d '\r' | xargs || true)"
    if [ -n "$v" ]; then
      baseurl="$(trim_quotes "$v")"
    fi
  fi

  # Normalize base url pieces.
  pages_url="${pages_url%/}"
  if [ -z "$baseurl" ]; then
    baseurl="/${repo_name}"
  fi
  if [[ "$baseurl" != /* ]]; then
    baseurl="/$baseurl"
  fi
  baseurl="${baseurl%/}"
  pages_base="${pages_url}${baseurl}/"

  log INFO "Check: $repo_dir => $pages_base"

  # Build paths from navigation.yml when available.
  nav="$base_dir/_data/navigation.yml"
  paths=()
  if [ -f "$nav" ]; then
    while IFS= read -r p; do
      np="$(normalize_path "$p" || true)"
      [ -n "$np" ] || continue
      paths+=("$np")
    done < <(extract_nav_paths "$nav")
  fi

  # Always include index.
  paths=("/" "${paths[@]}")
  mapfile -t paths < <(printf '%s\n' "${paths[@]}" | dedup_keep_order)

  # Decide which paths to probe.
  probe_paths=()
  if [ "$FULL" -eq 1 ] || [ "${#paths[@]}" -le 4 ]; then
    probe_paths=("${paths[@]}")
  else
    probe_paths+=("${paths[0]}")
    probe_paths+=("${paths[$(( ${#paths[@]} / 2 ))]}")
    probe_paths+=("${paths[$(( ${#paths[@]} - 1 ))]}")
  fi

  # Probe top + assets.
  urls=()
  urls+=("$pages_base")
  for a in "${COMMON_ASSETS[@]}"; do
    urls+=("${pages_base}${a}")
  done

  # Probe navigation pages.
  for p in "${probe_paths[@]}"; do
    # Avoid duplicate of root when joining.
    if [ "$p" = "/" ]; then
      urls+=("$pages_base")
      continue
    fi
    urls+=("${pages_url}${baseurl}${p}")
  done

  # De-dup URLs while keeping order.
  mapfile -t urls < <(printf '%s\n' "${urls[@]}" | dedup_keep_order)

  for u in "${urls[@]}"; do
    if [ "$DRY_RUN" -eq 1 ]; then
      printf "%s\t%s\t%s\t%s\t%s\n" "$repo_dir" "$pages_base" "-" "$u" "DRY_RUN" >> "$REPORT"
      continue
    fi
    code="$(curl_code "$u")"
    printf "%s\t%s\t%s\t%s\t%s\n" "$repo_dir" "$pages_base" "-" "$u" "$code" >> "$REPORT"
  done
done

log INFO "Report: $REPORT"

