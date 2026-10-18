import { countLabel, formatAmount } from "./format.js";
import { TOKEN_LIST, venueTag } from "./tokens.js";
import {
  BLOCK_SECONDS,
  composeReport,
  headStamp,
  measuredBlockSeconds,
  publicContext,
  resolveWallet,
  reviveContext,
  SCAN_CHUNK,
  scanRange,
  scanSlice,
  totalsOf,
  walletContext,
} from "./audit.js";

export const SAMPLE = 40_000;
export const SAMPLE_MAX = 40_000;
export const SAMPLE_HOURS = 12;
export const DAYS_APART = 7;
const SCAN_BUDGET_MS = 50_000;

export function estimatedPreviousTo(headBlock, blockSeconds, days = DAYS_APART, sample = SAMPLE) {
  const step = blockSeconds > 0 ? blockSeconds : BLOCK_SECONDS;
  const gap = Math.max(sample, Math.round((days * 86_400) / step));
  return Math.max(0, headBlock - gap);
}

export function digestWindows(headBlock, { sample = SAMPLE, previousSample, previousTo, days = DAYS_APART } = {}) {
  const currentTo = headBlock;
  const currentFrom = Math.max(0, headBlock - sample + 1);
  const thenWidth = (previousSample ?? sample) - 1;
  let prevTo = previousTo == null ? currentFrom - 1 : previousTo;
  prevTo = Math.max(0, Math.min(prevTo, currentFrom - 1));
  const previousFrom = Math.max(0, prevTo - thenWidth);
  return {
    sample,
    previousSample: previousSample ?? sample,
    days,
    gap: currentTo - prevTo,
    current: { fromBlock: currentFrom, toBlock: currentTo },
    previous: { fromBlock: previousFrom, toBlock: prevTo },
  };
}

export function pct(now, then) {
  if (then === 0) return now === 0 ? 0 : null;
  return Math.round(((now - then) / then) * 100);
}

export function comparePeriods(currentItems, previousItems) {
  const now = totalsOf(currentItems);
  const then = totalsOf(previousItems);
  const metrics = [
    { id: "events", now: currentItems.length, then: previousItems.length },
    { id: "swaps", now: now.counts.swap ?? 0, then: then.counts.swap ?? 0 },
    { id: "in", now: now.counts.in ?? 0, then: then.counts.in ?? 0 },
    { id: "out", now: now.counts.out ?? 0, then: then.counts.out ?? 0 },
  ];
  return {
    metrics: metrics.map((row) => ({ ...row, change: pct(row.now, row.then) })),
    current: now,
    previous: then,
  };
}

function countPhrase(n, lang, one, many) {
  return countLabel(n, lang, one, many);
}

function itemTags(item) {
  const tags = new Set();
  for (const leg of item.legs ?? []) {
    for (const addr of [leg.from, leg.to]) {
      const tag = venueTag(addr);
      if (!tag) continue;
      if (tag === "wrap" && item.category === "swap") continue;
      tags.add(tag);
    }
  }
  if (item.category === "swap" && !tags.has("jumper") && !tags.has("cctp")) {
    const symbols = [...new Set((item.legs ?? []).map((l) => l.symbol))];
    const onlyUsd = symbols.length > 0 && symbols.every((s) => s === "USDC" || s === "USDCe");
    if (!onlyUsd) tags.add("faroswap");
  }
  return tags;
}

export function venuesOf(items) {
  const txs = { faroswap: new Set(), jumper: new Set(), wrap: new Set(), cctp: new Set() };
  for (const item of items ?? []) {
    const key = String(item.tx || "").toLowerCase();
    for (const tag of itemTags(item)) txs[tag].add(key);
  }
  return {
    faroswap: txs.faroswap.size,
    jumper: txs.jumper.size,
    wrap: txs.wrap.size,
    cctp: txs.cctp.size,
  };
}

