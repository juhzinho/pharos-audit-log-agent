import { formatAmount, labeled, short } from "./format.js";
import { TOKEN_LIST } from "./tokens.js";

export const UNLIMITED = 10n ** 30n;

const STANCE = {
  trader: { en: "trader", pt: "trader" },
  accumulator: { en: "accumulator", pt: "acumulador" },
  distributor: { en: "distributor", pt: "distribuidor" },
  quiet: { en: "quiet", pt: "sem movimento" },
  mixed: { en: "mixed", pt: "misto" },
};

function decimalsOf(symbol) {
  return TOKEN_LIST.find((t) => t.symbol === symbol)?.decimals ?? 18;
}

function money(raw, symbol, lang) {
  const sign = raw < 0n ? "−" : "";
  return `${sign}${formatAmount(raw < 0n ? -raw : raw, decimalsOf(symbol), 4, lang)} ${symbol}`;
}

function add(map, symbol, value) {
  map[symbol] = (map[symbol] ?? 0n) + value;
}

export function netMap(incoming, outgoing) {
  const symbols = new Set([...Object.keys(incoming), ...Object.keys(outgoing)]);
  const net = {};
  for (const symbol of symbols) net[symbol] = (incoming[symbol] ?? 0n) - (outgoing[symbol] ?? 0n);
  return net;
}

export function swapPairs(items) {
  const pairs = new Map();
  for (const item of items) {
    if (item.category !== "swap") continue;
    const key = [...new Set(item.legs.map((l) => l.symbol))].sort().join("/");
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return [...pairs.entries()].map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count);
}

export function counterpartiesOf(items, wallet) {
  const me = wallet.toLowerCase();
  const map = new Map();
  for (const item of items) {
    for (const leg of item.legs ?? []) {
      const other = leg.direction === "in" ? leg.from : leg.direction === "out" ? leg.to : null;
      if (!other || other.toLowerCase() === me) continue;
      const key = other.toLowerCase();
      if (!map.has(key)) map.set(key, { address: other, txs: new Set(), inn: {}, out: {} });
      const row = map.get(key);
      row.txs.add(item.tx);
      add(leg.direction === "in" ? row.inn : row.out, leg.symbol, leg.value);
    }
  }
  return [...map.values()]
    .map((row) => ({ address: row.address, txCount: row.txs.size, inn: row.inn, out: row.out }))
    .sort((a, b) => b.txCount - a.txCount || b.address.localeCompare(a.address));
}

/** Latest non-zero approval per token + spender, oldest first so the last write wins. */
export function openApprovals(items) {
  const latest = new Map();
  const ordered = items.filter((item) => item.approvals?.length).sort((a, b) => a.block - b.block);
  for (const item of ordered) {
    for (const approval of item.approvals) {
      latest.set(`${approval.token}:${approval.spender.toLowerCase()}`, approval);
    }
  }
  return [...latest.values()].filter((approval) => approval.value > 0n);
}

/** Most events inside a block window. Null when the log is too thin to call it a burst. */
export function tightestBurst(items, window = 400) {
  const blocks = items.map((item) => item.block).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  if (blocks.length < 5) return null;
  let best = null;
  let start = 0;
  for (let end = 0; end < blocks.length; end++) {
    while (blocks[end] - blocks[start] > window) start++;
    const count = end - start + 1;
    if (!best || count > best.count) best = { count, from: blocks[start], to: blocks[end], window };
  }
  return best && best.count >= 5 ? best : null;
}

export function stanceOf(counts, net) {
  const swaps = counts.swap ?? 0;
  const moves = (counts.in ?? 0) + (counts.out ?? 0) + swaps + (counts.self ?? 0);
  if (moves === 0 && !(counts.approval ?? 0)) return "quiet";
  const values = Object.values(net);
  const gained = values.some((v) => v > 0n);
  const lost = values.some((v) => v < 0n);
  if (swaps >= 3 || (swaps > 0 && swaps >= moves / 2)) return "trader";
  if (gained && !lost && swaps === 0) return "accumulator";
  if (lost && !gained && swaps === 0) return "distributor";
  if (swaps > 0) return "trader";
  return "mixed";
}

function netLine(net, lang) {
  const parts = Object.entries(net)
    .filter(([, value]) => value !== 0n)
    .map(([symbol, value]) => money(value, symbol, lang));
  return parts.join(lang === "pt" ? " · " : " · ");
}

function partyLine(row, lang) {
  const name = labeled(row.address, {}, lang);
  const sides = [];
  for (const symbol of new Set([...Object.keys(row.inn), ...Object.keys(row.out)])) {
    const inn = row.inn[symbol] ?? 0n;
    const out = row.out[symbol] ?? 0n;
    if (inn === 0n && out === 0n) continue;
    sides.push(lang === "pt" ? `${symbol} entra ${money(inn, symbol, lang)} / sai ${money(out, symbol, lang)}` : `${symbol} in ${money(inn, symbol, lang)} / out ${money(out, symbol, lang)}`);
  }
  return { address: row.address, name, txCount: row.txCount, detail: sides.join(" · ") };
}

