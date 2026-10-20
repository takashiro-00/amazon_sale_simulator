import { it, expect } from "vitest";
import {
  SimClock,
  toMarketplaceDate,
  marketplaceHour,
  dMinus,
  isScheduled,
  hourlyBucket,
} from "../src/time/clock.js";
import {
  queryFacts,
  zeroOrdersRobust,
  type MetricFact,
} from "../src/data/facts.js";
import { resolveWindow } from "../src/data/windows.js";
import { usd } from "../src/domain/money.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
it("G8 uses PT dates, repeated DST hours with distinct buckets and marketplace Sundays", () => {
  const a = "2026-11-01T08:30:00Z",
    b = "2026-11-01T09:30:00Z";
  expect([marketplaceHour(a), marketplaceHour(b)]).toEqual([1, 1]);
  expect(hourlyBucket(a)).not.toBe(hourlyBucket(b));
  expect(toMarketplaceDate("2026-10-20T01:00:00Z")).toBe("2026-10-19");
  expect(
    isScheduled("weeklySunday", "2026-11-01T01:00:00Z", DEFAULT_CONFIG),
  ).toBe(false);
  expect(isScheduled("weeklySunday", a, DEFAULT_CONFIG)).toBe(true);
  const c = new SimClock(a);
  c.advanceHours(1);
  expect(c.now()).toBe("2026-11-01T09:30:00.000Z");
  expect(dMinus("2026-11-02", 1)).toBe("2026-11-01");
  expect(
    isScheduled("every3Days", "2026-01-04T20:00:00Z", DEFAULT_CONFIG),
  ).toBe(true);
});
it("G2 windows stop D-2 and require full ripe post-change days", () => {
  for (const days of [3, 7, 14] as const) {
    const w = resolveWindow(
      { kind: "rolling", days },
      "2026-10-20",
      { windowStartAt: "2026-09-01T00:00:00Z" },
      DEFAULT_CONFIG,
    );
    expect(w.to).toBe("2026-10-18");
    expect(w.ripeDays).toBe(days);
    expect(w.eligible).toBe(true);
  }
  expect(
    resolveWindow(
      { kind: "rolling", days: 3 },
      "2026-10-20",
      { windowStartAt: "2026-10-17T12:00:00Z" },
      DEFAULT_CONFIG,
    ).eligible,
  ).toBe(false);
  expect(
    resolveWindow(
      { kind: "post", days: 3 },
      "2026-10-20",
      { windowStartAt: "2026-08-01T12:00:00Z" },
      DEFAULT_CONFIG,
    ).ripeDays,
  ).toBe(30);
  const mem = { windowStartAt: "2026-10-16T12:00:00Z" };
  expect(
    resolveWindow({ kind: "post", days: 3 }, "2026-10-20", mem, DEFAULT_CONFIG)
      .eligible,
  ).toBe(true);
  expect(
    resolveWindow({ kind: "post", days: 3 }, "2026-10-20", mem, {
      ...DEFAULT_CONFIG,
      ambiguity: { ...DEFAULT_CONFIG.ambiguity, changeDayCountsAsPost: false },
    }).eligible,
  ).toBe(false);
});
const fact = (date: string, knownAt: string, orders = 0): MetricFact => ({
  entityRef: "t:1",
  marketplaceDate: date,
  knownAt,
  orders,
  impressions: 10,
  clicks: 2,
  spendMicros: usd("1"),
  salesMicros: usd(orders ? "10" : "0"),
});
it("G2 filters future knowledge and selects latest restatement per full grain", () => {
  const facts = [
    fact("2026-10-17", "2026-10-18T00:00Z"),
    fact("2026-10-17", "2026-10-20T00:00Z", 1),
    fact("2026-10-18", "2026-10-19T00:00Z"),
  ];
  const q = queryFacts(facts, { asOf: "2026-10-19T12:00Z" });
  expect(q).toHaveLength(2);
  expect(q[0]?.orders).toBe(0);
  expect(zeroOrdersRobust(q, "2026-10-20")).toBe(true);
  expect(zeroOrdersRobust(q.slice(0, 1), "2026-10-20")).toBe(false);
  const restated = queryFacts(facts, { asOf: "2026-10-20T12:00Z" });
  expect(restated[0]?.orders).toBe(1);
  expect(zeroOrdersRobust(restated, "2026-10-20")).toBe(false);
});
it("G8 preserves 25 fall-back and 23 spring-forward hourly fact buckets", () => {
  const makeDay = (start: string, hours: number) =>
    Array.from({ length: hours }, (_, i) => {
      const c = new SimClock(start);
      c.advanceHours(i);
      const at = c.now();
      return {
        ...fact(toMarketplaceDate(at), "2026-12-01T00:00:00Z"),
        hour: marketplaceHour(at),
        hourBucket: hourlyBucket(at),
      };
    });
  for (const [start, hours] of [
    ["2026-11-01T07:00:00Z", 25],
    ["2026-03-08T08:00:00Z", 23],
  ] as const) {
    const snapshot = queryFacts(makeDay(start, hours), {
      asOf: "2026-12-02T00:00:00Z",
    });
    expect(snapshot).toHaveLength(hours);
    expect(new Set(snapshot.map((f) => f.marketplaceDate)).size).toBe(1);
  }
  expect(() =>
    queryFacts([{ ...fact("2026-11-01", "2026-12-01T00:00Z"), hour: 1 }], {
      asOf: "2026-12-02T00:00Z",
    }),
  ).toThrow("INVALID_HOUR_BUCKET");
});
// Calendar expiry replaces the removed elapsed-24h ambiguity, including DST.
it("G3 calendar expiry is independent of elapsed hours across DST", async()=>{
 const {isInCooldown}=await import("../src/engine/cooldown.js");
 const {createTargetMemory}=await import("../src/domain/state.js");
 const m={...createTargetMemory(usd("1"),"2026-03-07T20:00:00Z",DEFAULT_CONFIG),bidCooldownUntil:"2026-03-10"};
 expect(isInCooldown(m,"bid","2026-03-10T19:00:00Z")).toBe(false);
 expect(isInCooldown(m,"bid","2026-03-09T19:00:00Z")).toBe(true);
});