export function netOf(incoming = {}, outgoing = {}) {
  const net = {};
  for (const symbol of new Set([...Object.keys(incoming), ...Object.keys(outgoing)])) {
    net[symbol] = (incoming[symbol] ?? 0n) - (outgoing[symbol] ?? 0n);
  }
  return net;
}

function venueLine(venues, lang = "en") {
  if (!venues) return "";
  const bits = [];
  if (venues.faroswap) bits.push(`FaroSwap ${venues.faroswap}`);
  if (venues.jumper) bits.push(`Jumper ${venues.jumper}`);
  if (venues.cctp) bits.push(`CCTP ${venues.cctp}`);
  if (venues.wrap) bits.push(lang === "pt" ? `wrap WPROS ${venues.wrap}` : `WPROS wrap ${venues.wrap}`);
  if (!bits.length) return "";
  return lang === "pt" ? ` Onde: ${bits.join(", ")}.` : ` Where: ${bits.join(", ")}.`;
}

export function story(compare, lang = "en", venues = null, extra = {}) {
  const events = compare.metrics.find((m) => m.id === "events");
  const swaps = compare.metrics.find((m) => m.id === "swaps");
  const change = events.change;
  const cap = extra.capped
    ? (lang === "pt" ? " Comparação incompleta: uma janela parou cedo." : " Incomplete comparison: one window stopped early.")
    : "";
  if (lang === "pt") {
    if (events.now === 0 && events.then === 0) {
      return "Sem movimento de USDC, USDCe, WPROS, LINK ou WETH nesta amostra nem na de sete dias atrás. PROS nativo e memes ficam de fora." + cap;
    }
    const vs = change == null
      ? "não tinha atividade sete dias atrás"
      : change === 0
        ? "igual à amostra de sete dias atrás"
        : change > 0
          ? `${change}% acima da amostra de sete dias atrás`
          : `${Math.abs(change)}% abaixo da amostra de sete dias atrás`;
    return `${countPhrase(events.now, "pt", "evento", "eventos")} agora (${vs}). Swaps: ${swaps.now} agora, ${swaps.then} antes.${venueLine(venues, "pt")}${cap}`;
  }
  if (events.now === 0 && events.then === 0) {
    return "No USDC, USDCe, WPROS, LINK or WETH activity in this sample or the one from seven days ago. Native PROS and meme tokens are out of scope." + cap;
  }
  const vs = change == null
    ? "no activity seven days ago"
    : change === 0
      ? "flat vs seven days ago"
      : change > 0
        ? `${change}% above the sample from seven days ago`
        : `${Math.abs(change)}% below the sample from seven days ago`;
  return `${countPhrase(events.now, "en", "event", "events")} now (${vs}). Swaps: ${swaps.now} now, ${swaps.then} then.${venueLine(venues, "en")}${cap}`;
}

