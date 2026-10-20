import { describe, it, expect } from "vitest";
import { usd, micros, roundBidToCent, toUsd } from "../src/domain/money.js";
import { deriveThresholds } from "../src/domain/params.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { acos, acosLt, acosLte, acosGt, acosGte } from "../src/domain/acos.js";
import { stepUp, stepDown } from "../src/domain/budgetLadder.js";
import {
  createTargetMemory,
  assertStateInvariants,
  submittedBid,
} from "../src/domain/state.js";

describe("G1 money and product parameters", () => {
  it("derives the reference thresholds and stable parameter version", () => {
    const p = { asin: "A", priceMicros: usd("30"), breakEvenAcos: 0.4 };
    const { thresholds: t, warnings } = deriveThresholds(p, DEFAULT_CONFIG);
    expect(t.T_win).toBeCloseTo(0.28);
    expect(t.T_ok).toBeCloseTo(0.36);
    expect(t.T_bad).toBeCloseTo(0.44);
    expect([t.CPA_target, t.Spend_zero, t.Bid_max]).toEqual([
      usd("8.40"),
      usd("21"),
      usd("1.08"),
    ]);
    expect([t.N2, t.N3, t.N2h, t.N17]).toEqual([20, 30, 10, 12]);
    expect(warnings).toEqual([]);
    expect(Object.isFrozen(t)).toBe(true);
    expect(t.paramsVersion).toBe(
      deriveThresholds(p, DEFAULT_CONFIG).thresholds.paramsVersion,
    );
    expect(t.paramsVersion).not.toBe(
      deriveThresholds({ ...p, priceMicros: usd("31") }, DEFAULT_CONFIG)
        .thresholds.paramsVersion,
    );
  });
  it("warns for infeasible products and clamps spend bounds", () => {
    const derive = (price: string, be: number) =>
      deriveThresholds(
        { asin: "A", priceMicros: usd(price), breakEvenAcos: be },
        DEFAULT_CONFIG,
      );
    expect(derive("5", 0.2).thresholds.Bid_max).toBe(usd(".20"));
    expect(derive("5", 0.2).warnings).toContain(
      "PRODUCT_INFEASIBLE_AT_MIN_BID",
    );
    expect(derive("5", 0.2).thresholds.Spend_zero).toBe(usd("10"));
    expect(derive("100", 0.6).thresholds.Spend_zero).toBe(usd("40"));
  });
  it("keeps micros integral and rounds cent bids", () => {
    expect(roundBidToCent(usd("1.235"))).toBe(usd("1.24"));
    expect(toUsd(usd("1.23"))).toBe("1.23");
    expect(() => micros(1.1)).toThrow();
    expect(() => usd("NaN")).toThrow();
    expect(() =>
      deriveThresholds(
        { asin: "A", priceMicros: usd("30"), breakEvenAcos: 0.4, expCvr: 0 },
        DEFAULT_CONFIG,
      ),
    ).toThrow();
  });
  it("steps budget tiers without leaving the ladder", () => {
    expect(stepUp(0, DEFAULT_CONFIG)).toBe(1);
    expect(stepDown(0, DEFAULT_CONFIG)).toBe(0);
    expect(stepUp(DEFAULT_CONFIG.budgetLadder.length - 1, DEFAULT_CONFIG)).toBe(
      DEFAULT_CONFIG.budgetLadder.length - 1,
    );
  });
});
describe("ACoS", () => {
  it.each([
    [0, 0, "undefined"],
    [0, 10, "undefined"],
    [1, 0, "infinite"],
    [2, 10, "value"],
  ] as const)("classifies %s/%s", (s, v, k) =>
    expect(acos(micros(s), micros(v)).kind).toBe(k),
  );
  it("implements all comparison semantics", () => {
    for (const fn of [acosLt, acosLte, acosGt, acosGte])
      expect(fn(acos(usd("0"), usd("0")), 0.2)).toBe(false);
    const inf = acos(usd("1"), usd("0"));
    expect([
      acosLt(inf, 1),
      acosLte(inf, 1),
      acosGt(inf, 1),
      acosGte(inf, 1),
    ]).toEqual([false, false, true, true]);
    const a = acos(usd("2"), usd("10"));
    expect([
      acosLt(a, 0.2),
      acosLte(a, 0.2),
      acosGt(a, 0.2),
      acosGte(a, 0.2),
    ]).toEqual([false, true, false, true]);
  });
});
it("G4 derives outbound bid without mutating base and rejects inconsistent state", () => {
  const m = createTargetMemory(
    usd("1"),
    "2026-10-01T00:00:00Z",
    DEFAULT_CONFIG,
  );
  const changed = { ...m, hourlyFactor: { ...m.hourlyFactor, 1: 1.235 } };
  expect(submittedBid(changed, 1)).toBe(usd("1.24"));
  expect(() =>
    assertStateInvariants({
      memory: changed,
      hourNow: 1,
      bidMicros: usd("1.24"),
    }),
  ).not.toThrow();
  expect(() =>
    assertStateInvariants({ memory: changed, hourNow: 1, bidMicros: usd("1") }),
  ).toThrow();
  expect(m.baseBidMicros).toBe(usd("1"));
});
