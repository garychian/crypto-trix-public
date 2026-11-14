# Agent rules for crypto-trix-public

- Several machines (user's Mac, box agent) push and deploy branch `feat/public-site`.
- **Before editing data:** `git pull --rebase --autostash origin feat/public-site`.
- **Never run `vercel deploy --prod` / `vercel --prod` directly.** Commit + push, then run
  `scripts/deploy-prod.sh`. It refuses to deploy if HEAD is behind origin or the tree is dirty,
  which is what rolled production back on 2026-10-06 and 2026-10-07.
- Never deploy to / touch the private project `crypto-trix.vercel.app`.