function utcStamp(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function money(map, lang, { signed = false } = {}) {
  return Object.entries(map)
    .filter(([, v]) => (signed ? v !== 0n : v > 0n))
    .map(([symbol, value]) => {
      const token = TOKEN_LIST.find((t) => t.symbol === symbol);
      const decimals = token?.decimals ?? 18;
      const abs = value < 0n ? -value : value;
      const core = formatAmount(abs, decimals, 4, lang);
      const enCore = formatAmount(abs, decimals, 4, "en");
      const ptCore = formatAmount(abs, decimals, 4, "pt");
      const mark = !signed ? "" : value < 0n ? "−" : "+";
      return {
        symbol,
        decimals,
        amount: `${mark}${core}`,
        en: `${mark}${enCore}`,
        pt: `${mark}${ptCore}`,
        raw: value.toString(),
      };
    });
}

function estimatedTime(head, blockNumber) {
  const step = head.blockSeconds > 0 ? head.blockSeconds : BLOCK_SECONDS;
  return head.time - (head.block - blockNumber) * step;
}

function stampWindows(windows, head) {
  windows.current.fromTime = utcStamp(estimatedTime(head, windows.current.fromBlock));
  windows.current.toTime = utcStamp(head.time);
  windows.previous.fromTime = utcStamp(estimatedTime(head, windows.previous.fromBlock));
  windows.previous.toTime = utcStamp(estimatedTime(head, windows.previous.toBlock));
  return windows;
}

function saneDays(days) {
  const n = Number(days);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : DAYS_APART;
}

export async function prepareDigest(client, walletInput, { sample = SAMPLE, days = DAYS_APART } = {}) {
  days = saneDays(days);
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const head = await headStamp(client);
  head.blockSeconds = await measuredBlockSeconds(client, head);
  const guess = Math.round((SAMPLE_HOURS * 3_600) / (head.blockSeconds || BLOCK_SECONDS));
  const width = Math.min(SAMPLE_MAX, Math.max(4_000, Number.isInteger(sample) ? Math.min(sample, SAMPLE_MAX) : SAMPLE, guess || SAMPLE));
  const previousTo = estimatedPreviousTo(head.block, head.blockSeconds, days, width);
  const windows = stampWindows(
    digestWindows(head.block, { sample: width, previousSample: width, previousTo, days }),
    head
  );
  const context = await walletContext(client, wallet.address, head.block);
  return {
    ok: true,
    wallet: wallet.address,
    windows,
    headBlock: head.block,
    blockSeconds: head.blockSeconds,
    chunk: SCAN_CHUNK,
    days,
    headTime: head.time,
    context: publicContext(context, "en"),
    contextPt: publicContext(context, "pt"),
  };
}

export async function sliceDigest(client, walletInput, fromBlock, toBlock) {
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const from = Number(fromBlock);
  const to = Number(toBlock);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from >= SCAN_CHUNK) {
    const err = new Error("slice must be an integer block range under 4000");
    err.status = 400;
    throw err;
  }
  const items = await scanSlice(client, wallet.address, from, to, { includeApprovals: false });
  return { ok: true, items, fromBlock: from, toBlock: to };
}

