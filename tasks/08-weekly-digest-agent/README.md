# Weekly Digest

A public page that compares a wallet’s latest activity with the same-size window from 7 days ago. Top 3 moves, totals, and whether things sped up or slowed down.

Read-only. Official Chain MCP. `get_logs` stays in 1000-block pages.

Pacific is fast, so this does **not** walk every block of the week. It samples the latest 4000 blocks and the 4000 blocks from a week earlier, then puts the result on `/#digest`. A Vercel cron hits that API every Monday at 12:00 UTC.

```bash
npm run digest -- 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647
```

Live: https://pharos-ledger.vercel.app/#digest
