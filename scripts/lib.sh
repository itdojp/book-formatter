#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for book-formatter maintenance scripts.
# - Robust retries for transient GitHub API failures (429 / secondary rate limits)
# - Consistent logging
# - HTTP probing helpers for GitHub Pages checks
#
# NOTE: Keep this file dependency-light (bash + coreutils + curl/gh/git when used).

log() {
  local level=${1:-INFO}
  shift || true
  # RFC3339-ish UTC timestamp (seconds precision)
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2
}

die() {
  log ERROR "$*"
  exit 1
}

require_cmd() {
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      die "Required command not found: $cmd"
    fi
  done
}

utc_ts() {
  date -u '+%Y%m%dT%H%M%SZ'
}

run_dir() {
  # Usage: run_dir <tag>
  # Creates: tmp-reports/<tag>/<timestamp>/
  local tag=${1:-run}
  local dir="tmp-reports/${tag}/$(utc_ts)"
  mkdir -p "$dir"
  printf '%s' "$dir"
}

archive_report() {
  # Usage: archive_report <file> <tag>
  local file=${1:-}
  local tag=${2:-misc}
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    return 0
  fi
  local dir
  dir="$(run_dir "$tag")"
  mv "$file" "$dir/$(basename "$file")"
  log INFO "Archived: $dir/$(basename "$file")"
}

retry() {
  # Usage: retry <max_attempts> <command...>
  local max_attempts=${1:-}
  shift || true
  if [ -z "$max_attempts" ] || [ "$max_attempts" -lt 1 ]; then
    die "retry: max_attempts must be >= 1"
  fi
  if [ "$#" -eq 0 ]; then
    die "retry: missing command"
  fi

  local attempt=1
  local base_sleep=${RETRY_SLEEP_BASE_SEC:-1}
  local max_sleep=${RETRY_SLEEP_MAX_SEC:-60}

  while true; do
    if "$@"; then
      return 0
    fi

    local rc=$?
    if [ "$attempt" -ge "$max_attempts" ]; then
      return "$rc"
    fi

    # Exponential backoff with small jitter (0.0-0.9s).
    local sleep_sec=$(( base_sleep * (2 ** (attempt - 1)) ))
    if [ "$sleep_sec" -gt "$max_sleep" ]; then
      sleep_sec="$max_sleep"
    fi
    local jitter=$(( RANDOM % 10 ))
    log WARN "Retrying ($attempt/$max_attempts) in ${sleep_sec}.${jitter}s: $*"
    sleep "${sleep_sec}.${jitter}"
    attempt=$(( attempt + 1 ))
  done
}

_is_retryable_gh_error() {
  # Best-effort detection of transient GitHub/Network failures from gh stderr/stdout.
  local msg=${1:-}
  local lower
  lower="$(printf '%s' "$msg" | tr '[:upper:]' '[:lower:]')"

  printf '%s' "$lower" | grep -Eq \
    '(http 429|too many requests|secondary rate limit|rate limit exceeded|api rate limit exceeded|exceeded retry limit|temporar(il)?y unavailable|timeout|timed out|connection reset|tls handshake timeout|502|503|504)'
}

gh_retry() {
  # Usage: gh_retry <gh args...>
  require_cmd gh

  local max_attempts=${GH_RETRY_MAX_ATTEMPTS:-6}
  local base_sleep=${GH_RETRY_SLEEP_BASE_SEC:-2}
  local max_sleep=${GH_RETRY_SLEEP_MAX_SEC:-90}

  local attempt=1
  while true; do
    local out rc
    out="$(gh "$@" 2>&1)" || rc=$?
    rc=${rc:-0}
    if [ "$rc" -eq 0 ]; then
      # Preserve stdout for callers (logs go to stderr).
      printf '%s' "$out"
      return 0
    fi

    if _is_retryable_gh_error "$out"; then
      if [ "$attempt" -ge "$max_attempts" ]; then
        log ERROR "gh retry exceeded (attempt $attempt/$max_attempts): gh $*"
        log ERROR "gh output: $out"
        return "$rc"
      fi

      local sleep_sec=$(( base_sleep * (2 ** (attempt - 1)) ))
      if [ "$sleep_sec" -gt "$max_sleep" ]; then
        sleep_sec="$max_sleep"
      fi
      local jitter=$(( RANDOM % 10 ))
      log WARN "gh transient failure (attempt $attempt/$max_attempts); retry in ${sleep_sec}.${jitter}s: gh $*"
      sleep "${sleep_sec}.${jitter}"
      attempt=$(( attempt + 1 ))
      continue
    fi

    log ERROR "gh failed (non-retryable): gh $*"
    log ERROR "gh output: $out"
    return "$rc"
  done
}

curl_code() {
  # Usage: curl_code <url>
  # Prints HTTP status code (e.g. 200, 404). Returns 0 even for non-200; caller decides.
  require_cmd curl
  local url=${1:-}
  if [ -z "$url" ]; then
    die "curl_code: missing url"
  fi

  local max_attempts=${CURL_RETRY_MAX_ATTEMPTS:-5}
  local attempt=1
  local code

  while true; do
    code="$(curl -sS -L -o /dev/null -w '%{http_code}' "$url" || printf '000')"
    if [ "$code" != "000" ] && [ "$code" != "429" ] && [ "$code" != "502" ] && [ "$code" != "503" ] && [ "$code" != "504" ]; then
      printf '%s' "$code"
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      printf '%s' "$code"
      return 0
    fi

    local sleep_sec=$(( attempt * 2 ))
    local jitter=$(( RANDOM % 10 ))
    log WARN "curl transient status=$code; retry in ${sleep_sec}.${jitter}s: $url"
    sleep "${sleep_sec}.${jitter}"
    attempt=$(( attempt + 1 ))
  done
}

git_default_branch() {
  # Usage: git_default_branch <repo_dir>
  local repo_dir=${1:-}
  if [ -z "$repo_dir" ]; then
    die "git_default_branch: missing repo_dir"
  fi
  local ref
  ref="$(git -C "$repo_dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [ -n "$ref" ]; then
    printf '%s' "${ref#origin/}"
  else
    printf '%s' "main"
  fi
}

git_owner_repo_from_remote() {
  # Usage: git_owner_repo_from_remote <repo_dir>
  local repo_dir=${1:-}
  local remote url
  remote="$(git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
  url="$remote"
  if [ -z "$url" ]; then
    return 1
  fi

  # Supported forms:
  # - https://github.com/OWNER/REPO(.git)
  # - git@github.com:OWNER/REPO(.git)
  # - ssh://git@github.com/OWNER/REPO(.git)
  url="${url%.git}"
  url="${url#ssh://git@github.com/}"
  url="${url#git@github.com:}"
  url="${url#https://github.com/}"

  # If still contains protocol/host, give up.
  if printf '%s' "$url" | grep -q '://'; then
    return 1
  fi

  if ! printf '%s' "$url" | grep -Eq '^[^/]+/[^/]+$'; then
    return 1
  fi

  printf '%s' "$url"
}

