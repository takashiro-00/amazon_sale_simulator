import { describe, it, expect } from 'vitest';
import { Rng } from '../src/market/rng.js';
import { expectedImpressions, simulateHour } from '../src/market/model.js';
import { validateScenario } from '../src/scenario/schema.js';
import { readFileSync, readdirSync } from 'node:fs';
import { MarketDriver } from '../src/market/driver.js';
import { runScenario } from '../src/market/driver.js';
import { queryFacts } from '../src/data/facts.js';
const load = (name = 'golden-winner') => validateScenario(JSON.parse(readFileSync(`scenarios/${name}.json`, 'utf8')));
describe('seeded world', () => {
    it('forks are independent and distributions handle boundaries', () => {
        const a = new Rng(42), b = new Rng(42);
        a.fork('new').uniform();
        expect(a.fork('old').uniform()).toBe(b.fork('old').uniform());
        expect(a.binomial(20, 0)).toBe(0);
        expect(a.binomial(20, 1)).toBe(20);
        expect(a.poisson(0)).toBe(0);
        expect(a.lognormal(0, 0)).toBe(1);
        expect(a.categorical([0, 1])).toBe(1);
    });
    it('has monotone expected traffic, bounded CPC, paused traffic and budget cap', () => {
        const s = load(), t = s.campaigns[0]!.targets[0]!;
        expect(expectedImpressions(t, 1, 12)).toBeGreaterThanOrEqual(expectedImpressions(t, .5, 12));
        const base = { target: t, bid: 1, topOfSearchPct: 50, hour: 12, price: 30, remainingBudget: 2, seasonality: 1, status: 'ENABLED' as const };
        const r = simulateHour(base, new Rng(5));
        expect(r.spendMicros).toBeLessThanOrEqual(2e6);
        expect(r.clicks === 0 || r.spendMicros / r.clicks <= 1e6).toBe(true);
        expect(simulateHour({ ...base, status: 'PAUSED' }, new Rng(5)).impressions).toBe(0);
    });
    it('validates all examples and gives field paths', () => {
        for (const f of readdirSync('scenarios').filter(f=>f.endsWith('.json')))
            expect(() => validateScenario(JSON.parse(readFileSync(`scenarios/${f}`, 'utf8')))).not.toThrow();
        const s = load();
        s.campaigns[0]!.targets[0]!.trueCvr = -1;
        expect(() => validateScenario(s)).toThrow('campaigns[0].targets[0].trueCvr');
    });
    it('replays identically, changes with seed, and isolates target streams', () => {
        const s = load();
        s.days = 2;
        const a = runScenario(s);
        expect(runScenario(s).facts).toEqual(a.facts);
        expect(runScenario({ ...s, seed: 999 }).facts).not.toEqual(a.facts);
        s.campaigns[0]!.budget = 10000;
        const before = runScenario(s);
        s.campaigns[0]!.targets.push({ ...s.campaigns[0]!.targets[0]!, id: 'extra' });
        expect(runScenario(s).facts.filter(f => f.entityRef === 't1')).toEqual(before.facts.filter(f => f.entityRef === 't1'));
    });
    it('restates delayed orders, returns and never leaks future facts', () => {
        const s = load('attribution-storm');
        s.days = 2;
        s.returnRate = .3;
        s.attribution.returnLagDays = 9;
        const r = runScenario(s), day = s.startDate;
        const versions = r.facts.filter(f => f.entityRef === 't1' && f.marketplaceDate === day && f.hour === undefined && !f.placement);
        expect(Math.max(...versions.map(f => f.orders))).toBeGreaterThan(versions[0]!.orders);
        expect(versions.at(-1)!.orders).toBe(r.truth.filter(o => o.entityRef === 't1' && o.marketplaceDate === day).reduce((n, o) => n + o.orders.filter(x => !x.returnedAt).length, 0));
        expect(versions.some((f, i) => i > 0 && f.orders < versions[i - 1]!.orders)).toBe(true);
        expect(queryFacts(r.facts, { asOf: versions[0]!.knownAt, entityRef: 't1' }).filter(f => f.hour === undefined && !f.placement)[0]).toEqual(versions[0]);
        for (const f of r.facts)
            expect(Date.parse(f.knownAt)).toBeGreaterThanOrEqual(Date.parse(f.hourBucket ?? `${f.marketplaceDate}T00:00:00-07:00`) + (f.hourBucket ? 3600000 : 0));
    });
    it('zero lag is stable and hourly agrees with daily across both DST transitions', () => {
        for (const [start, hours] of [['2026-11-01', 25], ['2027-03-14', 23]] as const) {
            const s = load();
            s.startDate = start;
            s.days = 1;
            s.returnRate = 0;
            s.attribution.lagDistribution = { '0': 1 };
            const r = runScenario(s), facts = queryFacts(r.facts, { asOf: '2028-01-01T00:00:00Z', entityRef: 't1' }).filter(f => !f.placement);
            const hourly = facts.filter(f => f.hourBucket);
            expect(hourly).toHaveLength(hours);
            const daily = facts.find(f => !f.hourBucket)!;
            for (const k of ['impressions', 'clicks', 'orders', 'spendMicros', 'salesMicros'] as const)
                expect(hourly.reduce((n, f) => n + f[k], 0)).toBe(daily[k]);
            expect(r.facts.filter(f => f.entityRef === 't1' && !f.hourBucket && !f.placement).every(f => f.orders === daily.orders)).toBe(true);
        }
    });
    it('caps all later hours and manual edits start next hour', () => {
        const s = load('budget-capped');
        s.days = 1;
        const r = runScenario(s), hourly = queryFacts(r.facts, { asOf: '2028-01-01T00:00:00Z', entityRef: 't1' }).filter(f => f.hourBucket && !f.placement);
        expect(hourly.reduce((n, f) => n + f.spendMicros, 0)).toBeLessThanOrEqual(s.campaigns[0]!.budget * 1e6);
        const i = hourly.findIndex(f => f.budgetCapped);
        expect(i).toBeGreaterThan(0);
        expect(hourly.slice(i).every(f => f.clicks === 0 && f.budgetCapped)).toBe(true);
        const d = new MarketDriver(s);
        const v = d.initialView();
        v.campaigns[0]!.status = 'PAUSED';
        expect(d.step('2026-10-01T07:00:00Z', v).spendByCampaign.c1).toBe(0);
    });
});
it('storm grows between D+2 and D+14 and every hourly release waits for completion', () => {
    const s = load('attribution-storm');
    s.days = 1;
    const r = runScenario(s);
    const a = queryFacts(r.facts, { asOf: '2026-10-03T10:00:00Z', entityRef: 't1' }).find(f => !f.hourBucket && !f.placement)!;
    const b = queryFacts(r.facts, { asOf: '2026-10-15T10:00:00Z', entityRef: 't1' }).find(f => !f.hourBucket && !f.placement)!;
    expect(a.orders).toBeLessThan(b.orders);
    expect(b.orders).toBe(r.summary.netOrders);
    for (const f of r.facts)
        if (f.hourBucket)
            expect(Date.parse(f.knownAt)).toBeGreaterThanOrEqual(Date.parse(f.hourBucket) + 7200000);
});
it('hourly noise keeps click counts nonnegative and CPC below the submitted bid', () => {
    const s = load();
    s.days = 2;
    s.hourlyNoise = 1;
    s.campaigns[0]!.budget = 10000;
    s.campaigns[0]!.targets[0]!.ctr = .002;
    for (const f of runScenario(s).facts.filter(f => f.entityRef === 't1' && f.hourBucket && !f.placement)) {
        expect(f.spendMicros).toBeLessThanOrEqual(f.clicks * s.campaigns[0]!.targets[0]!.bid * 1e6);
    }
});


