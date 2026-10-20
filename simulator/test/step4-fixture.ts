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
