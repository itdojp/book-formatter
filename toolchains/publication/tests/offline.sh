#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
NODE="$(command -v node)"
PARENT_NET_NS="$(readlink /proc/self/ns/net)"
test -n "$PARENT_NET_NS"
# No silent fallback: an unsupported namespace/Node permission environment fails this gate.
unshare --user --map-root-user --net -- env -i PATH=/usr/bin:/bin \
  ROOT="$ROOT" NODE="$NODE" PARENT_NET_NS="$PARENT_NET_NS" PUBLICATION_OFFLINE_REQUIRED=1 \
  /bin/bash -euo pipefail -c '
    CURRENT_NET_NS="$(readlink /proc/self/ns/net)"
    test -n "$CURRENT_NET_NS"
    test "$CURRENT_NET_NS" != "$PARENT_NET_NS"
    exec timeout 90 "$NODE" --permission --allow-fs-read="$ROOT" \
      --test-isolation=none --test tests/compatibility.test.mjs
  '
