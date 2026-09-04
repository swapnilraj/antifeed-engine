#!/bin/bash
# wall-gate daemon — runs as root via launchd (com.antifeed.wall-gate).
# Reads gate requests from a user-writable file and applies them to /etc/hosts.
# SECURITY: this script must be root-owned and not writable by non-root (install.sh
# enforces this). The request file is untrusted data — parsed against a strict
# whitelist below, never executed.
set -euo pipefail

HOSTS=/etc/hosts
REQ=__REQ_FILE__   # substituted by install.sh for the installing user
STATE=/var/db/wall-gate.state   # exists (holds epoch) only while a gate opened via request is open
MAX_OPEN_SECS=1800              # dead-man switch: auto-close 30 min after opening
LOG_TAG="wall-gate"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

flush_dns() {
  dscacheutil -flushcache || true
  killall -HUP mDNSResponder 2>/dev/null || true
}

# Unblock: comment out the 127.0.0.1 lines for the domain group.
open_gate() {
  case "$1" in
    twitter)   sed -i '' -E '/twitter\.com|[[:space:].]x\.com/ s/^[[:space:]]*127/#127/' "$HOSTS" ;;
    instagram) sed -i '' -E '/instagram\.com/ s/^[[:space:]]*127/#127/' "$HOSTS" ;;
  esac
  date +%s > "$STATE"
  flush_dns
  log "opened gate: $1"
}

# Block (default state): restore the 127.0.0.1 lines for all wall domains.
close_gates() {
  sed -i '' -E '/twitter\.com|[[:space:].]x\.com|instagram\.com/ s/^#+[[:space:]]*127/127/' "$HOSTS"
  rm -f "$STATE"
  flush_dns
  log "closed all gates"
}

# 1. Process a pending request, if any. Strict whitelist; anything else is ignored.
if [[ -f "$REQ" ]]; then
  request=$(head -c 64 "$REQ" | tr -d '[:cntrl:]')
  if [[ -n "$request" ]]; then
    : > "$REQ"  # consume it
    case "$request" in
      "open twitter")   open_gate twitter ;;
      "open instagram") open_gate instagram ;;
      "open all")       open_gate twitter; open_gate instagram ;;
      "close")          close_gates ;;
      *) log "ignored invalid request: $request" ;;
    esac
  fi
fi

# 2. Dead-man switch: close gates opened via request that have been open too long.
#    Gates opened manually (Swapnil's toggle_* functions) have no STATE file and
#    are deliberately left alone.
if [[ -f "$STATE" ]]; then
  opened_at=$(cat "$STATE" 2>/dev/null || echo 0)
  now=$(date +%s)
  if (( now - opened_at > MAX_OPEN_SECS )); then
    log "dead-man switch: gate open for >${MAX_OPEN_SECS}s"
    close_gates
  fi
fi
