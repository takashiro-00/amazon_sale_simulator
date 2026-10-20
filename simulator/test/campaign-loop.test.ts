import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario/schema.js';
import { ScriptedMarket } from '../src/market/scripted.js';
import { runCampaignLoop } from '../src/runner/campaignLoop.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
const scenario = validateScenario(JSON.parse(readFileSync(new URL('../scenarios/golden-winner.json', import.meta.url), 'utf8')));
const winner = (day: number, budget: number) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / .2 });
const compact = (r: Awaited<ReturnType<typeof runCampaignLoop>>) => r.timeline.map(t => [t.day, t.ruleId, t.after.budget, t.after.tag]);
export async function scripted(fn: (day: number, budget: number) => {
    clicks: number;
    spendUsd: number;
    orders: number;
    salesUsd: number;
}, days = 40, config = DEFAULT_CONFIG) { return runCampaignLoop({ scriptedMarket: new ScriptedMarket(scenario, ({ day, campaign }) => fn(day, campaign.budget)), days, config }); }
it('B1 exact winning lifecycle', async () => { const r = await scripted(winner); expect(compact(r)).toEqual([[0, 'R01', 5, 'NORMAL'], [4, 'R02', 8, 'NORMAL'], [8, 'R03', 10, 'NORMAL'], [12, 'R04', 12, 'NORMAL'], [20, 'R04B', 14.4, 'NORMAL'], [28, 'R04B', 17.28, 'NORMAL'], [36, 'R04B', 20.74, 'NORMAL']]); });
it('B2 zero orders pauses on day 6 and remains paused', async () => {
    // At day 5 Wpost ends day 3: $20, below $21. Day 6 includes days 0..4: $25 and 25 clicks.
    const r = await scripted(() => ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 }));
    expect(compact(r)).toEqual([[0, 'R01', 5, 'NORMAL'], [6, 'R06', 5, 'PAUSED_AUTO']]);
    expect(r.notifications.map(n => n.type)).toEqual(['R06_PAUSED']);
    expect(r.state.campaigns.c1?.status).toBe('PAUSED');
});
it('B3 deteriorates then recovers and restores bids', async () => { const r = await scripted((day, budget) => day < 13 ? winner(day, budget) : ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / (day < 24 ? .4 : .18) }), 55); expect(r.timeline.filter(t => ['R07', 'R09'].includes(t.ruleId)).map(t => [t.day, t.ruleId, t.after.budget, t.after.tag, t.after.factors.t1])).toMatchSnapshot(); expect(r.decisions.some(d => d.ruleId === 'R05')).toBe(false); expect(r.state.targets.t1?.tagReductionFactor).toBe(1); });
it('B4 ALERT then permanent pause', async () => { const r = await scripted((day, budget) => day < 14 ? winner(day, budget) : ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 })); expect(compact(r)).toMatchSnapshot(); expect(r.notifications.map(n => n.type)).toEqual(['R08_ALERT', 'R06_PAUSED']); });
it('B4 recovery removes ALERT', async () => { const r = await scripted((day, budget) => day < 14 || day >= 18 ? winner(day, budget) : ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 })); expect(compact(r)).toMatchSnapshot(); expect(r.timeline.some(t => t.ruleId === 'R09' && t.before.tag === 'ALERT' && t.after.budget === 12)).toBe(true); });
it.each([false, true])('B5 R06B recovery=%s', async (recovery) => { const r = await scripted((day, budget) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / (recovery && day >= 7 ? .3 : .7) })); expect(compact(r)).toMatchSnapshot(); expect(r.decisions.some(d => d.ruleId === 'R06B')).toBe(true); expect(r.notifications.some(n => n.type === 'R06B_PAUSED')).toBe(!recovery); });
it('edge B1 records schedule phases without assuming equal outcomes', async () => { const rows = []; for (let phase = 0; phase < 3; phase++) {
    const config = { ...DEFAULT_CONFIG, every3DaysAnchorMode: 'global' as const, every3DaysAnchor: `2026-10-0${phase + 1}` };
    const r = await scripted((day, budget) => day < 14 ? winner(day, budget) : ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 }), 40, config);
    rows.push({ phase, events: compact(r).filter(t => ['R05', 'R08', 'R06'].includes(String(t[1]))) });
} expect(rows).toMatchSnapshot(); });
it('D stochastic golden-winner smoke, no changes to scenario', async () => { const r = await runCampaignLoop({ scenario, days: 40, config: DEFAULT_CONFIG }); expect(r.timeline.filter(t => t.after.budget >= 12 && t.day < 25).length, JSON.stringify(compact(r))).toBeGreaterThan(0); expect(r.timeline.every(t => t.after.status !== 'PAUSED'), JSON.stringify(compact(r))).toBe(true); });
it('manual enable is the only route out of PAUSED_AUTO and invokes R01', async () => {
    const edited = structuredClone(scenario);
    edited.events.push({ type: 'manualEdit', at: '2026-10-12T06:59:00Z', entityId: 'c1', field: 'status', value: 'ENABLED' });
    const r = await runCampaignLoop({ scriptedMarket: new ScriptedMarket(edited, () => ({ clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 })), days: 15 });
    expect(r.timeline.filter(t => t.ruleId === 'R01').map(t => t.day)).toEqual([0, 11]);
    expect(r.state.campaignMemory.c1?.tag).toBe('NORMAL');
    expect(r.state.campaigns.c1?.status).toBe('ENABLED');
});
it('daily run occurs once on a 25-hour fallback date when runHour=1',async()=>{
 const r=await runCampaignLoop({scriptedMarket:new ScriptedMarket(scenario,({day,campaign})=>winner(day,campaign.budget)),days:40,runHour:1});
 expect(new Set(r.audit.filter(e=>e.marketplaceDate==='2026-11-01').map(e=>e.runId)).size).toBe(1);
});

