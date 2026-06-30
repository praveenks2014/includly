#!/bin/bash
set -eo pipefail
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

# Re-install the git post-commit hook on every merge so it survives
# any .git/ regeneration by the Replit platform.
HOOK=".git/hooks/post-commit"
mkdir -p .git/hooks
python3 - <<'PYEOF'
import os, stat
hook_path = '/home/runner/workspace/.git/hooks/post-commit'
hook_content = """#!/bin/bash
# Auto-sync to GitHub on every git commit.
SCRIPT="$(git rev-parse --show-toplevel)/scripts/sync-to-github.sh"
if [ -f "${SCRIPT}" ] && [ -n "${GITHUB_PAT}" ]; then
  bash "${SCRIPT}" || true
fi
"""
with open(hook_path, 'w') as f:
    f.write(hook_content)
cur = stat.S_IMODE(os.stat(hook_path).st_mode)
os.chmod(hook_path, cur | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
print(f"post-commit hook installed ({hook_path})")
PYEOF

# Sync to GitHub after every task merge
bash "$(dirname "$0")/sync-to-github.sh"
