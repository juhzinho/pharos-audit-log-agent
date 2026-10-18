import { countLabel, formatAmount, formatInteger, explorerAddress, short } from "./format.js";
import { EXTRA_TOKENS, FAROSWAP_V3, PACIFIC, TOKEN_LIST, PROTOCOL_SPENDERS, UNREAD_PROTOCOLS } from "./tokens.js";
import { headStamp, readAllowance, resolveWallet, tokenBalance, walletContext } from "./audit.js";
import { readFaroSwapPositions } from "./faroswap-lp.js";
import { readVaultPositions } from "./vaults.js";
import { listProsperVaults, readProsperPositions } from "./prosper.js";
import { parsePortfolioQuestion } from "./portfolio-intent.js";

const UNLIMITED = 10n ** 30n;

const PROTOCOL_NAME = {
  faroswap: "FaroSwap",
  morpho: "Morpho",
  harbor: "Harbor",
  faroo: "Faroo",
  prosper: "Prosper",
  termmax: "TermMax",
  jumper: "Jumper",
  cctp: "CCTP",
  wpros: "WPROS",
};

function amt(raw, decimals, lang) {
  return formatAmount(raw, decimals, 4, lang);
}

function blk(n, lang) {
  return `${lang === "pt" ? "bloco" : "block"} ${formatInteger(n, lang)}`;
}

function source(label, contract, block, method) {
  return { label, contract, block, method, url: contract ? explorerAddress(contract) : null };
}

function moneyRow(symbol, raw, decimals, lang) {
  return {
    symbol,
    decimals,
    raw: raw.toString(),
    amount: amt(raw, decimals, lang),
    en: amt(raw, decimals, "en"),
    pt: amt(raw, decimals, "pt"),
  };
}

function whole(raw, decimals) {
  return raw / 10n ** BigInt(decimals);
}