function paragraphs(lang, { stance, counts, pairs, net, context, events }) {
  const label = STANCE[stance][lang];
  const netText = netLine(net, lang);
  const top = pairs[0];
  if (lang === "pt") {
    if (stance === "quiet") {
      return [
        "Nenhum transfer ou approval de USDC, WPROS, LINK ou WETH desta carteira no intervalo. O saldo abaixo é o estado no bloco mais recente, não um movimento deste período.",
      ];
    }
    const pairBit = top ? ` O par mais repetido foi ${top.pair} (${top.count}×).` : "";
    const netBit = netText ? ` Variação líquida: ${netText}.` : " Entradas e saídas se anulam em valor bruto por token.";
    const who = context.isContract ? "O endereço é um contrato." : "O endereço é uma carteira (EOA).";
    return [
      `Leitura: ${label}. ${events} evento(s) — ${counts.swap ?? 0} swap(s), ${counts.in ?? 0} entrada(s), ${counts.out ?? 0} saída(s), ${counts.approval ?? 0} aprovação(ões).${pairBit}${netBit}`,
      who,
    ];
  }
  if (stance === "quiet") {
    return [
      "No USDC, WPROS, LINK or WETH transfers or approvals for this wallet in the range. Balances below are the live head block, not movement from this period.",
    ];
  }
  const pairBit = top ? ` The pair that repeated most was ${top.pair} (${top.count}×).` : "";
  const netBit = netText ? ` Net change: ${netText}.` : " Inflows and outflows cancel on gross token amount.";
  const who = context.isContract ? "The address is a contract." : "The address is a wallet (EOA).";
  return [
    `Reading: ${label}. ${events} event(s) — ${counts.swap ?? 0} swap(s), ${counts.in ?? 0} in, ${counts.out ?? 0} out, ${counts.approval ?? 0} approval(s).${pairBit}${netBit}`,
    who,
  ];
}

function findingsOf({ approvals, liveAllowances, burst, parties, counts, context, events }) {
  const findings = [];
  const live = new Map((liveAllowances ?? []).map((row) => [`${row.token}:${row.spender.toLowerCase()}`, row]));
  for (const approval of approvals) {
    const key = `${approval.token}:${approval.spender.toLowerCase()}`;
    const confirmed = live.get(key);
    const still = confirmed ? confirmed.value > 0n : true;
    if (!still) continue;
    const unlimited = (confirmed?.value ?? approval.value) >= UNLIMITED;
    const who = short(approval.spender);
    if (unlimited) {
      findings.push({
        id: `unlimited:${key}`,
        severity: "high",
        en: `Unlimited ${approval.token} approval to ${who} is still open${confirmed ? " (allowance() at the head block)" : " (last Approval log in this range)"}.`,
        pt: `Aprovação ilimitada de ${approval.token} para ${who} continua aberta${confirmed ? " (allowance() no bloco mais recente)" : " (último log Approval neste intervalo)"}.`,
      });
    }
  }
  if (context.blacklist === true) {
    findings.push({
      id: "usdc-blacklisted",
      severity: "high",
      en: "Official USDC isBlacklisted(wallet) is true at the head block.",
      pt: "O USDC oficial marca isBlacklisted(carteira) como verdadeiro no bloco mais recente.",
    });
  }
  if (burst && events > 0 && burst.count >= 5 && burst.count >= Math.ceil(events * 0.6)) {
    findings.push({
      id: "burst",
      severity: "info",
      en: `${burst.count} events landed between blocks ${burst.from} and ${burst.to} (inside ${burst.window} blocks). Activity is bunched, not spread across the range.`,
      pt: `${burst.count} eventos caíram entre os blocos ${burst.from} e ${burst.to} (dentro de ${burst.window} blocos). A atividade está concentrada, não espalhada no intervalo.`,
    });
  }
  const top = parties[0];
  if (top && events >= 4 && top.txCount >= Math.ceil(events * 0.5)) {
    findings.push({
      id: "concentrated",
      severity: "info",
      en: `${top.txCount} of the events share a counterparty (${short(top.address)}). Flow is concentrated.`,
      pt: `${top.txCount} dos eventos têm a mesma contraparte (${short(top.address)}). O fluxo está concentrado.`,
    });
  }
  const twoWay = parties.find((row) => Object.keys(row.inn).some((symbol) => (row.out[symbol] ?? 0n) > 0n));
  if (twoWay && (counts.swap ?? 0) === 0) {
    findings.push({
      id: "two-way",
      severity: "info",
      en: `${short(twoWay.address)} both sent tokens to this wallet and received tokens from it.`,
      pt: `${short(twoWay.address)} tanto enviou tokens para esta carteira quanto recebeu tokens dela.`,
    });
  }
  return findings;
}

export function buildBrief({ wallet, items, counts, incoming, outgoing, context = {} }) {
  const net = netMap(incoming, outgoing);
  const pairs = swapPairs(items);
  const parties = counterpartiesOf(items, wallet);
  const approvals = openApprovals(items);
  const burst = tightestBurst(items);
  const stance = stanceOf(counts, net);
  const events = items.length;
  const findingInput = { approvals, liveAllowances: context.allowances, burst, parties, counts, context, events };
  return {
    stance,
    stanceLabel: STANCE[stance],
    paragraphs: {
      en: paragraphs("en", { stance, counts, pairs, net, context, events }),
      pt: paragraphs("pt", { stance, counts, pairs, net, context, events }),
    },
    findings: findingsOf(findingInput),
    nets: ["en", "pt"].reduce((acc, lang) => {
      acc[lang] = Object.entries(net)
        .filter(([, value]) => value !== 0n)
        .map(([symbol, value]) => ({ symbol, amount: money(value, symbol, lang), raw: value.toString(), sign: value > 0n ? "in" : "out" }));
      return acc;
    }, {}),
    pairs,
    counterparties: parties.slice(0, 6).map((row) => ({
      address: row.address,
      txCount: row.txCount,
      en: partyLine(row, "en").detail,
      pt: partyLine(row, "pt").detail,
      name: { en: labeled(row.address, {}, "en"), pt: labeled(row.address, {}, "pt") },
    })),
    approvals: approvals.slice(0, 8).map((approval) => ({
      token: approval.token,
      spender: approval.spender,
      unlimited: approval.value >= UNLIMITED,
      raw: approval.value.toString(),
    })),
  };
}
