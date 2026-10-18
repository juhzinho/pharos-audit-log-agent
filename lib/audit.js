import { decodeEventLog, decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, toEventSelector } from "viem";
import { callJson } from "./mcp.js";
import { fetchTransfers, latestBlock, logWindows, topicAddress, TRANSFER_TOPIC } from "./transfers.js";
import { explorerAddress, explorerTx, formatAmount, formatInteger, labeled, short } from "./format.js";
import { DEMO_WALLET, TOKEN_LIST, tokenByAddress } from "./tokens.js";
import { buildBrief, openApprovals, UNLIMITED } from "./audit-brief.js";

export { DEMO_WALLET, UNLIMITED };

/** One HTTP slice. Inside it, Chain MCP get_logs stays at 1000 blocks per call. */
export const SCAN_CHUNK = 4_000;
/** Official tokens share one get_logs: from, to, and approval. Still 1000-block pages. */
const CALLS_PER_WINDOW = 3;

/** Pacific blocks land about every 2 seconds. Used only to map a date range onto blocks. */
export const BLOCK_SECONDS = 2;
const APPROVAL_TOPIC = toEventSelector("Approval(address,address,uint256)");
const approvalAbi = parseAbi(["event Approval(address indexed owner, address indexed spender, uint256 value)"]);
const TOO_BIG = /too many|result limit|response (too |size)|exceeded|payload|max logs|query returned more/i;

const DAY_MS = 86_400_000;

export function resolveWallet(input) {
  const text = String(input ?? "").trim();
  if (!text) return { error: "empty" };
  if (isAddress(text)) return { address: getAddress(text) };
  const broken = text.match(/0x[0-9a-zA-Z]+/);
  if (broken) return { error: "invalid", raw: broken[0] };
  return { error: "unknown", raw: text };
}

/** Inclusive UTC day range. `to` defaults to today; `from` defaults to 6 days before `to`. */
export function parseDateRange(fromInput, toInput, now = new Date()) {
  const end = toInput ? parseDay(toInput) : utcDay(now);
  if (toInput && !end) return { error: "to" };
  const start = fromInput ? parseDay(fromInput) : new Date(end.getTime() - 6 * DAY_MS);
  if (fromInput && !start) return { error: "from" };
  if (start.getTime() > end.getTime()) return { error: "order" };
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return { from: isoDay(start), to: isoDay(end), fromMs: start.getTime(), toMs: end.getTime() + DAY_MS - 1, days };
}

/** Rolling window ending now. One hour is the practical default: a full UTC day is hundreds of thousands of blocks. */
export function rangeFromHours(hours, now = new Date()) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 31) return { error: "hours" };
  const toMs = now.getTime();
  const fromMs = toMs - n * 3_600_000;
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  return { from: stamp(fromMs), to: stamp(toMs), fromMs, toMs, days: n / 24, hours: n };
}

function parseDay(value) {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1) return null;
  return date;
}

function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** First guess of the block that landed at `targetSec`, from the head timestamp. */
export function guessBlock(headBlock, headTimeSec, targetSec, blockSeconds = BLOCK_SECONDS) {
  if (targetSec >= headTimeSec) return headBlock;
  const shift = Math.round((headTimeSec - targetSec) / blockSeconds);
  return Math.max(0, Math.min(headBlock, headBlock - shift));
}

/** Next guess after reading `blockTime` at `guess`. */
export function nextGuess(guess, blockTime, targetSec, headBlock, blockSeconds = BLOCK_SECONDS) {
  const shift = Math.round((blockTime - targetSec) / blockSeconds);
  if (shift === 0) return guess;
  const moved = Math.max(0, Math.min(headBlock, guess - shift));
  if (moved !== guess) return moved;
  return Math.max(0, Math.min(headBlock, guess + (shift > 0 ? -1 : 1)));
}

/**
 * Estimated inclusive block window for a date range. The live scan replaces
 * this with get_block timestamps. There is no lookback cap.
 */
export function blocksForRange(headBlock, headTimeSec, range) {
  const fromBlock = guessBlock(headBlock, headTimeSec, Math.floor(range.fromMs / 1000));
  const toBlock = range.toMs >= headTimeSec * 1000 ? headBlock : guessBlock(headBlock, headTimeSec, Math.floor(range.toMs / 1000));
  const low = Math.min(fromBlock, toBlock);
  const high = Math.max(fromBlock, toBlock);
  return { fromBlock: low, toBlock: high, capped: false, estimated: true, blockSeconds: BLOCK_SECONDS };
}

export async function headStamp(client) {
  const block = await latestBlock(client);
  let time = null;
  try {
    time = timestampOf(await callJson(client, "get_block", { block, includeTransactions: false }));
  } catch {
    time = null;
  }
  if (!Number.isFinite(time) || time <= 0) time = Math.floor(Date.now() / 1000);
  return { block, time };
}

