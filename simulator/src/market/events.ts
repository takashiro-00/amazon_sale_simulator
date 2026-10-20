import { deriveThresholds } from '../domain/params.js';
import { usd } from '../domain/money.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import type { Scenario, Distribution, FaultConfig } from '../scenario/schema.js';
export interface EventContext {
    seasonality: number;
    lagMultiplier: number;
    lagDistribution: Distribution;
    apiFault: FaultConfig;
}
export function eventContext(s: Scenario, at: string): EventContext {
    const c: EventContext = { seasonality: 1, lagMultiplier: 1, lagDistribution: s.attribution.lagDistribution, apiFault: { ...s.apiFault } };
    for (const e of s.events) {
        if ('from' in e && Date.parse(at) >= Date.parse(e.from) && Date.parse(at) < Date.parse(e.to)) {
            if (e.type === 'seasonality') {
                c.seasonality *= e.multiplier;
                c.lagMultiplier *= e.lagMultiplier ?? 1;
            }
            if (e.type === 'attributionStorm')
                c.lagDistribution = e.lagDistribution;
            if (e.type === 'apiFault')
                c.apiFault = { ...c.apiFault, ...e.fault };
        }
    }
    return c;
}
export function productAt(s: Scenario, asin: string, at: string) {
    const product = s.products.find(p => p.asin === asin);
    if (!product)
        throw new Error(`UNKNOWN_PRODUCT:${asin}`);
    const p = { ...product };
    for (const e of [...s.events].sort((a, b) => Date.parse('at' in a ? a.at : a.from) - Date.parse('at' in b ? b.at : b.from))) {
        if (e.type === 'priceChange' && e.asin === asin && Date.parse(e.at) <= Date.parse(at)) {
            p.priceUsd = e.priceUsd;
            p.breakEvenAcos = e.breakEvenAcos ?? p.breakEvenAcos;
        }
    }
    const derived = deriveThresholds({ asin: p.asin, priceMicros: usd(p.priceUsd), breakEvenAcos: p.breakEvenAcos, expCvr: p.expectedCvr }, DEFAULT_CONFIG);
    return { ...p, paramsVersion: derived.thresholds.paramsVersion, ...derived };
}
