import test from "node:test";
import assert from "node:assert/strict";
import { comparePeriods, digestWindows, pct, story } from "../lib/digest.js";

test("windows sit a week apart and keep the same width", () => {
  const w = digestWindows(1_000_000, 2, 4_000, 7);
  assert.equal(w.current.toBlock - w.current.fromBlock + 1, 4_000);
  assert.equal(w.previous.toBlock - w.previous.fromBlock + 1, 4_000);
  assert.ok(w.previous.toBlock < w.current.fromBlock);
  assert.equal(w.gap, 7 * 86_400 / 2);
});

test("pct handles a quiet previous week", () => {
  assert.equal(pct(10, 5), 100);
  assert.equal(pct(5, 5), 0);
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(4, 0), null);
});

test("story mentions the swing vs last week", () => {
  const compared = comparePeriods(
    [{ category: "swap", legs: [], approvals: [] }, { category: "swap", legs: [], approvals: [] }],
    [{ category: "in", legs: [], approvals: [] }]
  );
  assert.equal(compared.metrics.find((m) => m.id === "events").change, 100);
  assert.match(story(compared, "en"), /100% above last week/);
  assert.match(story(compared, "pt"), /100% acima/);
});
