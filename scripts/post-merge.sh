#!/bin/bash
set -eo pipefail
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

if [ -z "$GITHUB_PAT" ]; then
  echo "GITHUB_PAT not set, skipping GitHub sync"
  exit 0
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Skipping GitHub sync: not on main branch (current: '${CURRENT_BRANCH}')"
  exit 0
fi

git config user.email "replit-sync@includly.app" 2>/dev/null || true
git config user.name "Replit Sync" 2>/dev/null || true

echo "Syncing main branch to GitHub..."
git push "https://x-token:${GITHUB_PAT}@github.com/praveenks2014/includly.git" main:main \
  2>&1 | sed "s/${GITHUB_PAT}/***REDACTED***/g"
echo "GitHub sync complete"
