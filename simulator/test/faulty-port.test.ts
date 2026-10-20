import { it, expect } from 'vitest';
import { FaultyFakePort, RateLimitError, TransientServerError } from '../src/api/faultyPort.js';
import { InMemoryFakePort } from '../src/api/port.js';
import { SimClock } from '../src/time/clock.js';
import type { Target } from '../src/domain/entities.js';
import type { Micros } from '../src/domain/money.js';
const target = (id: string): Target => ({ id, campaignId: 'c', adGroupId: 'g', kind: 'KEYWORD', matchType: 'EXACT', text: id, status: 'ENABLED', bidMicros: 700000 as Micros });
it('429/5xx retries preserve idempotency and log every call', async () => {
    for (const [config, ErrorType] of [[{ rateLimit: { probability: 1 } }, RateLimitError], [{ serverError: { probability: 1 } }, TransientServerError]] as const) {
        const clock = new SimClock('2026-10-01T00:00:00Z'), port = new FaultyFakePort(new InMemoryFakePort(), clock, 42, () => config);
        await expect(port.createKeywords([target('t')], 'key')).rejects.toBeInstanceOf(ErrorType);
        port.configure({});
        expect(await port.createKeywords([target('t')], 'key')).toEqual([{ id: 't', ok: true }]);
        expect(await port.createKeywords([target('t')], 'key')).toEqual([{ id: 't', ok: true }]);
        expect(await port.listKeywords('c', 'read')).toHaveLength(1);
        expect(port.calls).toHaveLength(4);
        expect(port.calls[0]!.outcome).toMatch(/429|500/);
    }
});
it('rate-limit windows have exact boundaries', async () => {
    const clock = new SimClock('2026-10-01T00:00:00Z'), port = new FaultyFakePort(new InMemoryFakePort(), clock, 1, { rateLimit: { windows: [{ from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z', retryAfterSeconds: 12 }] } });
    await expect(port.listKeywords('c', 'r')).rejects.toMatchObject({ retryAfterSeconds: 12 });
    clock.advanceHours(1);
    expect(await port.listKeywords('c', 'r')).toEqual([]);
});
it('partial batches commit successes and retry failed elements only', async () => {
    const clock = new SimClock('2026-10-01T00:00:00Z'), port = new FaultyFakePort(new InMemoryFakePort(), clock, 42, { partialBatch: { probability: 1 } });
    const items = Array.from({ length: 8 }, (_, i) => target(`t${i}`)), first = await port.createKeywords(items, 'batch');
    expect(first.some(r => r.ok)).toBe(true);
    expect(first.some(r => !r.ok)).toBe(true);
    expect(await port.listKeywords('c', 'read')).toHaveLength(first.filter(r => r.ok).length);
    port.configure({});
    expect((await port.createKeywords(items, 'batch')).every(r => r.ok)).toBe(true);
    expect(await port.listKeywords('c', 'r2')).toHaveLength(8);
    await expect(port.createKeywords([target('different')], 'batch')).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
});
it('stale reads and invisible creates expire exactly at N minutes', async () => {
    const clock = new SimClock('2026-10-01T00:00:00Z'), port = new FaultyFakePort(new InMemoryFakePort(), clock, 4, { staleReadMinutes: 2, createSucceedsButInvisible: 3 });
    await port.createKeywords([target('t')], 'create');
    expect(await port.listKeywords('c', 'r')).toEqual([]);
    clock.advanceHours(2 / 60);
    expect(await port.listKeywords('c', 'r')).toEqual([]);
    clock.advanceHours(1 / 60);
    expect(await port.listKeywords('c', 'r')).toHaveLength(1);
    await port.updateTargets([{ target: target('t'), bidMicros: 900000 as Micros }], '/sp/keywords', 'update');
    expect((await port.listKeywords('c', 'r'))[0]!.bidMicros).toBe(700000);
    clock.advanceHours(2 / 60);
    expect((await port.listKeywords('c', 'r'))[0]!.bidMicros).toBe(900000);
});
