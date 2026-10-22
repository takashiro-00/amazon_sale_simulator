import { it, expect } from 'vitest';
import { DEFAULT_CONFIG as config } from '../config/defaults.js';
import { FactIndex, type MetricFact } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { resolveWindow } from '../src/data/windows.js';
import { usd } from '../src/domain/money.js';
import { createCampaignMemory, createTargetMemory } from '../src/domain/state.js';
import { deriveThresholds } from '../src/domain/params.js';
import { SimClock, dMinus } from '../src/time/clock.js';
import { AuditLog } from '../src/audit/log.js';
import { firstMatchWins } from '../src/engine/priority.js';
import type { RuleContext, RuleId } from '../src/engine/types.js';
import { registry } from '../src/rules/registry.js';
import { trackR09 } from '../src/rules/campaign/r09Tracker.js';
const start = '2026-10-01T07:00:00.000Z', now = '2026-10-19T07:00:00.000Z';
export function fixture(tier = 0, orders = 1, spend = 5, ratio = .2, days = 14): RuleContext {
    const today = '2026-10-19';
    const facts: MetricFact[] = Array.from({ length: days }, (_, i) => ({ entityRef: 'c', marketplaceDate: dMinus(today, i + 2), impressions: 100, clicks: 5, spendMicros: usd(String(spend)), orders, salesMicros: usd(String(orders ? spend / ratio : 0)), knownAt: now }));
    const T = deriveThresholds({ asin: 'A', priceMicros: usd('30'), breakEvenAcos: .4 }, config).thresholds;
    return { runId: 'test', clock: new SimClock(now), config, today, metrics: new MetricsReader(new FactIndex(facts), now, config), thresholds: { t: T }, thresholdsByCampaign: { c: T }, notify: () => { }, paramsVersion: T.paramsVersion, audit: new AuditLog(), decisions: [], state: { campaigns: { c: { id: 'c', asin: 'A', type: 'MANUAL', targetingKind: 'KEYWORD', status: 'ENABLED', dailyBudgetMicros: config.budgetLadder[tier]!, name: 'Campaign', topOfSearchPct: 0 } }, campaignMemory: { c: { ...createCampaignMemory(start), budgetTierIndex: tier, budgetByDate: Object.fromEntries(facts.map(f => [f.marketplaceDate, config.budgetLadder[tier]!])) } }, targets: { t: createTargetMemory(usd('1'), start, config) }, targetEntities: { t: { id: 't', campaignId: 'c', adGroupId: 'g', kind: 'KEYWORD', text: 'k', status: 'ENABLED', bidMicros: usd('1') } } } };
}
export function run(id: RuleId, ctx: RuleContext) { return firstMatchWins({ group: 'CAMPAIGN', id: 'c' }, [registry.find(r => r.id === id)!], ctx); }
export function memory(ctx: RuleContext, patch: Partial<typeof ctx.state.campaignMemory[string]>): RuleContext { return { ...ctx, state: { ...ctx.state, campaignMemory: { c: { ...ctx.state.campaignMemory.c!, ...patch } } } }; }
it.each([['R02', 0, 1, 5, .2, 1], ['R03', 1, 1, 5, .2, 2], ['R04', 2, 1, 5, .2, 3], ['R04B', 3, 1, 12, .2, 4], ['R05', 3, 1, 5, .5, 2], ['R06', 0, 0, 5, 0, 0], ['R06B', 3, 1, 5, .7, 0], ['R07', 3, 1, 5, .41, 1]] as const)('%s matches without mutating input', (id, tier, orders, spend, ratio, next) => { const ctx = fixture(tier, orders, spend, ratio); const before = structuredClone(ctx.state); expect(run(id, ctx)?.after.campaignMemory.c?.budgetTierIndex).toBe(next); expect(ctx.state).toEqual(before); });
it.each(['R02', 'R03', 'R04', 'R04B', 'R05', 'R06', 'R06B', 'R07', 'R08', 'R09'] as const)('%s grace gate', id => { const ctx = memory(fixture(), { graceUntil: '2026-10-20T07:00Z' }); expect(run(id, ctx)).toBeNull(); expect(ctx.audit.events.at(-1)?.outcome).toBe('BLOCKED_BY_GRACE'); });
it.each(['R02', 'R03', 'R04', 'R04B'] as const)('%s tag gate', id => { const ctx = memory(fixture(), { tag: 'MANAGE', preTagTierIndex: 3 }); expect(run(id, ctx)).toBeNull(); expect(ctx.audit.events.at(-1)?.outcome).toBe('BLOCKED_BY_TAG'); });
it.each(['R07', 'R08', 'R09'] as const)('%s schedule gate', id => { const ctx = { ...fixture(), today: '2026-10-20', clock: new SimClock('2026-10-20T07:00Z') }; expect(run(id, ctx)).toBeNull(); expect(ctx.audit.events.at(-1)?.outcome).toBe('NOT_SCHEDULED'); });
it.each(['R02', 'R03', 'R04', 'R04B', 'R05'] as const)('%s cooldown gate', id => { const ctx = memory(fixture(), { cooldownUntil: { budget: '2026-10-20', placement: null } }); expect(run(id, ctx)).toBeNull(); expect(ctx.audit.events.at(-1)?.outcome).toBe('BLOCKED_BY_COOLDOWN'); });
it('threshold boundaries and no-ops', () => {
    expect(run('R04B', fixture(8, 1, 25))).toBeNull();
    expect(run('R05', fixture(0, 1, 5, .7))).toBeNull();
    expect(run('R02', fixture(0, 1, 9, .36))).toBeNull();
    expect(run('R03', fixture(1, 0))).toBeNull();
    expect(run('R04', fixture(2, 1, 5, .2, 2))).toBeNull();
    expect(run('R04B', fixture(3, 1, 10.79))).toBeNull();
    expect(run('R05', fixture(3, 1, 5, .439))).toBeNull();
    expect(run('R06', fixture(0, 0, 1, 0, 4))).toBeNull();
    expect(run('R06B', fixture(3, 1, 6, .60))).toBeNull();
    expect(run('R07', fixture(3, 1, 5, .396))).toBeNull();
    expect(run('R08', fixture(3, 0, 4.19, 0))).toBeNull();
});
it('zero orders cannot be inferred from missing dates', () => { for (const id of ['R05', 'R06', 'R08'] as const)
    expect(run(id, fixture(3, 0, 30, 0, 1))).toBeNull(); });
