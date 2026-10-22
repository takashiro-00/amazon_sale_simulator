import { it, expect } from "vitest";
import { clampBid } from "../src/guards/bid.js";
import { usd } from "../src/domain/money.js";
import { deriveThresholds } from "../src/domain/params.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
const thresholds = deriveThresholds(
  { asin: "A", priceMicros: usd("100"), breakEvenAcos: 0.5 },
  DEFAULT_CONFIG,
).thresholds;
const run = (o: Partial<Parameters<typeof clampBid>[0]> = {}) =>
  clampBid({
    oldBase: usd("1"),
    proposedBase: usd("1.5"),
    anchor: usd("1"),
    thresholds,
    tosPct: 0,
    hourlyFactor: 1,
    ruleId: "R11",
    ...o,
  });
it("G6 caps per-change, anchor, product and ToS bounds", () => {
  expect(run().base).toBe(usd("1.2"));
  expect(run({ oldBase: usd(".5"), proposedBase: usd(".3") }).base).toBe(
    usd(".5"),
  );
  expect(
    run({ oldBase: usd("3"), anchor: usd("3"), proposedBase: usd("3.6") }).base,
  ).toBe(usd("3"));
  expect(
    run({
      oldBase: usd("1.5"),
      anchor: usd("1.5"),
      proposedBase: usd("1.8"),
      tosPct: 200,
    }).base,
  ).toBe(usd("1.5"));
  expect(run({ ruleId: "R20" }).base).toBe(usd("1.5"));
  expect(run({ anchor: usd("10") }).reasons).toContain("OUTSIDE_ANCHOR_BAND_RECOVERING");
  expect(run({ anchor: usd("10") }).base).toBe(usd("1.2"));
});
it("G6 rounds inward at fractional-cent ceiling and includes hourly factor", () => {
  const t = { ...thresholds, Bid_max: usd("1.239") };
  expect(
    run({ oldBase: usd("1.2"), proposedBase: usd("1.4"), thresholds: t }).base,
  ).toBe(usd("1.23"));
  expect(
    run({
      oldBase: usd("1.5"),
      anchor: usd("1.5"),
      proposedBase: usd("1.8"),
      tosPct: 50,
      hourlyFactor: 2,
    }).base,
  ).toBe(usd("1.5"));
});
it("G6 prioritizes hard bounds over incompatible soft per-step bounds", () => {
  expect(
    run({ oldBase: usd("2"), anchor: usd("2"), tosPct: 200 }).base,
  ).toBe(usd("1.5"));
});
