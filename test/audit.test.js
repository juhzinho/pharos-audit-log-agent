import test from "node:test";
import assert from "node:assert/strict";
import { blocksForRange, categorize, composeReport, guessBlock, hydrateItems, nextGuess, notableOf, parseDateRange, resolveWallet, timestampOf, toCsv, totalsOf, uniqueLogs } from "../lib/audit.js";
import { buildBrief } from "../lib/audit-brief.js";
import { PACIFIC } from "../lib/tokens.js";

const WALLET = "0x912c9aDe24D44d8922f0866D8Dcb079f1363f647";
const OTHER = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";

test("resolves a wallet and rejects junk", () => {
  assert.equal(resolveWallet(WALLET).address, WALLET);
  assert.equal(resolveWallet("0x123").error, "invalid");
  assert.equal(resolveWallet("").error, "empty");
  assert.equal(resolveWallet("not-an-address").error, "unknown");
});

test("reads hex block timestamps as unix seconds", () => {
  assert.equal(timestampOf({ timestamp: "0x6ad41851" }), 0x6ad41851);
  assert.equal(timestampOf({ timestamp: 1_792_284_753 }), 1_792_284_753);
  assert.equal(timestampOf({}), null);
});

test("parses an inclusive UTC date range", () => {
  const range = parseDateRange("2026-10-10", "2026-10-16", new Date("2026-10-16T18:00:00Z"));
  assert.equal(range.from, "2026-10-10");
  assert.equal(range.to, "2026-10-16");
  assert.equal(range.days, 7);
  assert.equal(parseDateRange("2026-10-20", "2026-10-01").error, "order");
  assert.equal(parseDateRange("10/10/2026", "2026-10-16").error, "from");
  const def = parseDateRange(undefined, undefined, new Date("2026-10-16T03:00:00Z"));
  assert.equal(def.to, "2026-10-16");
  assert.equal(def.from, "2026-10-10");
});

test("maps a long date range without a block cap", () => {
  const head = 1_000_000;
  const headTime = Math.floor(Date.parse("2026-10-16T12:00:00Z") / 1000);
  const range = parseDateRange("2026-10-16", "2026-10-16");
  const open = blocksForRange(head, headTime, range);
  assert.equal(open.toBlock, head);
  assert.equal(open.capped, false);
  assert.ok(open.fromBlock < head);

  const old = parseDateRange("2026-01-01", "2026-10-16");
  const full = blocksForRange(head, headTime, old);
  assert.equal(full.capped, false);
  assert.ok(full.fromBlock < head - 10_000);
  assert.equal(guessBlock(head, headTime, headTime), head);
  assert.equal(nextGuess(100, 200, 100, head), 50);
});

test("categories: in, out, self, swap, approval", () => {
  const usdc = { token: PACIFIC.USDC, transfers: [
    { block: 10, logIndex: 1, tx: "0xaa", from: OTHER, to: WALLET, value: 5n },
    { block: 11, logIndex: 1, tx: "0xbb", from: WALLET, to: OTHER, value: 2n },
    { block: 12, logIndex: 1, tx: "0xcc", from: WALLET, to: WALLET, value: 1n },
    { block: 13, logIndex: 1, tx: "0xdd", from: WALLET, to: OTHER, value: 7n },
  ] };
  const wpros = { token: PACIFIC.WPROS, transfers: [
    { block: 13, logIndex: 2, tx: "0xdd", from: OTHER, to: WALLET, value: 9n },
  ] };
  const approvals = [{
    block: 14, logIndex: 0, tx: "0xee", token: "USDC", decimals: 6, protocol: "Circle USDC",
    contract: PACIFIC.USDC.address, owner: WALLET, spender: SPENDER, value: 2n ** 256n - 1n,
  }];
  const map = new Map([["USDC", usdc], ["WPROS", wpros]]);
  const items = categorize(WALLET, map, approvals);
  const cats = items.map((i) => i.category).sort();
  assert.deepEqual(cats, ["approval", "in", "out", "self", "swap"]);
  const swap = items.find((i) => i.category === "swap");
  assert.equal(swap.legs.length, 2);
  assert.equal(swap.tx, "0xdd");

  const totals = totalsOf(items);
  assert.equal(totals.incoming.USDC, 6n);
  assert.equal(totals.outgoing.USDC, 10n);
  assert.equal(totals.incoming.WPROS, 9n);
  assert.equal(totals.counts.swap, 1);

  const notes = notableOf(items);
  assert.ok(notes.some((n) => n.why === "unlimited-approval"));
  assert.ok(notes.some((n) => n.why === "swap"));

  const brief = buildBrief({
    wallet: WALLET,
    items,
    counts: totals.counts,
    incoming: totals.incoming,
    outgoing: totals.outgoing,
    context: { isContract: false, blacklist: false },
  });
  assert.equal(brief.stance, "trader");
  assert.equal(brief.pairs[0].pair, "USDC/WPROS");
  assert.ok(brief.findings.some((f) => f.id.startsWith("unlimited:") && f.severity === "high"));
  assert.ok(brief.paragraphs.pt[0].includes("trader"));
  assert.ok(brief.counterparties.some((c) => c.address === OTHER));
});