export function timestampOf(block) {
  const raw = block?.timestamp ?? block?.time ?? block?.block?.timestamp;
  if (raw == null) return null;
  if (typeof raw === "string" && raw.startsWith("0x")) {
    try {
      return Number(BigInt(raw));
    } catch {
      return null;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function blockTime(client, blockNumber) {
  return timestampOf(await callJson(client, "get_block", { block: blockNumber, includeTransactions: false }));
}

export async function measuredBlockSeconds(client, head) {
  const back = Math.min(5_000, head.block);
  if (back < 10) return BLOCK_SECONDS;
  const time = await blockTime(client, head.block - back);
  if (!time || time >= head.time) return BLOCK_SECONDS;
  return Math.min(30, Math.max(0.05, (head.time - time) / back));
}

/** Block at or just after `targetSec`, using the chain's real block time once it is known. */
export async function blockForTime(client, targetSec, head) {
  if (targetSec >= head.time) return head.block;
  let step = head.blockSeconds || BLOCK_SECONDS;
  let guess = guessBlock(head.block, head.time, targetSec, step);
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    if (seen.has(guess)) break;
    seen.add(guess);
    const time = await blockTime(client, guess);
    if (time == null) return guess;
    const observed = (head.time - time) / Math.max(1, head.block - guess);
    if (observed > 0.05 && observed < 30) step = observed;
    const err = time - targetSec;
    if (Math.abs(err) <= step * 3) return err >= 0 ? guess : Math.min(head.block, guess + 1);
    const next = nextGuess(guess, time, targetSec, head.block, step);
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}

async function getLogsPaged(client, address, fromBlock, toBlock, topics) {
  try {
    return await callJson(client, "get_logs", { address, topics, fromBlock, toBlock });
  } catch (error) {
    if (fromBlock >= toBlock || !TOO_BIG.test(`${error.message ?? ""}`)) throw error;
    const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2);
    const [left, right] = await Promise.all([
      getLogsPaged(client, address, fromBlock, mid, topics),
      getLogsPaged(client, address, mid + 1, toBlock, topics),
    ]);
    return [...left, ...right];
  }
}

function decodeApprovals(logs, token) {
  const rows = [];
  for (const log of logs) {
    try {
      const { args } = decodeEventLog({ abi: approvalAbi, eventName: "Approval", data: log.data, topics: log.topics });
      rows.push({
        block: Number(log.blockNumber),
        logIndex: Number(log.logIndex),
        tx: log.transactionHash,
        token: token.symbol,
        decimals: token.decimals,
        protocol: token.protocol,
        contract: token.address,
        owner: getAddress(args.owner),
        spender: getAddress(args.spender),
        value: args.value,
      });
    } catch {
      /* same topic, different layout */
    }
  }
  return rows;
}

async function fetchApprovals(client, token, wallet, fromBlock, toBlock) {
  const topics = [APPROVAL_TOPIC, topicAddress(wallet)];
  const parts = await Promise.all(
    logWindows(fromBlock, toBlock).map((w) => getLogsPaged(client, token.address, w.fromBlock, w.toBlock, topics))
  );
  const byKey = new Map();
  for (const row of parts.flatMap((logs) => decodeApprovals(logs, token))) {
    byKey.set(`${row.tx}:${row.logIndex}`, row);
  }
  return [...byKey.values()];
}

export async function tokenBalance(client, token, holder, block) {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  const { result } = await callJson(client, "eth_call", { transaction: { to: token, data }, block });
  if (!result || result === "0x") return 0n;
  return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: result });
}

const allowanceAbi = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function isBlacklisted(address account) view returns (bool)"]);

export async function readAllowance(client, token, owner, spender, block) {
  const data = encodeFunctionData({ abi: allowanceAbi, functionName: "allowance", args: [owner, spender] });
  const { result } = await callJson(client, "eth_call", { transaction: { to: token.address, data }, block });
  if (!result || result === "0x") return 0n;
  return decodeFunctionResult({ abi: allowanceAbi, functionName: "allowance", data: result });
}

