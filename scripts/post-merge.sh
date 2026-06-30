#!/bin/bash
set -eo pipefail
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

# Sync to GitHub after every merge
if [ -n "$GITHUB_PAT" ]; then
  echo "Pushing to GitHub..."
  GIT_ASKPASS="" GIT_TERMINAL_PROMPT=0 \
    git push "https://praveenks2014:${GITHUB_PAT}@github.com/praveenks2014/includly.git" main
  echo "GitHub sync complete."
else
  echo "GITHUB_PAT not set — skipping GitHub sync."
fi
