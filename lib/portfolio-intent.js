import { detectLanguage, normalize } from "./language.js";
import { EXTRA_TOKENS, PACIFIC } from "./tokens.js";

const TOKENS = [...Object.keys(PACIFIC), ...Object.keys(EXTRA_TOKENS)];

function has(text, ...words) {
  return words.some((w) => {
    const safe = String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${safe}([^a-z0-9]|$)`).test(text);
  });
}

function pickToken(text) {
  if (has(text, "usdce", "usdc e", "bridged usdc")) return "USDCe";
  if (has(text, "usdc")) return "USDC";
  if (has(text, "wpros", "wrapped pros")) return "WPROS";
  if (has(text, "weth")) return "WETH";
  if (has(text, "link")) return "LINK";
  if (has(text, "pgold")) return "PGOLD";
  if (has(text, "usdpm")) return "USDpm";
  if (has(text, "pros") && !has(text, "wpros")) return "PROS";
  return null;
}

function pickProtocol(text) {
  if (has(text, "faroswap", "faro swap")) return "faroswap";
  if (has(text, "jumper", "li.fi", "lifi")) return "jumper";
  if (has(text, "cctp")) return "cctp";
  if (has(text, "morpho", "mmusdc", "rockaway")) return "morpho";
  if (has(text, "harbor", "axil", "apc3m", "r25")) return "harbor";
  if (has(text, "faroo", "stpros")) return "faroo";
  if (has(text, "prosper", "pvault", "p{vault}", "ptaco", "ptoken")) return "prosper";
  if (has(text, "termmax", "tmseusdc")) return "termmax";
  if (has(text, "faro") && !has(text, "faroo")) return "faroswap";
  return null;
}

/**
 * Five question families from the Arena brief, plus protocol/unknown.
 * Rule-based. No model.
 */
export function parsePortfolioQuestion(question, fallbackLang = "en") {
  const raw = String(question ?? "").trim();
  const text = normalize(raw);
  const lang = detectLanguage(raw, fallbackLang);
  const token = pickToken(text);

  if (!raw) return { kind: "balances", token: null, protocol: null, lang, raw };

  if (has(text, "zona")) return { kind: "unknown-protocol", token, protocol: "zona", lang, raw };
  if (has(text, "ember", "palpha")) return { kind: "unknown-protocol", token, protocol: "ember", lang, raw };
  if (has(text, "asseto")) return { kind: "unknown-protocol", token, protocol: "asseto", lang, raw };
  if (has(text, "agra", "wmtusdc")) return { kind: "unknown-protocol", token, protocol: "agra", lang, raw };
  if (has(text, "newsight")) return { kind: "unknown-protocol", token, protocol: "newsight", lang, raw };
  if (has(text, "grandline")) return { kind: "unknown-protocol", token, protocol: "grandline", lang, raw };
  if (has(text, "pharosname", "pns")) return { kind: "unknown-protocol", token, protocol: "pns", lang, raw };
  if (has(text, "zns")) return { kind: "unknown-protocol", token, protocol: "zns", lang, raw };
  if (has(text, "interport")) return { kind: "unknown-protocol", token, protocol: "interport", lang, raw };
  if (has(text, "layerzero", "layer zero")) return { kind: "unknown-protocol", token, protocol: "layerzero", lang, raw };
  if (has(text, "bifrost")) return { kind: "unknown-protocol", token, protocol: "bifrost", lang, raw };
  if (has(text, "oku") && !has(text, "okx")) return { kind: "unknown-protocol", token, protocol: "oku", lang, raw };

  if (has(text,
    "earn", "earning", "earned", "yield", "apy", "reward", "rewards", "fees", "income", "profit", "payout",
    "rendimento", "rendendo", "rendo", "rende", "juros", "ganhando", "ganho", "ganhos", "recompensa", "recompensas",
  )) {
    return { kind: "earning", token, protocol: null, lang, raw };
  }
  if (has(text,
    "where", "where's", "wheres", "onde", "aonde", "cade", "onde esta", "onde ta", "onde estao",
    "which protocol", "qual protocolo", "em qual", "em que protocolo", "which vault", "qual vault",
  )) {
    return { kind: "where", token: token || "USDC", protocol: null, lang, raw };
  }
  if (has(text,
    "biggest", "largest", "heaviest", "maior", "mais gorda", "top position", "maior posicao",
    "maior saldo", "main position", "top holding", "o maior",
  )) {
    return { kind: "biggest", token, protocol: null, lang, raw };
  }
  if (has(text, "allowance", "approval", "approve", "aprovacao", "aprovacoes", "permit", "permissoes")) {
    return { kind: "approvals", token, protocol: pickProtocol(text), lang, raw };
  }
  if (has(text, "lp", "liquidity", "liquidez", "nft", "pool") && !has(text, "morpho", "harbor", "faroo", "prosper", "termmax", "jumper")) {
    return { kind: "protocol", token, protocol: "faroswap", lang, raw };
  }

  const protocol = pickProtocol(text);
  if (protocol) return { kind: "protocol", token, protocol, lang, raw };

  if (has(text, "wpros wrap", "wrap", "wrapped")) return { kind: "protocol", token: "WPROS", protocol: "wpros", lang, raw };
  if (has(text,
    "hold", "holds", "holding", "holdings", "balance", "balances", "portfolio", "positions",
    "show", "mostra", "mostre", "list", "lista", "saldo", "saldos", "tenho", "tem", "terei",
    "quanto", "how much", "what do i", "whats in", "what's in", "meus tokens", "minha carteira",
    "o que eu tenho", "o q eu tenho", "o que tenho",
  )) {
    return { kind: "balances", token, protocol: null, lang, raw };
  }
  if (token && TOKENS.includes(token)) return { kind: "balances", token, protocol: null, lang, raw };

  return { kind: "unknown", token, protocol: null, lang, raw };
}
