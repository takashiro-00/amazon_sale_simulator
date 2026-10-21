import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { configHash } from '../src/audit/log.js';
import { fixture, run } from './step4-fixture.js';
import { FactIndex, type MetricFact } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { registry } from '../src/rules/registry.js';
import { firstMatchWins } from '../src/engine/priority.js';
import { analyzeHours } from '../src/rules/hourly/analysis.js';
import { usd } from '../src/domain/money.js';
import type { RuleContext } from '../src/engine/types.js';
import type { SimConfig } from '../config/defaults.js';
function flags(c: RuleContext, v: Partial<SimConfig['v32']>): RuleContext { const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, ...v } }; const fs = c.metrics.facts('c', '2026-09-01', '2026-10-17'); return { ...c, decisions: [], audit: new (c.audit.constructor as {
        new (): typeof c.audit;
    })(), config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config) }; }
it('v32 defaults preserve legacy config hash', () => { const { v32, v32Hysteresis, ...legacy } = DEFAULT_CONFIG; expect(v32).toEqual({ zeroOrderLagDays: 2, r06CalendarGuard: false, r08Daily: false, postHarvestGraceDays: 0, hysteresis: false, hourlyExcludeCapped: false }); expect(configHash(DEFAULT_CONFIG)).toBe(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')); });
it('P1 uses older zero window but original spend, and vetoes every recent date', () => {
    const c = fixture(0, 0, 2, .2, 16);
    const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map(f => ({...f, orders:f.marketplaceDate==='2026-10-02'?1:0}));
    // Full coverage: the older order is outside original W14, inside K=4 W14.
    const base = {...c, metrics:new MetricsReader(new FactIndex(fs),c.clock.now(),c.config)};
    expect(run('R06',base)).not.toBeNull();
    expect(run('R06',flags(base,{zeroOrderLagDays:4}))).toBeNull();
    const neutral=fs.map(f=>({...f,orders:0}));
    const context=(facts:MetricFact[])=>flags({...c,metrics:new MetricsReader(new FactIndex(facts),c.clock.now(),c.config)},{zeroOrderLagDays:4});
    // Positive control proves neither missing coverage nor eligibility causes the veto.
    expect(run('R06',context(neutral))).not.toBeNull();
    for(const date of ['2026-10-16','2026-10-17'])expect(run('R06',context(neutral.map(f=>({...f,orders:f.marketplaceDate===date?1:0}))))).toBeNull();
});
it('P2 calendar guard survives reset, remains OR, and requires zero orders', () => { let c = fixture(0, 0, 4); c = { ...c, state: { ...c.state, campaignMemory: { c: { ...c.state.campaignMemory.c!, windowStartAt: '2026-10-17T07:00Z' } } } }; expect(run('R06', c)).toBeNull(); expect(run('R06', flags(c, { r06CalendarGuard: true }))).not.toBeNull(); expect(run('R06', flags(fixture(0, 1, 4), { r06CalendarGuard: true }))).toBeNull(); });
it('P3 only R08 bypasses the three day schedule', () => { const c = fixture(3, 0, 5); const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17'); fs.push({ ...fs[0]!, marketplaceDate: '2026-10-01', orders: 1 }); const base = { ...c, config: { ...c.config, every3DaysAnchorMode: 'global' as const, every3DaysAnchor: '2026-10-02' }, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), c.config) }; expect(run('R08', base)).toBeNull(); expect(run('R08', flags(base, { r08Daily: true }))?.ruleId).toBe('R08'); for (const id of ['R07', 'R09'] as const) {
    const on = flags(base, { r08Daily: true });
    run(id, on);
    expect(on.audit.events[0]?.outcome).toBe('NOT_SCHEDULED');
} });
it.each([['R02', 0, .35], ['R03', 1, .35], ['R04', 2, .35], ['R05', 3, .45]] as const)('P5 %s has configurable hysteresis', (id, tier, acos) => { const c = fixture(tier, 2, 5, acos); expect(run(id, c)).not.toBeNull(); expect(run(id, flags(c, { hysteresis: true }))).toBeNull(); const on = flags(c, { hysteresis: true }); expect(run(id, { ...on, config: { ...on.config, v32Hysteresis: { ...on.config.v32Hysteresis, budgetUp: 1, budgetDown: 1 } } })).not.toBeNull(); });
it.each([19, 20])('P6 requires 20 distinct uncapped days (%s)', days => { const c = fixture(); const fs: MetricFact[] = []; for (let day = 1; day <= 28; day++)
    for (const h of [0, 1])
        fs.push({ entityRef: 'c', marketplaceDate: new Date(Date.UTC(2026, 9, 18 - day)).toISOString().slice(0, 10), hour: h as 0 | 1, hourBucket: new Date(Date.UTC(2026, 9, 18 - day, 7 + h)).toISOString(), knownAt: c.clock.now(), impressions: 100, clicks: 10, orders: h === 0 ? 0 : 5, spendMicros: usd('1'), salesMicros: usd('30'), budgetCapped: day > days }); const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, hourlyExcludeCapped: true } }; const context = { ...c, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config) }; expect(analyzeHours(context).targets.t?.hourlyFactor[0]).toBe(days === 20 ? .7 : 1); expect(analyzeHours({ ...context, config: c.config }).targets.t?.hourlyFactor[0]).toBe(.7); });
