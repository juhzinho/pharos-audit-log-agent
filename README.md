# Pharos Audit-Log Agent

Read-only **Audit-Log Agent** for [Pharos Agent Arena](https://pharos-agent-arena.vercel.app/). One wallet, a UTC date range, categories, totals, notable transactions, and Markdown / CSV export.

Uses the official [Chain MCP](https://mcp.pharos.xyz/mcp) on Pacific Mainnet (chain 1672). No wallet, no private key, nothing is sent.

```bash
npm install
npm test
npm run audit -- 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647
npm run web
```

Task notes: `tasks/07-audit-log-agent/README.md`.
