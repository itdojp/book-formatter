#!/usr/bin/env bash
set -euo pipefail

# Fix common GitHub Pages-related fields in Jekyll _config.yml across book repos.
#
# Default is audit-only (no writes). Use --apply to update + commit (+ optional PR).

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/rollout_fix_config_yaml.sh --repo <path> [--repo <path> ...] [--apply] [--branch <name>] [--create-pr]
  scripts/rollout_fix_config_yaml.sh --repos-file <file> [--apply] [--branch <name>] [--create-pr]

Options:
  --repo <path>         Target repository directory (repeatable)
  --repos-file <file>   Newline-delimited list of repository directories
  --apply               Apply changes (default: audit only)
  --branch <name>       Working branch name (default: chore/fix-jekyll-config)
  --create-pr           Create a PR via gh (requires authenticated gh; only with --apply)
USAGE
}

APPLY=0
BRANCH="chore/fix-jekyll-config"
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

RUN_DIR="$(run_dir rollout_fix_config_yaml)"
REPORT="$RUN_DIR/report.tsv"
printf "repo_dir\towner_repo\tconfig_path\tstatus\tmessage\n" > "$REPORT"

for repo_dir in "${REPOS[@]}"; do
  if [ -z "$repo_dir" ] || [ ! -d "$repo_dir/.git" ]; then
    log WARN "Skip (not a git repo): $repo_dir"
    printf "%s\t\t\tSKIP\t%s\n" "$repo_dir" "not a git repo" >> "$REPORT"
    continue
  fi

  owner_repo="$(git_owner_repo_from_remote "$repo_dir" || true)"
  owner="${owner_repo%%/*}"
  repo_name="${owner_repo##*/}"
  if [ -z "$owner_repo" ] || [ -z "$owner" ] || [ -z "$repo_name" ]; then
    log WARN "Skip (cannot parse owner/repo from origin remote): $repo_dir"
    printf "%s\t\t\tSKIP\t%s\n" "$repo_dir" "cannot parse owner/repo" >> "$REPORT"
    continue
  fi

  base_dir="$repo_dir"
  if [ -d "$repo_dir/docs" ]; then
    base_dir="$repo_dir/docs"
  fi
  cfg="$base_dir/_config.yml"
  if [ ! -f "$cfg" ]; then
    log INFO "Skip (no _config.yml): $repo_dir"
    printf "%s\t%s\t%s\tSKIP\t%s\n" "$repo_dir" "$owner_repo" "$cfg" "no _config.yml" >> "$REPORT"
    continue
  fi

  want_url="https://${owner}.github.io"
  want_baseurl="/${repo_name}"
  want_repo="$owner_repo"

  if [ "$APPLY" -eq 0 ]; then
    # Audit only
    audit_out="$(
      python3 - <<'PY' "$cfg" "$want_url" "$want_baseurl" "$want_repo"
from pathlib import Path
import re
import sys

cfg, want_url, want_baseurl, want_repo = sys.argv[1:]
text = Path(cfg).read_text(encoding="utf-8")

def get(key: str):
    m = re.search(rf"(?m)^\\s*{re.escape(key)}\\s*:\\s*(.+?)\\s*$", text)
    if not m:
        return None
    v = m.group(1).strip()
    # Strip trailing comments and quotes
    v = re.sub(r"\\s+#.*$", "", v).strip()
    v = v.strip("\"'")
    return v

cur_url = get("url")
cur_baseurl = get("baseurl")
cur_repo = get("repository")

msgs = []
if cur_url != want_url:
    msgs.append(f"url: {cur_url!r} -> {want_url!r}")
if cur_baseurl != want_baseurl:
    msgs.append(f"baseurl: {cur_baseurl!r} -> {want_baseurl!r}")
if cur_repo != want_repo:
    msgs.append(f"repository: {cur_repo!r} -> {want_repo!r}")

