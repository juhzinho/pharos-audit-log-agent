import { callJson } from "./mcp.js";
import { latestBlock } from "./transfers.js";
import { formatAmount } from "./format.js";
import { TOKEN_LIST } from "./tokens.js";
import {
  BLOCK_SECONDS,
  composeReport,
  notableOf,
  resolveWallet,
  scanSlice,
  totalsOf,
  walletContext,
} from "./audit.js";

export const SAMPLE = 4_000;
export const DAYS_APART = 7;

export function digestWindows(headBlock, blockSeconds, sample = SAMPLE, days = DAYS_APART) {
  const step = blockSeconds > 0 ? blockSeconds : BLOCK_SECONDS;
  const gap = Math.max(sample, Math.round((days * 86_400) / step));
  const currentTo = headBlock;
  const currentFrom = Math.max(0, headBlock - sample + 1);
  const previousTo = Math.max(0, headBlock - gap);
  const previousFrom = Math.max(0, previousTo - sample + 1);
  return {
    sample,
    days,
    gap,
    current: { fromBlock: currentFrom, toBlock: currentTo },
    previous: { fromBlock: previousFrom, toBlock: previousTo },
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

export function story(compare, lang = "en") {
  const events = compare.metrics.find((m) => m.id === "events");
  const swaps = compare.metrics.find((m) => m.id === "swaps");
  const change = events.change;
  if (lang === "pt") {
    if (events.now === 0 && events.then === 0) return "Sem movimento de USDC/WPROS/LINK/WETH nesta amostra nem na de uma semana atrás.";
    const vs = change == null ? "não tinha atividade na semana passada" : change === 0 ? "igual à semana passada" : change > 0 ? `${change}% acima da semana passada` : `${Math.abs(change)}% abaixo da semana passada`;
    return `Esta amostra teve ${events.now} evento(s) (${vs}). Swaps: ${swaps.now} agora, ${swaps.then} na semana passada.`;
  }
  if (events.now === 0 && events.then === 0) return "No USDC/WPROS/LINK/WETH activity in this sample or the one from a week ago.";
  const vs = change == null ? "no activity a week ago" : change === 0 ? "flat vs last week" : change > 0 ? `${change}% above last week` : `${Math.abs(change)}% below last week`;
  return `This sample had ${events.now} event(s) (${vs}). Swaps: ${swaps.now} now, ${swaps.then} a week ago.`;
}

function money(map, lang) {
  return Object.entries(map)
    .filter(([, v]) => v > 0n)
    .map(([symbol, value]) => {
      const token = TOKEN_LIST.find((t) => t.symbol === symbol);
      return { symbol, amount: formatAmount(value, token?.decimals ?? 18, 4, lang), raw: value.toString() };
    });
}

export async function buildDigest(client, walletInput, { lang = "en", sample = SAMPLE, days = DAYS_APART } = {}) {
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const head = await latestBlock(client);
  let blockSeconds = BLOCK_SECONDS;
  try {
    const full = await callJson(client, "get_block", { blockNumber: Math.max(0, head - 5_000) });
    const raw = full.timestamp ?? full.time ?? full.block?.timestamp;
    const t = typeof raw === "string" && raw.startsWith("0x") ? Number(BigInt(raw)) : Number(raw);
    const now = await callJson(client, "get_block", { blockNumber: head });
    const nraw = now.timestamp ?? now.time ?? now.block?.timestamp;
    const n = typeof nraw === "string" && nraw.startsWith("0x") ? Number(BigInt(nraw)) : Number(nraw);
    if (t > 0 && n > t) blockSeconds = (n - t) / 5_000;
  } catch {
    /* keep the 2s guess */
  }
  const windows = digestWindows(head, blockSeconds, sample, days);
  const [currentItems, previousItems, context] = await Promise.all([
    scanSlice(client, wallet.address, windows.current.fromBlock, windows.current.toBlock),
    scanSlice(client, wallet.address, windows.previous.fromBlock, windows.previous.toBlock),
    walletContext(client, wallet.address, head),
  ]);
  const compared = comparePeriods(currentItems, previousItems);
  const current = composeReport({
    wallet: wallet.address,
    range: { from: `block ${windows.current.fromBlock}`, to: `block ${windows.current.toBlock}`, days },
    fromBlock: windows.current.fromBlock,
    toBlock: windows.current.toBlock,
    headBlock: head,
    items: currentItems,
    context,
    lang,
  });
  const previous = composeReport({
    wallet: wallet.address,
    range: { from: `block ${windows.previous.fromBlock}`, to: `block ${windows.previous.toBlock}`, days },
    fromBlock: windows.previous.fromBlock,
    toBlock: windows.previous.toBlock,
    headBlock: head,
    items: previousItems,
    lang,
  });
  const top = notableOf(currentItems, 3).map((row) => {
    const view = current.view.items.find((i) => i.tx?.toLowerCase() === row.item.tx.toLowerCase());
    return view ? { why: row.why, ...view } : null;
  }).filter(Boolean);
  const text = [
    lang === "pt" ? "Digest semanal" : "Weekly digest",
    wallet.address,
    story(compared, lang),
    lang === "pt" ? `Amostra de ${sample} blocos agora vs a mesma largura de ${days} dias atrás.` : `Sample of ${sample} blocks now vs the same width from ${days} days ago.`,
  ].join("\n");
  return {
    ok: true,
    wallet: wallet.address,
    walletUrl: current.view.walletUrl,
    published: true,
    windows,
    blockSeconds,
    story: { en: story(compared, "en"), pt: story(compared, "pt") },
    metrics: compared.metrics,
    incoming: money(compared.current.incoming, lang),
    outgoing: money(compared.current.outgoing, lang),
    top,
    current: current.view,
    previous: {
      fromBlock: windows.previous.fromBlock,
      toBlock: windows.previous.toBlock,
      counts: previous.view.counts,
    },
    note: lang === "pt"
      ? "Não lê cada bloco da semana. Compara as pontas: agora e há 7 dias. get_logs em janelas de 1000."
      : "Does not scan every block of the week. It compares the ends: now vs 7 days ago. get_logs in 1000-block pages.",
    text,
  };
}