export async function walletContext(client, wallet, block) {
  const [codeRes, balRes, nonceRes, blacklistRes, tokenResults] = await Promise.allSettled([
    callJson(client, "get_code", { address: wallet, block }),
    callJson(client, "get_balance", { address: wallet, block }),
    callJson(client, "get_transaction_count", { address: wallet, block }),
    (async () => {
      const usdc = TOKEN_LIST.find((t) => t.symbol === "USDC");
      const data = encodeFunctionData({ abi: allowanceAbi, functionName: "isBlacklisted", args: [wallet] });
      const { result } = await callJson(client, "eth_call", { transaction: { to: usdc.address, data }, block });
      return decodeFunctionResult({ abi: allowanceAbi, functionName: "isBlacklisted", data: result });
    })(),
    Promise.all(TOKEN_LIST.map(async (token) => ({ token, value: await tokenBalance(client, token.address, wallet, block) }))),
  ]);
  const code = codeRes.status === "fulfilled" ? (codeRes.value.code ?? codeRes.value.result ?? "0x") : "0x";
  const isContract = Boolean(code && code !== "0x");
  const native = balRes.status === "fulfilled" ? BigInt(balRes.value.balanceWei ?? balRes.value.balance ?? balRes.value.result ?? 0) : 0n;
  const nonce = nonceRes.status === "fulfilled" ? Number(nonceRes.value.transactionCount ?? nonceRes.value.count ?? nonceRes.value.result ?? nonceRes.value.nonce ?? 0) : 0;
  const balances = tokenResults.status === "fulfilled" ? tokenResults.value : [];
  return {
    block,
    isContract,
    codeBytes: isContract ? (code.length - 2) / 2 : 0,
    nonce,
    native,
    blacklist: blacklistRes.status === "fulfilled" ? Boolean(blacklistRes.value) : null,
    balances,
  };
}

/** Confirm the latest approvals against live allowance(). Failures stay on the log value. */
export async function confirmAllowances(client, wallet, approvals, block) {
  const tokenBySymbol = new Map(TOKEN_LIST.map((token) => [token.symbol, token]));
  const top = approvals.slice(0, 8);
  const rows = await Promise.all(top.map(async (approval) => {
    const token = tokenBySymbol.get(approval.token);
    if (!token) return { token: approval.token, spender: approval.spender, value: approval.value };
    try {
      const value = await readAllowance(client, token, wallet, approval.spender, block);
      return { token: approval.token, spender: approval.spender, value };
    } catch {
      return { token: approval.token, spender: approval.spender, value: approval.value };
    }
  }));
  return rows;
}

const TOKEN_ADDRESSES = TOKEN_LIST.map((token) => token.address);
const tokenByLogAddress = new Map(TOKEN_LIST.map((token) => [token.address.toLowerCase(), token]));

function logList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.logs)) return result.logs;
  return [];
}