it('R06B rearms after recovery and pauses a second sustained deterioration over 80 days', async () => {
    const r = await scripted((day, budget) => ({ clicks: 10, spendUsd: budget, orders: 2, salesUsd: budget / (day <= 6 || day >= 41 ? .7 : .2) }), 80);
    expect(r.timeline.filter(t => t.ruleId === 'R06B').map(t => [t.day, t.after.tag, t.after.budget])).toEqual([
        [6, 'MANAGE', 5], [14, 'MANAGE', 5], [56, 'MANAGE', 5], [64, 'PAUSED_AUTO', 5],
    ]);
    const recovery = r.decisions.find(d => d.ruleId === 'R09' && d.after.campaignMemory.c1?.tag === 'NORMAL')!;
    expect(recovery.after.campaignMemory.c1).toMatchObject({ r06bPhase: 'NONE', r06bStep1At: null });
    const step1 = r.timeline.find(t => t.ruleId === 'R06B' && t.day > 41)!;
    // G6 retains the existing anchor floor ($1.05 × .8 = $.84), above the $.83 cent-rounded proposal.
    const secondStep1 = r.decisions.filter(d => d.ruleId === 'R06B')[2]!;
    expect([secondStep1.before.targets.t1?.baseBidMicros, secondStep1.after.targets.t1?.baseBidMicros]).toEqual([1_040_000, 840_000]);
    expect(step1.after.factors.t1).toBeCloseTo(.84 / 1.04);
    expect(step1.after.factors.t1).toBeGreaterThanOrEqual(.7);
    expect(r.timeline.filter(t => t.ruleId === 'R09').map(t => t.day)).toEqual([15, 18, 21, 24]);
    expect(r.state.campaigns.c1?.status).toBe('PAUSED');
    expect(r.notifications.filter(n => n.type === 'R06B_PAUSED').map(n => n.at)).toEqual(['2026-12-04T08:00:00.000Z']);
});
