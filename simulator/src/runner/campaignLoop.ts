import type { Hour } from "../domain/entities.js";
import type { Scenario } from '../scenario/schema.js';
import { DEFAULT_CONFIG, type SimConfig } from '../../config/defaults.js';
import { MarketDriver, type EntityView, applyManualEdits } from '../market/driver.js';
import { ScriptedMarket } from '../market/scripted.js';
import { date, calendarDaysBetween, SimClock } from '../time/clock.js';
import { MemoryFactSink } from '../market/reporting.js';
import { FactIndex, type MetricFact } from '../data/facts.js';
import { MetricsReader } from '../data/metrics.js';
import { createTargetMemory, submittedBid } from '../domain/state.js';
import { micros } from '../domain/money.js';
import { deriveThresholds, type DerivedThresholds } from '../domain/params.js';
import { productAt } from '../market/events.js';
import { AuditLog } from '../audit/log.js';
import type { EngineState, RuleContext, Decision, NotificationLog } from '../engine/types.js';
import { firstMatchWins, CAMPAIGN, stateEqual } from '../engine/priority.js';
import { registry } from '../rules/registry.js';
import { trackR09 } from '../rules/campaign/r09Tracker.js';
import { assertCampaignInvariants } from '../invariants/campaign.js';
import { FaultyFakePort } from '../api/faultyPort.js';
import { InMemoryFakePort, idempotencyKey } from '../api/port.js';
export interface TimelineView {
    budget: number;
    tag: string;
    status: string;
    factors: Record<string, number>;
}
export interface TimelineEntry {
    day: number;
    date: string;
    ruleId: Decision['ruleId'];
    campaignId: string;
    before: TimelineView;
    after: TimelineView;
}
export function timelineMarkdown(timeline: readonly TimelineEntry[]) { return '| day | date | campaign | rule | budget | tag |\n| --- | --- | --- | --- | --- | --- |\n' + timeline.map(t => `| ${t.day} | ${t.date} | ${t.campaignId} | ${t.ruleId} | $${t.after.budget.toFixed(2)} | ${t.after.tag} |`).join('\n') + '\n'; }
export async function runCampaignLoop(options: {
    scenario?: Scenario;
    scriptedMarket?: ScriptedMarket;
    days?: number;
    config?: SimConfig;
    runHour?: number;
}) {
    const s = options.scenario ?? options.scriptedMarket?.scenario;
    if (!s)
        throw new Error('SCENARIO_REQUIRED');
    const config = options.config ?? DEFAULT_CONFIG, runHour = options.runHour ?? 0, days = options.days ?? s.days;
    if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23 || !Number.isInteger(days) || days < 1)
        throw new Error('INVALID_RUN_OPTIONS');
    const start = date(s.startDate, config.marketplace.zone), end = start.plus({ days }), clock = new SimClock(start.toUTC().toISO()!), sink = new MemoryFactSink(), market = options.scriptedMarket ?? new MarketDriver(s, sink);
    const facts: MetricFact[] = [], index = new FactIndex(), audit = new AuditLog(), decisions: Decision[] = [], notifications: NotificationLog[] = [], timeline: TimelineEntry[] = [];
    const port = new FaultyFakePort(new InMemoryFakePort(), clock, s.seed, {});
    let state: EngineState = { campaigns: {}, campaignMemory: {}, targets: {}, targetEntities: {} };
    for (const c of s.campaigns) {
        const campaign = { id: c.id, asin: c.asin, type: c.type, targetingKind: c.type === 'AUTO' ? 'AUTO' as const : 'KEYWORD' as const, status: c.status, name: c.name, dailyBudgetMicros: micros(Math.round(c.budget * 1e6)), topOfSearchPct: c.topOfSearchPct };
        state = { ...state, campaigns: { ...state.campaigns, [c.id]: campaign } };
        for (const t of c.targets) {
            const entity = { id: t.id, campaignId: c.id, adGroupId: `${c.id}:group`, kind: t.kind, text: t.text, status: t.status, bidMicros: micros(Math.round(t.bid * 1e6)), ...(t.kind === 'KEYWORD' ? { matchType: 'EXACT' as const } : {}) };
            state = { ...state, targets: { ...state.targets, [t.id]: createTargetMemory(entity.bidMicros, clock.now(), config) }, targetEntities: { ...state.targetEntities, [t.id]: entity } };
        }
    }
    const view = (): EntityView => ({ campaigns: s.campaigns.map(c => ({ ...c, name: state.campaigns[c.id]!.name, budget: state.campaigns[c.id]!.dailyBudgetMicros / 1e6, status: state.campaigns[c.id]!.status, topOfSearchPct: state.campaigns[c.id]!.topOfSearchPct, targets: c.targets.map(t => ({ ...t, status: state.targetEntities[t.id]!.status, bid: submittedBid(state.targets[t.id]!, dateLocalHour as Hour) / 1e6 })) })) });
    let dateLocalHour = 0, previous = start.minus({ hours: 1 }).toUTC().toISO()!;
    const pendingEnable = new Set<string>();
    const runDates = new Set<string>();
    const snap = (id: string, st: EngineState): TimelineView => ({ budget: st.campaigns[id]!.dailyBudgetMicros / 1e6, tag: st.campaignMemory[id]?.tag ?? 'NORMAL', status: st.campaigns[id]!.status, factors: Object.fromEntries(Object.entries(st.targets).filter(([tid]) => st.targetEntities[tid]?.campaignId === id).map(([tid, t]) => [tid, t.tagReductionFactor])) });
    for (let at = start; at < end; at = at.plus({ hours: 1 })) {
        const iso = at.toUTC().toISO()!, today = at.toISODate()!;
        dateLocalHour = at.hour;
        // Clock advances in UTC hours; PT may repeat an hour at DST fallback.
        const delta = (Date.parse(iso) - Date.parse(clock.now())) / 3600000;
        if (delta > 0)
            clock.advanceHours(delta);
        const manual = view();
        applyManualEdits(s, manual, previous, iso);
        for (const c of manual.campaigns) {
            const old = state.campaigns[c.id]!;
            if (old.status === 'PAUSED' && c.status === 'ENABLED')
                pendingEnable.add(c.id);
            if (old.status !== c.status || old.name !== c.name || old.dailyBudgetMicros !== Math.round(c.budget * 1e6)) {
                const tier = config.budgetLadder.indexOf(micros(Math.round(c.budget * 1e6)));
                if (tier < 0)
                    throw new Error('MANUAL_BUDGET_NOT_ON_LADDER');
                const m = state.campaignMemory[c.id];
                state = { ...state, campaigns: { ...state.campaigns, [c.id]: { ...old, status: c.status, name: c.name, dailyBudgetMicros: config.budgetLadder[tier]! } }, campaignMemory: { ...state.campaignMemory, ...(m ? { [c.id]: { ...m, budgetTierIndex: tier, ...(old.dailyBudgetMicros !== Math.round(c.budget * 1e6) ? { windowStartAt: iso, lastChangeAt: { ...m.lastChangeAt, budget: iso } } : {}) } } : {}) } };
            }
            for (const t of c.targets) {
                const tm = state.targets[t.id]!, te = state.targetEntities[t.id]!;
                const bid = micros(Math.round(t.bid * 1e6));
                if (te.status !== t.status || bid !== submittedBid(tm, dateLocalHour as Hour))
                    state = { ...state, targetEntities: { ...state.targetEntities, [t.id]: { ...te, status: t.status } }, targets: { ...state.targets, [t.id]: { ...tm, baseBidMicros: micros(Math.round(bid / tm.hourlyFactor[dateLocalHour as Hour])) } } };
            }
        }
        // SPEC-AMBIGUITY: A repeated PT hour dispatches once, at its first occurrence.
        if (at.hour === runHour && !runDates.has(today)) {
            runDates.add(today);
            index.update(facts);
            const thresholdsByCampaign: Record<string, DerivedThresholds> = {}, thresholds: Record<string, DerivedThresholds> = {};
            for (const c of Object.values(state.campaigns)) {
                const p = productAt(s, c.asin, iso), result = deriveThresholds({ asin: c.asin, priceMicros: micros(Math.round(p.priceUsd * 1e6)), breakEvenAcos: p.breakEvenAcos, expCvr: p.expectedCvr }, config);
                thresholdsByCampaign[c.id] = result.thresholds;
                for (const warning of result.warnings)
                    if (!notifications.some(n => n.campaignId === c.id && n.type === 'PRODUCT_INFEASIBLE'))
                        notifications.push({ at: iso, campaignId: c.id, type: 'PRODUCT_INFEASIBLE', details: { warning } });
            }
            for (const [id, t] of Object.entries(state.targetEntities))
                thresholds[id] = thresholdsByCampaign[t.campaignId]!;
            const context = (): RuleContext => ({ runId: `${iso}|campaign`, clock, config, state, thresholds, thresholdsByCampaign, today, metrics: new MetricsReader(index, clock.now(), config), audit, decisions, notify: e => notifications.push(e), manualReenabledCampaignIds: [...pendingEnable], paramsVersion: Object.values(thresholdsByCampaign).map(t => t.paramsVersion).join(':') });
            const apply = async (decision: Decision | null): Promise<void> => {
                if (!decision) return;
                state = decision.after;
                const id = decision.objectRef.id;
                assertCampaignInvariants(state, id, config, decision, iso);
                timeline.push({
                    day: calendarDaysBetween(s.startDate, today, config.marketplace.zone),
                    date: today, ruleId: decision.ruleId, campaignId: id,
                    before: snap(id, decision.before), after: snap(id, state),
                });
                const key = idempotencyKey(decision.runId, id, decision.ruleId);
                if (!stateEqual(decision.before.campaigns[id], state.campaigns[id])) {
                    await port.updateCampaign(state.campaigns[id]!, key);
                }
                for (const tid of decision.baseBidTargetIds) {
                    const target = state.targetEntities[tid]!;
                    await port.updateTargets(
                        [{ target, bidMicros: submittedBid(state.targets[tid]!, dateLocalHour as Hour) }],
                        target.kind === 'KEYWORD' ? '/sp/keywords' : '/sp/targets',
                        idempotencyKey(decision.runId, tid, decision.ruleId),
                    );
                }
            };
            const ids = Object.keys(state.campaigns).sort();
            for (const id of ids)
                if (state.campaigns[id]!.status === 'ENABLED' && (!state.campaignMemory[id] || pendingEnable.has(id)))
                    await apply(firstMatchWins({ group: 'CAMPAIGN', id }, [registry.find(r => r.id === 'R01')!], context()));
            for (const id of ids) {
                const m = state.campaignMemory[id];
                if (!m)
                    continue;
                const history = { ...m.budgetByDate, [today]: state.campaigns[id]!.dailyBudgetMicros };
                const retained = Object.fromEntries(Object.entries(history).sort(([a], [b]) => a.localeCompare(b)).slice(-35));
                state = { ...state, campaignMemory: { ...state.campaignMemory, [id]: { ...m, budgetByDate: retained } } };
            }
            for (const id of ids)
                state = trackR09(id, context());
            for (const id of ids)
                if (state.campaigns[id]!.status === 'ENABLED')
                    await apply(firstMatchWins({ group: 'CAMPAIGN', id }, CAMPAIGN.map(rule => registry.find(r => r.id === rule)!), context()));
            // SPEC-AMBIGUITY: Record the post-run daily budget as the budget used for R04B.
            // Keep the budget actually used for this date, after the pre-traffic decision.
            for (const id of ids) {
                const m = state.campaignMemory[id];
                if (m)
                    state = { ...state, campaignMemory: { ...state.campaignMemory, [id]: { ...m, budgetByDate: { ...m.budgetByDate, [today]: state.campaigns[id]!.dailyBudgetMicros } } } };
            }
            pendingEnable.clear();
        }
        const result = market.step(iso, view());
        facts.push(...result.facts);
        previous = iso;
    }
    return { state, audit: audit.events, notifications, decisions, facts, timeline, portCalls: port.calls };
}
