#!/usr/bin/env bash
# Run inside a copy of this fixture after `git init`.
# Commits a .env.local holding a fake live key, then deletes and gitignores it,
# so the key is gone from the files but still in git history.
set -euo pipefail
KEY="sk_live_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
printf 'STRIPE_SECRET_KEY=%s\n' "$KEY" > .env.local
git add .env.local
git commit -q -m "add local env"
git rm -q --cached .env.local
rm .env.local
printf '.env.local\n' >> .gitignore
git add .gitignore
git commit -q -m "remove env file"