it('R06B memory-only completion and R09 resolve STEP1_WAITING', () => { const ctx = memory(fixture(0, 1, 5, .3), { tag: 'MANAGE', preTagTierIndex: 3, taggedAt: start, r06bPhase: 'STEP1_WAITING', r06bStep1At: start, r09ConsecutivePasses: 2, baselineAcos: { kind: 'value', v: .3 } }); expect(run('R06B', ctx)?.after.campaignMemory.c?.r06bPhase).toBe('DONE'); expect(run('R09', { ...ctx, decisions: [] })?.after.campaignMemory.c).toMatchObject({ tag: 'NORMAL', r06bPhase: 'NONE', r06bStep1At: null, budgetTierIndex: 3 }); });
it('R09 tracker checks once without consuming G5', () => { const ctx = memory(fixture(), { tag: 'MANAGE', preTagTierIndex: 3, taggedAt: start }); const state = trackR09('c', ctx); expect(state.campaignMemory.c?.r09ConsecutivePasses).toBe(1); expect(trackR09('c', { ...ctx, state })).toEqual(state); expect(ctx.decisions).toHaveLength(0); });
it('R01 needs user reenabling, starts grace and resets window', () => { let ctx = memory(fixture(), { tag: 'PAUSED_AUTO', requiresUserConfirmToEnable: true }); expect(run('R01', ctx)).toBeNull(); ctx = { ...ctx, manualReenabledCampaignIds: ['c'] }; expect(run('R01', ctx)?.after.campaignMemory.c).toMatchObject({ tag: 'NORMAL', windowStartAt: now, graceUntil: '2026-10-22T07:00:00.000Z' }); });
it('MetricsReader excludes future versions and granular facts', () => { const ctx = fixture(), facts = ctx.metrics.facts('c', '2026-10-01', '2026-10-17'), f = facts[0]!; const metrics = new MetricsReader(new FactIndex([...facts, { ...f, orders: 99, knownAt: '2026-10-20T07:00Z' }, { ...f, placement: 'TOP', orders: 50 }]), now, config); expect(metrics.campaignWindow('c', resolveWindow({ kind: 'rolling', days: 3 }, ctx.today, ctx.state.campaignMemory.c!, config)).orders).toBe(3); expect(resolveWindow({ kind: 'post', days: 14, minRipeDays: 1 }, '2026-10-03', { windowStartAt: start }, config).eligible).toBe(true); });
it.each([false, true])('B6 R07 -> R06B -> R09 keeps/overwrites saved tier (%s)', overwrite => {
    const ctx = fixture(4, 1, 5, .41), managed = run('R07', ctx)!.after;
    const bad = fixture(1, 1, 5, .7);
    const step1 = run('R06B', { ...bad, config: { ...config, ambiguity: { ...config.ambiguity, r06bOverwritesPreTagTier: overwrite } }, state: { ...managed, campaignMemory: { c: { ...managed.campaignMemory.c!, windowStartAt: start, cooldownUntil: { budget: null, placement: null } } } } })!.after;
    expect(step1.campaignMemory.c?.preTagTierIndex).toBe(overwrite ? 1 : 4);
    expect(step1.targets.t?.tagReductionFactor).toBeCloseTo(.72);
    const recovery = fixture(0, 1, 5, .2);
    const d = run('R09', { ...recovery, state: { ...step1, campaignMemory: { c: { ...step1.campaignMemory.c!, windowStartAt: start, taggedAt: start, r09ConsecutivePasses: 2 } } } })!;
    expect(d.after.campaigns.c?.dailyBudgetMicros).toBe(config.budgetLadder[overwrite ? 1 : 4]);
    expect(d.after.campaignMemory.c?.r06bPhase).toBe('NONE');
});
it('R08 matches with historical orders outside reset window and preserves MANAGE metadata', () => {
    let ctx = fixture(1, 0, 5, 0);
    const f: MetricFact = { entityRef: 'c', marketplaceDate: '2026-10-01', impressions: 100, clicks: 10, spendMicros: usd('5'), orders: 1, salesMicros: usd('30'), knownAt: now };
    ctx = memory({ ...ctx, metrics: new MetricsReader(new FactIndex([...ctx.metrics.facts('c', '2026-10-01', '2026-10-17'), f]), now, config) }, { tag: 'MANAGE', preTagTierIndex: 4, taggedAt: start });
    const d = run('R08', ctx)!;
    expect(d.after.campaignMemory.c).toMatchObject({ tag: 'ALERT', preTagTierIndex: 4, taggedAt: start });
    expect(d.after.targets).toEqual(ctx.state.targets);
});
it('R09 restores tag portion without undoing unrelated bid reductions', () => {
    let ctx = memory(fixture(), { bidRestorePending: true });
    ctx = { ...ctx, state: { ...ctx.state, targets: { t: { ...ctx.state.targets.t!, baseBidMicros: usd('.72'), tagReductionFactor: .9 } } } };
    const d = run('R09', ctx)!;
    expect(d.after.targets.t?.baseBidMicros).toBe(usd('.79'));
    expect(d.after.targets.t?.tagReductionFactor).toBeCloseTo(.99);
    const final = run('R09', { ...ctx, decisions: [], state: d.after })!;
    expect(final.after.targets.t?.tagReductionFactor).toBe(1);
    expect(final.after.campaignMemory.c?.bidRestorePending).toBe(false);
    expect(final.after.targets.t?.baseBidMicros).toBe(usd('.80'));
});
it('R06B caps stacked tag reductions at .70 and leaves paused targets unchanged', () => {
    const ctx = fixture(1, 1, 5, .7), t = ctx.state.targets.t!;
    const next = { ...ctx, state: { ...ctx.state, targets: { t: { ...t, tagReductionFactor: .72 }, u: t }, targetEntities: { ...ctx.state.targetEntities, u: { ...ctx.state.targetEntities.t!, id: 'u', status: 'PAUSED' as const } } } };
    const d = run('R06B', next)!;
    expect(d.after.targets.t?.tagReductionFactor).toBe(.7);
    expect(d.after.targets.u).toEqual(t);
    expect(d.after.targets.t?.baseBidMicros).toBe(usd('.97'));
});
it('state invariants validate new campaign history, timestamp and counters', async () => {
    const { assertStateInvariants } = await import('../src/domain/state.js');
    const ctx = fixture();
    const input = { memory: ctx.state.targets.t!, campaignMemory: ctx.state.campaignMemory.c!, hourNow: 0 as const, bidMicros: usd('1') };
    for (const patch of [{ createdAt: 'invalid' }, { lastR09CheckDate: '2026-02-30' }, { r09ConsecutivePasses: -1 }, { budgetByDate: { '2026-10-01': usd('6') } }, { bidRestorePending: 'yes' }])
        expect(() => assertStateInvariants({ ...input, campaignMemory: { ...input.campaignMemory, ...patch } } as typeof input, config)).toThrow();
});
it('R06 never retains a waiting R06B phase when pausing', () => { const ctx = memory(fixture(0, 0, 5, 0), { tag: 'MANAGE', preTagTierIndex: 3, r06bPhase: 'STEP1_WAITING', r06bStep1At: start }); expect(run('R06', ctx)?.after.campaignMemory.c).toMatchObject({ tag: 'PAUSED_AUTO', r06bPhase: 'DONE', preTagTierIndex: null }); });
it('R06 post window is limited to fourteen dates', () => { const ctx = fixture(0, 0, 1, 0, 30); expect(run('R06', ctx)).toBeNull(); });
it('R04B compares historical daily budgets, not the current budget', () => { const ctx = fixture(3, 1, 10, .2); expect(run('R04B', ctx)).toBeNull(); const history = Object.fromEntries(Object.keys(ctx.state.campaignMemory.c!.budgetByDate).map(d => [d, usd('10')])); expect(run('R04B', memory(ctx, { budgetByDate: history }))?.after.campaigns.c?.dailyBudgetMicros).toBe(usd('14.40')); });
it('R09 keep-current option and failed tracker check', () => {
    const ctx = memory(fixture(1, 1, 5, .2), { tag: 'MANAGE', preTagTierIndex: 3, taggedAt: start, r09ConsecutivePasses: 2 });
    const keep = { ...ctx, config: { ...config, ambiguity: { ...config.ambiguity, r09BudgetRestore: 'keep-current' as const } } };
    expect(run('R09', keep)?.after.campaignMemory.c?.budgetTierIndex).toBe(1);
    const bad = memory(fixture(1, 1, 5, .5), { tag: 'MANAGE', preTagTierIndex: 3, r09ConsecutivePasses: 1 });
    expect(trackR09('c', bad).campaignMemory.c?.r09ConsecutivePasses).toBe(0);
});
it('G6 bid floor does not invent a tag reduction that R09 later restores',()=>{
 const ctx=fixture(3,1,5,.41);const floored={...ctx,state:{...ctx.state,targets:{t:{...ctx.state.targets.t!,baseBidMicros:usd('.20'),anchorBidMicros:usd('.20')}}}};
 const d=run('R07',floored)!;expect(d.after.targets.t?.baseBidMicros).toBe(usd('.20'));expect(d.after.targets.t?.tagReductionFactor).toBe(1);
 const recovery=fixture(1,1,5,.2);const removed=run('R09',{...recovery,state:{...d.after,campaignMemory:{c:{...d.after.campaignMemory.c!,taggedAt:start,windowStartAt:start,r09ConsecutivePasses:2}}}})!;expect(removed.after.campaignMemory.c?.bidRestorePending).toBe(false);
});
it('G6 partial floor reduction tracks only the accepted portion',()=>{
 const ctx=fixture(1,1,5,.7);const nearFloor={...ctx,state:{...ctx.state,targets:{t:{...ctx.state.targets.t!,baseBidMicros:usd('.22'),anchorBidMicros:usd('.22')}}}};
 const d=run('R06B',nearFloor)!;expect(d.after.targets.t?.baseBidMicros).toBe(usd('.20'));expect(d.after.targets.t?.tagReductionFactor).toBeCloseTo(.20/.22);
});
it('R09 clears the last nominal factor when cent rounding needs no bid write',()=>{
 const ctx=memory(fixture(),{bidRestorePending:true});const next={...ctx,state:{...ctx.state,targets:{t:{...ctx.state.targets.t!,baseBidMicros:usd('.20'),anchorBidMicros:usd('.20'),tagReductionFactor:.99}}}};
 const d=run('R09',next)!;expect(d.after.targets.t?.baseBidMicros).toBe(usd('.20'));expect(d.after.targets.t?.tagReductionFactor).toBe(1);expect(d.after.campaignMemory.c?.bidRestorePending).toBe(false);expect(d.baseBidTargetIds).toEqual([]);
});
it('R09 cannot mark a capped restoration as completed',()=>{
 const ctx=memory(fixture(),{bidRestorePending:true});const next={...ctx,state:{...ctx.state,targets:{t:{...ctx.state.targets.t!,baseBidMicros:usd('1.08'),anchorBidMicros:usd('1.08'),tagReductionFactor:.9}}}};
 expect(run('R09',next)).toBeNull();expect(next.state.campaignMemory.c?.bidRestorePending).toBe(true);
});

it.each(['STEP1_WAITING', 'DONE'] as const)('campaign invariant rejects NORMAL with R06B phase %s', async phase => {
    const { assertCampaignInvariants } = await import('../src/invariants/campaign.js');
    const ctx = memory(fixture(), { r06bPhase: phase });
    expect(() => assertCampaignInvariants(ctx.state, 'c', config)).toThrow('INVALID_R06B_PHASE');
});

it.each(['MANAGE', 'ALERT'] as const)('R09 rearms %s after completed R06B in the same decision', tag => {
    const ctx = memory(fixture(0, 2, 5, .2), { tag, preTagTierIndex: 3, taggedAt: start, r06bPhase: 'DONE', r06bStep1At: start, r09ConsecutivePasses: 2 });
    expect(run('R09', ctx)?.after.campaignMemory.c).toMatchObject({ tag: 'NORMAL', r06bPhase: 'NONE', r06bStep1At: null });
});
