import { normalizeText } from '../api/tags.js';
import { date, instant } from '../time/clock.js';
export interface Truth {
    trueCvr: number;
    ctr: number;
    clearingPrice: number;
    priceSpread: number;
    baseImpressionsPerDay: number;
    hourlyTrafficCurve: number[];
    topCvrMultiplier: number;
    searchTerms: {
        query: string;
        weight: number;
        cvrMultiplier: number;
    }[];
}
export interface ScenarioTarget extends Truth {
    matchType?: "EXACT" | "PHRASE" | "BROAD";
    id: string;
    bid: number;
    status: 'ENABLED' | 'PAUSED';
    kind: 'KEYWORD' | 'AUTO' | 'PRODUCT';
    text: string;
}
export interface ScenarioCampaign {
    harvestDestinationCampaignId?: string;
    id: string;
    asin: string;
    name: string;
    type: 'AUTO' | 'MANUAL';
    budget: number;
    topOfSearchPct: number;
    status: 'ENABLED' | 'PAUSED';
    targets: ScenarioTarget[];
}
export type Distribution = Record<string, number>;
export interface FaultConfig {
    rateLimit?: {
        probability?: number;
        windows?: {
            from: string;
            to: string;
            retryAfterSeconds?: number;
        }[];
        retryAfterSeconds?: number;
    };
    serverError?: {
        probability: number;
    };
    partialBatch?: {
        probability: number;
    };
    staleReadMinutes?: number;
    createSucceedsButInvisible?: number;
}
export type TimelineEvent = {
    type: 'seasonality';
    from: string;
    to: string;
    multiplier: number;
    lagMultiplier?: number;
} | {
    type: 'priceChange';
    asin: string;
    at: string;
    priceUsd: number;
    breakEvenAcos?: number;
} | {
    type: 'manualEdit';
    at: string;
    entityId: string;
    field: 'bid' | 'budget' | 'status' | 'name';
    value: string | number;
} | {
    type: 'attributionStorm';
    from: string;
    to: string;
    lagDistribution: Distribution;
} | {
    type: 'apiFault';
    from: string;
    to: string;
    fault: FaultConfig;
};
export interface Scenario {
    seed: string | number;
    marketplace: {
        id: 'US';
        zone: string;
    };
    startDate: string;
    days: number;
    products: {
        asin: string;
        priceUsd: number;
        breakEvenAcos: number;
        expectedCvr: number;
    }[];
    campaigns: ScenarioCampaign[];
    attribution: {
        lagDistribution: Distribution;
        returnLagDays: number;
    };
    returnRate: number;
    hourlyNoise: number;
    overspendTolerance: number;
    couponZeroSalesRate: number;
    events: TimelineEvent[];
    apiFault: FaultConfig;
}
/** Validate untrusted JSON without coercion. All errors carry a JSON field path. */
export function validateScenario(value: unknown): Scenario {
    const fail = (p: string, m: string): never => {
        throw new Error(`${p} ${m}`);
    };
    const obj = (v: unknown, p: string): Record<string, unknown> => {
        if (!v || typeof v !== 'object' || Array.isArray(v))
            fail(p, 'must be an object');
        return v as Record<string, unknown>;
    };
    const num = (v: unknown, p: string, min = 0, max = Infinity): number => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
            fail(p, `must be in [${min},${max}]`);
        return v as number;
    };
    const str = (v: unknown, p: string): string => {
        if (typeof v !== 'string' || !v.trim())
            fail(p, 'must be a nonempty string');
        return v as string;
    };
    const arr = (v: unknown, p: string): unknown[] => {
        if (!Array.isArray(v))
            fail(p, 'must be an array');
        return v as unknown[];
    };
    const enumeration = (v: unknown, p: string, choices: readonly unknown[]) => {
        if (!choices.includes(v))
            fail(p, `must be one of ${choices.join(', ')}`);
    };
    const dist = (v: unknown, p: string) => {
        const d = obj(v, p);
        let total = 0;
        for (const [k, w] of Object.entries(d)) {
            if (!/^\d+$/.test(k) || +k > 14)
                fail(`${p}.${k}`, 'lag must be an integer in [0,14]');
            total += num(w, `${p}.${k}`, 0, 1);
        }
        if (Math.abs(total - 1) > 1e-9)
            fail(p, 'weights must sum to 1');
    };
    const fault = (v: unknown, p: string) => {
        const f = obj(v, p);
        for (const k of ['rateLimit', 'serverError', 'partialBatch'])
            if (f[k] !== undefined) {
                const c = obj(f[k], `${p}.${k}`);
                if (k !== 'rateLimit' || c.probability !== undefined)
                    num(c.probability, `${p}.${k}.probability`, 0, 1);
                if (c.retryAfterSeconds !== undefined)
                    num(c.retryAfterSeconds, `${p}.${k}.retryAfterSeconds`);
                if (c.windows !== undefined)
                    arr(c.windows, `${p}.${k}.windows`).forEach((w, i) => {
                        const a = obj(w, `${p}.${k}.windows[${i}]`);
                        range(a, `${p}.${k}.windows[${i}]`);
                        if (a.retryAfterSeconds !== undefined)
                            num(a.retryAfterSeconds, `${p}.${k}.windows[${i}].retryAfterSeconds`);
                    });
            }
        for (const k of ['staleReadMinutes', 'createSucceedsButInvisible'])
            if (f[k] !== undefined)
                num(f[k], `${p}.${k}`);
    };
    const timestamp = (v: unknown, p: string) => {
        try {
            instant(str(v, p));
        }
        catch {
            fail(p, 'must be an ISO instant with offset');
        }
    };
    const range = (o: Record<string, unknown>, p: string) => {
        timestamp(o.from, `${p}.from`);
        timestamp(o.to, `${p}.to`);
        if (Date.parse(String(o.from)) >= Date.parse(String(o.to)))
            fail(p, 'from must precede to');
    };
    const s = structuredClone(obj(value, 'scenario'));
    if (typeof s.seed !== 'string' && typeof s.seed !== 'number')
        fail('seed', 'must be string or number');
    if (typeof s.seed === 'number')
        num(s.seed, 'seed', -Infinity);
    const m = obj(s.marketplace, 'marketplace');
    enumeration(m.id, 'marketplace.id', ['US']);
    if (m.zone !== 'America/Los_Angeles')
        fail('marketplace.zone', 'must be America/Los_Angeles');
    try {
        date(str(s.startDate, 'startDate'));
    }
    catch {
        fail('startDate', 'must be a valid YYYY-MM-DD');
    }
    const days = num(s.days, 'days', 1, 3660);
    if (!Number.isInteger(days))
        fail('days', 'must be integer');
    const products = arr(s.products, 'products');
    if (!products.length)
        fail('products', 'must not be empty');
    const asins = new Set<string>();
    products.forEach((v, i) => {
        const p = `products[${i}]`, o = obj(v, p), asin = str(o.asin, `${p}.asin`);
        if (asins.has(asin))
            fail(`${p}.asin`, 'duplicate');
        asins.add(asin);
        num(o.priceUsd, `${p}.priceUsd`, Number.MIN_VALUE);
        num(o.breakEvenAcos, `${p}.breakEvenAcos`, Number.MIN_VALUE, 1);
        o.expectedCvr ??= .1;
        num(o.expectedCvr, `${p}.expectedCvr`, Number.MIN_VALUE, 1);
    });
    const ids = new Set<string>();
    const identity = (v: unknown, p: string) => {
        const id = str(v, p);
        if (ids.has(id))
            fail(p, 'duplicate entity id');
        ids.add(id);
    };
    arr(s.campaigns, 'campaigns').forEach((v, i) => {
        const p = `campaigns[${i}]`, c = obj(v, p);
        identity(c.id, `${p}.id`);
        if (!asins.has(str(c.asin, `${p}.asin`)))
            fail(`${p}.asin`, 'unknown product');
        c.name ??= c.id;
        c.status ??= 'ENABLED';
        enumeration(c.status, `${p}.status`, ['ENABLED', 'PAUSED']);
        enumeration(c.type, `${p}.type`, ['AUTO', 'MANUAL']);
        str(c.name, `${p}.name`);
        num(c.budget, `${p}.budget`);
        num(c.topOfSearchPct, `${p}.topOfSearchPct`, 0, 900);
        arr(c.targets, `${p}.targets`).forEach((v, j) => {
            const q = `${p}.targets[${j}]`, t = obj(v, q);
            identity(t.id, `${q}.id`);
            t.status ??= 'ENABLED';
            t.kind ??= c.type === 'AUTO' ? 'AUTO' : 'KEYWORD';
            t.text ??= t.id;
            enumeration(t.kind, `${q}.kind`, ['AUTO', 'KEYWORD', 'PRODUCT']);
            if(t.kind === 'KEYWORD'){ t.matchType ??= 'EXACT'; enumeration(t.matchType, `${q}.matchType`, ['EXACT','PHRASE','BROAD']); }
            enumeration(t.status, `${q}.status`, ['ENABLED', 'PAUSED']);
            str(t.text, `${q}.text`);
            num(t.bid, `${q}.bid`, Number.MIN_VALUE);
            num(t.trueCvr, `${q}.trueCvr`, 0, 1);
            num(t.ctr, `${q}.ctr`, 0, 1);
            num(t.clearingPrice, `${q}.clearingPrice`);
            num(t.priceSpread, `${q}.priceSpread`, Number.MIN_VALUE);
            num(t.baseImpressionsPerDay, `${q}.baseImpressionsPerDay`);
            num(t.topCvrMultiplier, `${q}.topCvrMultiplier`);
            const curve = arr(t.hourlyTrafficCurve, `${q}.hourlyTrafficCurve`);
            if (curve.length !== 24)
                fail(`${q}.hourlyTrafficCurve`, 'must have 24 entries');
            let sum = 0;
            curve.forEach((x, h) => sum += num(x, `${q}.hourlyTrafficCurve[${h}]`));
            if (Math.abs(sum - 1) > 1e-6)
                fail(`${q}.hourlyTrafficCurve`, 'must sum to 1');
            let weight = 0;
            const queries = new Set<string>();
            arr(t.searchTerms, `${q}.searchTerms`).forEach((v, k) => {
                const r = `${q}.searchTerms[${k}]`, o = obj(v, r);
                const query = normalizeText(str(o.query, `${r}.query`));
                if (queries.has(query))
                    fail(`${r}.query`, 'must be unique within target');
                queries.add(query);
                weight += num(o.weight, `${r}.weight`);
                num(o.cvrMultiplier, `${r}.cvrMultiplier`);
            });
            if (weight <= 0)
                fail(`${q}.searchTerms`, 'must have positive total weight');
        });
    });
    for (const [i,c] of (s.campaigns as Record<string, unknown>[]).entries()) if(c.harvestDestinationCampaignId !== undefined){
        const id=str(c.harvestDestinationCampaignId, `campaigns[${i}].harvestDestinationCampaignId`);
        if(!(s.campaigns as Record<string, unknown>[]).some(d=>d.id===id && d.type==='MANUAL' && d.asin===c.asin)) fail(`campaigns[${i}].harvestDestinationCampaignId`, 'must reference MANUAL campaign with same ASIN');
    }
    const a = obj(s.attribution, 'attribution');
    dist(a.lagDistribution, 'attribution.lagDistribution');
    a.returnLagDays ??= 7;
    num(a.returnLagDays, 'attribution.returnLagDays', 0, 14);
    if (!Number.isInteger(a.returnLagDays))
        fail('attribution.returnLagDays', 'must be integer');
    for (const k of ['returnRate', 'hourlyNoise', 'couponZeroSalesRate', 'overspendTolerance']) {
        s[k] ??= 0;
        num(s[k], k, 0, 1);
    }
    s.apiFault ??= {};
    fault(s.apiFault, 'apiFault');
    s.events ??= [];
    arr(s.events, 'events').forEach((v, i) => {
        const p = `events[${i}]`, e = obj(v, p);
        enumeration(e.type, `${p}.type`, ['seasonality', 'priceChange', 'manualEdit', 'attributionStorm', 'apiFault']);
        if (e.type === 'priceChange' || e.type === 'manualEdit')
            timestamp(e.at, `${p}.at`);
        else
            range(e, p);
        if (e.type === 'seasonality') {
            num(e.multiplier, `${p}.multiplier`);
            if (e.lagMultiplier !== undefined)
                num(e.lagMultiplier, `${p}.lagMultiplier`, 0, 14);
        }
        if (e.type === 'attributionStorm')
            dist(e.lagDistribution, `${p}.lagDistribution`);
        if (e.type === 'apiFault')
            fault(e.fault, `${p}.fault`);
        if (e.type === 'priceChange') {
            if (!asins.has(String(e.asin)))
                fail(`${p}.asin`, 'unknown product');
            num(e.priceUsd, `${p}.priceUsd`, Number.MIN_VALUE);
            if (e.breakEvenAcos !== undefined)
                num(e.breakEvenAcos, `${p}.breakEvenAcos`, Number.MIN_VALUE, 1);
        }
        if (e.type === 'manualEdit') {
            if (!ids.has(String(e.entityId)))
                fail(`${p}.entityId`, 'unknown entity');
            enumeration(e.field, `${p}.field`, ['bid', 'budget', 'status', 'name']);
            if (e.field === 'status')
                enumeration(e.value, `${p}.value`, ['ENABLED', 'PAUSED']);
            else if (e.field === 'name')
                str(e.value, `${p}.value`);
            else
                num(e.value, `${p}.value`, e.field === 'bid' ? Number.MIN_VALUE : 0);
        }
    });
    return s as unknown as Scenario;
}