/** A self-transfer matches both the from-topic and the to-topic query. Keep one copy. */
export function uniqueLogs(logs) {
  const seen = new Set();
  return logs.filter((log) => {
    const key = `${log.transactionHash}:${log.logIndex}:${String(log.address ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function officialLogs(client, fromBlock, toBlock, topics) {
  const parts = await Promise.all(
    logWindows(fromBlock, toBlock).map((window) => getLogsPaged(client, TOKEN_ADDRESSES, window.fromBlock, window.toBlock, topics))
  );
  return parts.flatMap(logList);
}

function decodeBatchedTransfers(logs, wallet) {
  const byToken = new Map(TOKEN_LIST.map((token) => [token.symbol, { token, transfers: [] }]));
  for (const log of logs) {
    const token = tokenByLogAddress.get(String(log.address ?? "").toLowerCase());
    if (!token) continue;
    let args;
    try {
      ({ args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data, topics: log.topics }));
    } catch {
      continue;
    }
    if (!directionOf(wallet, args.from, args.to)) continue;
    byToken.get(token.symbol).transfers.push({
      block: Number(log.blockNumber),
      logIndex: Number(log.logIndex),
      tx: log.transactionHash,
      from: args.from,
      to: args.to,
      value: args.value,
    });
  }
  return byToken;
}

function decodeBatchedApprovals(logs, wallet) {
  const me = wallet.toLowerCase();
  const rows = [];
  for (const log of logs) {
    const token = tokenByLogAddress.get(String(log.address ?? "").toLowerCase());
    if (!token) continue;
    try {
      const { args } = decodeEventLog({ abi: approvalAbi, eventName: "Approval", data: log.data, topics: log.topics });
      if (args.owner.toLowerCase() !== me) continue;
      rows.push({
        block: Number(log.blockNumber),
        logIndex: Number(log.logIndex),
        tx: log.transactionHash,
        token: token.symbol,
        decimals: token.decimals,
        protocol: token.protocol,
        contract: token.address,
        owner: getAddress(args.owner),
        spender: getAddress(args.spender),
        value: args.value,
      });
    } catch {
      /* same topic, different layout */
    }
  }
  return rows;
}

async function scanSlicePerToken(client, wallet, fromBlock, toBlock, { includeApprovals = true } = {}) {
  const transfersByToken = new Map();
  const approvalLists = await Promise.all(TOKEN_LIST.map(async (token) => {
    const pack = await fetchTransfers(client, token.address, fromBlock, toBlock, { parties: [wallet] }).then((result) => ({
      token,
      transfers: result.transfers.filter((t) => directionOf(wallet, t.from, t.to)),
    }));
    transfersByToken.set(token.symbol, pack);
    if (!includeApprovals) return [];
    const approvals = await fetchApprovals(client, token, wallet, fromBlock, toBlock);
    return approvals.filter((a) => a.owner.toLowerCase() === wallet.toLowerCase());
  }));
  return categorize(wallet, transfersByToken, approvalLists.flat());
}

/**
 * One slice. Chain MCP get_logs stays filtered by the official token addresses
 * and the Transfer or Approval topic, paged at 1000 blocks. The four tokens go
 * in the same call. Falls back to one token per call if the MCP rejects that.
 */
export async function scanSlice(client, wallet, fromBlock, toBlock, { includeApprovals = true } = {}) {
  const padded = topicAddress(wallet);
  try {
    const jobs = [
      officialLogs(client, fromBlock, toBlock, [TRANSFER_TOPIC, padded]),
      officialLogs(client, fromBlock, toBlock, [TRANSFER_TOPIC, null, padded]),
    ];
    if (includeApprovals) jobs.push(officialLogs(client, fromBlock, toBlock, [APPROVAL_TOPIC, padded]));
    const [fromLogs, toLogs, approvalLogs = []] = await Promise.all(jobs);
    const transfersByToken = decodeBatchedTransfers(uniqueLogs([...fromLogs, ...toLogs]), wallet);
    const approvals = includeApprovals ? decodeBatchedApprovals(uniqueLogs(approvalLogs), wallet) : [];
    return categorize(wallet, transfersByToken, approvals);
  } catch {
    return scanSlicePerToken(client, wallet, fromBlock, toBlock, { includeApprovals });
  }
}

export async function scanRange(client, wallet, fromBlock, toBlock, opts = {}) {
  const items = [];
  const slices = [];
  for (let start = fromBlock; start <= toBlock; start += SCAN_CHUNK) {
    slices.push([start, Math.min(start + SCAN_CHUNK - 1, toBlock)]);
  }
  slices.reverse();
  let scannedFrom = fromBlock;
  let capped = false;
  for (const [start, end] of slices) {
    if (opts.deadline && Date.now() > opts.deadline) {
      capped = true;
      scannedFrom = end + 1;
      break;
    }
    items.push(...await scanSlice(client, wallet, start, end, opts));
    scannedFrom = start;
  }
  items.sort((a, b) => b.block - a.block || a.tx.localeCompare(b.tx));
  return { items, capped, fromBlock: scannedFrom, toBlock };
}

function directionOf(wallet, from, to) {
  const me = wallet.toLowerCase();
  const out = from.toLowerCase() === me;
  const inn = to.toLowerCase() === me;
  if (out && inn) return "self";
  if (out) return "out";
  if (inn) return "in";
  return null;
}

/**
 * Group token movements that share a tx. Two different official tokens in one tx
 * is treated as a swap; a single token stays an in/out (or self) transfer.
 */
export function categorize(wallet, transfersByToken, approvals) {
  const buckets = new Map();
  for (const [symbol, pack] of transfersByToken) {
    for (const t of pack.transfers) {
      const direction = directionOf(wallet, t.from, t.to);
      if (!direction) continue;
      const key = t.tx.toLowerCase();
      if (!buckets.has(key)) buckets.set(key, { tx: t.tx, block: t.block, legs: [], approvals: [] });
      const row = buckets.get(key);
      row.block = Math.min(row.block, t.block);
      row.legs.push({
        ...t,
        symbol,
        decimals: pack.token.decimals,
        protocol: pack.token.protocol,
        contract: pack.token.address,
        direction,
      });
    }
  }
  for (const a of approvals) {
    const key = a.tx.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, { tx: a.tx, block: a.block, legs: [], approvals: [] });
    const row = buckets.get(key);
    row.block = Math.min(row.block, a.block);
    row.approvals.push(a);
  }

  const items = [];
  for (const row of buckets.values()) {
    const symbols = new Set(row.legs.map((l) => l.symbol));
    const base = symbols.size >= 2 ? "swap" : row.approvals.length && !row.legs.length ? "approval" : "transfer";
    if (base === "swap") {
      items.push({ category: "swap", ...row });
    } else if (base === "approval") {
      items.push({ category: "approval", ...row });
    } else {
      for (const leg of row.legs) {
        items.push({
          category: leg.direction === "self" ? "self" : leg.direction,
          tx: row.tx,
          block: leg.block,
          legs: [leg],
          approvals: row.approvals.filter((a) => a.token === leg.symbol),
        });
      }
      if (row.approvals.length && !row.legs.length) items.push({ category: "approval", ...row, legs: [] });
    }
  }
  items.sort((a, b) => b.block - a.block || a.tx.localeCompare(b.tx));
  return items;
}

function add(map, symbol, value) {
  map[symbol] = (map[symbol] ?? 0n) + value;
}

export function totalsOf(items) {
  const incoming = {};
  const outgoing = {};
  const counts = { in: 0, out: 0, self: 0, swap: 0, approval: 0 };
  for (const item of items) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    for (const leg of item.legs) {
      if (leg.direction === "in") add(incoming, leg.symbol, leg.value);
      if (leg.direction === "out") add(outgoing, leg.symbol, leg.value);
      if (leg.direction === "self") {
        add(incoming, leg.symbol, leg.value);
        add(outgoing, leg.symbol, leg.value);
      }
    }
  }
  return { incoming, outgoing, counts, events: items.length };
}

/** Largest absolute leg, unlimited approvals, and multi-token swaps. */
export function notableOf(items, limit = 8) {
  const ranked = [];
  for (const item of items) {
    if (item.category === "swap") ranked.push({ score: 3, item, why: "swap" });
    for (const a of item.approvals) {
      if (a.value >= UNLIMITED) ranked.push({ score: 4, item, why: "unlimited-approval" });
    }
    const biggest = item.legs.reduce((m, l) => (wholeTokens(l) > wholeTokens(m) ? l : m), null);
    if (biggest) ranked.push({ score: 1, item, why: "size", leg: biggest });
  }
  const seen = new Set();
  return ranked
    .sort((a, b) => b.score - a.score || (wholeTokens(b.leg) > wholeTokens(a.leg) ? 1 : wholeTokens(b.leg) < wholeTokens(a.leg) ? -1 : 0))
    .filter((row) => {
      const key = row.item.tx.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function wholeTokens(leg) {
  if (!leg) return 0n;
  const decimals = Number.isInteger(leg.decimals) ? leg.decimals : 18;
  return leg.value / 10n ** BigInt(decimals);
}

function money(raw, decimals, symbol, lang) {
  return `${formatAmount(raw, decimals, 6, lang)} ${symbol}`;
}

const COPY = {
  en: {
    title: "Audit log",
    wallet: "Wallet",
    range: "Date range (UTC)",
    blocks: "Blocks scanned",
    capped: (from, wanted) => `Stopped at the optional --lookback cap. Scanned from block ${formatInteger(from, "en")} (the date range starts near ${formatInteger(wanted, "en")}).`,
    estimate: "Every block in the date range was scanned. get_logs is paged in 1000-block windows. The start and end blocks come from get_block timestamps.",
    empty: "No USDC, USDCe, WPROS, LINK or WETH transfers or approvals for this wallet in the scanned blocks.",
    in: "In",
    out: "Out",
    self: "Self",
    swap: "Swap",
    approval: "Approval",
    categories: "By category",
    totalsIn: "Totals in",
    totalsOut: "Totals out",
    notable: "Notable",
    unlimited: "unlimited approval",
    swapWhy: "two official tokens in the same transaction",
    sizeWhy: "largest amount in the window",
    tx: "tx",
    none: "none",
    items: "Items",
    reading: "Reading",
  },
  pt: {
    title: "Registro de auditoria",
    wallet: "Carteira",
    range: "Intervalo (UTC)",
    blocks: "Blocos varridos",
    capped: (from, wanted) => `Parou no teto opcional de --lookback. Varredura a partir do bloco ${formatInteger(from, "pt")} (o intervalo de datas começa perto de ${formatInteger(wanted, "pt")}).`,
    estimate: "Todos os blocos do intervalo foram varridos. O get_logs é fatiado em janelas de 1000 blocos. O início e o fim vêm do timestamp do get_block.",
    empty: "Nenhuma transferência nem aprovação de USDC, USDCe, WPROS, LINK ou WETH desta carteira nos blocos varridos.",
    items: "Movimentos",
    reading: "Leitura",
    in: "Entrada",
    out: "Saída",
    self: "Própria",
    swap: "Swap",
    approval: "Aprovação",
    categories: "Por categoria",
    totalsIn: "Totais de entrada",
    totalsOut: "Totais de saída",
    notable: "Destaques",
    unlimited: "aprovação ilimitada",
    swapWhy: "dois tokens oficiais na mesma transação",
    sizeWhy: "maior valor da janela",
    tx: "tx",
    none: "nenhum",
  },
};

function catLabel(lang, category) {
  return COPY[lang][category] ?? category;
}

export function presentAudit(report, lang = "en") {
  const t = COPY[lang] ?? COPY.en;
  const lines = [
    `${t.title} — ${report.wallet}`,
    `${t.range}: ${report.range.from} → ${report.range.to} (${report.range.days}d)`,
    `${t.blocks}: ${formatInteger(report.fromBlock, lang)} → ${formatInteger(report.toBlock, lang)}`,
    report.capped ? t.capped(report.fromBlock, report.wantedFrom) : t.estimate,
    "",
    `${t.categories}: ${["in", "out", "self", "swap", "approval"].map((k) => `${catLabel(lang, k)} ${report.counts[k] ?? 0}`).join(" · ")}`,
    `${t.totalsIn}: ${sideLine(report.incoming, lang) || t.none}`,
    `${t.totalsOut}: ${sideLine(report.outgoing, lang) || t.none}`,
  ];
  const briefLines = report.brief?.paragraphs?.[lang] ?? [];
  if (briefLines.length) lines.push("", ...briefLines);
  for (const finding of report.brief?.findings ?? []) lines.push(`- ${finding[lang] || finding.en}`);
  if (!report.items.length) lines.push("", t.empty);
  if (report.notable.length) {
    lines.push("", t.notable);
    for (const n of report.notable) lines.push(`- ${notableLine(n, lang, t)}`);
  }
  lines.push("", t.items);
  for (const item of report.items.slice(0, 40)) lines.push(`- ${itemLine(item, lang)}`);
  if (report.items.length > 40) lines.push(`… ${report.items.length - 40} more in the Markdown and CSV export`);
  return lines.join("\n");
}

function sideLine(map, lang) {
  return Object.entries(map)
    .filter(([, v]) => v > 0n)
    .map(([symbol, value]) => {
      const token = TOKEN_LIST.find((t) => t.symbol === symbol);
      return money(value, token?.decimals ?? 18, symbol, lang);
    })
    .join(" · ");
}

function itemLine(item, lang) {
  const legs = item.legs.map((l) => `${catLabel(lang, l.direction)} ${money(l.value, l.decimals, l.symbol, lang)}`).join(", ");
  const appr = item.approvals.map((a) => `${a.token} → ${short(a.spender)}`).join(", ");
  const blk = lang === "pt" ? "bloco" : "block";
  const apprWord = lang === "pt" ? "aprovação" : "approval";
  return `[${catLabel(lang, item.category)}] ${blk} ${formatInteger(item.block, lang)} ${legs}${appr ? ` ${apprWord} ${appr}` : ""} ${explorerTx(item.tx)}`;
}

function notableLine(n, lang, t) {
  const why = n.why === "unlimited-approval" ? t.unlimited : n.why === "swap" ? t.swapWhy : t.sizeWhy;
  return `${itemLine(n.item, lang)} (${why})`;
}

export function toCsv(report) {
  const header = ["category", "block", "tx", "symbol", "direction", "amount_raw", "decimals", "from", "to", "spender", "protocol", "contract"];
  const rows = [header.join(",")];
  for (const item of report.items) {
    if (!item.legs.length && item.approvals.length) {
      for (const a of item.approvals) {
        rows.push(csvRow(["approval", a.block, a.tx, a.token, "approval", a.value, a.decimals, a.owner, "", a.spender, a.protocol, a.contract]));
      }
    }
    for (const leg of item.legs) {
      rows.push(csvRow([item.category, leg.block, item.tx, leg.symbol, leg.direction, leg.value, leg.decimals, leg.from, leg.to, "", leg.protocol, leg.contract]));
    }
  }
  return `${rows.join("\n")}\n`;
}

function csvRow(cells) {
  return cells.map((c) => {
    const s = c == null ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}

export function toMarkdown(report, lang = "en") {
  const t = COPY[lang] ?? COPY.en;
  const lines = [
    `# ${t.title}`,
    "",
    `| | |`,
    `|---|---|`,
    `| ${t.wallet} | [${short(report.wallet)}](${explorerAddress(report.wallet)}) |`,
    `| ${t.range} | ${report.range.from} → ${report.range.to} |`,
    `| ${t.blocks} | ${formatInteger(report.fromBlock, lang)} → ${formatInteger(report.toBlock, lang)} |`,
    "",
    report.capped ? `> ${t.capped(report.fromBlock, report.wantedFrom)}` : `> ${t.estimate}`,
    "",
    `## ${t.reading}`,
    "",
    ...(report.brief?.paragraphs?.[lang] ?? []),
    ...(report.brief?.findings ?? []).map((finding) => `- ${finding[lang] || finding.en}`),
    "",
    `## ${t.categories}`,
    "",
    ["in", "out", "self", "swap", "approval"].map((k) => `- **${catLabel(lang, k)}:** ${report.counts[k] ?? 0}`).join("\n"),
    "",
    `**${t.totalsIn}:** ${sideLine(report.incoming, lang) || t.none}`,
    "",
    `**${t.totalsOut}:** ${sideLine(report.outgoing, lang) || t.none}`,
    "",
    `## ${t.notable}`,
    "",
  ];
  if (!report.notable.length) lines.push(t.empty);
  for (const n of report.notable) lines.push(`- ${notableLine(n, lang, t)}`);
  lines.push("", `## ${t.items}`, "");
  lines.push("| Category | Block | Detail | Tx |");
  lines.push("|---|---:|---|---|");
  for (const item of report.items) {
    const detail = item.legs.map((l) => `${l.direction} ${money(l.value, l.decimals, l.symbol, lang)}`).join("; ")
      || item.approvals.map((a) => `${a.token} spender ${short(a.spender)}`).join("; ");
    lines.push(`| ${catLabel(lang, item.category)} | ${formatInteger(item.block, lang)} | ${detail} | [tx](${explorerTx(item.tx)}) |`);
  }
  lines.push("");
  return lines.join("\n");
}

function decimalsOf(symbol, given) {
  if (Number.isInteger(given)) return given;
  return TOKEN_LIST.find((token) => token.symbol === symbol)?.decimals ?? 18;
}

function publicItem(item, lang) {
  return {
    category: item.category,
    block: item.block,
    tx: item.tx,
    txUrl: explorerTx(item.tx),
    legs: item.legs.map((l) => ({
      symbol: l.symbol,
      direction: l.direction,
      decimals: decimalsOf(l.symbol, l.decimals),
      amount: formatAmount(l.value, decimalsOf(l.symbol, l.decimals), 6, lang),
      raw: l.value.toString(),
      from: l.from,
      to: l.to,
      fromLabel: labeled(l.from, {}, lang),
      toLabel: labeled(l.to, {}, lang),
      protocol: l.protocol,
      contract: l.contract,
    })),
    approvals: item.approvals.map((a) => ({
      symbol: a.token,
      spender: a.spender,
      spenderLabel: labeled(a.spender, {}, lang),
      decimals: decimalsOf(a.token, a.decimals),
      amount: a.value >= UNLIMITED ? (lang === "pt" ? "ilimitada" : "unlimited") : formatAmount(a.value, decimalsOf(a.token, a.decimals), 4, lang),
      raw: a.value.toString(),
      protocol: a.protocol,
      contract: a.contract,
    })),
  };
}

function publicTotals(map, lang) {
  return Object.entries(map)
    .filter(([, v]) => v > 0n)
    .map(([symbol, value]) => {
      const token = TOKEN_LIST.find((t) => t.symbol === symbol);
      return { symbol, decimals: token?.decimals ?? 18, amount: formatAmount(value, token?.decimals ?? 18, 6, lang), raw: value.toString() };
    });
}

export function reviveContext(pub = {}, allowances = []) {
  return {
    isContract: Boolean(pub.isContract),
    codeBytes: pub.codeBytes ?? 0,
    nonce: pub.nonce ?? 0,
    blacklist: pub.blacklist ?? null,
    block: pub.block,
    native: BigInt(pub.nativeRaw ?? 0),
    balances: (pub.balances ?? []).map((row) => ({
      token: TOKEN_LIST.find((t) => t.symbol === row.symbol) ?? { symbol: row.symbol, decimals: row.decimals ?? 18 },
      value: BigInt(row.raw ?? 0),
    })),
    allowances,
  };
}

export function hydrateItems(items) {
  return (items ?? []).map((item) => ({
    ...item,
    block: Number(item.block),
    legs: (item.legs ?? []).map((leg) => ({ ...leg, value: BigInt(leg.raw ?? leg.value ?? 0) })),
    approvals: (item.approvals ?? []).map((approval) => ({
      ...approval,
      token: approval.token ?? approval.symbol,
      value: BigInt(approval.raw ?? approval.value ?? 0),
    })),
  }));
}

export function publicContext(context, lang) {
  if (!context) return null;
  return {
    block: context.block,
    isContract: context.isContract,
    codeBytes: context.codeBytes,
    nonce: context.nonce,
    blacklist: context.blacklist,
    native: formatAmount(context.native ?? 0n, 18, 4, lang),
    nativeRaw: (context.native ?? 0n).toString(),
    balances: (context.balances ?? []).map(({ token, value }) => ({
      symbol: token.symbol,
      decimals: token.decimals,
      amount: formatAmount(value, token.decimals, 4, lang),
      raw: value.toString(),
    })),
  };
}

export function composeReport({ wallet, range, fromBlock, toBlock, headBlock, items, context, lang = "en", capped = false, wantedFrom = fromBlock }) {
  const totals = totalsOf(items);
  const notable = notableOf(items);
  const brief = buildBrief({
    wallet,
    items,
    counts: totals.counts,
    incoming: totals.incoming,
    outgoing: totals.outgoing,
    context,
  });
  const copy = COPY[lang] ?? COPY.en;
  const report = {
    ok: true,
    wallet,
    walletUrl: explorerAddress(wallet),
    lang,
    range,
    headBlock,
    fromBlock,
    toBlock,
    capped,
    wantedFrom,
    counts: totals.counts,
    incoming: totals.incoming,
    outgoing: totals.outgoing,
    items,
    notable,
    brief,
    context,
    tokens: TOKEN_LIST.map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals, protocol: t.protocol })),
  };
  const view = {
    ok: true,
    wallet,
    walletUrl: report.walletUrl,
    range,
    fromBlock,
    toBlock,
    capped,
    headBlock,
    counts: totals.counts,
    incoming: publicTotals(totals.incoming, lang),
    outgoing: publicTotals(totals.outgoing, lang),
    notable: notable.slice(0, 8).map((row) => ({ why: row.why, ...publicItem(row.item, lang) })),
    items: items.map((item) => publicItem(item, lang)),
    tokens: report.tokens,
    brief,
    context: publicContext(context, lang),
    note: capped ? copy.capped(fromBlock, wantedFrom) : copy.estimate,
  };
  return {
    ...report,
    text: presentAudit(report, lang),
    markdown: toMarkdown(report, lang),
    csv: toCsv(report),
    view,
  };
}

