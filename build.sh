#!/usr/bin/env bash
#
# build.sh — Package ShieldBlock Pro into a store-ready ZIP.
#
# The Chrome Web Store and Firefox AMO require manifest.json to sit at the
# ROOT of the uploaded ZIP. GitHub's "Download ZIP" button (and zipping the
# checkout folder itself) nests everything under a <repo>-<branch>/ folder,
# so the store can't find the manifest and reports:
#
#     There was a problem uploading your file. Please try again.
#     The manifest must define a version.
#
# This script always produces a correctly-structured archive: manifest.json
# and all runtime assets live at the root, and dev-only files are excluded.
#
# Usage:
#     ./build.sh [output.zip]      # default: ShieldBlock-Pro-complete-stable.zip
#
set -euo pipefail

# Resolve the output path against the invocation directory *before* we cd into
# the project root, so a relative path argument lands where the caller expects.
# The default is anchored to the repo root regardless of where the script runs.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/ShieldBlock-Pro-complete-stable.zip}"
case "$OUT" in
  /*) ;;                  # absolute path: use as-is
  *)  OUT="$PWD/$OUT" ;;  # relative path: anchor to caller's working directory
esac

cd "$SCRIPT_DIR"

# --- Sanity checks ----------------------------------------------------------
if [ ! -f manifest.json ]; then
  echo "error: manifest.json not found in $(pwd)" >&2
  exit 1
fi

VERSION="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9][0-9.]*"' manifest.json \
            | head -1 | grep -oE '[0-9][0-9.]*')"
if [ -z "$VERSION" ]; then
  echo "error: manifest.json does not define a version" >&2
  exit 1
fi

echo "Packaging ShieldBlock Pro v$VERSION -> $OUT"

# --- Build ------------------------------------------------------------------
# Zip into a secure temp dir (outside the project tree) so the previous
# artifact is never packed into the new one, and clean it up on exit. Include
# everything the extension loads at runtime; exclude dev docs, the build script,
# the artifact itself, VCS metadata, and OS junk.
TMP_DIR="$(mktemp -d -t sbpro-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
TMP="$TMP_DIR/ShieldBlock-Pro.zip"

zip -r -X "$TMP" . \
  -x '.git/*' \
  -x '.gitignore' \
  -x 'CLAUDE.md' \
  -x 'AGENTS.md' \
  -x 'README.md' \
  -x 'build.sh' \
  -x '*.zip' \
  -x '_metadata/*' \
  -x '.DS_Store' -x '*/.DS_Store' \
  -x '*/Thumbs.db' \
  -x '__MACOSX/*' >/dev/null

mv -f "$TMP" "$OUT"

# --- Verify -----------------------------------------------------------------
# manifest.json must be a top-level entry (exact line match), not nested.
if ! unzip -Z1 "$OUT" | grep -qx 'manifest.json'; then
  echo "error: manifest.json is not at the ZIP root — aborting" >&2
  rm -f "$OUT"
  exit 1
fi

echo "Done: $OUT ($(du -h "$OUT" | cut -f1)), manifest.json at archive root."
