#!/bin/bash
# deploy-prod.sh — the ONLY sanctioned way to `vercel deploy --prod` this site.
# Refuses to deploy unless the working tree contains origin/feat/public-site
# (prevents stale machines from rolling production back) and is clean.
set -u
BRANCH="feat/public-site"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1
git fetch -q origin "$BRANCH" || { echo "DEPLOY REFUSED: git fetch failed"; exit 1; }
if ! git merge-base --is-ancestor "origin/$BRANCH" HEAD; then
  echo "DEPLOY REFUSED: HEAD $(git rev-parse --short HEAD) is behind origin/$BRANCH $(git rev-parse --short origin/$BRANCH)."
  echo "Run: git pull --rebase --autostash origin $BRANCH && git push   — then retry."
  exit 1
fi
if [ -n "$(git status --porcelain -- public api vercel.json package.json)" ]; then
  echo "DEPLOY REFUSED: uncommitted changes under public/ api/ — commit them first."; git status --short -- public api; exit 1
fi
if [ -n "$(git log --oneline "origin/$BRANCH..HEAD")" ]; then
  git push -q origin "HEAD:$BRANCH" || { echo "DEPLOY REFUSED: push failed"; exit 1; }
fi
VERCEL="$(command -v vercel || echo "$HOME/.local/bin/vercel")"
exec "$VERCEL" deploy --prod --yes "$@"
