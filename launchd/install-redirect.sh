#!/bin/bash
# One-time install of the wall-redirect LaunchDaemon. Run with:
#   sudo ./install-redirect.sh
#
# Prereqs (run as YOURSELF first, no sudo):
#   brew install socat mkcert
#   mkcert -install          # adds mkcert's local CA to your keychain (once)
#
# This script (as root) then: generates an mkcert cert covering every gated
# domain, drops it where the daemon can read it, installs + loads the daemon.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run with sudo: sudo $0"; exit 1; fi
: "${SUDO_USER:?must be run via sudo, not as root directly}"

HERE="$(cd "$(dirname "$0")" && pwd)"
DAEMON_SRC="$HERE/wall-redirect.sh"
DAEMON_DST=/usr/local/libexec/wall-redirect.sh
PLIST_SRC="$HERE/com.antifeed.wall-redirect.plist"
PLIST_DST=/Library/LaunchDaemons/com.antifeed.wall-redirect.plist
CERT_DIR=/usr/local/etc/wall-redirect

# Every domain wall-gate sinks to 127.0.0.1 must be in the cert's SANs, or it
# would cert-error instead of redirecting. Keep this in sync with /etc/hosts.
DOMAINS=(
  twitter.com www.twitter.com
  x.com www.x.com
  instagram.com www.instagram.com
  netflix.com www.netflix.com
)

# Resolve the user's tools (brew installs aren't on root's PATH).
run_as_user() { sudo -u "$SUDO_USER" -H bash -lc "$*"; }
MKCERT="$(run_as_user 'command -v mkcert' || true)"
SOCAT="$(run_as_user 'command -v socat' || true)"
[[ -n "$MKCERT" ]] || { echo "mkcert not found — run: brew install mkcert && mkcert -install"; exit 1; }
[[ -n "$SOCAT"  ]] || { echo "socat not found — run: brew install socat"; exit 1; }

# 1. Generate the cert as the USER (so it's signed by their mkcert CA), into a
#    temp dir the user can write, then move it into the root-owned cert dir.
echo "→ generating mkcert cert for: ${DOMAINS[*]}"
TMP="$(run_as_user 'mktemp -d')"
run_as_user "mkcert -cert-file '$TMP/redirect.pem' -key-file '$TMP/redirect-key.pem' ${DOMAINS[*]}"
mkdir -p "$CERT_DIR"
mv "$TMP/redirect.pem" "$TMP/redirect-key.pem" "$CERT_DIR/"
rm -rf "$TMP"
chown -R root:wheel "$CERT_DIR"
chmod 755 "$CERT_DIR"
chmod 644 "$CERT_DIR/redirect.pem"
chmod 600 "$CERT_DIR/redirect-key.pem"

# 2. Daemon script: root-owned, world-readable, executable.
mkdir -p /usr/local/libexec
cp "$DAEMON_SRC" "$DAEMON_DST"
chown root:wheel "$DAEMON_DST"
chmod 755 "$DAEMON_DST"

# 3. LaunchDaemon plist.
cp "$PLIST_SRC" "$PLIST_DST"
chown root:wheel "$PLIST_DST"
chmod 644 "$PLIST_DST"

# 4. (Re)load.
launchctl bootout system "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap system "$PLIST_DST"

echo "wall-redirect installed and running."
echo "  test:  ./gate.sh close && open -a Brave https://x.com   (should land on the wall)"
echo "  log:   tail /var/log/wall-redirect.log"
echo "Only fires while a domain is BLOCKED; open gates (sweeps) are unaffected."
