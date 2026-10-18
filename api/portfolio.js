import { isTransient, takeCallLog, CHAIN_MCP_URL } from "../lib/mcp.js";
import { getSharedClient, resetSharedClient } from "../lib/server-client.js";
import { sendJson } from "../lib/http.js";
import { summarizeCalls } from "../lib/agent.js";
import { askPortfolio } from "../lib/portfolio.js";
import { DEMO_WALLET } from "../lib/tokens.js";

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "GET only" });
  const params = new URL(req.url, "http://localhost").searchParams;
  const wallet = (params.get("wallet") ?? DEMO_WALLET).trim();
  const question = (params.get("ask") ?? params.get("question") ?? "").trim();
  const lang = params.get("lang") === "pt" ? "pt" : "en";
  const started = Date.now();
  try {
    const client = await getSharedClient(CHAIN_MCP_URL);
    takeCallLog(client);
    const asked = question || (lang === "pt" ? "quanto eu tenho?" : "what do I hold?");
    const result = await askPortfolio(client, wallet, asked, lang);
    const calls = summarizeCalls(takeCallLog(client));
    return sendJson(res, 200, jsonSafe({ ...result, calls, ms: Date.now() - started }));
  } catch (e) {
    resetSharedClient(CHAIN_MCP_URL);
    if (e.status === 400) return sendJson(res, 400, { ok: false, error: e.message });
    const busy = isTransient(e);
    return sendJson(res, busy ? 503 : 500, { ok: false, error: busy ? "A Pharos MCP is not responding right now. Retrying…" : e.message });
  }
}
