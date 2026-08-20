#!/bin/sh
#
# setup-dev.sh — run once after cloning. Wires up the DCO git hooks and installs
# every workspace's dependencies. Git doesn't share hooks by default (the
# .git/hooks dir isn't committed), so we point core.hooksPath at our tracked
# .githooks folder.

set -e

echo "→ Pointing git at the shared hooks in .githooks/"
git config core.hooksPath .githooks

echo "→ Making hooks executable"
chmod +x .githooks/* 2>/dev/null || true

echo "→ Installing dependencies for all workspaces (shared, server, client)"
npm install

echo "→ Building shared types (server and client both import @pollen/shared)"
npm run build:shared

echo ""
echo "✓ Done. DCO sign-off is now automatic on every commit."
echo "  Your git identity in use:"
echo "    name:  $(git config user.name  || echo '(unset — please set it)')"
echo "    email: $(git config user.email || echo '(unset — please set it)')"
echo ""
echo "  Start the game with two terminals:"
echo "    npm run dev:server     # authoritative server on :2567"
echo "    npm run dev:client     # browser client on :5173"
