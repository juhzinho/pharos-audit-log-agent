# Task 7 — Audit-Log Agent (Medium · Chain MCP)

Builds an **audit report for a wallet and a date range**: categories, totals, notable transactions with explorer links, and export to Markdown or CSV.

Read-only. No wallet, no private key, no sending.

## Requirements

| Requirement | How |
|---|---|
| Wallet + date range | `0x` address plus `--from` / `--to` (`YYYY-MM-DD`, UTC). Default window is the last 7 days. The whole range is scanned — there is no silent block cap |
| Categories | **In**, **out**, and **self** from official-token `Transfer` logs; **swap** when one transaction moves two different official tokens; **approval** from `Approval` logs |
| Totals | Summed in and out per token (USDC, WPROS, LINK, WETH) |
| Notable txs | Unlimited approvals, multi-token swaps, and the largest legs, each with a Pharosscan link |
| Export | `--md` and `--csv` on the CLI; the page downloads the same files or prints to PDF |
| Extra: a reading | After the log, the agent says what the wallet did: trader / accumulator / distributor, net flow, the pair it repeated, the main counterparties, bursts, and unlimited approvals still open (`allowance()` at the head block). It also reads PROS, token balances, contract-vs-wallet, and USDC `isBlacklisted` |

## What it reads (Chain MCP)

- `get_block_number` and `get_block` — head block and timestamp
- `get_logs` — `Transfer` and `Approval` on the official token contracts, filtered by the wallet as topic1/topic2 (Transfer) or topic1 (Approval owner)

Each `get_logs` call covers 1000 blocks and stays filtered by the official token addresses plus the Transfer or Approval topic. USDC, WPROS, LINK and WETH go in the same call, so a full day needs about a quarter of the requests. The page shows progress and retries when the Chain MCP is busy. `--lookback` is optional; omit it and the dates are the only limit.

## Install and run

```bash
npm install
npm run audit -- 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647
npm run audit -- 0x912c9aDe24D44d8922f0866D8Dcb079f1363f647 --from 2026-10-01 --to 2026-10-16 --lang pt
npm run audit -- 0x… --md report.md --csv report.csv
```

| Option | Default | Meaning |
|---|---|---|
| `--from` / `--to` | last 7 UTC days | Inclusive date range |
| `--lookback` | whole range | Optional block ceiling |
| `--lang` | en | `en` or `pt` |
| `--json` | off | Structured result |
| `--md` / `--csv` | off | Write export files |
