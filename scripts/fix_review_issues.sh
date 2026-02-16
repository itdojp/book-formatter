#!/usr/bin/env bash
set -euo pipefail

# Collect PR review bodies + inline comments with retry/backoff, and archive the result.
#
# This does not auto-apply suggestions. It produces artifacts that make it easier
# to respond consistently without being blocked by transient GitHub API errors.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/fix_review_issues.sh --pr <url|owner/repo#num> [--pr <...> ...]
  scripts/fix_review_issues.sh --prs-file <file>

Options:
  --pr <...>            PR identifier (repeatable):
                          - https://github.com/OWNER/REPO/pull/123
                          - OWNER/REPO#123
  --prs-file <file>     Newline-delimited list of PR identifiers
USAGE
}

PRS=()
PRS_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pr)
      PRS+=("${2:-}")
      shift 2
      ;;
    --prs-file)
      PRS_FILE="${2:-}"
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

if [ -n "$PRS_FILE" ]; then
  [ -f "$PRS_FILE" ] || die "--prs-file not found: $PRS_FILE"
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    PRS+=("$line")
  done < "$PRS_FILE"
fi

if [ "${#PRS[@]}" -eq 0 ]; then
  usage
  die "No PRs specified"
fi

require_cmd gh python3

RUN_DIR="$(run_dir fix_review_issues)"
SUMMARY="$RUN_DIR/summary.md"
printf "# PR review artifacts\n\nGenerated at: %s\n\n" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$SUMMARY"

parse_pr() {
  # Prints: owner repo number
  local s=${1:-}
  s="${s%.git}"
  if [[ "$s" =~ ^https?://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    printf '%s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  if [[ "$s" =~ ^([^/]+)/([^#]+)\#([0-9]+)$ ]]; then
    printf '%s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}

for pr in "${PRS[@]}"; do
  if [ -z "$pr" ]; then
    continue
  fi
  if ! parsed="$(parse_pr "$pr")"; then
    log WARN "Skip (cannot parse): $pr"
    continue
  fi
  owner="$(printf '%s' "$parsed" | awk '{print $1}')"
  repo="$(printf '%s' "$parsed" | awk '{print $2}')"
  num="$(printf '%s' "$parsed" | awk '{print $3}')"

  tag="${owner}-${repo}-pr${num}"
  pr_json="$RUN_DIR/${tag}.pull.json"
  reviews_json="$RUN_DIR/${tag}.reviews.json"
  review_comments_json="$RUN_DIR/${tag}.review_comments.json"
  issue_comments_json="$RUN_DIR/${tag}.issue_comments.json"

  log INFO "Fetch: $owner/$repo#$num"

  gh_retry api "repos/${owner}/${repo}/pulls/${num}" > "$pr_json"
  gh_retry api "repos/${owner}/${repo}/pulls/${num}/reviews" > "$reviews_json"
  gh_retry api "repos/${owner}/${repo}/pulls/${num}/comments" > "$review_comments_json"
  gh_retry api "repos/${owner}/${repo}/issues/${num}/comments" > "$issue_comments_json"

  pr_url="https://github.com/${owner}/${repo}/pull/${num}"
  title="$(gh_retry pr view "$pr_url" --json title --jq .title 2>/dev/null || true)"
  review_count="$(python3 - <<'PY' "$reviews_json"\nimport json,sys\np=sys.argv[1]\ntry:\n  data=json.load(open(p,'r',encoding='utf-8'))\n  print(len(data) if isinstance(data,list) else 0)\nexcept Exception:\n  print(0)\nPY)"
  inline_count="$(python3 - <<'PY' "$review_comments_json"\nimport json,sys\np=sys.argv[1]\ntry:\n  data=json.load(open(p,'r',encoding='utf-8'))\n  print(len(data) if isinstance(data,list) else 0)\nexcept Exception:\n  print(0)\nPY)"
  issue_count="$(python3 - <<'PY' "$issue_comments_json"\nimport json,sys\np=sys.argv[1]\ntry:\n  data=json.load(open(p,'r',encoding='utf-8'))\n  print(len(data) if isinstance(data,list) else 0)\nexcept Exception:\n  print(0)\nPY)"

  {
    printf "## %s\n\n" "$pr_url"
    if [ -n "$title" ]; then
      printf "- Title: %s\n" "$title"
    fi
    printf "- Reviews: %s\n" "$review_count"
    printf "- Inline review comments: %s\n" "$inline_count"
    printf "- Issue comments: %s\n" "$issue_count"
    printf "- Artifacts:\n"
    printf "  - %s\n" "$(basename "$pr_json")"
    printf "  - %s\n" "$(basename "$reviews_json")"
    printf "  - %s\n" "$(basename "$review_comments_json")"
    printf "  - %s\n" "$(basename "$issue_comments_json")"
    printf "\n"
  } >> "$SUMMARY"
done

log INFO "Summary: $SUMMARY"
