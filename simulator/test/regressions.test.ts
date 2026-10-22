import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateScenario } from '../src/scenario/schema.js';
import { runScenario } from '../src/market/driver.js';
import { observation, Reporter, MemoryFactSink } from '../src/market/reporting.js';
import { emptyMetrics, expectedImpressions } from '../src/market/model.js';
import { Rng } from '../src/market/rng.js';
import { FactIndex, queryFacts } from '../src/data/facts.js';
const load = (path = 'scenarios/golden-winner.json') => validateScenario(JSON.parse(readFileSync(path, 'utf8')));
it('lag 1 waits for second daily release, lag 0 is in first stream and daily', () => {
    for (const lag of [0, 1]) {
        const s = load();
        s.attribution.lagDistribution = { [lag]: 1 };
        const result = { ...emptyMetrics(), budgetCapped: false, orders: 3, salesMicros: 90e6, slices: [], orderEvents: Array.from({ length: 3 }, () => ({ placement: 'TOP' as const, query: 'winner', salesMicros: 30e6 })) };
        const o = observation(s, 't1', 'c1', '2026-10-01T07:00:00Z', result, new Rng(1));
        const sink = new MemoryFactSink(), reporter = new Reporter(s, sink);
        reporter.record(o);
        reporter.publish('2026-10-03T10:00:00Z');
        const daily = (asOf: string) => queryFacts(sink.facts, { entityRef: 't1', asOf }).find(f => !f.hourBucket && !f.placement)!.orders;
        expect(daily('2026-10-02T10:00:00Z')).toBe(lag === 0 ? 3 : 0);
        expect(daily('2026-10-03T10:00:00Z')).toBe(3);
        if (lag === 0)
            expect(sink.facts.find(f => f.hourBucket && !f.placement)!.orders).toBe(3);
    }
});
it('shared budget is fair for identical targets', () => {
    const s = load('test/fixtures/golden-perf.json');
    const c = s.campaigns[0]!;
    c.targets = [{ ...c.targets[0]!, id: 'a' }, { ...c.targets[0]!, id: 'b' }];
    const r = runScenario(s);
    const n = c.targets.map(t => r.truth.filter(o => o.entityRef === t.id).reduce((a, o) => a + o.result.impressions, 0));
    expect(Math.abs(n[0]! - n[1]!) / Math.max(...n)).toBeLessThanOrEqual(.15);
});
it('golden has forty days, realistic depletion and winner economics by expectation', () => {
    const s = load(), c = s.campaigns[0]!, t = c.targets[0]!;
    expect(s.days).toBe(40);
    const spend = t.hourlyTrafficCurve.map((_, h) => expectedImpressions(t, t.bid, h) * t.ctr * t.bid * .775);
    expect(spend.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(25);
    let sum = 0;
    const hour = spend.findIndex(n => (sum += n) >= 5);
    expect(hour).toBeGreaterThanOrEqual(13);
    expect(hour).toBeLessThanOrEqual(18);
    const cvr = t.trueCvr * (.85 + .15 * t.topCvrMultiplier) * t.searchTerms.reduce((n, x) => n + x.weight * x.cvrMultiplier, 0) / t.searchTerms.reduce((n, x) => n + x.weight, 0);
    expect(cvr).toBeGreaterThanOrEqual(.12);
    expect(cvr).toBeLessThanOrEqual(.15);
    const acos = t.bid * .775 / (cvr * s.products[0]!.priceUsd);
    expect(acos).toBeGreaterThanOrEqual(.18);
    expect(acos).toBeLessThanOrEqual(.22);
});
it('14 day fixture is compact, fast and deterministic', () => {
    const s = load('test/fixtures/golden-perf.json'), start = performance.now(), r = runScenario(s), ms = performance.now() - start;
    expect(r.facts.length).toBeLessThan(6283);
    expect(ms).toBeLessThan(500);
    const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    expect(hash(runScenario(s))).toBe(hash(r));
});
it('indexed entity queries equal linear snapshots on three scenarios', () => {
    for (const name of ['golden-winner', 'budget-capped', 'attribution-storm']) {
        const s = load(`scenarios/${name}.json`);
        s.days = 2;
        const r = runScenario(s), index = new FactIndex(r.facts);
        for (const asOf of ['2026-10-02T10:00:00Z', '2026-10-03T10:00:00Z', '2026-11-01T10:00:00Z'])
            for (const entityRef of ['t1', 'c1', 't1:search:winner']) {
                const linear = queryFacts(r.facts, { asOf }).filter(f => f.entityRef === entityRef);
                expect(queryFacts(r.facts, { asOf, entityRef })).toEqual(linear);
                expect(queryFacts(index, { asOf, entityRef })).toEqual(linear);
            }
    }
});
it('20 targets over 60 days runs below ten seconds', () => {
    const s = load();
    s.days = 60;
    const c = s.campaigns[0]!;
    c.targets = Array.from({ length: 20 }, (_, i) => ({ ...c.targets[0]!, id: `t${i}`, text: `winner ${i}` }));
    const start = performance.now();
    runScenario(s);
    expect(performance.now() - start).toBeLessThan(10000);
}, 15000);
it('renaming target IDs leaves role totals unchanged; unconstrained demand matches solo', () => {
    const s = load('test/fixtures/golden-perf.json');
    s.days = 3;
    const c = s.campaigns[0]!;
    c.targets = [{ ...c.targets[0]!, id: 'a' }, { ...c.targets[0]!, id: 'b' }];
    const totals = (x: typeof s) => { const r = runScenario(x); return x.campaigns[0]!.targets.map(t => r.truth.filter(o => o.entityRef === t.id).map(o => o.result)); };
    const before = totals(s);
    c.targets[0]!.id = 'zzz';
    c.targets[1]!.id = 'aaa';
    expect(totals(s)).toEqual(before);
    c.budget = 10000;
    const together = totals(s);
    c.targets.pop();
    expect(totals(s)[0]).toEqual(together[0]);
});
it('all campaign hourly restatements include every target', () => {
    const s = load('scenarios/attribution-storm.json');
    s.days = 1;
    const c = s.campaigns[0]!;
    c.targets.push({ ...c.targets[0]!, id: 'other' });
    const r = runScenario(s);
    for (const asOf of ['2026-10-02T10:00:00Z', '2026-10-05T10:00:00Z', '2026-10-09T10:00:00Z']) {
        const fs = queryFacts(r.facts, { asOf }).filter(f => !f.placement && f.hourBucket);
        for (const f of fs.filter(f => f.entityRef === c.id))
            for (const k of ['impressions', 'clicks', 'spendMicros', 'orders', 'salesMicros'] as const)
                expect(f[k]).toBe(fs.filter(t => c.targets.some(x => x.id === t.entityRef) && t.hourBucket === f.hourBucket).reduce((n, t) => n + t[k], 0));
    }
});
it('daily release maturity is exactly P(lag <= 1) at D-2; returns use release boundaries', async () => {
    const { visibleLagProbability, dailyRelease } = await import('../src/market/reporting.js');
    const s = load();
    expect(visibleLagProbability(s.attribution.lagDistribution, 2)).toBeCloseTo(.8, 14);
    for (const [lag, p] of Object.entries(s.attribution.lagDistribution))
        expect(visibleLagProbability({ [lag]: 1 }, 2)).toBe(Number(lag) <= 1 ? 1 : 0);
    for (const [lag, returnLag] of [[0, 0], [1, 0], [1, 4], [14, 14]]) {
        s.attribution.lagDistribution = { [lag!]: 1 };
        s.returnRate = 1;
        s.attribution.returnLagDays = returnLag!;
        const result = { ...emptyMetrics(), budgetCapped: false, slices: [], orderEvents: [{ placement: 'TOP' as const, query: 'winner', salesMicros: 30e6 }] };
        const order = observation(s, 't1', 'c1', '2026-10-01T07:00:00Z', result, new Rng(4)).orders[0]!;
        expect(order.returnedAt).toBe(dailyRelease('2026-10-01', Math.min(14, Math.max(lag!, returnLag!) + 1), s.marketplace.zone));
    }
});
it('fact versions change metrics, omit never-used zero dimensions, and restore zero after returns', () => {
    const s = load();
    s.days = 2;
    s.returnRate = 1;
    s.attribution.lagDistribution = { '0': 1 };
    s.attribution.returnLagDays = 2;
    s.campaigns[0]!.budget = 1000;
    const r = runScenario(s), last = new Map<string, string>();
    for (const f of r.facts) {
        const key = JSON.stringify([f.entityRef, f.marketplaceDate, f.hourBucket, f.placement]), payload = JSON.stringify([f.impressions, f.clicks, f.spendMicros, f.orders, f.salesMicros, f.budgetCapped]);
        expect(last.get(key)).not.toBe(payload);
        last.set(key, payload);
        expect(f.placement).not.toBe('PRODUCT_PAGE');
    }
    const daily = r.facts.filter(f => f.entityRef === 't1' && !f.hourBucket && !f.placement);
    expect(daily.some(f => f.orders > 0)).toBe(true);
    expect(queryFacts(r.facts, { asOf: '2027-01-01T00:00:00Z', entityRef: 't1' }).filter(f => !f.hourBucket).every(f => f.orders === 0)).toBe(true);
});
it('lag 14 first appears on daily release 15; only returns have a D+14 ceiling', () => {
    const s = load();
    s.days = 1;
    s.attribution.lagDistribution = { '14': 1 };
    s.returnRate = 0;
    s.campaigns[0]!.budget = 1000;
    const r = runScenario(s);
    const at = (asOf: string) => queryFacts(r.facts, { entityRef: 't1', asOf }).find(f => !f.hourBucket && !f.placement)!.orders;
    expect(at('2026-10-15T10:00:00Z')).toBe(0);
    expect(at('2026-10-16T10:00:00Z')).toBe(r.summary.netOrders);
});
it('batch binomial skips failures instead of drawing for every impression', () => {
    class CountingRng extends Rng {
        calls = 0;
        override uniform(min = 0, max = 1) { this.calls++; return super.uniform(min, max); }
    }
    const r = new CountingRng(91), count = r.binomial(1000000, .0001);
    expect(count).toBeGreaterThan(60);
    expect(count).toBeLessThan(140);
    expect(r.calls).toBeLessThan(500);
    const samples = Array.from({ length: 10000 }, () => r.binomial(100, .3)), mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(30, 0);
    expect(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length).toBeGreaterThan(20);
    expect(r.binomial(10, 0)).toBe(0);
    expect(r.binomial(10, 1)).toBe(10);
});
