#!/usr/bin/env bash
set -e

# scripts/release.sh
# Release pipeline: bumps versions, runs the full gate suite, commits, tags, and pushes.
# DO NOT execute this script directly via agents — it mutates git state.
# Usage: bash scripts/release.sh <X.Y.Z>

# ---------------------------------------------------------------------------
# 1. Guard: clean working tree
# ---------------------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash all changes before releasing." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Guard: must be on main branch
# ---------------------------------------------------------------------------
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "ERROR: releases must be cut from main. Current branch: $CURRENT_BRANCH" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Accept and validate version argument
# ---------------------------------------------------------------------------
if [ -z "$1" ]; then
  echo "ERROR: version argument required. Usage: bash scripts/release.sh <X.Y.Z>" >&2
  exit 1
fi
VERSION="$1"

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: version '$VERSION' does not match X.Y.Z format (digits only, no 'v' prefix)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Guard: tag must not already exist
# ---------------------------------------------------------------------------
if [ -n "$(git tag -l "v$VERSION")" ]; then
  echo "ERROR: tag v$VERSION already exists. Bump to a new version number." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Fail if package.json missing
# ---------------------------------------------------------------------------
if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found in $(pwd)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Fail if .claude-plugin/plugin.json missing
# ---------------------------------------------------------------------------
if [ ! -f ".claude-plugin/plugin.json" ]; then
  echo "ERROR: .claude-plugin/plugin.json not found." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 7. Bump version in package.json
# ---------------------------------------------------------------------------
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Bumped package.json -> $VERSION"

# ---------------------------------------------------------------------------
# 8. Bump version in .claude-plugin/plugin.json
# ---------------------------------------------------------------------------
node -e "
  const fs = require('fs');
  const plugin = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
  plugin.version = '${VERSION}';
  fs.writeFileSync('.claude-plugin/plugin.json', JSON.stringify(plugin, null, 2) + '\n');
"
echo "Bumped .claude-plugin/plugin.json -> $VERSION"

# ---------------------------------------------------------------------------
# 8a. Bump capo_version in .claude/.teo-for-claude-version
# ---------------------------------------------------------------------------
if [[ -f ".claude/.teo-for-claude-version" ]]; then
  sed -i.bak "s/^capo_version:.*/capo_version: ${VERSION}/" .claude/.teo-for-claude-version
  rm -f .claude/.teo-for-claude-version.bak
  echo "Bumped .claude/.teo-for-claude-version capo_version -> $VERSION"
fi

# ---------------------------------------------------------------------------
# 9. Run npm run bundle
# ---------------------------------------------------------------------------
echo "Running npm run bundle..."
npm run bundle

# ---------------------------------------------------------------------------
# 10. Run npm run test:cov
# ---------------------------------------------------------------------------
echo "Running npm run test:cov..."
npm run test:cov

# ---------------------------------------------------------------------------
# 11. Run npm run typecheck
# ---------------------------------------------------------------------------
echo "Running npm run typecheck..."
npm run typecheck

# ---------------------------------------------------------------------------
# 12. Commit version bump
# ---------------------------------------------------------------------------
git commit -am "chore: bump version to v$VERSION"

# ---------------------------------------------------------------------------
# 13. Create annotated tag
# ---------------------------------------------------------------------------
git tag -a "v$VERSION" -m "Release v$VERSION"

# ---------------------------------------------------------------------------
# 14. Push commit and tag
# ---------------------------------------------------------------------------
git push origin main && git push origin "v$VERSION"

# ---------------------------------------------------------------------------
# 15. Manual gate reminder
# ---------------------------------------------------------------------------
echo "Release v$VERSION tagged and pushed. Now run: bash scripts/verify-plugin-install.sh — this is a required manual gate that agents cannot run."
