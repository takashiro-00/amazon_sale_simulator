import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario/schema.js';
const raw = (): any => JSON.parse(readFileSync('scenarios/golden-winner.json', 'utf8'));
it('rejects chronologically reversed windows even with different offsets', () => {
    const s = raw();
    s.events = [{ type: 'seasonality', from: '2026-10-01T08:00:00-07:00', to: '2026-10-01T09:00:00Z', multiplier: 2 }];
    expect(() => validateScenario(s)).toThrow('events[0]');
});
it('requires fault probabilities and unique search queries', () => {
    const s = raw();
    s.apiFault = { serverError: {} };
    expect(() => validateScenario(s)).toThrow('apiFault.serverError.probability');
    const t = raw();
    t.campaigns[0].targets[0].searchTerms.push(t.campaigns[0].targets[0].searchTerms[0]);
    expect(() => validateScenario(t)).toThrow('searchTerms[2].query');
});