it('P4 blocks only R06 for N calendar days after a verified source negative', () => {
    for (const age of [0, 6, 7]) {
        const c = fixture(0, 0, 4);
        const at = new Date(Date.parse('2026-10-19T07:00Z') - age * 86400000).toISOString();
        const base = { ...c, state: { ...c.state, negatives: { c: [{ campaignId: 'c', text: 'harvest', matchType: 'NEGATIVE_EXACT' as const, harvestKeywordId: 'k', harvestedAt: at }] } } };
        expect(run('R06', base)).not.toBeNull();
        const on = flags(base, { postHarvestGraceDays: 7 });
        expect(run('R06', on) === null).toBe(age < 7);
        if (age < 7)
            expect(on.audit.events[0]?.outcome).toBe('BLOCKED_BY_HARVEST_GRACE');
    }
});
it('named variants share ordered baseline seeds and expose paired rates', async () => {
    const { runMonteCarlo } = await import('../src/montecarlo/index.js');
    const { readFile } = await import('node:fs/promises');
    const { validateScenario } = await import('../src/scenario/schema.js');
    const scenario = validateScenario(JSON.parse(await readFile('scenarios/edge/premature-positive.json', 'utf8')));
    scenario.days = 3;
    const result = await runMonteCarlo({ scenario, config: DEFAULT_CONFIG, seeds: 2, workers: 1, compare:['v32.r08Daily=true'], variants: [{ name: 'K3', overrides: ['v32.zeroOrderLagDays=3'] }, { name: 'P5', overrides: ['v32.hysteresis=true'] }] });
    expect(result.summary.compare?.paired?.profit).toEqual({better:0,tied:2,worse:0,count:2,betterRate:0});
    expect(result.summary.variants.map(v => v.name)).toEqual(['K3', 'P5']);
    for (const v of result.summary.variants) {
        expect(v.paired.profit).toEqual({ better: 0, tied: 2, worse: 0, count: 2, betterRate: 0 });
        expect(v.diff.profit?.mean).toBe(0);
    }
});
it('rejects invalid maturity and grace overrides', async () => { const { applyOverrides } = await import('../src/montecarlo/index.js'); for (const override of ['v32.zeroOrderLagDays=1', 'v32.zeroOrderLagDays=3.5', 'v32.postHarvestGraceDays=-1'])
    expect(() => applyOverrides(DEFAULT_CONFIG, [override])).toThrow(); });
