#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { connect, takeCallLog, CHAIN_MCP_URL } from "../../lib/mcp.js";
import { summarizeCalls } from "../../lib/agent.js";
import { buildAudit, DEMO_WALLET } from "../../lib/audit.js";

const USAGE = `Usage: node tasks/07-audit-log-agent/audit.js <wallet> [options]

Audit-Log Agent. Builds a read-only activity report for one wallet on
Pharos Pacific Mainnet: token in/out, same-transaction swaps, and approvals
on official USDC, WPROS, LINK and WETH, then writes what the wallet did:
net flow, repeated pairs, counterparties, and approvals still open.

The date range is scanned in full. get_logs is paged in 1000-block windows.
Nothing is sent.

  npm run audit -- ${DEMO_WALLET}
  npm run audit -- ${DEMO_WALLET} --from 2026-10-01 --to 2026-10-16 --lang pt
  npm run audit -- ${DEMO_WALLET} --md report.md --csv report.csv

Options:
  --from YYYY-MM-DD     start day UTC (default: 6 days before --to)
  --to YYYY-MM-DD       end day UTC (default: today)
  --lookback <blocks>   optional ceiling. Omit it to scan the whole date range.
  --lang en|pt          report language (default en)
  --json                print the structured result
  --md <file>           write Markdown
  --csv <file>          write CSV
  --help
`;

function fail(message) {
  console.log(`${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { wallet: null, from: undefined, to: undefined, lookback: null, lang: "en", json: false, md: null, csv: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--json") opts.json = true;
    else if (a === "--from" || a === "--to" || a === "--lookback" || a === "--lang" || a === "--md" || a === "--csv") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) fail(`${a} needs a value.`);
      if (a === "--from") opts.from = v;
      else if (a === "--to") opts.to = v;
      else if (a === "--md") opts.md = v;
      else if (a === "--csv") opts.csv = v;
      else if (a === "--lang") {
        if (v !== "en" && v !== "pt") fail("--lang must be en or pt.");
        opts.lang = v;
      } else {
        if (!/^\d+$/.test(v)) fail("--lookback needs a number.");
        opts.lookback = Number(v);
      }
    } else if (a.startsWith("--")) fail(`Unknown option: ${a}`);
    else if (!opts.wallet) opts.wallet = a;
    else fail(`Unexpected argument: ${a}`);
  }
  if (!opts.wallet) fail("Pass a 0x wallet address.");
  if (opts.lookback != null && (!Number.isInteger(opts.lookback) || opts.lookback < 1)) fail("--lookback must be a positive number of blocks.");
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

let client;
try {
  client = await connect(CHAIN_MCP_URL, "pharos-audit-log-agent");
} catch (e) {
  console.error(`Error: could not connect to Pharos MCP (${e.message})`);
  process.exit(1);
}

try {
  takeCallLog(client);
  const report = await buildAudit(client, opts.wallet, {
    from: opts.from,
    to: opts.to,
    maxLookback: opts.lookback,
    onSlice: (slice) => process.stderr.write(`scanned ${slice.fromBlock}–${slice.toBlock} (${slice.total} events)\n`),
    lang: opts.lang,
  });
  const calls = summarizeCalls(takeCallLog(client));
  if (opts.md) await writeFile(opts.md, report.markdown);
  if (opts.csv) await writeFile(opts.csv, report.csv);
  if (opts.json) {
    console.log(JSON.stringify({ ...report.view, calls }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    console.log(report.text);
    console.log(`\nChain MCP: ${calls}`);
    if (opts.md) console.log(`Markdown: ${opts.md}`);
    if (opts.csv) console.log(`CSV: ${opts.csv}`);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(e.status === 400 ? 2 : 1);
} finally {
  await client.close().catch(() => {});
}
