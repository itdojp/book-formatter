#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/scaffold-new-book.sh <owner> <repo> [--create]
OWNER=${1:-}
REPO=${2:-}
CREATE=${3:-}
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "Usage: $0 <owner> <repo> [--create]" >&2; exit 1; fi

WORK=$(mktemp -d)
DST="$WORK/$REPO"
mkdir -p "$DST"

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
  for f in "$@"; do
    rm -f "$f.bak" 2>/dev/null || true
  done
  return "$rc"
}

# Copy starter (docs/ + root files)
cp -R templates/starter/. "$DST/"

# Copy GitHub workflows/templates (optional)
if [ -d templates/.github ]; then
  mkdir -p "$DST/.github"
  cp -R templates/.github/. "$DST/.github/"
fi

# Sync canonical shared components into docs/ (Jekyll conventions)
mkdir -p "$DST/docs/_layouts" "$DST/docs/_includes" "$DST/docs/assets"
cp -R shared/layouts/. "$DST/docs/_layouts/"
cp -R shared/includes/. "$DST/docs/_includes/"
cp -R shared/assets/. "$DST/docs/assets/"

# Fill placeholders
TITLE_DEFAULT="${REPO//-/ }"
sed_inplace "s#<owner>#$OWNER#g; s#<repo>#$REPO#g; s#<BOOK TITLE>#$TITLE_DEFAULT#g; s#<SHORT DESCRIPTION>#Book description#g; s#<AUTHOR>#ITDO Inc.#g" "$DST/docs/_config.yml"
sed_inplace "s#<BOOK TITLE>#$TITLE_DEFAULT#g" "$DST/docs/index.md"
sed_inplace "s#<BOOK TITLE>#$TITLE_DEFAULT#g; s#<owner>#$OWNER#g; s#<repo>#$REPO#g" "$DST/LICENSE.md" "$DST/LICENSE-SCOPE.md" 2>/dev/null || true

# Show next steps
cat <<EON
Scaffolded at: $DST
Next steps:
1) Review docs/_config.yml (title/description/author/baseurl/repository)
2) Update docs/_data/navigation.yml (ToC order)
3) Add chapters under docs/chapters/, appendices under docs/appendices/
4) Review .github/workflows/ (CI/QA)
5) Commit and push to GitHub
EON

if [ "$CREATE" = "--create" ]; then
  gh repo create "$OWNER/$REPO" --public --source "$DST" --remote origin --push
fi
