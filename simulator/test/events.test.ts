import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario/schema.js';
import { eventContext, productAt } from '../src/market/events.js';
import { runScenario } from '../src/market/driver.js';
import { queryFacts } from '../src/data/facts.js';
const load = () => validateScenario(JSON.parse(readFileSync('scenarios/golden-winner.json', 'utf8')));
it('applies event windows, versioned product changes and next-hour manual edits', () => {
    const s = load();
    s.days = 1;
    s.campaigns[0]!.budget = 10000;
    s.events = [
        { type: 'seasonality', from: '2026-10-01T07:00:00Z', to: '2026-10-01T09:00:00Z', multiplier: 3, lagMultiplier: 2 },
        { type: 'priceChange', asin: 'B001', at: '2026-10-01T08:00:00Z', priceUsd: 20, breakEvenAcos: .3 },
        { type: 'manualEdit', entityId: 't1', at: '2026-10-01T09:00:00Z', field: 'status', value: 'PAUSED' },
        { type: 'apiFault', from: '2026-10-01T08:00:00Z', to: '2026-10-01T09:00:00Z', fault: { serverError: { probability: 1 } } }
    ];
    expect(eventContext(s, '2026-10-01T08:00:00Z')).toMatchObject({ seasonality: 3, lagMultiplier: 2, apiFault: { serverError: { probability: 1 } } });
    expect(eventContext(s, '2026-10-01T09:00:00Z').seasonality).toBe(1);
    expect(productAt(s, 'B001', '2026-10-01T08:00:00Z')).toMatchObject({ priceUsd: 20, breakEvenAcos: .3 });
    expect(productAt(s, 'B001', '2026-10-01T08:00:00Z').paramsVersion).not.toBe(productAt(s, 'B001', '2026-10-01T07:00:00Z').paramsVersion);
    const r = runScenario(s);
    expect(r.truth.find(o => o.hour === 2)!.result.impressions).toBeGreaterThan(0);
    expect(r.truth.filter(o => o.hour >= 3).every(o => o.result.impressions === 0)).toBe(true);
});
it('campaign facts reconcile with targets and zero-sale coupon orders survive reporting', () => {
    const s = load();
    s.days = 1;
    s.campaigns[0]!.budget = 10000;
    s.couponZeroSalesRate = 1;
    s.attribution.lagDistribution = { '0': 1 };
    s.campaigns[0]!.targets.push({ ...s.campaigns[0]!.targets[0]!, id: 't2' });
    const r = runScenario(s), facts = queryFacts(r.facts, { asOf: '2028-01-01T00:00:00Z' }).filter(f => f.hour === undefined && !f.placement);
    const c = facts.find(f => f.entityRef === 'c1')!;
    expect(c).toBeDefined();
    expect(c.orders).toBeGreaterThan(0);
    expect(c.salesMicros).toBe(0);
    for (const k of ['impressions', 'clicks', 'orders', 'salesMicros', 'spendMicros'] as const)
        expect(c[k]).toBe(facts.filter(f => ['t1', 't2'].includes(f.entityRef)).reduce((n, f) => n + f[k], 0));
});