export async function snapshotPortfolio(client, walletInput, intent = { kind: "balances", protocol: null }) {
  const wallet = resolveWallet(walletInput);
  if (wallet.error) {
    const err = new Error(wallet.error === "invalid" ? `${wallet.raw} is not a valid 0x address` : "Pass a 0x wallet address");
    err.status = 400;
    throw err;
  }
  const proto = intent.protocol;
  const kind = intent.kind;
  const needLp = kind !== "approvals" && kind !== "unknown" && kind !== "unknown-protocol"
    && proto !== "prosper" && proto !== "morpho" && proto !== "harbor" && proto !== "faroo" && proto !== "termmax" && proto !== "jumper" && proto !== "wpros";
  const needFixedVaults = kind !== "approvals" && kind !== "unknown" && proto !== "faroswap" && proto !== "jumper" && proto !== "wpros" && proto !== "prosper";
  const needProsper = kind !== "approvals" && kind !== "unknown" && kind !== "unknown-protocol"
    && (proto == null || proto === "prosper") && proto !== "faroswap" && proto !== "jumper" && proto !== "wpros";
  const needAllowances = kind === "approvals" || proto === "faroswap" || proto === "jumper" || proto === "cctp";
  const needExtra = kind === "balances" || kind === "where" || kind === "biggest";

  const head = await headStamp(client);
  const ctx = await walletContext(client, wallet.address, head.block);
  const extraBalances = needExtra
    ? await Promise.all(Object.values(EXTRA_TOKENS).map(async (token) => {
      try {
        return { token, value: await tokenBalance(client, token.address, wallet.address, head.block) };
      } catch {
        return { token, value: 0n };
      }
    }))
    : [];
  let lp = { nfts: 0, truncated: false, positions: [], npm: FAROSWAP_V3.npm, block: head.block, method: "balanceOf" };
  if (needLp) {
    try {
      lp = await readFaroSwapPositions(client, wallet.address, head.block);
    } catch {
      lp = { ...lp, error: true };
    }
  }
  let vaults = [];
  const unread = UNREAD_PROTOCOLS.map((p) => ({ id: p.id, en: p.reasonEn, pt: p.reasonPt }));
  if (needFixedVaults) {
    try {
      const only = proto && ["harbor", "morpho", "faroo", "termmax"].includes(proto) ? proto : null;
      vaults = await readVaultPositions(client, wallet.address, head.block, [], only);
    } catch {
      vaults = [];
    }
  }
  if (needProsper) {
    try {
      const catalog = await listProsperVaults();
      const prosper = await readProsperPositions(client, wallet.address, head.block, catalog, { pTokens: proto === "prosper" });
      vaults = [...vaults, ...prosper];
    } catch {
      unread.push({
        id: "prosper",
        en: "Prosper's live vault list did not load, so I will not guess share addresses.",
        pt: "A lista ao vivo da Prosper não carregou, então não invento endereços de share.",
      });
    }
  }
  let allowances = [];
  if (needAllowances) {
    const tokensForAllowance = [...TOKEN_LIST, ...Object.values(EXTRA_TOKENS)];
    const allowanceSpenders = PROTOCOL_SPENDERS.filter((s) => s.id === "faroswap" || s.id === "jumper" || s.id === "cctp");
    const allowanceHits = await Promise.all(tokensForAllowance.flatMap((token) => allowanceSpenders.map(async (spender) => {
      try {
        const value = await readAllowance(client, token, wallet.address, spender.address, head.block);
        if (value <= 0n) return null;
        return {
          protocol: spender.id,
          spender: spender.address,
          spenderEn: spender.en,
          spenderPt: spender.pt,
          symbol: token.symbol,
          decimals: token.decimals,
          token: token.address,
          raw: value.toString(),
          unlimited: value >= UNLIMITED,
          block: head.block,
          method: "allowance",
        };
      } catch {
        return null;
      }
    })));
    allowances = allowanceHits.filter(Boolean);
  }

  const wpros = ctx.balances.find((b) => b.token.symbol === "WPROS")?.value ?? 0n;
  const positions = [
    {
      id: "native",
      kind: "wallet",
      protocol: "wallet",
      symbol: "PROS",
      decimals: 18,
      raw: ctx.native.toString(),
      contract: null,
      method: "get_balance",
      block: head.block,
    },
    ...[...ctx.balances, ...extraBalances].map((b) => ({
      id: b.token.symbol.toLowerCase(),
      kind: "wallet",
      protocol: "wallet",
      symbol: b.token.symbol,
      decimals: b.token.decimals,
      raw: b.value.toString(),
      contract: b.token.address,
      method: "balanceOf",
      block: head.block,
      extra: Boolean(EXTRA_TOKENS[b.token.symbol]),
    })),
    ...lp.positions.map((p) => ({
      id: `faroswap-v3-${p.tokenId}`,
      kind: "lp",
      protocol: "faroswap",
      symbol: `${p.symbol0}/${p.symbol1}`,
      decimals: 0,
      raw: p.liquidity,
      contract: p.npm,
      method: "positions",
      block: p.block,
      lp: p,
    })),
    ...vaults.map((v) => ({
      id: v.id,
      kind: v.kind === "ptoken" ? "ptoken" : "vault",
      protocol: v.protocol,
      symbol: v.symbol,
      decimals: v.decimals,
      raw: v.shares,
      contract: v.share,
      method: v.method,
      block: v.block,
      vault: v,
    })),
  ];
  if (wpros > 0n) {
    positions.push({
      id: "wpros-wrap",
      kind: "protocol",
      protocol: "wpros",
      symbol: "WPROS",
      decimals: 18,
      raw: wpros.toString(),
      contract: PACIFIC.WPROS.address,
      method: "balanceOf",
      block: head.block,
      noteEn: "1:1 wrap of native PROS. No yield.",
      notePt: "Wrap 1:1 do PROS nativo. Sem rendimento.",
    });
  }

  return {
    ok: true,
    wallet: wallet.address,
    walletUrl: explorerAddress(wallet.address),
    block: head.block,
    native: ctx.native.toString(),
    positions,
    lp,
    vaults,
    allowances,
    unread,
  };
}

function held(snap) {
  return snap.positions.filter((p) => {
    if (p.kind === "wallet") return BigInt(p.raw) > 0n;
    if (p.kind === "lp") {
      try {
        return BigInt(p.raw) > 0n || BigInt(p.lp?.tokensOwed0 ?? 0) > 0n || BigInt(p.lp?.tokensOwed1 ?? 0) > 0n;
      } catch {
        return false;
      }
    }
    if (p.kind === "vault" || p.kind === "ptoken") return BigInt(p.raw) > 0n;
    return false;
  });
}

function ofSymbol(snap, symbol) {
  return snap.positions.filter((p) => {
    if (p.kind === "lp" && p.lp) {
      return (p.lp.symbol0 === symbol || p.lp.symbol1 === symbol) && (BigInt(p.lp.liquidity) > 0n || BigInt(p.lp.tokensOwed0) > 0n || BigInt(p.lp.tokensOwed1) > 0n);
    }
    if (p.kind === "ptoken") return p.symbol === symbol && BigInt(p.raw) > 0n;
    if (p.kind === "vault" && p.vault) {
      return (p.symbol === symbol || p.vault.asset === symbol) && BigInt(p.raw) > 0n;
    }
    return p.symbol === symbol && BigInt(p.raw) > 0n;
  });
}

