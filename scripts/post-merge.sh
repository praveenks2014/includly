#!/bin/bash
set -eo pipefail
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

# Sync to GitHub after every task merge
bash "$(dirname "$0")/sync-to-github.sh"
