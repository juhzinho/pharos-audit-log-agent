#!/usr/bin/env node
import { connect, takeCallLog, CHAIN_MCP_URL } from "../../lib/mcp.js";
import { summarizeCalls } from "../../lib/agent.js";
import { buildDigest } from "../../lib/digest.js";
import { DEMO_WALLET as WALLET } from "../../lib/tokens.js";

const USAGE = `Usage: node tasks/08-weekly-digest-agent/digest.js [wallet]

Weekly digest: this week's latest activity vs the same-size window 7 days ago.
Read-only. Chain MCP get_logs on official tokens.

  npm run digest
  npm run digest -- ${WALLET}
  npm run digest -- ${WALLET} --lang pt
`;

function fail(message) {
  console.log(`${message}\n\n${USAGE}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
let wallet = WALLET;
let lang = "en";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--lang") {
    lang = argv[++i];
    if (lang !== "en" && lang !== "pt") fail("--lang must be en or pt.");
  } else if (argv[i].startsWith("--")) fail(`Unknown option: ${argv[i]}`);
  else wallet = argv[i];
}

let client;
try {
  client = await connect(CHAIN_MCP_URL, "pharos-weekly-digest");
} catch (e) {
  console.error(`Error: could not connect to Pharos MCP (${e.message})`);
  process.exit(1);
}

try {
  takeCallLog(client);
  const digest = await buildDigest(client, wallet, { lang });
  console.log(digest.text);
  const cur = digest.windows.current;
  const prev = digest.windows.previous;
  console.log(`Now  ${cur.fromBlock}–${cur.toBlock}  ${cur.fromTime || ""} → ${cur.toTime || ""}`);
  console.log(`Then ${prev.fromBlock}–${prev.toBlock}  ${prev.fromTime || ""} → ${prev.toTime || ""}`);
  for (const m of digest.metrics) {
    const delta = m.change == null ? "new" : `${m.change > 0 ? "+" : ""}${m.change}%`;
    console.log(`${m.id}  ${m.now} vs ${m.then}  ${delta}`);
  }
  console.log(`\nTop 3`);
  if (digest.net?.length) {
    console.log(`Net  ${digest.net.map((r) => `${r.amount} ${r.symbol}`).join(", ")}`);
  }
  for (const row of digest.top) {
    const detail = (row.legs || []).map((l) => `${l.direction} ${l.amount} ${l.symbol}`).join(", ");
    console.log(`- ${row.category} ${detail}${row.via ? ` via ${row.via}` : ""} ${row.txUrl}`);
  }
  console.log(`\n${digest.note}`);
  console.log(`Chain MCP: ${summarizeCalls(takeCallLog(client))}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(e.status === 400 ? 2 : 1);
} finally {
  await client.close().catch(() => {});
}
