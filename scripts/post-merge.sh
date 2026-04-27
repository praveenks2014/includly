#!/bin/bash
set -eo pipefail
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force