status = "NOOP" if not msgs else "MISMATCH"
msg = "; ".join(msgs) if msgs else "ok"
print(status)
print(msg)
PY
    )"
    audit_status="$(printf '%s\n' "$audit_out" | head -n1)"
    audit_msg="$(printf '%s\n' "$audit_out" | tail -n1)"
    printf "%s\t%s\t%s\t%s\t%s\n" "$repo_dir" "$owner_repo" "$cfg" "$audit_status" "$audit_msg" >> "$REPORT"
    continue
  fi

  # Apply mode: modify config on a branch and commit.
  if ! git -C "$repo_dir" diff --quiet || ! git -C "$repo_dir" diff --cached --quiet; then
    log WARN "Skip (dirty working tree): $repo_dir"
    printf "%s\t%s\t%s\tSKIP\t%s\n" "$repo_dir" "$owner_repo" "$cfg" "dirty working tree" >> "$REPORT"
    continue
  fi

  base_branch="$(git_default_branch "$repo_dir")"
  git -C "$repo_dir" fetch origin "$base_branch" >/dev/null
  git -C "$repo_dir" fetch origin "$BRANCH" >/dev/null 2>&1 || true
  if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null
  else
    git -C "$repo_dir" checkout -B "$BRANCH" "origin/$base_branch" >/dev/null
  fi

  python3 - <<'PY' "$cfg" "$want_url" "$want_baseurl" "$want_repo"
from pathlib import Path
import re
import sys

cfg, want_url, want_baseurl, want_repo = sys.argv[1:]
path = Path(cfg)
text = path.read_text(encoding="utf-8")

def set_key(text: str, key: str, value: str) -> str:
    line = f'{key}: "{value}"'
    pat = re.compile(rf"(?m)^\\s*{re.escape(key)}\\s*:\\s*.*$")
    if pat.search(text):
        return pat.sub(line, text, count=1)
    # Insert near the top after the first block of scalar metadata when possible.
    lines = text.splitlines(True)
    insert_at = 0
    for i, l in enumerate(lines):
        if l.strip().startswith("#") or not l.strip():
            continue
        insert_at = i + 1
        # After a few common keys, stop searching.
        if l.lstrip().startswith(("author:", "version:", "lang:", "description:", "title:")):
            continue
        break
    if insert_at > 0 and (insert_at >= len(lines) or lines[insert_at - 1].strip() != ""):
        lines.insert(insert_at, "\n")
        insert_at += 1
    lines.insert(insert_at, line + "\n")
    return "".join(lines)

text2 = text
text2 = set_key(text2, "url", want_url)
text2 = set_key(text2, "baseurl", want_baseurl)
text2 = set_key(text2, "repository", want_repo)

if text2 != text:
    path.write_text(text2, encoding="utf-8")
PY

  if git -C "$repo_dir" diff --quiet -- "$cfg"; then
    log INFO "No changes: $repo_dir"
    printf "%s\t%s\t%s\tNOOP\t%s\n" "$repo_dir" "$owner_repo" "$cfg" "already up to date" >> "$REPORT"
    continue
  fi

  rel_cfg="${cfg#"$repo_dir/"}"
  git -C "$repo_dir" add "$rel_cfg"
  git -C "$repo_dir" commit -m "chore: normalize Jekyll _config.yml for Pages" >/dev/null
  git -C "$repo_dir" push -u origin "$BRANCH" >/dev/null

  if [ "$CREATE_PR" -eq 1 ]; then
    set +e
    gh_retry pr create -R "$owner_repo" --base "$base_branch" --head "$BRANCH" --title "chore: normalize Jekyll _config.yml for Pages" --body "Normalize url/baseurl/repository in _config.yml for GitHub Pages project sites." >/dev/null 2>&1
    set -e
  fi

  printf "%s\t%s\t%s\tOK\t%s\n" "$repo_dir" "$owner_repo" "$cfg" "updated" >> "$REPORT"
done

log INFO "Report: $REPORT"
