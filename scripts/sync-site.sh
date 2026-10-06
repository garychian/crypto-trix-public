#!/bin/bash
# sync-site.sh — launchd entry: parse new daily reports → commit → deploy.
# Called by ~/Library/LaunchAgents/com.cryptotrix.syncsite.plist; also safe to run by hand.
# Logs to ~/Library/Logs/cryptotrix-sync.log (configured in the plist).

export HOME="$HOME"
NVM_BIN="$HOME/.nvm/versions/node/v22.20.0/bin"
export PATH="$NVM_BIN:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="$HOME/Downloads/CryptoTrix/crypto-trix-public"

echo "=== sync-site $(date '+%F %T') ==="

out=$(node "$REPO/scripts/sync-checkins.mjs" "$@" 2>&1)
echo "$out"

# 周总结/月总结 + daily snapshots (idempotent; prints SUMMARIES_CHANGED / SUMMARIES_UP_TO_DATE)
case " $* " in *" --dry-run "*) ;; *)
  sum_out=$(node "$REPO/scripts/generate-summaries.mjs" 2>&1)
  echo "$sum_out"
  out="$out
$sum_out"
  ;;
esac

case "$out" in
  *CHANGED*)
    cd "$REPO" || { echo "ERROR: no repo"; exit 1; }
    # Other machines (box agent) also push + deploy this branch: always rebase onto origin first,
    # otherwise `vercel deploy` ships a stale tree and silently rolls back their features.
    git pull --rebase --autostash -q || { echo "ERROR: git pull --rebase failed"; exit 1; }
    git add public/data/fund-checkins.json public/data/summaries.json public/data/snapshots || exit 1
    git commit -q -m "checkins: auto-sync daily report ($(date +%F))" || { echo "nothing to commit"; exit 0; }
    if ! git push -q; then
      echo "ERROR: git push failed (ssh-agent missing key?)"
      exit 1
    fi
    if vercel deploy --prod --yes >/dev/null 2>&1; then
      echo "DEPLOYED"
    else
      echo "ERROR: vercel deploy failed"
      exit 1
    fi
    ;;
  *UP_TO_DATE*)
    echo "no action"
    ;;
  *)
    echo "ERROR: unexpected script output"
    exit 1
    ;;
esac
