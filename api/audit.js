import { isTransient, takeCallLog, CHAIN_MCP_URL } from "../lib/mcp.js";
import { getSharedClient, resetSharedClient } from "../lib/server-client.js";
import { sendJson } from "../lib/http.js";
import { summarizeCalls } from "../lib/agent.js";
import { composeReport, confirmAllowances, hydrateItems, prepareAudit, resolveWallet, reviveContext, SCAN_CHUNK, scanSlice } from "../lib/audit.js";
import { DEMO_WALLET } from "../lib/tokens.js";
import { openApprovals } from "../lib/audit-brief.js";

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(Object.assign(error, { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function withClient(res, fn) {
  try {
    const client = await getSharedClient(CHAIN_MCP_URL);
    takeCallLog(client);
    return await fn(client);
  } catch (e) {
    resetSharedClient(CHAIN_MCP_URL);
    if (e.status === 400) return sendJson(res, 400, { ok: false, error: e.message });
    const busy = isTransient(e);
    return sendJson(res, busy ? 503 : 500, { ok: false, error: busy ? "A Pharos MCP is not responding right now. Retrying…" : e.message });
  }
}

// GET  /api/audit?step=prepare&wallet&from&to
// GET  /api/audit?step=slice&wallet&fromBlock&toBlock
// POST /api/audit  { step:"finish", wallet, range, fromBlock, toBlock, headBlock, items, lang }
export default async function handler(req, res) {
  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: "Body must be JSON" });
    }
    const lang = body.lang === "pt" ? "pt" : "en";
    const items = hydrateItems(body.items);
    const started = Date.now();
    return withClient(res, async (client) => {
      const allowances = await confirmAllowances(client, body.wallet, openApprovals(items), Number(body.headBlock));
      const calls = summarizeCalls(takeCallLog(client));
      const report = composeReport({
        wallet: body.wallet,
        range: body.range,
        fromBlock: Number(body.fromBlock),
        toBlock: Number(body.toBlock),
        headBlock: Number(body.headBlock),
        items,
        context: reviveContext(body.context, allowances),
        lang,
      });
      return sendJson(res, 200, jsonSafe({ ...report.view, markdown: report.markdown, csv: report.csv, calls, ms: Date.now() - started }));
    });
  }

  const params = new URL(req.url, "http://localhost").searchParams;
  const step = params.get("step") ?? "prepare";
  const wallet = (params.get("wallet") ?? params.get("q") ?? DEMO_WALLET).trim();
  const lang = params.get("lang") === "pt" ? "pt" : "en";
  const started = Date.now();

  if (step === "slice") {
    const fromBlock = Number(params.get("fromBlock"));
    const toBlock = Number(params.get("toBlock"));
    if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || toBlock < fromBlock || toBlock - fromBlock + 1 > SCAN_CHUNK) {
      return sendJson(res, 400, { ok: false, error: `slice must cover 1 to ${SCAN_CHUNK} blocks` });
    }
    const resolved = resolveWallet(wallet);
    if (resolved.error) return sendJson(res, 400, { ok: false, error: "Pass a 0x wallet address" });
    return withClient(res, async (client) => {
      const items = await scanSlice(client, resolved.address, fromBlock, toBlock);
      const calls = summarizeCalls(takeCallLog(client));
      const viewItems = composeReport({
        wallet: resolved.address,
        range: { from: "", to: "", days: 0 },
        fromBlock,
        toBlock,
        headBlock: toBlock,
        items,
        lang,
      }).view.items;
      return sendJson(res, 200, { ok: true, fromBlock, toBlock, items: viewItems, calls, ms: Date.now() - started });
    });
  }

  return withClient(res, async (client) => {
    const hours = params.get("hours");
    const prepared = await prepareAudit(client, wallet, {
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      hours: hours ? Number(hours) : undefined,
    });
    const calls = summarizeCalls(takeCallLog(client));
    return sendJson(res, 200, { ...prepared, lang, calls, ms: Date.now() - started });
  });
}
