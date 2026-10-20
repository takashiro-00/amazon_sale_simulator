import { FactIndex, queryFacts, zeroOrdersRobust } from './facts.js';
import type { ResolvedWindow } from './windows.js';
import { acos } from '../domain/acos.js';
import { micros } from '../domain/money.js';
import { calendarDaysBetween, dMinus, type Instant, type MarketplaceDate } from '../time/clock.js';
import type { SimConfig } from '../../config/defaults.js';
export interface MetricRead { query: { kind: string; id: string }; from: string; to: string; totals: unknown }
export class MetricsReader {
    private reads: MetricRead[] = [];
    resetReads() { this.reads = []; }
    get recordedReads(): readonly MetricRead[] { return this.reads; }
    private record(kind: string, id: string, from: string, to: string, facts: readonly import('./facts.js').MetricFact[]) {
        this.reads.push({query:{kind,id},from,to,totals:this.aggregate(facts)});
    }
    constructor(private readonly index: FactIndex, readonly asOf: Instant, private readonly config: SimConfig) { }
    granular(id: string, from: string, to: string) { const facts = queryFacts(this.index, { entityRef: id, from, to, asOf: this.asOf }, this.config); this.record('granular',id,from,to,facts); return facts; }
    aggregate(facts: readonly import('./facts.js').MetricFact[]) {
        const sum=(key:'impressions'|'clicks'|'spendMicros'|'orders'|'salesMicros')=>facts.reduce((n,f)=>n+f[key],0);
        return {impressions:sum('impressions'), clicks:sum('clicks'),orders:sum('orders'),spendMicros:micros(sum('spendMicros')),salesMicros:micros(sum('salesMicros')),acos:acos(micros(sum('spendMicros')),micros(sum('salesMicros')))};
    }
    facts(campaignId: string, from: MarketplaceDate, to: MarketplaceDate) { const facts = queryFacts(this.index, { entityRef: campaignId, dailyOnly: true, from, to, asOf: this.asOf }, this.config).filter(f => f.hour === undefined && f.placement === undefined); this.record('campaignWindow',campaignId,from,to,facts); return facts; }
    campaignWindow(id: string, window: ResolvedWindow) {
        const facts = this.facts(id, window.from, window.to);
        const sum = (key: 'impressions' | 'clicks' | 'spendMicros' | 'orders' | 'salesMicros') => facts.reduce((n, f) => n + f[key], 0);
        const spendMicros = micros(sum('spendMicros')), salesMicros = micros(sum('salesMicros'));
        return { impressions: sum('impressions'), clicks: sum('clicks'), spendMicros, orders: sum('orders'), salesMicros, acos: acos(spendMicros, salesMicros), daily: facts.map(f => ({ date: f.marketplaceDate, orders: f.orders, spendMicros: f.spendMicros, clicks: f.clicks })), complete: facts.length === Math.max(0, calendarDaysBetween(window.from, window.to, this.config.marketplace.zone) + 1) };
    }
    hasOrdersInLookback(id: string, days = 30, today: MarketplaceDate) { const to = dMinus(today, this.config.maturityLagDays); return this.facts(id, dMinus(to, days - 1), to).some(f => f.orders > 0); }
    zeroOrdersRobust(id: string, today: MarketplaceDate) { return zeroOrdersRobust(this.facts(id, dMinus(today, this.config.maturityLagDays + 1), dMinus(today, this.config.maturityLagDays)), today, this.config); }
}
