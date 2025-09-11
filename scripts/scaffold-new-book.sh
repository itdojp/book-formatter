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

# Copy starter
cp -R templates/starter/docs "$DST/"
# Fill placeholders in _config.yml
sed -i "s#<owner>#$OWNER#g; s#<repo>#$REPO#g; s#<BOOK TITLE>#${REPO//-/ }#g; s#<SHORT DESCRIPTION>#Book description#g; s#<AUTHOR>#ITDO Inc.#g" "$DST/docs/_config.yml"

# Show next steps
cat <<EON
Scaffolded at: $DST
Next steps:
1) Review docs/_config.yml (title/description/author)
2) Add chapters under docs/chapters/, appendices under docs/appendices/
3) Commit and push to GitHub
EON

if [ "$CREATE" = "--create" ]; then
  gh repo create "$OWNER/$REPO" --public --source "$DST" --remote origin --push
fi