/**
 * Read-only audit of the whole date range: official-token transfers, swaps,
 * approvals, a written reading, and live balances. Nothing is sent.
 * `maxLookback` is an optional explicit ceiling; the default scans every block in the dates.
 */
export async function buildAudit(client, walletInput, { from, to, maxLookback = null, now = new Date(), lang = "en", onSlice } = {}) {
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const range = parseDateRange(from, to, now);
  if (range.error) {
    const err = new Error(range.error === "order" ? "from must be on or before to (YYYY-MM-DD)" : `Bad date: ${range.error}`);
    err.status = 400;
    throw err;
  }
  if (maxLookback != null && (!Number.isInteger(maxLookback) || maxLookback < 1)) {
    const err = new Error("lookback must be a positive number of blocks");
    err.status = 400;
    throw err;
  }

  const head = await headStamp(client);
  head.blockSeconds = await measuredBlockSeconds(client, head);
  let fromBlock = await blockForTime(client, Math.floor(range.fromMs / 1000), head);
  let toBlock = range.toMs >= head.time * 1000 ? head.block : await blockForTime(client, Math.floor(range.toMs / 1000), head);
  if (fromBlock > toBlock) [fromBlock, toBlock] = [toBlock, fromBlock];
  const wantedFrom = fromBlock;
  let capped = false;
  if (maxLookback != null && toBlock - fromBlock + 1 > maxLookback) {
    fromBlock = Math.max(0, toBlock - maxLookback + 1);
    capped = true;
  }

  const context = await walletContext(client, wallet.address, head.block);
  const items = [];
  for (let start = fromBlock; start <= toBlock; start += SCAN_CHUNK) {
    const end = Math.min(start + SCAN_CHUNK - 1, toBlock);
    const slice = await scanSlice(client, wallet.address, start, end);
    items.push(...slice);
    onSlice?.({ fromBlock: start, toBlock: end, added: slice.length, total: items.length });
  }
  items.sort((a, b) => b.block - a.block || a.tx.localeCompare(b.tx));

  const allowances = await confirmAllowances(client, wallet.address, openApprovals(items), head.block);
  context.allowances = allowances;

  return composeReport({
    wallet: wallet.address,
    range,
    fromBlock,
    toBlock,
    headBlock: head.block,
    items,
    context,
    lang,
    capped,
    wantedFrom,
  });
}

