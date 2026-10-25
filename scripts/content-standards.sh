#!/bin/sh
# Delegate to the shared content and UI standards runner.
#
# The rule pack lives in the user's shared agent directory. This repository
# keeps no copy of it, so the rules cannot drift between projects. When the
# pack is not reachable the check is skipped and the gate continues: a missing
# pack must never turn into a red build.
#
# Usage: sh content-standards.sh [root]
PACK="${CONTENT_STANDARDS_HOME:-$HOME/.agents/skills/content-standards}"
RUNNER="$PACK/scripts/run.sh"

if [ ! -f "$RUNNER" ]; then
  echo "content standards: shared rule pack not found at $PACK; skipped"
  exit 0
fi

exec sh "$RUNNER" "$@"
