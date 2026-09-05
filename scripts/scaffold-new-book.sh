#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./lib.sh
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<EOF
Usage: $0 <owner> <repo> --output <path> [--create]

Options:
  --output <path>  Required persistent destination. The path must not exist.
  --create         Initialize, commit, and publish the scaffold with gh.
  --help           Show this help.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

OWNER=${1:-}
REPO=${2:-}
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  usage >&2
  die "owner and repository are required"
fi
shift 2

OUTPUT_INPUT=""
CREATE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      if [ -n "$OUTPUT_INPUT" ]; then
        die "--output may be specified only once"
      fi
      if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
        die "--output requires a non-empty path"
      fi
      OUTPUT_INPUT=$2
      shift 2
      ;;
    --create)
      if [ "$CREATE" -eq 1 ]; then
        die "--create may be specified only once"
      fi
      CREATE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

if [ -z "$OUTPUT_INPUT" ]; then
  die "--output <path> is required"
fi

# These finite names cover GitHub owner/repository names while keeping
# placeholder substitution data separate from sed syntax.
if ! [[ "$OWNER" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]]; then
  die "Invalid GitHub owner name: $OWNER"
fi
if [ "$REPO" = "." ] || [ "$REPO" = ".." ] || \
   ! [[ "$REPO" =~ ^[A-Za-z0-9._-]{1,100}$ ]]; then
  die "Invalid GitHub repository name: $REPO"
fi

OUTPUT_PARENT_INPUT="$(dirname -- "$OUTPUT_INPUT")"
OUTPUT_NAME="$(basename -- "$OUTPUT_INPUT")"
if [ -z "$OUTPUT_NAME" ] || [ "$OUTPUT_NAME" = "." ] || \
   [ "$OUTPUT_NAME" = ".." ] || [ "$OUTPUT_NAME" = "/" ]; then
  die "--output must name a new directory"
fi
if [ ! -d "$OUTPUT_PARENT_INPUT" ]; then
  die "Output parent must already be a directory: $OUTPUT_PARENT_INPUT"
fi
OUTPUT_PARENT="$(CDPATH='' cd -- "$OUTPUT_PARENT_INPUT" && pwd -P)"
OUTPUT="$OUTPUT_PARENT/$OUTPUT_NAME"

if [ -e "$OUTPUT" ] || [ -L "$OUTPUT" ]; then
  die "Output path already exists; refusing to overwrite: $OUTPUT"
fi

require_cmd cp env mkdir sed

# Do not let caller-owned repository routing variables redirect local Git or
# the Git subprocesses started by `gh repo create` outside the new output.
run_without_git_routing() (
  unset \
    GIT_DIR \
    GIT_WORK_TREE \
    GIT_INDEX_FILE \
    GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES \
    GIT_COMMON_DIR \
    GIT_NAMESPACE \
    GIT_CONFIG_COUNT \
    GIT_CONFIG_PARAMETERS \
    GIT_CONFIG_GLOBAL \
    GIT_CONFIG_SYSTEM \
    GIT_CONFIG_NOSYSTEM

  local variable
  while IFS= read -r variable; do
    case "$variable" in
      GIT_CONFIG_KEY_*|GIT_CONFIG_VALUE_*) unset "$variable" ;;
    esac
  done < <(compgen -e)

  "$@"
)

run_without_external_git_config() (
  # Keep repository-local configuration available, but prevent an ordinary
  # user/system config from rewriting the publication push destination.
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  "$@"
)

run_git_with_user_config() {
  run_without_git_routing git "$@"
}

run_git() {
  run_without_git_routing run_without_external_git_config git "$@"
}

run_github_com_gh() {
  # A caller-level GH_HOST must not redirect a public repository operation to
  # an identically named owner on a GitHub Enterprise host.
  run_without_git_routing \
    run_without_external_git_config env GH_HOST=github.com gh "$@"
}

git_owner_repo_without_routing() {
  run_without_git_routing \
    run_without_external_git_config git_owner_repo_from_remote "$1"
}

GIT_IDENTITY_NAME=""
GIT_IDENTITY_EMAIL=""

