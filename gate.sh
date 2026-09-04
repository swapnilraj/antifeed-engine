#!/bin/bash
# User-side gate control (no sudo). Requires the wall-gate LaunchDaemon
# (launchd/install.sh) to be installed.
#   ./gate.sh open twitter|instagram|all
#   ./gate.sh close
#   ./gate.sh status
set -euo pipefail
REQ="$HOME/.wall-gate/request"

case "${1:-}" in
  open)
    target="${2:-all}"
    [[ "$target" =~ ^(twitter|instagram|all)$ ]] || { echo "usage: $0 open twitter|instagram|all"; exit 1; }
    [[ -f "$REQ" ]] || { echo "wall-gate daemon not installed — run: sudo launchd/install.sh"; exit 1; }
    echo "open $target" > "$REQ"
    echo "requested: open $target (auto-closes in 30 min)"
    ;;
  close)
    [[ -f "$REQ" ]] || { echo "wall-gate daemon not installed — run: sudo launchd/install.sh"; exit 1; }
    echo "close" > "$REQ"
    echo "requested: close"
    ;;
  status)
    echo "hosts entries (active line = blocked, #commented = open):"
    grep -E "twitter\.com|[[:space:].]x\.com|instagram\.com" /etc/hosts
    ;;
  *)
    echo "usage: $0 open twitter|instagram|all | close | status"
    exit 1
    ;;
esac
