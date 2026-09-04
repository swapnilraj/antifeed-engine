#!/bin/bash
# One-time install of the wall-gate LaunchDaemon. Run with: sudo ./install.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo $0"; exit 1; fi

HERE="$(cd "$(dirname "$0")" && pwd)"
DAEMON_SRC="$HERE/wall-gate.sh"
DAEMON_DST=/usr/local/libexec/wall-gate.sh
PLIST_SRC="$HERE/com.antifeed.wall-gate.plist"
PLIST_DST=/Library/LaunchDaemons/com.antifeed.wall-gate.plist
TARGET_USER="${SUDO_USER:-$(logname)}"
TARGET_HOME="$(dscl . -read "/Users/$TARGET_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
TARGET_HOME="${TARGET_HOME:-/Users/$TARGET_USER}"
REQ_DIR="$TARGET_HOME/.wall-gate"

# Daemon script: root-owned, not writable by anyone else (it runs as root).
mkdir -p /usr/local/libexec
sed "s|__REQ_FILE__|$REQ_DIR/request|g" "$DAEMON_SRC" > "$DAEMON_DST"
chown root:wheel "$DAEMON_DST"
chmod 755 "$DAEMON_DST"

# Request file: user-writable trigger, watched by the daemon.
mkdir -p "$REQ_DIR"
touch "$REQ_DIR/request"
chown -R "$TARGET_USER:staff" "$REQ_DIR"
chmod 755 "$REQ_DIR"
chmod 644 "$REQ_DIR/request"

# LaunchDaemon plist.
sed "s|__REQ_FILE__|$REQ_DIR/request|g" "$PLIST_SRC" > "$PLIST_DST"
chown root:wheel "$PLIST_DST"
chmod 644 "$PLIST_DST"

# (Re)load.
launchctl bootout system "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap system "$PLIST_DST"

echo "wall-gate installed and running."
echo "  open:   echo 'open twitter' > ~/.wall-gate/request   (or 'open instagram' / 'open all')"
echo "  close:  echo 'close' > ~/.wall-gate/request"
echo "  log:    tail /var/log/wall-gate.log"
echo "Gates opened this way auto-close after 30 minutes."