if [ "$CREATE" -eq 1 ]; then
  require_cmd gh git grep

  GIT_IDENTITY_NAME="${GIT_AUTHOR_NAME:-}"
  GIT_IDENTITY_EMAIL="${GIT_AUTHOR_EMAIL:-}"
  if [ -z "$GIT_IDENTITY_NAME" ]; then
    GIT_IDENTITY_NAME="$(run_git_with_user_config -C "$BOOK_FORMATTER_REPO_ROOT" config --get user.name 2>/dev/null || true)"
  fi
  if [ -z "$GIT_IDENTITY_EMAIL" ]; then
    GIT_IDENTITY_EMAIL="$(run_git_with_user_config -C "$BOOK_FORMATTER_REPO_ROOT" config --get user.email 2>/dev/null || true)"
  fi
  if [ -z "$GIT_IDENTITY_NAME" ] || [ -z "$GIT_IDENTITY_EMAIL" ]; then
    die "--create requires a configured Git author name and email"
  fi

  if ! run_github_com_gh auth status --hostname github.com >/dev/null 2>&1; then
    die "GitHub CLI authentication for github.com is required"
  fi

  REMOTE_LOOKUP_ERROR=""
  if REMOTE_LOOKUP_ERROR="$(run_github_com_gh api --hostname github.com --silent "repos/$OWNER/$REPO" 2>&1 >/dev/null)"; then
    die "GitHub repository already exists: $OWNER/$REPO"
  fi
  if ! printf '%s' "$REMOTE_LOOKUP_ERROR" | grep -Eqi '(HTTP[[:space:]]+404|status code[[:space:]]+404)'; then
    die "Unable to prove that GitHub repository $OWNER/$REPO is absent; no local output was created"
  fi
fi

OUTPUT_OWNED=0
LOCAL_SCAFFOLD_COMPLETE=0
cleanup_incomplete_output() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$OUTPUT_OWNED" -eq 1 ] && \
     [ "$LOCAL_SCAFFOLD_COMPLETE" -eq 0 ]; then
    rm -rf -- "$OUTPUT"
  fi
  return "$rc"
}
trap cleanup_incomplete_output EXIT

# mkdir is the no-clobber ownership boundary: it fails if another process
# creates any object at the destination after the preflight check.
mkdir -- "$OUTPUT"
OUTPUT_OWNED=1

sed_inplace() {
  local expr=${1:-}
  shift || true
  if [ -z "$expr" ] || [ "$#" -eq 0 ]; then
    echo "sed_inplace: missing args" >&2
    return 2
  fi

  # Use -i.bak for portability across GNU/BSD sed.
  local rc=0
  sed -i.bak -e "$expr" "$@" || rc=$?
  local file
  for file in "$@"; do
    rm -f "$file.bak" 2>/dev/null || true
  done
  return "$rc"
}

# Preserve the finite legacy-Jekyll scaffold mapping.
cp -R "$BOOK_FORMATTER_REPO_ROOT/templates/starter/." "$OUTPUT/"

if [ -d "$BOOK_FORMATTER_REPO_ROOT/templates/.github" ]; then
  mkdir -p "$OUTPUT/.github"
  cp -R "$BOOK_FORMATTER_REPO_ROOT/templates/.github/." "$OUTPUT/.github/"
fi

mkdir -p "$OUTPUT/docs/_layouts" "$OUTPUT/docs/_includes" "$OUTPUT/docs/assets"
cp -R "$BOOK_FORMATTER_REPO_ROOT/shared/layouts/." "$OUTPUT/docs/_layouts/"
cp -R "$BOOK_FORMATTER_REPO_ROOT/shared/includes/." "$OUTPUT/docs/_includes/"
cp -R "$BOOK_FORMATTER_REPO_ROOT/shared/assets/." "$OUTPUT/docs/assets/"

TITLE_DEFAULT="${REPO//-/ }"
sed_inplace \
  "s#<owner>#$OWNER#g; s#<repo>#$REPO#g; s#<BOOK TITLE>#$TITLE_DEFAULT#g; s#<SHORT DESCRIPTION>#Book description#g; s#<AUTHOR>#ITDO Inc.#g" \
  "$OUTPUT/docs/_config.yml"