it.each(['R06', 'R12', 'R13', 'R16', 'R17', 'R05', 'R08'] as const)('P1 %s extends only zero-order evidence', id => {
    const c = fixture(id === 'R05' || id === 'R08' ? 3 : 0, 0, 5);
    const target = ['R12', 'R13', 'R16', 'R17'].includes(id), search = ['R16', 'R17'].includes(id), entity = search ? 't:search:query' : target ? 't' : 'c';
    const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map(f => ({ ...f, entityRef: entity, clicks: 10 }));
    if (['R05', 'R08'].includes(id))
        fs.find(f => f.marketplaceDate === '2026-10-13')!.orders = 1;
    else
        fs.push({ ...fs[0]!, marketplaceDate: '2026-10-02', orders: 1 });
    if (id === 'R08')
        fs.push({ ...fs[0]!, marketplaceDate: '2026-10-01', orders: 1 });
    const state = { ...c.state, targets: { t: { ...c.state.targets.t!, baseBidMicros: usd(id === 'R13' ? '.50' : '.80') } } };
    const ref = { group: search ? 'SEARCHTERM' as const : target ? 'TARGET' as const : 'CAMPAIGN' as const, id: entity, campaignId: 'c', sourceTargetId: 't', query: 'query' };
    const evaluate = (k: number) => { const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, zeroOrderLagDays: k } }; return registry.find(r => r.id === id)!.evaluate(ref, { ...c, state, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config) }); };
    expect(evaluate(2)).not.toBeNull();
    expect(evaluate(4)).toBeNull();
});
it.each([['R10', 3, 27], ['R11', 1, 38]] as const)('P5 %s uses bid hysteresis in every ACoS gate', (id, orders, spend) => { const c = fixture(); const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map((f, i) => ({ ...f, entityRef: 't', clicks: i === 0 ? 20 : 0, orders: i === 0 ? orders : 0, spendMicros: usd(i === 0 ? String(spend) : '0'), salesMicros: usd(i === 0 ? '100' : '0') })); const evaluate = (on: boolean) => { const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, hysteresis: on } }; return registry.find(r => r.id === id)!.evaluate({ group: 'TARGET', id: 't' }, { ...c, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config), state: { ...c.state, targets: { t: { ...c.state.targets.t!, baseBidMicros: usd('.80') } } } }); }; expect(evaluate(false)).not.toBeNull(); expect(evaluate(true)).toBeNull(); });
it('P5 R04B uses the separately configurable winning budget threshold', () => { const c = fixture(3, 2, 12, .27); expect(run('R04B', c)).not.toBeNull(); expect(run('R04B', flags(c, { hysteresis: true }))).toBeNull(); });
it('report renders named v3.2 experiments with deltas and paired rates', async () => { const { renderReport } = await import('../src/report/render.js'); const result = renderReport({ edges: [], monteCarlo: [], v32: { experiments: [{ name: 'example', summary: { metrics: { profit: { p50: 10, mean: 12 } }, variants: [{ name: 'P5', summary: { metrics: { profit: { p50: 11, mean: 13 } } }, diff: { profit: { p50: 1, mean: 1 } }, paired: { profit: { betterRate: .6 } } }] } }], edges: [] } }); expect(result.html).toContain('Thử nghiệm v3.2'); expect(result.html).toContain('P5'); expect(result.html).toContain('0.6'); expect(result.markdown).toContain('Delta p50'); });
it('all flags off reproduce v3.1 state, audit, decisions and API hashes', async () => {
    const { readFile } = await import('node:fs/promises');
    const { runAccountLoop } = await import('../src/runner/accountLoop.js');
    const { validateScenario } = await import('../src/scenario/schema.js');
    const scenario = validateScenario(JSON.parse(await readFile('scenarios/full-account.json', 'utf8')));
    scenario.days = 10;
    const expected = JSON.parse(await readFile('test/fixtures/v31-full-10-hashes.json', 'utf8')) as Record<string, string>;
    const r = await runAccountLoop({ scenario });
    for (const [field, hash] of Object.entries(expected))
        expect(createHash('sha256').update(JSON.stringify(r[field as keyof typeof r])).digest('hex'), field).toBe(hash);
});
it('P1 preserves the entire R13 interval since R12, beyond 30 days', () => { const c = fixture(); const fs: MetricFact[] = Array.from({ length: 47 }, (_, i) => ({ ...c.metrics.facts('c', '2026-10-04', '2026-10-04')[0]!, entityRef: 't', marketplaceDate: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), orders: i === 4 ? 1 : 0, clicks: 10, spendMicros: usd('2') })); const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, zeroOrderLagDays: 4 } }; const context = { ...c, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config), state: { ...c.state, targets: { t: { ...c.state.targets.t!, createdAt: '2026-09-01T07:00Z', baseBidMicros: usd('.80'), r12Count: 1, r12LastAt: '2026-09-01T07:00Z' } } } }; expect(registry.find(r => r.id === 'R13')!.evaluate({ id: 't', group: 'TARGET' }, context)).toBeNull(); });
it('P6 audit exposes clean day count and excludes every bucket on a capped date/hour', () => { const c = fixture(); const f = c.metrics.facts('c', '2026-10-04', '2026-10-04')[0]!; const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, hourlyExcludeCapped: true } }; const fs = [{ ...f, hour: 0 as const, hourBucket: '2026-10-04T07:00Z', clicks: 100, orders: 0, budgetCapped: true }, { ...f, hour: 1 as const, hourBucket: '2026-10-04T08:00Z', clicks: 100, orders: 50 }]; const records: Record<string, unknown>[] = []; analyzeHours({ ...c, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config) }, undefined, r => records.push({ ...r })); expect(records[0]?.cleanDays).toBe(0); expect(records[0]?.clicks).toBe(0); expect(records[1]?.cleanDays).toBe(1); });
it('population preflight aborts before comparing when baseline lacks premature signal', async () => { const { runMonteCarlo } = await import('../src/montecarlo/index.js'); const { readFile } = await import('node:fs/promises'); const { validateScenario } = await import('../src/scenario/schema.js'); const scenario = validateScenario(JSON.parse(await readFile('scenarios/edge/premature-positive.json', 'utf8'))); scenario.days = 3; await expect(runMonteCarlo({ scenario, config: DEFAULT_CONFIG, seeds: 1, workers: 1, minPrematureSeedRate: .1, variants: [{ name: 'K3', overrides: ['v32.zeroOrderLagDays=3'] }] })).rejects.toThrow('INSUFFICIENT_PREMATURE_SIGNAL'); });
it('P4 starts grace only at successful verified negative, and leaves R05 enabled', async () => { const { verifyHarvests } = await import('../src/runner/harvest.js'); const { InMemoryFakePort } = await import('../src/api/port.js'); const c = fixture(3, 0, 5); class Port extends InMemoryFakePort {
    override async listKeywords() { return [{ ...c.state.targetEntities.t!, matchType: 'EXACT' as const }]; }
} const pending = { ...c.state, pendingHarvests: [{ query: 'k', sourceCampaignId: 'c', sourceTargetId: 't', destCampaignId: 'c', keywordId: 't', createdAt: c.clock.now() }] }; const on = flags(c, { postHarvestGraceDays: 7 }); const state = await verifyHarvests(pending, new Port(), c.clock.now(), () => { }, on.config); expect(state.negatives?.c?.[0]?.harvestedAt).toBe(c.clock.now()); expect(run('R06', { ...on, state })).toBeNull(); expect(run('R05', { ...on, state, decisions: [] })).not.toBeNull(); const off = await verifyHarvests(pending, new Port(), c.clock.now(), () => { }, c.config); expect(off.negatives?.c?.[0]?.harvestedAt).toBeUndefined(); });
it('P1 keeps original spend thresholds even when the older zero-order window spends less', () => { let c = fixture(0, 0, 0, .2, 16); const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map(f => ({ ...f, spendMicros: usd(f.marketplaceDate === '2026-10-17' ? '25' : '0'), clicks: 10 })); c = { ...c, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), c.config) }; expect(run('R06', flags(c, { zeroOrderLagDays: 4 }))).not.toBeNull(); });
it('P1 moves robust zero-day check independently of the reset window', () => { let c = fixture(0, 0, 20); c = { ...c, state: { ...c.state, campaignMemory: { c: { ...c.state.campaignMemory.c!, windowStartAt: '2026-10-15T07:00Z' } } } }; const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map(f => ({ ...f, orders: f.marketplaceDate === '2026-10-14' ? 1 : 0 })); c = { ...c, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), c.config) }; expect(run('R06', c)).not.toBeNull(); expect(run('R06', flags(c, { zeroOrderLagDays: 4 }))).toBeNull(); });
it('P3 verdict requires actual ALERT events in all three phases', async () => { const { synchronizedAlerts } = await import('../src/edge/suite.js'); expect(synchronizedAlerts([[], [], []])).toBe(false); expect(synchronizedAlerts([[{ ruleId: 'R08', day: 18 }], [{ ruleId: 'R08', day: 18 }], []])).toBe(false); expect(synchronizedAlerts(Array.from({ length: 3 }, () => [{ ruleId: 'R08', day: 18 }]))).toBe(true); });
it.each([true, false])('P5 R10 applies hysteresis independently to W14 and W_post (%s)', postFails => { const c = fixture(); const fs = c.metrics.facts('c', '2026-10-01', '2026-10-17').map(f => { const post = f.marketplaceDate >= '2026-10-15'; return { ...f, entityRef: 't', clicks: 5, orders: 1, spendMicros: usd(post ? (postFails ? '9' : '3') : (postFails ? '1' : '14.6')), salesMicros: usd(post ? (postFails ? '33.333333' : '30') : '50') }; }); const state = { ...c.state, targets: { t: { ...c.state.targets.t!, baseBidMicros: usd('.80'), windowStartAt: '2026-10-15T07:00Z' } } }; const evaluate = (on: boolean) => { const config = { ...c.config, v32: { ...DEFAULT_CONFIG.v32, hysteresis: on } }; return registry.find(r => r.id === 'R10')!.evaluate({ group: 'TARGET', id: 't' }, { ...c, state, config, metrics: new MetricsReader(new FactIndex(fs), c.clock.now(), config) }); }; expect(evaluate(false)).not.toBeNull(); expect(evaluate(true)).toBeNull(); });
it.each(['verify', 'negative'] as const)('P4 failed %s creates no grace', async (phase) => { const { verifyHarvests } = await import('../src/runner/harvest.js'); const { InMemoryFakePort } = await import('../src/api/port.js'); const c = flags(fixture(0, 0, 5), { postHarvestGraceDays: 7 }); class Port extends InMemoryFakePort {
    override async listKeywords() { return phase === 'verify' ? [] : [{ ...c.state.targetEntities.t!, matchType: 'EXACT' as const }]; }
    override async createNegatives(): Promise<never> { throw new Error('503 SERVICE_UNAVAILABLE'); }
} const state = await verifyHarvests({ ...c.state, pendingHarvests: [{ query: 'k', sourceCampaignId: 'c', sourceTargetId: 't', destCampaignId: 'c', keywordId: 't', createdAt: c.clock.now() }] }, new Port(), c.clock.now(), () => { }, c.config); expect(state.negatives?.c ?? []).toHaveLength(0); expect(run('R06', { ...c, state })).not.toBeNull(); });
it('paired rates align by seed and rank profit upward, other metrics downward', async () => {
 const {pairedRates}=await import('../src/montecarlo/index.js');
 const baseline=[{seed:0,metrics:{profit:1,wastedSpend:10,prematureTotal:2,flipFlops:{bid:4,budget:0}}},{seed:1,metrics:{profit:100,wastedSpend:100,prematureTotal:100,flipFlops:{bid:50,budget:50}}},{seed:2,metrics:{profit:1000,wastedSpend:1000,prematureTotal:1000,flipFlops:{bid:500,budget:500}}}];
 const variant=[baseline[2]!,{seed:0,metrics:{profit:2,wastedSpend:9,prematureTotal:1,flipFlops:{bid:0,budget:3}}},{seed:1,metrics:{profit:99,wastedSpend:101,prematureTotal:101,flipFlops:{bid:101,budget:0}}}];
 const rates=pairedRates(baseline,variant);expect(Object.keys(rates).sort()).toEqual(['flipFlops','premature','profit','wastedSpend']);
 for(const rate of Object.values(rates))expect(rate).toEqual({better:1,tied:1,worse:1,count:3,betterRate:1/3});
});