describe('target RNG identity', () => {
    it('samples identical targets independently across uncapped campaigns over forty days', () => {
        const s = load(), c = s.campaigns[0]!;
        s.startDate = '2026-09-01';
        c.budget = 10000;
        s.campaigns.push({ ...structuredClone(c), id: 'c2', targets: [{ ...structuredClone(c.targets[0]!), id: 't2' }] });
        const r = runScenario(s);
        const rows = ['t1', 't2'].map(id => r.truth.filter(o => o.entityRef === id));
        expect(rows.every(xs => xs.length === 40 * 24 && xs.every(o => !o.result.budgetCapped))).toBe(true);
        expect(rows[0]!.map(o => o.result.clicks)).not.toEqual(rows[1]!.map(o => o.result.clicks));
        const impressions = rows.map(xs => xs.reduce((n, o) => n + o.result.impressions, 0));
        expect(Math.min(...impressions)).toBeGreaterThan(0);
        expect(Math.abs(impressions[0]! - impressions[1]!) / Math.max(...impressions)).toBeLessThanOrEqual(.15);
    });
    it('preserves all facts when only a target ID changes within its campaign', () => {
        const s = load();
        s.days = 3;
        s.campaigns[0]!.budget = 10000;
        const before = runScenario(s).facts;
        s.campaigns[0]!.targets[0]!.id = 'renamed';
        const after = runScenario(s).facts.map(f => ({ ...f, entityRef: f.entityRef.replace(/^renamed(?=:|$)/, 't1') }));
        expect(after).toEqual(before);
    });
    it('preserves all facts across target text case and whitespace variants', () => {
        const s = load();
        s.days = 3;
        s.campaigns[0]!.budget = 10000;
        const t = s.campaigns[0]!.targets[0]!;
        t.text = 'best winner';
        const before = runScenario(s).facts;
        for (const text of ['BEST WINNER', '  best   winner  ', '\tBest \n WINNER\t']) {
            t.text = text;
            expect(runScenario(s).facts).toEqual(before);
        }
    });
});