function lpLine(pos, lang) {
  const p = pos.lp;
  const pt = lang === "pt";
  const range = p.inRange ? (pt ? "no range" : "in range") : (pt ? "fora do range" : "out of range");
  const fee = `${(p.fee / 10000).toFixed(2)}%`;
  const a0 = Number(p.amount0).toFixed(4);
  const a1 = Number(p.amount1).toFixed(4);
  const o0 = amt(BigInt(p.tokensOwed0), p.decimals0, lang);
  const o1 = amt(BigInt(p.tokensOwed1), p.decimals1, lang);
  return pt
    ? `FaroSwap V3 NFT #${p.tokenId} ${p.symbol0}/${p.symbol1} fee ${fee} · ~${a0} ${p.symbol0} + ~${a1} ${p.symbol1} (${range}) · fees ${o0} + ${o1} · NPM ${short(p.npm)} · ${blk(p.block, lang)}. Quantidades ~ via slot0.`
    : `FaroSwap V3 NFT #${p.tokenId} ${p.symbol0}/${p.symbol1} fee ${fee} · ~${a0} ${p.symbol0} + ~${a1} ${p.symbol1} (${range}) · fees ${o0} + ${o1} · NPM ${short(p.npm)} · ${blk(p.block, lang)}. Amounts ~ from slot0.`;
}

function vaultLine(pos, lang) {
  const v = pos.vault || pos;
  const pt = lang === "pt";
  const shares = amt(BigInt(v.shares ?? pos.raw ?? 0), v.decimals ?? pos.decimals ?? 18, lang);
  const assets = v.assets && BigInt(v.assets) > 0n ? amt(BigInt(v.assets), v.assetDecimals ?? 6, lang) : null;
  const who = pt ? (v.labelPt || pos.symbol) : (v.labelEn || pos.symbol);
  const extra = assets ? ` ≈ ${assets} ${v.asset}` : "";
  const addr = v.share || pos.contract;
  return pt
    ? `${who}: ${shares} ${v.symbol || pos.symbol}${extra} · ${short(addr)} · ${blk(v.block || pos.block, lang)}. Sem APY de marketing.`
    : `${who}: ${shares} ${v.symbol || pos.symbol}${extra} · ${short(addr)} · ${blk(v.block || pos.block, lang)}. No marketing APY.`;
}

function line(pos, lang) {
  if (pos.kind === "lp") return lpLine(pos, lang);
  if (pos.kind === "vault" || pos.kind === "ptoken") return vaultLine(pos, lang);
  const a = amt(BigInt(pos.raw), pos.decimals, lang);
  const where = pos.contract ? short(pos.contract) : (lang === "pt" ? "nativo" : "native");
  return `${a} ${pos.symbol} · ${where} · ${blk(pos.block, lang)}`;
}

function yieldNotes(snap, lang) {
  const keep = new Set(["harbor-rest", "zona", "ember", "prosper"]);
  return snap.unread.filter((u) => keep.has(u.id)).map((u) => (lang === "pt" ? u.pt : u.en));
}

function sourcesFor(rows) {
  return rows.map((p) => source(`${p.symbol} ${p.method}`, p.contract, p.block, p.method));
}

