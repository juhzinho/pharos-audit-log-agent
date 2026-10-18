#!/usr/bin/env node
import { connect, takeCallLog, CHAIN_MCP_URL } from "../../lib/mcp.js";
import { summarizeCalls } from "../../lib/agent.js";
import { askPortfolio } from "../../lib/portfolio.js";
import { DEMO_WALLET as WALLET } from "../../lib/tokens.js";

const USAGE = `Usage: node tasks/09-portfolio-assistant/agent.js [wallet] [question]

Read-only. Official tokens, FaroSwap V3 LPs, Faroo, Harbor Axil, Morpho, TermMax, live Prosper vaults. Other Port dapps stay unread.

  npm run portfolio
  npm run portfolio -- ${WALLET} "where is my USDC?"
  npm run portfolio -- ${WALLET} "quanto eu tenho?" --lang pt
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
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--lang") {
    lang = argv[++i];
    if (lang !== "en" && lang !== "pt") fail("--lang must be en or pt.");
  } else if (argv[i].startsWith("--")) fail(`Unknown option: ${argv[i]}`);
  else rest.push(argv[i]);
}
if (rest[0]?.startsWith("0x")) wallet = rest.shift();
const question = rest.join(" ") || (lang === "pt" ? "quanto eu tenho?" : "what do I hold?");

let client;
try {
  client = await connect(CHAIN_MCP_URL, "pharos-portfolio");
} catch (e) {
  console.error(`Error: could not connect to Pharos MCP (${e.message})`);
  process.exit(1);
}

try {
  takeCallLog(client);
  const got = await askPortfolio(client, wallet, question, lang);
  console.log(got.wallet);
  console.log(lang === "pt" ? `bloco ${got.block}` : `block ${got.block}`);
  console.log(got.story[lang] || got.text);
  if (got.sources?.length) {
    console.log(lang === "pt" ? "\nFontes" : "\nSources");
    for (const s of got.sources) {
      const where = s.contract || (lang === "pt" ? "nativo" : "native");
      const blk = lang === "pt" ? "bloco" : "block";
      console.log(`- ${s.label} ${where} ${blk} ${s.block} ${s.method}`);
    }
  }
  console.log(`\nChain MCP: ${summarizeCalls(takeCallLog(client))}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(e.status === 400 ? 2 : 1);
} finally {
  await client.close().catch(() => {});
}