sed_inplace "s#<BOOK TITLE>#$TITLE_DEFAULT#g" "$OUTPUT/docs/index.md"
if [ -f "$OUTPUT/.github/PULL_REQUEST_TEMPLATE.md" ]; then
  sed_inplace \
    "s#<owner>#$OWNER#g; s#<repo>#$REPO#g" \
    "$OUTPUT/.github/PULL_REQUEST_TEMPLATE.md"
fi

LICENSE_FILES=()
for candidate in "$OUTPUT/LICENSE.md" "$OUTPUT/LICENSE-SCOPE.md"; do
  if [ -f "$candidate" ]; then
    LICENSE_FILES+=("$candidate")
  fi
done
if [ "${#LICENSE_FILES[@]}" -gt 0 ]; then
  sed_inplace \
    "s#<BOOK TITLE>#$TITLE_DEFAULT#g; s#<owner>#$OWNER#g; s#<repo>#$REPO#g" \
    "${LICENSE_FILES[@]}"
fi

LOCAL_SCAFFOLD_COMPLETE=1

if [ "$CREATE" -eq 1 ]; then
  run_git init --initial-branch=main "$OUTPUT" >/dev/null
  # The scaffold is the complete known worktree. Caller-level global ignore
  # rules must not silently omit generated files from the initial commit.
  run_git -C "$OUTPUT" add --all --force
  GIT_AUTHOR_NAME="$GIT_IDENTITY_NAME" \
  GIT_AUTHOR_EMAIL="$GIT_IDENTITY_EMAIL" \
  GIT_COMMITTER_NAME="$GIT_IDENTITY_NAME" \
  GIT_COMMITTER_EMAIL="$GIT_IDENTITY_EMAIL" \
    run_git -C "$OUTPUT" \
      -c core.hooksPath=/dev/null \
      -c commit.gpgSign=false \
      commit -m "chore: initialize book scaffold" >/dev/null

  if [ "$(run_git -C "$OUTPUT" branch --show-current)" != "main" ] || \
     ! run_git -C "$OUTPUT" rev-parse --verify HEAD >/dev/null 2>&1 || \
     [ -n "$(run_git -C "$OUTPUT" status --porcelain=v1 --untracked-files=all)" ] || \
     run_git -C "$OUTPUT" remote get-url origin >/dev/null 2>&1; then
    die "Local repository preflight failed; retained for inspection: $OUTPUT"
  fi

  # Repository creation is non-idempotent. Do not retry automatically: a
  # network failure can occur after the remote has already been created.
  if ! run_github_com_gh repo create "$OWNER/$REPO" \
      --public \
      --source "$OUTPUT" \
      --remote origin \
      --push; then
    log ERROR "GitHub repository creation or initial push failed"
    if [ "$(run_git -C "$OUTPUT" branch --show-current 2>/dev/null || true)" = "main" ] && \
       [ -z "$(run_git -C "$OUTPUT" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)" ]; then
      log ERROR "The clean local repository is retained at: $OUTPUT"
    else
      log ERROR "The local repository is retained but its state requires inspection: $OUTPUT"
    fi
    log ERROR "Before retrying, inspect: GH_HOST=github.com gh repo view $OWNER/$REPO"
    printf -v OUTPUT_SHELL '%q' "$OUTPUT"
    log ERROR "Also inspect: git -C $OUTPUT_SHELL remote -v"
    exit 1
  fi

  REMOTE_OWNER_REPO="$(git_owner_repo_without_routing "$OUTPUT" 2>/dev/null || true)"
  if [ "$REMOTE_OWNER_REPO" != "$OWNER/$REPO" ] || \
     [ "$(run_git -C "$OUTPUT" branch --show-current)" != "main" ] || \
     [ -n "$(run_git -C "$OUTPUT" status --porcelain=v1 --untracked-files=all)" ]; then
    die "Remote command returned success but the local repository contract is incomplete: $OUTPUT"
  fi
fi

cat <<EOF
Scaffolded at: $OUTPUT
Next steps:
1) Review docs/_config.yml (title/description/author/baseurl/repository)
2) Update docs/_data/navigation.yml (ToC order)
3) Add chapters under docs/chapters/, appendices under docs/appendices/
4) Review .github/workflows/ (CI/QA)
EOF
if [ "$CREATE" -eq 1 ]; then
  echo "5) Verify the created GitHub repository and branch protection"
else
  echo "5) Commit and push to GitHub when the scaffold is ready"
fi
