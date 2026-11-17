#!/usr/bin/env bash
# Decides how much the CI `check` job has to run, and writes `full=true|false` to $GITHUB_OUTPUT.
#
# full=false (the fast path) only for a pull request whose changes are nothing but a version bump: every changed line of
# a code-ish file is a `version` line (Cargo.toml / Cargo.lock / tauri.conf.json / package*.json), plus any Markdown.
# That is what `chore/release-vX.Y.Z` PRs contain. Anything else (a dependency change, a checksum line, any other file)
# runs the full check. The Release workflow compiles every target again from the tag, so a broken bump cannot ship.
#
# Usage: ci-scope.sh <base-sha> <head-sha>    (no arguments = not a pull request = full run)
set -euo pipefail

out() {
  echo "full=$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "CI scope: full=$1 ($2)"
}

if [ $# -lt 2 ]; then
  out true "not a pull request"
  exit 0
fi
base=$1
head=$2

files=$(git diff --name-only "$base" "$head")
if [ -z "$files" ]; then
  out true "empty diff"
  exit 0
fi

while IFS= read -r file; do
  case "$file" in
    *.md) continue ;;
    Cargo.toml | Cargo.lock | crates/*/Cargo.toml | crates/as-gui/tauri.conf.json | gui/package.json | gui/package-lock.json) ;;
    *)
      out true "$file is not a version file"
      exit 0
      ;;
  esac
  # Changed lines only (drop the +++/--- headers). Allowed: `version = "..."` (Cargo.toml, Cargo.lock), a path dependency
  # line carrying a version (`as-core = { path = "...", version = "..." }`), and `"version": "..."` (JSON).
  bad=$(git diff --unified=0 "$base" "$head" -- "$file" \
    | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' \
    | grep -vE '^[+-][[:space:]]*version[[:space:]]*=[[:space:]]*"[^"]*"[[:space:]]*$' \
    | grep -vE '^[+-][[:space:]]*as-[a-z-]+[[:space:]]*=[[:space:]]*\{[^}]*version[[:space:]]*=[[:space:]]*"[^"]*"[^}]*\}[[:space:]]*$' \
    | grep -vE '^[+-][[:space:]]*"version":[[:space:]]*"[^"]*",?[[:space:]]*$' || true)
  if [ -n "$bad" ]; then
    out true "$file has a change that is not a version bump"
    exit 0
  fi
done <<< "$files"

out false "version bump only"
