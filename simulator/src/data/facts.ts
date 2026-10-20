import { instant, toMarketplaceDate, marketplaceHour, hourlyBucket, dMinus, type Instant, type MarketplaceDate, } from "../time/clock.js";
import type { Hour, Placement } from "../domain/entities.js";
import type { Micros } from "../domain/money.js";
import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
export interface MetricFact {
    readonly budgetCapped?: boolean;
    readonly entityRef: string;
    readonly marketplaceDate: MarketplaceDate;
    readonly hour?: Hour;
    /** Required for intraday records; UTC hour-start instant. */ readonly hourBucket?: Instant;
    readonly impressions: number;
    readonly clicks: number;
    readonly spendMicros: Micros;
    readonly orders: number;
    readonly salesMicros: Micros;
    readonly placement?: Placement;
    readonly knownAt: Instant;
}
export interface FactQuery {
    readonly dailyOnly?: boolean;
    readonly asOf: Instant;
    readonly entityRef?: string;
    readonly from?: MarketplaceDate;
    readonly to?: MarketplaceDate;
}
/** Append-only fact index. Versions are ordered by knowledge time inside each entity/date. */
export class FactIndex {
    readonly entities = new Map<string, Map<string, {
        fact: MetricFact;
        ordinal: number;
    }[]>>();
    private size = 0;
    constructor(facts: readonly MetricFact[] = []) { this.update(facts); }
    update(facts: readonly MetricFact[]): void {
        for (let i = this.size; i < facts.length; i++) {
            const fact = facts[i]!, dates = this.entities.get(fact.entityRef) ?? new Map<string, {
                fact: MetricFact;
                ordinal: number;
            }[]>();
            this.entities.set(fact.entityRef, dates);
            const versions = dates.get(fact.marketplaceDate) ?? [];
            dates.set(fact.marketplaceDate, versions);
            const entry = { fact, ordinal: i };
            if (!versions.length || Date.parse(versions.at(-1)!.fact.knownAt) <= Date.parse(fact.knownAt))
                versions.push(entry);
            else {
                let lo = 0, hi = versions.length;
                while (lo < hi) {
                    const mid = (lo + hi) >>> 1;
                    if (Date.parse(versions[mid]!.fact.knownAt) <= Date.parse(fact.knownAt))
                        lo = mid + 1;
                    else
                        hi = mid;
                }
                versions.splice(lo, 0, entry);
            }
        }
        this.size = facts.length;
    }
    candidates(q: FactQuery): readonly MetricFact[] {
        const matches: {
            fact: MetricFact;
            ordinal: number;
        }[] = [];
        const dates = q.entityRef === undefined ? [...this.entities.values()] : [this.entities.get(q.entityRef)];
        const cutoff = Date.parse(q.asOf);
        for (const days of dates)
            if (days)
                for (const [day, versions] of days) {
                    if ((q.from && day < q.from) || (q.to && day > q.to))
                        continue;
                    let lo = 0, hi = versions.length;
                    while (lo < hi) {
                        const mid = (lo + hi) >>> 1;
                        if (Date.parse(versions[mid]!.fact.knownAt) <= cutoff)
                            lo = mid + 1;
                        else
                            hi = mid;
                    }
                    for (let i = 0; i < lo; i++)
                        matches.push(versions[i]!);
                }
        return matches.sort((a, b) => a.ordinal - b.ordinal).map(e => e.fact);
    }
}
const indexes = new WeakMap<readonly MetricFact[], FactIndex>();
export function queryFacts(facts: readonly MetricFact[] | FactIndex, q: FactQuery, config: SimConfig = DEFAULT_CONFIG): readonly MetricFact[] {
    const cutoff = instant(q.asOf).toMillis(), latest = new Map<string, MetricFact>();
    let candidates: readonly MetricFact[];
    if (facts instanceof FactIndex)
        candidates = facts.candidates(q);
    else if (q.entityRef !== undefined) {
        let index = indexes.get(facts);
        if (!index) {
            index = new FactIndex(facts);
            indexes.set(facts, index);
        }
        else
            index.update(facts);
        candidates = index.candidates(q);
    }
    else
        candidates = facts;
    for (const f of candidates) {
        if (q.dailyOnly && (f.hour !== undefined || f.placement !== undefined)) continue;
        if (Date.parse(f.knownAt) > cutoff)
            continue;
        if ((q.entityRef !== undefined && f.entityRef !== q.entityRef) ||
            (q.from !== undefined && f.marketplaceDate < q.from) ||
            (q.to !== undefined && f.marketplaceDate > q.to))
            continue;
        // SPEC-AMBIGUITY: Local hour alone cannot distinguish fall-back hours; require a UTC bucket.
        if (config.ambiguity.repeatedHourPolicy === "require-utc-bucket" &&
            f.hour !== undefined) {
            if (!f.hourBucket ||
                hourlyBucket(f.hourBucket) !== instant(f.hourBucket).toUTC().toISO() ||
                marketplaceHour(f.hourBucket, config.marketplace) !== f.hour ||
                toMarketplaceDate(f.hourBucket, config.marketplace) !==
                    f.marketplaceDate)
                throw new Error("INVALID_HOUR_BUCKET");
        }
        const key = JSON.stringify([
            f.entityRef,
            f.marketplaceDate,
            f.hour ?? null,
            f.hourBucket ? hourlyBucket(f.hourBucket) : null,
            f.placement ?? null,
        ]);
        const old = latest.get(key);
        if (!old || Date.parse(f.knownAt) > Date.parse(old.knownAt))
            latest.set(key, Object.freeze({ ...f }));
        else if (Date.parse(f.knownAt) === Date.parse(old.knownAt) &&
            JSON.stringify(f) !== JSON.stringify(old))
            throw new Error("AMBIGUOUS_FACT_VERSION");
    }
    return [...latest.values()];
}
/** Pass an asOf-resolved, entity-scoped snapshot, never raw future facts. */
export function zeroOrdersRobust(facts: readonly MetricFact[], today: MarketplaceDate, config: SimConfig = DEFAULT_CONFIG): boolean {
    const dates = [
        dMinus(today, config.maturityLagDays + 1),
        dMinus(today, config.maturityLagDays),
    ];
    // SPEC-AMBIGUITY: Missing days are ineligible; absence of observations is not proof of zero orders.
    return dates.every((day) => {
        const daily = facts.filter((f) => f.marketplaceDate === day);
        return daily.length > 0 && daily.every((f) => f.orders === 0);
    });
}