export function packDigest({
  wallet,
  windows,
  currentItems,
  previousItems,
  context,
  lang = "en",
  capped = false,
  days = DAYS_APART,
  headBlock,
  blockSeconds,
}) {
  if (!wallet || !windows?.current || !windows?.previous) {
    const err = new Error("pack needs wallet and both windows");
    err.status = 400;
    throw err;
  }
  const compared = comparePeriods(currentItems ?? [], previousItems ?? []);
  const venues = venuesOf(currentItems);
  const net = money(netOf(compared.current.incoming, compared.current.outgoing), lang, { signed: true });
  const current = composeReport({
    wallet,
    range: {
      from: windows.current.fromTime || `block ${windows.current.fromBlock}`,
      to: windows.current.toTime || `block ${windows.current.toBlock}`,
      days,
    },
    fromBlock: windows.current.fromBlock,
    toBlock: windows.current.toBlock,
    headBlock: headBlock ?? windows.current.toBlock,
    items: currentItems,
    context,
    lang,
  });
  const nowBlocks = windows.current.toBlock - windows.current.fromBlock + 1;
  const thenBlocks = windows.previous.toBlock - windows.previous.fromBlock + 1;
  const sampleLine = lang === "pt"
    ? `Agora: ${nowBlocks} blocos. Há ${days} dias: ${thenBlocks} blocos.`
    : `Now: ${nowBlocks} blocks. ${days} days ago: ${thenBlocks} blocks.`;
  const extra = { capped };
  const text = [lang === "pt" ? "Digest semanal" : "Weekly digest", wallet, story(compared, lang, venues, extra), sampleLine].join("\n");
  const top = current.view.notable.slice(0, 3).map((row) => {
    const tags = itemTags(row);
    const via = tags.has("faroswap") ? "FaroSwap" : tags.has("jumper") ? "Jumper" : tags.has("cctp") ? "CCTP" : tags.has("wrap") ? "WPROS" : "";
    return via ? { ...row, via } : row;
  });
  return {
    ok: true,
    wallet,
    walletUrl: current.view.walletUrl,
    published: true,
    windows,
    blockSeconds,
    story: { en: story(compared, "en", venues, extra), pt: story(compared, "pt", venues, extra) },
    venues,
    net,
    metrics: compared.metrics,
    incoming: money(compared.current.incoming, lang),
    outgoing: money(compared.current.outgoing, lang),
    incomingThen: money(compared.previous.incoming, lang),
    outgoingThen: money(compared.previous.outgoing, lang),
    holdings: current.view.context,
    top,
    current: {
      fromBlock: windows.current.fromBlock,
      toBlock: windows.current.toBlock,
      fromTime: windows.current.fromTime,
      toTime: windows.current.toTime,
      counts: current.view.counts,
    },
    previous: {
      fromBlock: windows.previous.fromBlock,
      toBlock: windows.previous.toBlock,
      fromTime: windows.previous.fromTime,
      toTime: windows.previous.toTime,
      counts: compared.previous.counts,
    },
    capped,
    note: lang === "pt"
      ? `Não lê a semana inteira. Compara duas janelas da mesma largura (~${SAMPLE_HOURS} h), agora e há ${days} dias. Só tokens oficiais + USDCe — PROS nativo e memes ficam de fora.${capped ? " Parou cedo para não estourar o tempo." : ""}`
      : `Does not scan the whole week. It compares two same-size windows (~${SAMPLE_HOURS} h), now and ${days} days ago. Official tokens + USDCe only — native PROS and memes are out of scope.${capped ? " Stopped early to stay inside the time budget." : ""}`,
    notes: {
      en: `Does not scan the whole week. It compares two same-size windows (~${SAMPLE_HOURS} h), now and ${days} days ago. Official tokens + USDCe only — native PROS and memes are out of scope.${capped ? " Stopped early to stay inside the time budget." : ""}`,
      pt: `Não lê a semana inteira. Compara duas janelas da mesma largura (~${SAMPLE_HOURS} h), agora e há ${days} dias. Só tokens oficiais + USDCe — PROS nativo e memes ficam de fora.${capped ? " Parou cedo para não estourar o tempo." : ""}`,
    },
    text,
  };
}

export async function buildDigest(client, walletInput, { lang = "en", sample = SAMPLE, days = DAYS_APART } = {}) {
  const prepared = await prepareDigest(client, walletInput, { sample, days });
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const opts = { includeApprovals: false, deadline };
  const nowScan = await scanRange(client, prepared.wallet, prepared.windows.current.fromBlock, prepared.windows.current.toBlock, opts);
  const thenScan = Date.now() < deadline - 4_000
    ? await scanRange(client, prepared.wallet, prepared.windows.previous.fromBlock, prepared.windows.previous.toBlock, opts)
    : { items: [], capped: true, fromBlock: prepared.windows.previous.toBlock, toBlock: prepared.windows.previous.toBlock };
  const windows = { ...prepared.windows, current: { ...prepared.windows.current }, previous: { ...prepared.windows.previous } };
  if (nowScan.capped) windows.current.fromBlock = nowScan.fromBlock;
  if (thenScan.capped) windows.previous.fromBlock = thenScan.fromBlock;
  stampWindows(windows, { block: prepared.headBlock, time: prepared.headTime, blockSeconds: prepared.blockSeconds });
  return packDigest({
    wallet: prepared.wallet,
    windows,
    currentItems: nowScan.items,
    previousItems: thenScan.items,
    context: reviveContext(lang === "pt" ? prepared.contextPt : prepared.context),
    lang,
    capped: Boolean(nowScan.capped || thenScan.capped),
    days: prepared.days,
    headBlock: prepared.headBlock,
    blockSeconds: prepared.blockSeconds,
  });
}
