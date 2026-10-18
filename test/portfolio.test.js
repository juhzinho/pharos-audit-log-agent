import test from "node:test";
import assert from "node:assert/strict";
import { parsePortfolioQuestion } from "../lib/portfolio-intent.js";
import { answerPortfolio } from "../lib/portfolio.js";
import { PACIFIC } from "../lib/tokens.js";

test("maps five question types plus a miss", () => {
  assert.equal(parsePortfolioQuestion("what do I hold?").kind, "balances");
  assert.equal(parsePortfolioQuestion("where is my USDC?").kind, "where");
  assert.equal(parsePortfolioQuestion("what's my biggest position?").kind, "biggest");
  assert.equal(parsePortfolioQuestion("what am I earning?").kind, "earning");
  assert.equal(parsePortfolioQuestion("any Faroswap allowance?").kind, "approvals");
  assert.equal(parsePortfolioQuestion("zzzz not a question").kind, "unknown");
});

test("casual PT and EN phrasing still maps", () => {
  assert.equal(parsePortfolioQuestion("mostra o que eu tenho").kind, "balances");
  assert.equal(parsePortfolioQuestion("cadê o USDC").kind, "where");
  assert.equal(parsePortfolioQuestion("cadê o USDC").token, "USDC");
  assert.equal(parsePortfolioQuestion("tem alguma coisa na Prosper?").protocol, "prosper");
  assert.equal(parsePortfolioQuestion("show my holdings").kind, "balances");
  assert.equal(parsePortfolioQuestion("where's my USDC parked?").kind, "where");
  assert.equal(parsePortfolioQuestion("what rewards am I getting?").kind, "earning");
  assert.equal(parsePortfolioQuestion("qual o maior saldo?").kind, "biggest");
});

test("Harbor Morpho Prosper map to readable protocols; Agra and Zona stay unread", () => {
  assert.equal(parsePortfolioQuestion("any Harbor position?").kind, "protocol");
  assert.equal(parsePortfolioQuestion("any Harbor position?").protocol, "harbor");
  assert.equal(parsePortfolioQuestion("any Morpho vault?").protocol, "morpho");
  assert.equal(parsePortfolioQuestion("any Prosper vault?").protocol, "prosper");
  assert.equal(parsePortfolioQuestion("zona balance").kind, "unknown-protocol");
  assert.equal(parsePortfolioQuestion("zona balance").protocol, "zona");
  assert.equal(parsePortfolioQuestion("any Agra position?").protocol, "agra");
});

const snap = {
  wallet: "0x1111111111111111111111111111111111111111",
  walletUrl: "https://www.pharosscan.xyz/address/0x1111111111111111111111111111111111111111",
  block: 20_000_000,
  native: "1000000000000000000",
  positions: [
    { id: "native", kind: "wallet", protocol: "wallet", symbol: "PROS", decimals: 18, raw: "1000000000000000000", contract: null, method: "get_balance", block: 20_000_000 },
    { id: "usdc", kind: "wallet", protocol: "wallet", symbol: "USDC", decimals: 6, raw: "2500000", contract: PACIFIC.USDC.address, method: "balanceOf", block: 20_000_000 },
    { id: "wpros", kind: "wallet", protocol: "wallet", symbol: "WPROS", decimals: 18, raw: "0", contract: PACIFIC.WPROS.address, method: "balanceOf", block: 20_000_000 },
  ],
  allowances: [
    { protocol: "faroswap", spender: "0xA5cA5Fbe34e444F366B373170541ec6902b0F75c", spenderEn: "Faroswap", spenderPt: "Faroswap", symbol: "USDC", decimals: 6, token: PACIFIC.USDC.address, raw: (10n ** 31n).toString(), unlimited: true, block: 20_000_000, method: "allowance" },
  ],
  unread: [{ id: "harbor-rest", en: "pGAIN, ETHvp, BTCvc, pRNH, GPCI and the rest of the Harbor catalog still have no Pacific share token I can cite.", pt: "pGAIN, ETHvp, BTCvc, pRNH, GPCI e o resto do catálogo Harbor ainda não têm share token da Pacific que eu cite." }],
  lp: { nfts: 0, truncated: false, positions: [], npm: "0xc0479219f4FeBA5A668CFF71bf96f4ffe124c3ab", block: 20_000_000, method: "balanceOf" },
};

const lpSnap = {
  ...snap,
  lp: { nfts: 1, truncated: false, positions: [], npm: "0xc0479219f4FeBA5A668CFF71bf96f4ffe124c3ab", block: 20_000_000, method: "positions" },
  positions: [
    ...snap.positions,
    {
      id: "faroswap-v3-12",
      kind: "lp",
      protocol: "faroswap",
      symbol: "WPROS/USDC",
      decimals: 0,
      raw: "1000",
      contract: "0xc0479219f4FeBA5A668CFF71bf96f4ffe124c3ab",
      method: "positions",
      block: 20_000_000,
      lp: {
        tokenId: "12",
        symbol0: "WPROS",
        symbol1: "USDC",
        decimals0: 18,
        decimals1: 6,
        fee: 100,
        inRange: true,
        amount0: 1.5,
        amount1: 0.9,
        tokensOwed0: "0",
        tokensOwed1: "250000",
        liquidity: "1000",
        npm: "0xc0479219f4FeBA5A668CFF71bf96f4ffe124c3ab",
        block: 20_000_000,
      },
    },
  ],
};