function resolveRange({ from, to, hours, now }) {
  if (hours) return rangeFromHours(hours, now);
  return parseDateRange(from, to, now);
}

export async function prepareAudit(client, walletInput, { from, to, hours, now = new Date() } = {}) {
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const range = resolveRange({ from, to, hours, now });
  if (range.error) {
    const err = new Error(range.error === "order" ? "from must be on or before to (YYYY-MM-DD)" : range.error === "hours" ? "hours must be between 1 and 744" : `Bad date: ${range.error}`);
    err.status = 400;
    throw err;
  }
  const head = await headStamp(client);
  head.blockSeconds = await measuredBlockSeconds(client, head);
  let fromBlock = await blockForTime(client, Math.floor(range.fromMs / 1000), head);
  let toBlock = range.toMs >= head.time * 1000 ? head.block : await blockForTime(client, Math.floor(range.toMs / 1000), head);
  if (fromBlock > toBlock) [fromBlock, toBlock] = [toBlock, fromBlock];
  const context = await walletContext(client, wallet.address, head.block);
  const blocks = toBlock - fromBlock + 1;
  const calls = Math.ceil(blocks / 1000) * CALLS_PER_WINDOW;
  return {
    ok: true,
    wallet: wallet.address,
    walletUrl: explorerAddress(wallet.address),
    range,
    headBlock: head.block,
    fromBlock,
    toBlock,
    blocks,
    blockSeconds: head.blockSeconds,
    etaMin: Math.max(1, Math.ceil(calls / 120)),
    chunk: SCAN_CHUNK,
    context: publicContext(context, "en"),
    contextPt: publicContext(context, "pt"),
  };
}

export function tokenOf(address) {
  return tokenByAddress(address);
}
