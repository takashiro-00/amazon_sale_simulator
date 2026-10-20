import type { Truth } from '../scenario/schema.js';
import { Rng } from './rng.js';
export interface Metrics {
    impressions: number;
    clicks: number;
    spendMicros: number;
    orders: number;
    salesMicros: number;
}
export interface RawOrder {
    salesMicros: number;
    placement: 'TOP' | 'REST_OF_SEARCH';
    query: string;
}
export interface Slice extends Metrics {
    placement: 'TOP' | 'REST_OF_SEARCH';
    query: string;
}
export interface HourResult extends Metrics {
    budgetCapped: boolean;
    budgetExhausted?: boolean;
    slices: Slice[];
    orderEvents: RawOrder[];
}
export interface HourInput {
    target: Truth;
    bid: number;
    topOfSearchPct: number;
    hour: number;
    price: number;
    remainingBudget: number;
    seasonality: number;
    status: 'ENABLED' | 'PAUSED';
    couponZeroSalesRate?: number;
}
export const emptyMetrics = (): Metrics => ({ impressions: 0, clicks: 0, spendMicros: 0, orders: 0, salesMicros: 0 });
export function expectedImpressions(t: Truth, bid: number, hour: number, seasonality = 1): number {
    return t.baseImpressionsPerDay * t.hourlyTrafficCurve[hour]! / (1 + Math.exp(-(bid - t.clearingPrice) / t.priceSpread)) * seasonality;
}
/** Monotonic, capped TOP traffic share; ToS is in percentage points. */
export function topTrafficShare(pct: number): number {
    return Math.min(.85, .15 + .7 * pct / (100 + pct));
}
interface Click {
    cost: number;
    order?: RawOrder;
}
export interface Demand extends HourResult {
    batches: {
        slice: Slice;
        clicks: Click[];
    }[];
}
/** Draw natural demand in batches; only clicks require individual CPC draws. */
export function demandHour(input: HourInput, rng: Rng): Demand {
    const r: Demand = { ...emptyMetrics(), budgetCapped: false, slices: [], orderEvents: [], batches: [] };
    if (input.status === 'PAUSED')
        return r;
    const t = input.target, allocation = rng.fork('allocation'), clicks = rng.fork('clicks'), costs = rng.fork('cpc'), orders = rng.fork('orders'), coupon = rng.fork('coupon');
    let remaining = rng.fork('impressions').poisson(expectedImpressions(t, input.bid, input.hour, input.seasonality));
    const cells = t.searchTerms.flatMap(term => (['TOP', 'REST_OF_SEARCH'] as const).map(placement => ({ term, placement, weight: term.weight * (placement === 'TOP' ? topTrafficShare(input.topOfSearchPct) : 1 - topTrafficShare(input.topOfSearchPct)) })));
    let weight = cells.reduce((n, c) => n + c.weight, 0);
    for (const cell of cells) {
        const n = weight <= cell.weight ? remaining : allocation.binomial(remaining, Math.min(1, cell.weight / weight));
        remaining -= n;
        weight -= cell.weight;
        const slice: Slice = { ...emptyMetrics(), placement: cell.placement, query: cell.term.query, impressions: n };
        const count = clicks.binomial(n, t.ctr), cvr = Math.min(1, t.trueCvr * cell.term.cvrMultiplier * (cell.placement === 'TOP' ? t.topCvrMultiplier : 1));
        const conversions = orders.binomial(count, cvr), batch: Click[] = [];
        for (let i = 0; i < count; i++) {
            const cost = Math.floor(input.bid * costs.uniform(.6, .95) * 1e6);
            const order = i < conversions ? { placement: cell.placement, query: cell.term.query, salesMicros: coupon.uniform() < (input.couponZeroSalesRate ?? 0) ? 0 : Math.round(input.price * 1e6) } : undefined;
            batch.push({ cost, ...(order ? { order } : {}) });
            slice.clicks++;
            slice.spendMicros += cost;
            if (order) {
                slice.orders++;
                slice.salesMicros += order.salesMicros;
                r.orderEvents.push(order);
            }
        }
        r.batches.push({ slice, clicks: batch });
        r.slices.push(slice);
        for (const k of ['impressions', 'clicks', 'spendMicros', 'orders', 'salesMicros'] as const)
            r[k] += slice[k];
    }
    return r;
}
/** Uniformly shuffle all campaign impressions only when the shared cap binds. */
export function allocateCampaign(demands: Demand[], budgetMicros: number, rng: Rng): HourResult[] {
    if (budgetMicros > 0 && demands.reduce((n, r) => n + r.spendMicros, 0) <= budgetMicros)
        return demands.map(({ batches, ...r }) => r);
    const results: HourResult[] = demands.map(() => ({ ...emptyMetrics(), budgetCapped: budgetMicros <= 0, slices: [], orderEvents: [] }));
    if (budgetMicros <= 0)
        return results;
    const tokens: {
        target: number;
        slice: Slice;
        click?: Click;
    }[] = [];
    demands.forEach((d, target) => d.batches.forEach(b => {
        const slice: Slice = { ...emptyMetrics(), placement: b.slice.placement, query: b.slice.query };
        results[target]!.slices.push(slice);
        for (let i = 0; i < b.slice.impressions; i++)
            tokens.push({ target, slice, ...(b.clicks[i] ? { click: b.clicks[i] } : {}) });
    }));
    for (let i = tokens.length - 1; i > 0; i--) {
        const j = Math.floor(rng.uniform(0, i + 1));
        [tokens[i], tokens[j]] = [tokens[j]!, tokens[i]!];
    }
    let used = 0;
    // Stop the whole campaign at the last affordable click, without fractional spend.
    for (const token of tokens) {
        const r = results[token.target]!, s = token.slice, c = token.click;
        if (c && used + c.cost > budgetMicros) {
            for (const r of results)
                r.budgetExhausted = true;
            break;
        }
        r.impressions++;
        s.impressions++;
        if (c) {
            used += c.cost;
            r.clicks++;
            s.clicks++;
            r.spendMicros += c.cost;
            s.spendMicros += c.cost;
            if (c.order) {
                r.orders++;
                s.orders++;
                r.salesMicros += c.order.salesMicros;
                s.salesMicros += c.order.salesMicros;
                r.orderEvents.push(c.order);
            }
        }
    }
    return results;
}
export function simulateHour(input: HourInput, rng: Rng): HourResult {
    return allocateCampaign([demandHour(input, rng)], Math.max(0, Math.floor(input.remainingBudget * 1e6)), rng.fork('budget'))[0]!;
}
