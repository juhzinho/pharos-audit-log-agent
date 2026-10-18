import { isTransient, takeCallLog, CHAIN_MCP_URL } from "../lib/mcp.js";
import { getSharedClient, resetSharedClient } from "../lib/server-client.js";
import { sendJson } from "../lib/http.js";
import { summarizeCalls } from "../lib/agent.js";
import { hydrateItems, reviveContext } from "../lib/audit.js";
import { buildDigest, packDigest, prepareDigest, sliceDigest, DAYS_APART, SAMPLE } from "../lib/digest.js";
import { DEMO_WALLET } from "../lib/tokens.js";

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

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: "Body must be JSON" });
    }
    const lang = body.lang === "pt" ? "pt" : "en";
    try {
      const digest = packDigest({
        wallet: body.wallet,
        windows: body.windows,
        currentItems: hydrateItems(body.currentItems),
        previousItems: hydrateItems(body.previousItems),
        context: reviveContext(body.context),
        lang,
        capped: Boolean(body.capped),
        days: body.days ?? DAYS_APART,
        headBlock: Number(body.headBlock),
        blockSeconds: body.blockSeconds,
      });
      return sendJson(res, 200, jsonSafe({ ...digest, ms: Date.now() - started }));
    } catch (e) {
      return sendJson(res, e.status || 500, { ok: false, error: e.message });
    }
  }

  const params = new URL(req.url, "http://localhost").searchParams;
  const step = params.get("step");
  const wallet = (params.get("wallet") ?? params.get("q") ?? DEMO_WALLET).trim();
  const lang = params.get("lang") === "pt" ? "pt" : "en";
  const sample = Number(params.get("sample") ?? SAMPLE);
  const days = Number(params.get("days") ?? DAYS_APART);

  if (step === "slice") {
    return withClient(res, async (client) => {
      const slice = await sliceDigest(client, wallet, params.get("fromBlock"), params.get("toBlock"));
      const calls = summarizeCalls(takeCallLog(client));
      return sendJson(res, 200, jsonSafe({ ...slice, calls, ms: Date.now() - started }));
    });
  }

  if (step === "prepare") {
    if (!Number.isInteger(sample) || sample < 1000 || sample > 40_000) {
      return sendJson(res, 400, { ok: false, error: "sample must be 1000 to 40000" });
    }
    return withClient(res, async (client) => {
      const prepared = await prepareDigest(client, wallet, { sample, days });
      const calls = summarizeCalls(takeCallLog(client));
      return sendJson(res, 200, jsonSafe({ ...prepared, calls, ms: Date.now() - started }));
    });
  }

  // Vercel cron would 504 on a full scan. Warm the MCP with prepare only.
  if (req.headers["x-vercel-cron"]) {
    return withClient(res, async (client) => {
      const prepared = await prepareDigest(client, wallet, { sample, days });
      const calls = summarizeCalls(takeCallLog(client));
      return sendJson(res, 200, jsonSafe({ ...prepared, cron: true, calls, ms: Date.now() - started }));
    });
  }

  return withClient(res, async (client) => {
    const digest = await buildDigest(client, wallet, { lang, sample, days });
    const calls = summarizeCalls(takeCallLog(client));
    return sendJson(res, 200, jsonSafe({ ...digest, calls, ms: Date.now() - started }));
  });
}
