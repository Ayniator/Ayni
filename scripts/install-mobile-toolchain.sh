#!/usr/bin/env bash
# Root-only bits of the mobile toolchain — Ubuntu 24.04 (noble).
#
#   sudo bash scripts/install-mobile-toolchain.sh
#
# READ THIS FIRST: the Android APK build does NOT need any of this. It was
# already built on this machine with everything installed under $HOME (JDK 21
# and Node 22 in ~/.local/opt, the Android SDK in ~/Android/Sdk). Nothing below
# was a blocker. This script installs the things that genuinely require root and
# that you will want NEXT — plus one that you cannot do without root at all:
# letting `adb` see a phone over USB.
#
# It is idempotent: run it twice, nothing breaks. It installs no Node.js by
# default — see the NODE section at the bottom for why that would be dangerous
# right now.

set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "This script must run as root:  sudo bash $0" >&2
  exit 1
fi

# The user who invoked sudo — group membership and udev access must land on
# them, not on root.
TARGET_USER="${SUDO_USER:-}"
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  echo "Could not determine the invoking user. Run with sudo from your normal account." >&2
  exit 1
fi

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/4  Package index"
apt-get update -qq

# ---------------------------------------------------------------------------
say "2/4  System JDK 21"
# Why: the APK build currently depends on a JDK that exists only in
# ~/.local/opt for one user. A system JDK makes the build reproducible for
# anyone on this box (and for a CI runner that mimics it). Gradle 8.11 and
# Android Gradle Plugin 8.x want 17+; 21 is what the mobile.yml workflow uses,
# so matching it keeps local and CI builds honest.
if [ -d /usr/lib/jvm/java-21-openjdk-amd64 ]; then
  echo "already installed — skipping"
else
  apt-get install -y -qq openjdk-21-jdk
fi

# ---------------------------------------------------------------------------
say "3/4  adb USB access (the one thing that truly needs root)"
# Why: `adb install app-debug.apk` to a real phone fails without udev rules —
# the device shows as "no permissions" or does not appear at all. The rules
# live in /etc/udev/rules.d and the user must be in the plugdev group. This is
# the only item here that you cannot work around from $HOME.
apt-get install -y -qq android-sdk-platform-tools-common
if getent group plugdev >/dev/null; then
  if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx plugdev; then
    echo "$TARGET_USER already in plugdev"
  else
    usermod -aG plugdev "$TARGET_USER"
    echo "added $TARGET_USER to plugdev — LOG OUT AND BACK IN for it to take effect"
  fi
fi
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger 2>/dev/null || true

# ---------------------------------------------------------------------------
say "4/4  GitHub CLI (gh)"
# Why: docs/mobile.md's documented build path is the manual `mobile.yml`
# workflow, and `gh workflow run` / `gh run download` is how you drive it
# without a browser. It is also the only way to pull CI artifacts, which
# GitHub does not serve anonymously.
if command -v gh >/dev/null; then
  echo "already installed — skipping"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh
fi

# ---------------------------------------------------------------------------
cat <<'NOTES'

== Done. What was deliberately NOT installed ==

NODE.JS — not touched, on purpose.
  This box runs Node 18. The Capacitor CLI needs >= 20, so the APK build used a
  private Node 22 in ~/.local/opt instead. Upgrading the SYSTEM Node right now
  is risky: other agent sessions and the frontend Docker build are running
  against 18, and swapping it underneath them can break work in flight.
  When the machine is quiet and you want it system-wide:
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs

IOS — nothing to install here.
  Xcode is macOS-only. An iOS build cannot be produced on this Linux host at
  all, by this script or any other. It needs a Mac (or the macos-latest CI
  runner) plus an Apple Developer signing identity.

YOUR ANDROID SIGNING KEYSTORE — not created, and it should not be.
  The release APK is unsigned and will not install or upload until you sign it.
  The key is yours; an agent must not generate or hold it. When you are ready,
  run this yourself (NO sudo — it belongs to your user, not root):

      keytool -genkeypair -v -keystore ~/aha-release.jks \
        -alias aha -keyalg RSA -keysize 4096 -validity 10000

      ~/Android/Sdk/build-tools/35.0.0/apksigner sign \
        --ks ~/aha-release.jks \
        --out app-release.apk \
        mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk

  Back that keystore up somewhere you will still have in five years. Losing it
  means you can never publish an update to the same Play listing again.

NOTES