test("where USDC cites the token contract and block", () => {
  const got = answerPortfolio(snap, "where is my USDC?", "en");
  assert.match(got.text, /USDC/);
  assert.match(got.text, /Harbor/);
  assert.equal(got.sources[0].block, 20_000_000);
  assert.equal(got.sources[0].contract, PACIFIC.USDC.address);
});

test("earning does not invent Harbor APY", () => {
  const got = answerPortfolio(snap, "what am I earning?", "en");
  assert.match(got.text, /Harbor catalog|will not copy Port APY|No marketing APY|Prosper/i);
  assert.doesNotMatch(got.text, /13%\s*APY/);
});

test("biggest uses token units and says there is no oracle", () => {
  const got = answerPortfolio(snap, "what's my biggest position?", "en");
  assert.match(got.text, /PROS|USDC/);
  assert.match(got.text, /No oracle/);
});

test("Portuguese unknown stays unknown", () => {
  const got = answerPortfolio(snap, "blablabla xyz", "pt");
  assert.equal(got.unknown, true);
  assert.match(got.story.pt, /Não entendi/);
});

test("Portuguese holdings use bloco, not block", () => {
  const got = answerPortfolio(snap, "quanto eu tenho?", "pt");
  assert.match(got.story.pt, /bloco/);
  assert.doesNotMatch(got.story.pt, / block /);
});

test("earning does not dump unread Agra copy", () => {
  const noisy = {
    ...snap,
    unread: [
      ...snap.unread,
      { id: "agra", en: "Agra lists wmtUSDC.", pt: "Agra lista wmtUSDC." },
    ],
  };
  const got = answerPortfolio(noisy, "what am I earning?", "en");
  assert.doesNotMatch(got.text, /Agra lists/);
});

test("LP question maps to Faroswap protocol", () => {
  assert.equal(parsePortfolioQuestion("Any FaroSwap LP?").kind, "protocol");
  assert.equal(parsePortfolioQuestion("Any FaroSwap LP?").protocol, "faroswap");
  assert.equal(parsePortfolioQuestion("any Morpho pool?").protocol, "morpho");
});

test("earning cites FaroSwap NFT fees without inventing APY", () => {
  const got = answerPortfolio(lpSnap, "what am I earning?", "en");
  assert.match(got.text, /NFT #12/);
  assert.match(got.text, /will not invent APY/i);
  assert.doesNotMatch(got.text, /\d+(\.\d+)?% APY/);
});

test("where USDC mentions the V3 position", () => {
  const got = answerPortfolio(lpSnap, "where is my USDC?", "en");
  assert.match(got.text, /FaroSwap V3 NFT #12/);
});

test("Morpho vault shares are cited with contract and no Port APY", () => {
  const vaultSnap = {
    ...snap,
    positions: [
      ...snap.positions,
      {
        id: "morpho-mmusdc",
        kind: "vault",
        protocol: "morpho",
        symbol: "mmUSDC",
        decimals: 18,
        raw: "1000000000000000000",
        contract: "0x047cD0a91E9B92ED979189a6C8A120bf280f02E5",
        method: "convertToAssets",
        block: 20_000_000,
        vault: {
          shares: "1000000000000000000",
          decimals: 18,
          assets: "1005000",
          assetDecimals: 6,
          asset: "USDC",
          symbol: "mmUSDC",
          labelEn: "Morpho RockawayX USDC V2",
          labelPt: "Morpho RockawayX USDC V2",
          share: "0x047cD0a91E9B92ED979189a6C8A120bf280f02E5",
          block: 20_000_000,
        },
      },
    ],
  };
  const got = answerPortfolio(vaultSnap, "any Morpho vault?", "en");
  assert.match(got.text, /mmUSDC/);
  assert.match(got.text, /0x047c/);
  assert.doesNotMatch(got.text, /8\.5%/);
  const where = answerPortfolio(vaultSnap, "where is my USDC?", "en");
  assert.match(where.text, /Morpho RockawayX/);
});

test("Prosper share is cited; Agra stays unread", () => {
  const vaultSnap = {
    ...snap,
    unread: [
      ...snap.unread,
      { id: "agra", en: "Agra lists wmtUSDC as a Wildcat credit bond. I will not guess a Pacific 0x from a truncated explorer link.", pt: "Agra." },
    ],
    positions: [
      ...snap.positions,
      {
        id: "prosper-taco",
        kind: "vault",
        protocol: "prosper",
        symbol: "TACO",
        decimals: 18,
        raw: "2000000000000000000",
        contract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        method: "balanceOf",
        block: 20_000_000,
        vault: {
          shares: "2000000000000000000",
          decimals: 18,
          assets: "0",
          assetDecimals: 6,
          asset: "USDC",
          symbol: "TACO",
          labelEn: "Prosper EM Hennessy Trend Vault",
          labelPt: "Prosper EM Hennessy Trend Vault",
          share: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          block: 20_000_000,
        },
      },
    ],
  };
  const got = answerPortfolio(vaultSnap, "any Prosper vault?", "en");
  assert.match(got.text, /Prosper/);
  assert.match(got.text, /0xaaaa/);
  const agra = answerPortfolio(vaultSnap, "any Agra position?", "en");
  assert.match(agra.text, /Agra/);
  assert.equal(agra.unknown, true);
});
