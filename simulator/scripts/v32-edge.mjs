import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../dist/config/defaults.js';
import { applyOverrides } from '../dist/src/montecarlo/index.js';
import { runAccountLoop } from '../dist/src/runner/accountLoop.js';
import { runCampaignLoop } from '../dist/src/runner/campaignLoop.js';
import { ScriptedMarket } from '../dist/src/market/scripted.js';
import { evaluateAccountEdges, measureZeroOrderWindow } from '../dist/src/edge/suite.js';
import { measureHourlySignal } from '../dist/src/edge/controls.js';
import { measureRun } from '../dist/src/montecarlo/metrics.js';
import { queryFacts } from '../dist/src/data/facts.js';
import { date, calendarDaysBetween, toMarketplaceDate } from '../dist/src/time/clock.js';
const load = async (name) => JSON.parse(await readFile(`scenarios/${name}.json`, 'utf8'));
const root=process.env.V32_OUT??'out/v32';
await mkdir(`${root}/edge`, { recursive: true });
const started = performance.now();
const write = async (name, value) => writeFile(`${root}/edge/${name}.json`, JSON.stringify(value, null, 2) + '\n');
for (const [proposal, overrides] of [['P2', ['v32.r06CalendarGuard=true']], ['P3', ['v32.r08Daily=true']]]) {
    const phases = [];
    for (let phase = 0; phase < 3; phase++) {
        const variants = [];
        for (const on of [false, true]) {
            const config = { ...applyOverrides(DEFAULT_CONFIG, on ? overrides : []), every3DaysAnchorMode: 'global', every3DaysAnchor: `2026-10-0${phase + 1}` };
            const scenario = await load('golden-winner');
            const r = await runCampaignLoop({ scriptedMarket: new ScriptedMarket(scenario, ({ day, campaign }) => day < 14 ? { clicks: 10, spendUsd: campaign.budget, orders: 2, salesUsd: campaign.budget / .2 } : { clicks: 5, spendUsd: 5, orders: 0, salesUsd: 0 }), days: 40, config });
            variants.push({ on, zeroOrderCalendarSpend: queryFacts(r.facts, { asOf: date(scenario.startDate).plus({ days: 55 }).toUTC().toISO(), entityRef: scenario.campaigns[0].id, from: '2026-10-15', to: r.timeline.find(t => t.ruleId === 'R06')?.date ?? '2026-11-09', dailyOnly: true }).reduce((n, f) => n + f.spendMicros / 1e6, 0), r06: r.decisions.filter(d => d.ruleId === 'R06').map(d => measureZeroOrderWindow(scenario, d, r.facts, config)), events: r.timeline.filter(t => ['R05', 'R08', 'R06'].includes(t.ruleId)), metrics: measureRun({ ...scenario, days: 40 }, config, { ...r, matureFacts: r.facts }).metrics });
        }
        phases.push({ phase, variants });
    }
    await write(proposal === 'P2' ? 'B2' : 'B1', { proposal, phases });
}
for (const [name, proposal, overrides] of [['full-account', 'P4', ['v32.postHarvestGraceDays=7']], ['full-account', 'P6', ['v32.hourlyExcludeCapped=true']], ['edge/hourly-signal', 'P6', ['v32.hourlyExcludeCapped=true']]]) {
    const variants = [];
    for (const on of [false, true]) {
        const scenario = await load(name), config = applyOverrides(DEFAULT_CONFIG, on ? overrides : []), r = await runAccountLoop({ scenario, config });
        const edges = evaluateAccountEdges(r, scenario).filter(e => ['E6', 'A5'].includes(e.id));
        const negatives = Object.values(r.state.negatives ?? {}).flat().filter(n => n.harvestKeywordId);
        const sourceR06 = r.timeline.filter(t => t.ruleId === 'R06' && scenario.campaigns.find(c => c.id === t.campaignId)?.type === 'AUTO');
        variants.push({ on, edges, negatives, sourceR06, blockedByHarvest: r.audit.filter(a => a.outcome === 'BLOCKED_BY_HARVEST_GRACE').map(a => ({ at: a.at, id: a.objectRef.id })),
            metrics: measureRun(scenario, config, r).metrics, hourly: name.includes('hourly-signal') ? measureHourlySignal(scenario, r) : undefined,
            learnedWithInsufficientDays: r.hourlyAnalyses.filter(a => a.after !== 1 && a.cleanDays !== undefined && a.cleanDays < 20).length, learnedFromCapped: r.hourlyAnalyses.filter(a => a.after !== 1 && a.budgetCapped).length,
            factors: r.hourlyAnalyses.filter(a => a.after !== 1).map(a => ({ at: a.at, id: a.targetId, hour: a.hour, after: a.after, budgetCapped: a.budgetCapped, cleanDays: a.cleanDays })),
            graceViolations: on && proposal === 'P4' ? sourceR06.filter(t => negatives.some(n => n.campaignId === t.campaignId && n.harvestedAt && calendarDaysBetween(toMarketplaceDate(n.harvestedAt), t.date) >= 0 && calendarDaysBetween(toMarketplaceDate(n.harvestedAt), t.date) < 7)).length : 0 });
    }
    await write(name.includes('hourly-signal') ? 'hourly-signal' : proposal === 'P4' ? 'E6' : 'A5', { proposal, variants });
}
for (const [name, proposal, variantsToRun] of [['edge/premature-positive', 'P1', [[2, []], [3, ['v32.zeroOrderLagDays=3']], [5, ['v32.zeroOrderLagDays=5']], [8, ['v32.zeroOrderLagDays=8']]]], ['marginal-account', 'P5', [[false, []], [true, ['v32.hysteresis=true']]]]]) {
    const variants = [];
    for (const [value, overrides] of variantsToRun) {
        const scenario = await load(name), config = applyOverrides(DEFAULT_CONFIG, overrides), r = await runAccountLoop({ scenario, config });
        variants.push({ value, metrics: measureRun(scenario, config, r).metrics, events: r.timeline.filter(t => ['R06', 'R12', 'R13', 'R08'].includes(t.ruleId)).map(t => ({ day: t.day, ruleId: t.ruleId, campaignId: t.campaignId })) });
    }
    await write(proposal === 'P1' ? 'P1-positive' : 'P5-marginal', { proposal, variants });
}
await write('duration', { durationMs: performance.now() - started, runs: 24 });
console.log('v3.2 edges complete');
