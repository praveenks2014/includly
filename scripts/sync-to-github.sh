#!/bin/bash
# Push the current HEAD of main to github.com/praveenks2014/includly.
# Called by scripts/post-merge.sh after every task merge.
# Uses GIT_ASKPASS so the PAT never appears on the command line.
set -eo pipefail

GITHUB_REPO="https://praveenks2014@github.com/praveenks2014/includly.git"
ASKPASS_SCRIPT="$(dirname "$0")/github-askpass.sh"

if [ -z "${GITHUB_PAT}" ]; then
  echo "ERROR: GITHUB_PAT secret is not set — cannot sync to GitHub." >&2
  exit 1
fi

chmod +x "${ASKPASS_SCRIPT}"

LOCAL_SHA=$(git rev-parse HEAD)
echo "Syncing commit ${LOCAL_SHA} to GitHub..."

GIT_ASKPASS="${ASKPASS_SCRIPT}" \
GIT_TERMINAL_PROMPT=0 \
  git push "${GITHUB_REPO}" HEAD:main

REMOTE_SHA=$(GIT_ASKPASS="${ASKPASS_SCRIPT}" GIT_TERMINAL_PROMPT=0 \
  git ls-remote "${GITHUB_REPO}" refs/heads/main | awk '{print $1}')

if [ "${LOCAL_SHA}" = "${REMOTE_SHA}" ]; then
  echo "GitHub sync verified: ${LOCAL_SHA}"
else
  echo "ERROR: GitHub SHA mismatch — local=${LOCAL_SHA} remote=${REMOTE_SHA}" >&2
  exit 1
fi
