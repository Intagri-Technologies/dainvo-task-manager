#!/usr/bin/env bash
# Canonical entrypoint. Sync with scripts/sync-agent-skills.sh --hooks-only.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/block-dangerous-git.py"
