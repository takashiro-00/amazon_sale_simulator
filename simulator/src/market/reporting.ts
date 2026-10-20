import type { MetricFact } from '../data/facts.js';
import type { Micros } from '../domain/money.js';
import type { Hour, Placement } from '../domain/entities.js';
import { date, instant, isoFromMillis, marketplaceHour, toMarketplaceDate } from '../time/clock.js';
import type { Scenario } from '../scenario/schema.js';
import { Rng } from './rng.js';
import { emptyMetrics, type Metrics, type HourResult } from './model.js';
import { eventContext } from './events.js';
export interface FactSink {
    append(fact: MetricFact): void;
}
export class MemoryFactSink implements FactSink {
    readonly facts: MetricFact[] = [];
    append(fact: MetricFact): void {
        this.facts.push(Object.freeze({ ...fact }));
    }
}
export interface AttributedOrder {
    salesMicros: number;
    knownAt: string;
    returnedAt?: string;
    placement: Placement;
    query: string;
}
export interface Observation {
    sourceTargetId?: string;
    entityRef: string;
    campaignId: string;
    hourBucket: string;
    marketplaceDate: string;
    hour: Hour;
    result: HourResult;
    orders: AttributedOrder[];
}
export function observation(s: Scenario, entityRef: string, campaignId: string, at: string, result: HourResult, rng: Rng, frame?: {
    day: string;
    hour: Hour;
    context: ReturnType<typeof eventContext>;
}): Observation {
    const day = frame?.day ?? toMarketplaceDate(at, s.marketplace), c = frame?.context ?? eventContext(s, at), entries = Object.entries(c.lagDistribution);
    const orders = result.orderEvents.map((o, i) => {
        const r = rng.fork(`order:${i}`), lag = Math.min(14, Math.ceil(Number(entries[r.categorical(entries.map(e => e[1]))]![0]) * c.lagMultiplier));
        // Lag N first appears at click-day D+1+N 03:00 PT; lag zero is already visible in the initial stream.
        const release = (lag: number) => dailyRelease(day, lag + 1, s.marketplace.zone);
        const knownAt = lag === 0 ? isoFromMillis(Date.parse(at) + 7200000) : release(lag);
        const returnedAt = r.uniform() < s.returnRate ? release(Math.min(13, Math.max(lag, s.attribution.returnLagDays))) : undefined;
        return { ...o, knownAt, ...(returnedAt ? { returnedAt } : {}) };
    });
    return { entityRef, campaignId, hourBucket: isoFromMillis(Date.parse(at)), marketplaceDate: day, hour: frame?.hour ?? marketplaceHour(at, s.marketplace), result, orders };
}
const releases = new Map<string, string>();
export function dailyRelease(day: string, offset: number, zone: string): string {
    const key = `${zone}/${day}/${offset}`;
    let value = releases.get(key);
    if (!value) {
        value = date(day, zone).plus({ days: offset }).set({ hour: 3 }).toUTC().toISO()!;
        releases.set(key, value);
    }
    return value;
}
/** Exact probability visible in daily release N, independent of a random sample. */
export function visibleLagProbability(distribution: Record<string, number>, releaseNumber: number): number {
    const entries = Object.entries(distribution), total = entries.reduce((n, [, p]) => n + p, 0);
    return entries.reduce((n, [lag, p]) => n + (Number(lag) <= releaseNumber - 1 ? p : 0), 0) / total;
}
const keys = ['impressions', 'clicks', 'spendMicros', 'orders', 'salesMicros'] as const;
function add(a: Metrics, b: Metrics) {
    for (const k of keys)
        a[k] += b[k];
}
/** Independent daily and stream publication schedules, sharing the same click/order ledger. */
export class Reporter {
    private readonly previous = new Map<string, string>();
    private readonly hourly = new Map<string, {
        obs: Observation[];
        times: Set<string>;
    }>();
    private readonly daily = new Map<string, {
        obs: Observation[];
        times: Set<string>;
    }>();
    private readonly terms = new Map<string, readonly {
        query: string;
    }[]>();
    constructor(private readonly s: Scenario, private readonly sink: FactSink) {
        for (const c of s.campaigns)
            for (const t of c.targets)
                this.terms.set(t.id, t.searchTerms);
    }
    record(observation: Observation): void {
        for (const o of [observation, { ...observation, sourceTargetId: observation.entityRef, entityRef: observation.campaignId }]) {
            const firstStream = isoFromMillis(Date.parse(o.hourBucket) + 7200000);
            const firstDaily = dailyRelease(o.marketplaceDate, 1, this.s.marketplace.zone);
            const times = new Set([firstDaily]);
            for (const order of o.orders) {
                for (const at of [order.knownAt, order.returnedAt])
                    if (at && Date.parse(at) > Date.parse(firstDaily))
                        times.add(at);
            }
            const hourKey = JSON.stringify(['hour', o.entityRef, o.hourBucket]);
            const hourLedger = this.hourly.get(hourKey) ?? { obs: [], times: new Set<string>() };
            hourLedger.obs.push(o);
            hourLedger.times.add(firstStream);
            for (const at of times)
                if (Date.parse(at) > Date.parse(firstStream))
                    hourLedger.times.add(at);
            this.hourly.set(hourKey, hourLedger);
            // Every observation must contribute to each daily version, including unchanged slices.
            const dailyKey = JSON.stringify(['daily', o.entityRef, o.marketplaceDate]);
            const ledger = this.daily.get(dailyKey) ?? { obs: [], times: new Set<string>() };
            ledger.obs.push(o);
            for (const at of times)
                ledger.times.add(at);
            this.daily.set(dailyKey, ledger);
        }
    }
    publish(asOf: string): MetricFact[] {
        const emitted: MetricFact[] = [], cutoff = instant(asOf).toMillis();
        const schedule = new Map<string, Observation[]>();
        for (const ledgers of [this.hourly, this.daily])
            for (const [key, ledger] of ledgers) {
                for (const at of ledger.times)
                    if (Date.parse(at) <= cutoff) {
                        const [kind, entity, period] = JSON.parse(key) as string[];
                        schedule.set(JSON.stringify([kind, entity, period, at]), ledger.obs);
                        ledger.times.delete(at);
                    }
                if (!ledger.times.size)
                    ledgers.delete(key);
            }
        const sorted = [...schedule.entries()].sort(([a], [b]) => {
            const ka = JSON.parse(a) as string[], kb = JSON.parse(b) as string[];
            return Date.parse(ka.at(-1)!) - Date.parse(kb.at(-1)!) || a.localeCompare(b);
        });
        for (const [key, obs] of sorted) {
            const parts = JSON.parse(key) as string[], hourly = parts[0] === 'hour', knownAt = parts.at(-1)!, first = obs[0]!;
            const dimensions = new Map<string, {
                entityRef: string;
                placement?: Placement;
                metrics: Metrics;
            }>();
            const aggregate = (entityRef: string, placement: Placement | undefined, metrics: Metrics) => {
                const k = JSON.stringify([entityRef, placement]);
                let a = dimensions.get(k);
                if (!a) {
                    a = { entityRef, ...(placement ? { placement } : {}), metrics: emptyMetrics() };
                    dimensions.set(k, a);
                }
                add(a.metrics, metrics);
            };
            for (const o of obs) {
                let noise = 1;
                if (hourly && this.s.hourlyNoise)
                    noise = new Rng(this.s.seed).fork(`noise:${o.entityRef}:${o.hourBucket}`).uniform(1 - this.s.hourlyNoise, 1 + this.s.hourlyNoise);
                const visible = (placement?: Placement, query?: string): Metrics => {
                    const m = emptyMetrics();
                    const slices = o.result.slices.filter(s => (!placement || s.placement === placement) && (!query || s.query === query));
                    for (const s of slices) {
                        m.impressions += s.impressions;
                        m.clicks += s.clicks;
                        m.spendMicros += s.spendMicros;
                    }
                    for (const order of o.orders)
                        if ((!placement || order.placement === placement) && (!query || order.query === query) && Date.parse(order.knownAt) <= Date.parse(knownAt) && (!order.returnedAt || Date.parse(order.returnedAt) > Date.parse(knownAt))) {
                            m.orders++;
                            m.salesMicros += order.salesMicros;
                        }
                    const originalCpc = m.clicks ? m.spendMicros / m.clicks : 0;
                    for (const k of keys)
                        m[k] = Math.round(m[k] * noise);
                    // Preserve CPC when integer rounding removes noisy clicks.
                    m.spendMicros = Math.min(m.spendMicros, Math.round(m.clicks * originalCpc));
                    return m;
                };
                aggregate(o.entityRef, undefined, visible());
                for (const p of ['TOP', 'REST_OF_SEARCH', 'PRODUCT_PAGE'] as const)
                    aggregate(o.entityRef, p, visible(p));
                for (const term of this.terms.get(o.sourceTargetId ?? o.entityRef)!)
                    aggregate(`${o.entityRef}:search:${term.query}`, undefined, visible(undefined, term.query));
            }
            for (const d of dimensions.values()) {
                const f: MetricFact = { entityRef: d.entityRef, marketplaceDate: first.marketplaceDate, ...(hourly ? { hour: first.hour, hourBucket: first.hourBucket } : {}), ...d.metrics, spendMicros: d.metrics.spendMicros as Micros, salesMicros: d.metrics.salesMicros as Micros, ...(d.placement ? { placement: d.placement } : {}), budgetCapped: obs.some(o => o.result.budgetCapped), knownAt };
                const versionKey = JSON.stringify([f.entityRef, f.marketplaceDate, f.hourBucket, f.placement]);
                const payload = JSON.stringify([...keys.map(k => f[k]), f.budgetCapped]);
                const prior = this.previous.get(versionKey);
                if (prior === payload)
                    continue;
                if (prior === undefined && (f.placement === 'PRODUCT_PAGE' || f.entityRef.includes(':search:')) && keys.every(k => f[k] === 0))
                    continue;
                this.previous.set(versionKey, payload);
                this.sink.append(f);
                emitted.push(f);
            }
        }
        return emitted;
    }
}