function answerIn(snap, intent) {
  const lang = intent.lang;
  const pt = lang === "pt";
  const rows = held(snap);

  const pack = (text, sources, extra = {}) => ({
    ok: true,
    wallet: snap.wallet,
    walletUrl: snap.walletUrl,
    block: snap.block,
    intent: intent.kind,
    token: intent.token,
    protocol: intent.protocol,
    unknown: Boolean(extra.unknown),
    text,
    story: { en: extra.en || text, pt: extra.pt || text },
    holdings: rows.filter((p) => p.kind !== "lp").map((p) => moneyRow(p.symbol, BigInt(p.raw), p.decimals, lang)),
    sources,
    unread: snap.unread,
    allowances: snap.allowances,
  });

  if (intent.kind === "unknown") {
    const text = pt
      ? "Não entendi a pergunta. Dá para perguntar saldo, onde está um token, a maior posição, rendimento ou aprovações."
      : "I don't know that question. Try holdings, where a token sits, the biggest position, yield, or approvals.";
    return pack(text, [], { unknown: true, en: text, pt: text });
  }

  if (intent.kind === "unknown-protocol") {
    const unread = snap.unread.find((u) => u.id === intent.protocol) || snap.unread[0];
    const text = unread ? (pt ? unread.pt : unread.en) : (pt ? "Não leio esse protocolo." : "I cannot read that protocol.");
    return pack(text, [], { unknown: true, en: unread?.en || text, pt: unread?.pt || text });
  }

  if (intent.kind === "balances") {
    if (intent.token) {
      const hits = ofSymbol(snap, intent.token);
      if (!hits.length) {
        const text = pt
          ? `Nenhum ${intent.token} nesta carteira no ${blk(snap.block, lang)}.`
          : `No ${intent.token} in this wallet at ${blk(snap.block, lang)}.`;
        return pack(text, [source("head", null, snap.block, "get_block")]);
      }
      const text = hits.map((p) => line(p, lang)).join("\n");
      return pack(text, sourcesFor(hits));
    }
    if (!rows.length) {
      const text = pt ? `Carteira vazia nos tokens oficiais no ${blk(snap.block, lang)}.` : `No official-token balances at ${blk(snap.block, lang)}.`;
      return pack(text, [source("head", null, snap.block, "get_block")]);
    }
    const text = rows.map((p) => line(p, lang)).join("\n");
    return pack(text, sourcesFor(rows));
  }

  if (intent.kind === "where") {
    const symbol = intent.token || "USDC";
    const hits = ofSymbol(snap, symbol);
    const bits = [];
    if (symbol === "PROS" || symbol === "WPROS") {
      const native = snap.positions.find((p) => p.id === "native");
      const wrap = snap.positions.find((p) => p.id === "wpros-wrap") || snap.positions.find((p) => p.symbol === "WPROS" && p.kind === "wallet");
      if (native && BigInt(native.raw) > 0n) bits.push(pt ? `${amt(BigInt(native.raw), 18, lang)} PROS nativo (get_balance, ${blk(snap.block, lang)}).` : `${amt(BigInt(native.raw), 18, lang)} native PROS (get_balance, ${blk(snap.block, lang)}).`);
      if (wrap && BigInt(wrap.raw) > 0n) bits.push(pt ? `${amt(BigInt(wrap.raw), 18, lang)} WPROS no contrato de wrap ${short(PACIFIC.WPROS.address)}.` : `${amt(BigInt(wrap.raw), 18, lang)} WPROS in the wrap contract ${short(PACIFIC.WPROS.address)}.`);
    }
    for (const p of hits) {
      if ((symbol === "PROS" || symbol === "WPROS") && (p.id === "native" || p.id === "wpros-wrap" || (p.kind === "wallet" && p.symbol === "WPROS"))) continue;
      if (p.kind === "lp") bits.push(lpLine(p, lang));
      else if (p.kind === "vault" || p.kind === "ptoken") bits.push(vaultLine(p, lang));
      else if (p.symbol === symbol) {
        bits.push(pt
          ? `${amt(BigInt(p.raw), p.decimals, lang)} ${p.symbol} em ${p.contract ? short(p.contract) : "nativo"} via ${p.method}, ${blk(p.block, lang)}.`
          : `${amt(BigInt(p.raw), p.decimals, lang)} ${p.symbol} at ${p.contract ? short(p.contract) : "native"} via ${p.method}, ${blk(p.block, lang)}.`);
      }
    }
    if (!bits.length) {
      const text = pt
        ? `Nenhum ${symbol} na carteira neste ${blk(snap.block, lang)}.`
        : `No ${symbol} in the wallet at this ${blk(snap.block, lang)}.`;
      return pack(text, [source("head", null, snap.block, "get_block")], { unknown: false });
    }
    return pack(bits.join("\n"), sourcesFor(hits.length ? hits : snap.positions.filter((p) => p.symbol === "WPROS" || p.id === "native")));
  }

  if (intent.kind === "biggest") {
    const ranked = rows.filter((p) => p.kind !== "lp").slice().sort((a, b) => {
      const wa = whole(BigInt(a.raw), a.decimals);
      const wb = whole(BigInt(b.raw), b.decimals);
      return wa === wb ? 0 : wa > wb ? -1 : 1;
    });
    if (!ranked.length) {
      const text = pt ? "Não há posição para comparar." : "There is no position to rank.";
      return pack(text, [source("head", null, snap.block, "get_block")]);
    }
    const top = ranked[0];
    const lps = snap.positions.filter((p) => p.kind === "lp");
    const lpNote = lps.length
      ? (pt
        ? ` FaroSwap V3: ${countLabel(lps.length, "pt", "NFT", "NFTs")} no NPM, liquidez à parte (não comparo com saldo ERC-20).`
        : ` FaroSwap V3: ${countLabel(lps.length, "en", "NFT", "NFTs")} on the NPM, liquidity not ranked against ERC-20 units.`)
      : "";
    const text = pt
      ? `Maior posição (em unidades do token, sem preço): ${line(top, lang)}. Sem oracle nesta página.${lpNote}`
      : `Biggest position (token units, no USD price): ${line(top, lang)}. No oracle on this page.${lpNote}`;
    return pack(text, sourcesFor([top, ...lps]));
  }

  if (intent.kind === "earning") {
    const wrap = snap.positions.find((p) => p.protocol === "wpros" && BigInt(p.raw) > 0n);
    const lps = snap.positions.filter((p) => p.kind === "lp");
    const bits = [];
    bits.push(pt
      ? "WPROS é wrap 1:1, não paga yield."
      : "WPROS is a 1:1 wrap, not a yield vault.");
    if (lps.length) {
      bits.push(pt
        ? `FaroSwap V3: ${countLabel(lps.length, "pt", "posição", "posições")} no NPM ${short(FAROSWAP_V3.npm)}. Fees não coletadas vêm de positions().tokensOwed. Não invento APY.`
        : `FaroSwap V3: ${countLabel(lps.length, "en", "position", "positions")} on NPM ${short(FAROSWAP_V3.npm)}. Uncollected fees from positions().tokensOwed. I will not invent APY.`);
      if (snap.lp?.truncated) {
        bits.push(pt ? "Li no máximo 24 NFTs neste bloco." : "I read at most 24 NFTs at this block.");
      }
      for (const p of lps) bits.push(lpLine(p, lang));
    } else {
      bits.push(pt
        ? `FaroSwap V3: 0 NFTs no NPM ${short(FAROSWAP_V3.npm)} (balanceOf, ${blk(snap.block, lang)}). Sem APY.`
        : `FaroSwap V3: 0 NFTs on NPM ${short(FAROSWAP_V3.npm)} (balanceOf, ${blk(snap.block, lang)}). No APY.`);
    }
    const vaultHeld = snap.positions.filter((p) => (p.kind === "vault" || p.kind === "ptoken") && BigInt(p.raw) > 0n);
    const vaultAll = snap.positions.filter((p) => p.kind === "vault" || p.kind === "ptoken");
    if (vaultHeld.length) {
      bits.push(...vaultHeld.map((p) => vaultLine(p, lang)));
    } else if (vaultAll.length) {
      bits.push(pt
        ? `Faroo / Harbor Axil / Morpho / TermMax / Prosper: 0 shares no ${blk(snap.block, lang)} (balanceOf). Não copio APY do Port.`
        : `Faroo / Harbor Axil / Morpho / TermMax / Prosper: 0 shares at ${blk(snap.block, lang)} (balanceOf). I will not copy Port APY.`);
    }
    bits.push(...yieldNotes(snap, lang));
    if (wrap) bits.unshift(pt ? `Wrap: ${line(wrap, lang)}.` : `Wrap: ${line(wrap, lang)}.`);
    const src = [
      ...(wrap ? sourcesFor([wrap]) : [source("WPROS wrap", PACIFIC.WPROS.address, snap.block, "balanceOf")]),
      source("FaroSwap V3 NPM", FAROSWAP_V3.npm, snap.block, lps.length ? "positions" : "balanceOf"),
      ...lps.map((p) => source(`NFT #${p.lp.tokenId}`, p.contract, p.block, "positions")),
      ...vaultHeld.map((p) => source(p.symbol, p.contract, p.block, p.method)),
    ];
    return pack(bits.join("\n"), src);
  }

  if (intent.kind === "approvals" || intent.kind === "protocol") {
    const want = intent.protocol;
    const list = snap.allowances.filter((a) => !want || a.protocol === want);
    if (intent.kind === "protocol" && want === "faroswap") {
      const lps = snap.positions.filter((p) => p.kind === "lp");
      const bits = lps.length
        ? lps.map((p) => lpLine(p, lang))
        : [pt
          ? `0 NFTs FaroSwap V3 no NPM ${short(FAROSWAP_V3.npm)} no ${blk(snap.block, lang)}.`
          : `0 FaroSwap V3 NFTs on NPM ${short(FAROSWAP_V3.npm)} at ${blk(snap.block, lang)}.`];
      if (snap.lp?.truncated) bits.unshift(pt ? "Li no máximo 24 NFTs neste bloco." : "I read at most 24 NFTs at this block.");
      const list = snap.allowances.filter((a) => a.protocol === "faroswap");
      if (list.length) {
        bits.push(list.map((a) => {
          const n = a.unlimited ? (pt ? "ilimitada" : "unlimited") : amt(BigInt(a.raw), a.decimals, lang);
          return `${a.symbol} → ${pt ? a.spenderPt : a.spenderEn} (${n})`;
        }).join("\n"));
      }
      const src = [
        source("FaroSwap V3 NPM", FAROSWAP_V3.npm, snap.block, "balanceOf"),
        ...lps.map((p) => source(`NFT #${p.lp.tokenId}`, p.contract, p.block, "positions")),
        ...list.map((a) => source(`${a.symbol} allowance`, a.token, a.block, "allowance")),
      ];
      return pack(bits.join("\n"), src);
    }
    if (intent.kind === "protocol" && (want === "harbor" || want === "morpho" || want === "faroo" || want === "termmax" || want === "prosper")) {
      const vaults = snap.positions.filter((p) => (p.kind === "vault" || p.kind === "ptoken") && p.protocol === want);
      const heldVaults = vaults.filter((p) => BigInt(p.raw) > 0n);
      const bits = heldVaults.length
        ? heldVaults.map((p) => vaultLine(p, lang))
        : [pt
          ? `0 shares em ${PROTOCOL_NAME[want] || want} no ${blk(snap.block, lang)}.`
          : `0 shares on ${PROTOCOL_NAME[want] || want} at ${blk(snap.block, lang)}.`];
      if (want === "harbor") {
        const rest = snap.unread.find((u) => u.id === "harbor-rest");
        if (rest) bits.push(pt ? rest.pt : rest.en);
      }
      return pack(bits.join("\n"), sourcesFor(heldVaults.length ? heldVaults : [{ symbol: want, contract: null, block: snap.block, method: "balanceOf" }]));
    }
    if (intent.kind === "protocol" && want === "wpros") {
      const wrap = snap.positions.find((p) => p.symbol === "WPROS");
      const text = wrap && BigInt(wrap.raw) > 0n
        ? line(wrap, lang)
        : (pt ? "Sem WPROS nesta carteira." : "No WPROS in this wallet.");
      return pack(text, wrap ? sourcesFor([wrap]) : [source("WPROS", PACIFIC.WPROS.address, snap.block, "balanceOf")]);
    }
    if (!list.length) {
      const text = pt
        ? `Nenhuma allowance aberta${want ? ` em ${PROTOCOL_NAME[want] || want}` : " nos protocolos que eu leio"} no ${blk(snap.block, lang)}.`
        : `No open allowance${want ? ` on ${PROTOCOL_NAME[want] || want}` : " on the protocols I read"} at ${blk(snap.block, lang)}.`;
      return pack(text, [source("head", null, snap.block, "eth_call")]);
    }
    const text = list.map((a) => {
      const n = a.unlimited ? (pt ? "ilimitada" : "unlimited") : amt(BigInt(a.raw), a.decimals, lang);
      const who = pt ? a.spenderPt : a.spenderEn;
      return `${a.symbol} → ${who} (${n}) · ${short(a.spender)} · ${blk(a.block, lang)}`;
    }).join("\n");
    const src = list.map((a) => source(`${a.symbol} allowance`, a.token, a.block, "allowance"));
    return pack(text, src);
  }

  const text = pt ? "Não sei responder isso." : "I cannot answer that.";
  return pack(text, [], { unknown: true });
}

export function answerPortfolio(snap, question, fallbackLang = "en") {
  const intent = parsePortfolioQuestion(question, fallbackLang);
  const en = answerIn(snap, { ...intent, lang: "en" });
  const pt = answerIn(snap, { ...intent, lang: "pt" });
  return {
    ...en,
    intent: intent.kind,
    token: intent.token,
    protocol: intent.protocol,
    story: { en: en.text, pt: pt.text },
  };
}

export async function askPortfolio(client, walletInput, question, lang = "en") {
  const intent = parsePortfolioQuestion(question, lang);
  const snap = await snapshotPortfolio(client, walletInput, intent);
  return answerPortfolio(snap, question, lang);
}
