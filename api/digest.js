import { isTransient, takeCallLog, CHAIN_MCP_URL } from "../lib/mcp.js";
import { getSharedClient, resetSharedClient } from "../lib/server-client.js";
import { sendJson } from "../lib/http.js";
import { summarizeCalls } from "../lib/agent.js";
import { buildDigest, DAYS_APART, SAMPLE } from "../lib/digest.js";
import { DEMO_WALLET } from "../lib/tokens.js";

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

// GET /api/digest?wallet=0x…&lang=en
export default async function handler(req, res) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const wallet = (params.get("wallet") ?? params.get("q") ?? DEMO_WALLET).trim();
  const lang = params.get("lang") === "pt" ? "pt" : "en";
  const sample = Number(params.get("sample") ?? SAMPLE);
  const days = Number(params.get("days") ?? DAYS_APART);
  if (!Number.isInteger(sample) || sample < 1000 || sample > 8_000) {
    return sendJson(res, 400, { ok: false, error: "sample must be 1000 to 8000" });
  }
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    return sendJson(res, 400, { ok: false, error: "days must be 1 to 31" });
  }
  const started = Date.now();
  try {
    const client = await getSharedClient(CHAIN_MCP_URL);
    takeCallLog(client);
    const digest = await buildDigest(client, wallet, { lang, sample, days });
    const calls = summarizeCalls(takeCallLog(client));
    return sendJson(res, 200, jsonSafe({ ...digest, calls, ms: Date.now() - started }));
  } catch (e) {
    resetSharedClient(CHAIN_MCP_URL);
    if (e.status === 400) return sendJson(res, 400, { ok: false, error: e.message });
    const busy = isTransient(e);
    return sendJson(res, busy ? 503 : 500, { ok: false, error: busy ? "A Pharos MCP is not responding right now. Retrying…" : e.message });
  }
}