test("a self-transfer returned by both topic queries is kept once", () => {
  const log = { transactionHash: "0xabc", logIndex: 1, address: "0xabc" };
  assert.equal(uniqueLogs([log, { ...log }, { ...log, logIndex: 2 }]).length, 2);
});

test("WPROS keeps 18 decimals after the page round-trip", () => {
  const tx = "0x" + "ab".repeat(32);
  const raw = 43n * 10n ** 18n;
  const once = composeReport({
    wallet: WALLET,
    range: { from: "2026-10-17", to: "2026-10-17", days: 1 },
    fromBlock: 1,
    toBlock: 2,
    headBlock: 2,
    items: [{ category: "out", block: 2, tx, legs: [{ symbol: "WPROS", direction: "out", value: raw, from: WALLET, to: OTHER }], approvals: [] }],
    lang: "pt",
  });
  const again = composeReport({
    wallet: WALLET,
    range: once.view.range,
    fromBlock: 1,
    toBlock: 2,
    headBlock: 2,
    items: hydrateItems(once.view.items),
    lang: "pt",
  });
  assert.equal(again.view.items[0].legs[0].amount, "43");
  assert.equal(again.view.outgoing[0].amount, "43");
});

test("audit reading uses real plurals and USDC totals keep 6 decimals", () => {
  const usdc = 2_500_000n;
  const report = composeReport({
    wallet: WALLET,
    range: { from: "2026-10-17", to: "2026-10-17", days: 1 },
    fromBlock: 1,
    toBlock: 2,
    headBlock: 2,
    items: [{
      category: "in",
      block: 2,
      tx: "0x" + "cd".repeat(32),
      legs: [{ symbol: "USDC", direction: "in", value: usdc, decimals: 6, from: OTHER, to: WALLET }],
      approvals: [],
    }],
    lang: "pt",
  });
  assert.doesNotMatch(report.brief.paragraphs.pt[0], /\(s\)/);
  assert.doesNotMatch(report.brief.paragraphs.en[0], /\(s\)/);
  assert.match(report.brief.paragraphs.pt[0], /1 evento/);
  assert.equal(report.view.incoming[0].decimals, 6);
  assert.equal(report.view.incoming[0].raw, "2500000");
  assert.match(report.text, /bloco/);
  assert.doesNotMatch(report.text, /\] block /);
});

test("csv includes one row per leg", () => {
  const items = categorize(WALLET, new Map([["USDC", {
    token: PACIFIC.USDC,
    transfers: [{ block: 3, logIndex: 0, tx: "0xabc", from: OTHER, to: WALLET, value: 1000n }],
  }]]), []);
  const csv = toCsv({ items });
  assert.match(csv, /^category,block,tx,/);
  assert.match(csv, /in,3,0xabc,USDC,in,1000,6/);
});
