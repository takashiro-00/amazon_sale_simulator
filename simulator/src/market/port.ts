import type { MetricFact } from '../data/facts.js';
import type { Instant } from '../time/clock.js';
import type { EntityView } from './driver.js';
/** Step 5 boundary: the world consumes visible entities, never rule memory. */
export interface MarketModel {
    step(hourInstant: Instant, entityView: EntityView): {
        facts: MetricFact[];
        spendByCampaign: Record<string, number>;
    };
}
