#!/usr/bin/env bash
set -euo pipefail

# Apply the shared UX core to one explicitly selected consumer worktree.
#
# The runtime contract lives in ConsumerMutationBoundary and UxRollout. This
# wrapper deliberately does not create branches, commits, pushes, or PRs: each
# consumer must pass an independent review/QA/deployment gate before another
# target is selected in a later invocation.

# shellcheck source=./lib.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE' >&2
Usage:
  scripts/rollout_unification.sh --plan <json> --target <consumer-id> [--dry-run]

Options:
  --plan <json>          Audited finite consumer mutation plan. Its operation
                         must be rollout-ux-core.
  --target <consumer-id> Apply or preview exactly one consumer from the plan.
  --dry-run              Validate the formatter/worktree/base/destination
                         contract without changing file contents.

Write mode leaves an allowlisted diff in the isolated linked worktree. Review,
Book QA, main CI, Pages, and public HTTP verification are separate per-consumer
gates. Run this script again only after that review gate is complete.
USAGE
}

PLAN=""
TARGET=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan)
      PLAN="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
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

[ -n "$PLAN" ] || { usage; die "--plan is required"; }
[ -n "$TARGET" ] || { usage; die "--target is required"; }
[ -f "$PLAN" ] || die "--plan not found: $PLAN"

require_cmd node git

ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$(run_dir rollout_unification)"
REPORT="$RUN_DIR/report.tsv"
printf "consumer_id\tmode\tstatus\tmessage\n" > "$REPORT"

args=(
  "$ROOT_DIR/src/index.js"
  rollout-ux
  --plan "$PLAN"
  --target "$TARGET"
  --apply-ux-core
)
if [ "$DRY_RUN" -eq 1 ]; then
  args+=(--dry-run)
fi

set +e
(cd "$ROOT_DIR" && node "${args[@]}")
status=$?
set -e

mode="write"
if [ "$DRY_RUN" -eq 1 ]; then
  mode="dry-run"
fi

if [ "$status" -ne 0 ]; then
  printf "%s\t%s\tERROR\truntime rejected the consumer; no later target was attempted\n" \
    "$TARGET" "$mode" >> "$REPORT"
  log ERROR "Consumer rollout failed and stopped: $TARGET"
  log INFO "Report: $REPORT"
  exit "$status"
fi

printf "%s\t%s\tOK\tconsumer review gate required before the next invocation\n" \
  "$TARGET" "$mode" >> "$REPORT"
log INFO "Consumer rollout completed: $TARGET ($mode)"
log INFO "Next gate: review diff, one PR, Book QA, main CI, Pages, and public HTTP"
log INFO "Report: $REPORT"
