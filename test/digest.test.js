import test from "node:test";
import assert from "node:assert/strict";
import { comparePeriods, digestWindows, estimatedPreviousTo, netOf, pct, story, venuesOf } from "../lib/digest.js";

test("windows sit a week apart and keep the same width", () => {
  const previousTo = estimatedPreviousTo(1_000_000, 2, 7, 4_000);
  assert.equal(previousTo, 1_000_000 - (7 * 86_400) / 2);
  const w = digestWindows(1_000_000, { sample: 4_000, previousTo, days: 7 });
  assert.equal(w.current.toBlock - w.current.fromBlock + 1, 4_000);
  assert.equal(w.previous.toBlock - w.previous.fromBlock + 1, 4_000);
  assert.ok(w.previous.toBlock < w.current.fromBlock);
});

test("fast Pacific block time still places last week far behind the live sample", () => {
  const previousTo = estimatedPreviousTo(8_000_000, 0.16, 7, 4_000);
  const w = digestWindows(8_000_000, { sample: 4_000, previousTo });
  assert.ok(w.gap > 3_000_000);
  assert.ok(w.previous.toBlock < w.current.fromBlock);
});

test("pct handles a quiet previous week", () => {
  assert.equal(pct(10, 5), 100);
  assert.equal(pct(5, 5), 0);
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(4, 0), null);
});

test("story uses real plurals and names the swing", () => {
  const compared = comparePeriods(
    [{ category: "swap", legs: [], approvals: [] }, { category: "swap", legs: [], approvals: [] }],
    [{ category: "in", legs: [], approvals: [] }]
  );
  assert.equal(compared.metrics.find((m) => m.id === "events").change, 100);
  assert.match(story(compared, "en"), /2 events now/);
  assert.match(story(compared, "en"), /100% above/);
  assert.doesNotMatch(story(compared, "en"), /event\(s\)/);
  assert.match(story(compared, "pt"), /2 eventos agora/);
  assert.doesNotMatch(story(compared, "pt"), /evento\(s\)/);
});

test("default windows keep the same width both weeks", () => {
  const previousTo = estimatedPreviousTo(2_000_000, 1, 7, 40_000);
  const w = digestWindows(2_000_000, { sample: 40_000, previousSample: 40_000, previousTo });
  assert.equal(w.current.toBlock - w.current.fromBlock + 1, 40_000);
  assert.equal(w.previous.toBlock - w.previous.fromBlock + 1, 40_000);
});

test("Jumper Permit2 executor counts as Jumper", () => {
  const exec = "0x36C800D4472fBb888D034Aa74778f481aEE01FEc";
  const got = venuesOf([
    { tx: "0xddd", category: "out", legs: [{ from: "0x1111111111111111111111111111111111111111", to: exec, symbol: "USDC" }] },
  ]);
  assert.equal(got.jumper, 1);
});

test("venuesOf counts Faroswap counterparties once per tx", () => {
  const faro = "0xA5cA5Fbe34e444F366B373170541ec6902b0F75c";
  const got = venuesOf([
    { tx: "0xaaa", category: "swap", legs: [{ from: faro, to: "0x1111111111111111111111111111111111111111" }, { from: "0x1111111111111111111111111111111111111111", to: faro }] },
  ]);
  assert.equal(got.faroswap, 1);
});

test("a same-chain official swap is Faroswap even when the pool is not the router", () => {
  const pool = "0x2222222222222222222222222222222222222222";
  const got = venuesOf([
    {
      tx: "0xbbb",
      category: "swap",
      legs: [
        { symbol: "WPROS", from: "0x1111111111111111111111111111111111111111", to: pool },
        { symbol: "USDC", from: pool, to: "0x1111111111111111111111111111111111111111" },
      ],
    },
  ]);
  assert.equal(got.faroswap, 1);
});

test("USDC to USDCe is not labeled Faroswap", () => {
  const got = venuesOf([
    {
      tx: "0xccc",
      category: "swap",
      legs: [
        { symbol: "USDC", from: "0x1111111111111111111111111111111111111111", to: "0x3333333333333333333333333333333333333333" },
        { symbol: "USDCe", from: "0x3333333333333333333333333333333333333333", to: "0x1111111111111111111111111111111111111111" },
      ],
    },
  ]);
  assert.equal(got.faroswap, 0);
});

test("netOf subtracts outs from ins", () => {
  const net = netOf({ USDC: 10n, WPROS: 3n }, { USDC: 4n, WPROS: 3n });
  assert.equal(net.USDC, 6n);
  assert.equal(net.WPROS, 0n);
});

test("one event does not read as events", () => {
  const compared = comparePeriods(
    [{ category: "in", legs: [], approvals: [] }],
    [{ category: "in", legs: [], approvals: [] }]
  );
  assert.match(story(compared, "en"), /1 event now/);
  assert.doesNotMatch(story(compared, "en"), /1 events/);
  assert.match(story(compared, "pt"), /1 evento agora/);
});
