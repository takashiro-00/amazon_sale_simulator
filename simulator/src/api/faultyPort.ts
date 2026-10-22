import { InMemoryFakePort, type AmazonAdsPort, type BatchResult, type TargetEndpoint, type TargetUpdate } from './port.js';
import type { Campaign, Target, NegativeKeyword } from '../domain/entities.js';
import type { Clock } from '../time/clock.js';
import type { FaultConfig } from '../scenario/schema.js';
import { Rng } from '../market/rng.js';
import { hash } from '../domain/hash.js';
export class RateLimitError extends Error {
    constructor(readonly retryAfterSeconds: number) {
        super('429 RATE_LIMIT');
        this.name = 'RateLimitError';
    }
}
export class TransientServerError extends Error {
    constructor() {
        super('500 TRANSIENT_SERVER_ERROR');
        this.name = 'TransientServerError';
    }
}
export interface PortCall {
    time: string;
    op: string;
    idempotencyKey: string;
    outcome: string;
    results?: readonly BatchResult[];
}
type Stale<T> = {
    until: number;
    value: readonly T[];
};
export class FaultyFakePort implements AmazonAdsPort {
    readonly calls: PortCall[] = [];
    private override: FaultConfig | undefined;
    private readonly rng: Rng;
    private readonly fingerprints = new Map<string, string>();
    private readonly batchIdentities = new Map<string, Set<string>>();
    private readonly successes = new Map<string, Map<string, BatchResult>>();
    private readonly campaignStale = new Map<string, Stale<Campaign>[]>();
    private readonly targetStale = new Map<string, Stale<Target>[]>();
    private readonly readSnapshots = new Map<string, unknown>();
    private readonly keywordStale = new Map<string, Stale<Target>[]>();
    private readonly negativeStale = new Map<string, Stale<NegativeKeyword>[]>();
    private readonly invisible = new Map<string, number>();
    constructor(private readonly inner: InMemoryFakePort, private readonly clock: Clock, seed: string | number, private readonly faults: FaultConfig | (() => FaultConfig) = {}) {
        this.rng = new Rng(seed);
    }
    configure(config: FaultConfig): void {
        this.override = config;
    }
    private config(): FaultConfig {
        return this.override ?? (typeof this.faults === 'function' ? this.faults() : this.faults);
    }
    private async call<T>(op: string, key: string, payload: unknown, write: boolean, fn: (rng: Rng, config: FaultConfig) => Promise<T>): Promise<T> {
        const log: PortCall = { time: this.clock.now(), op, idempotencyKey: key, outcome: 'pending' }, rng = this.rng.fork(`${op}:${key}:${this.calls.length}`);
        this.calls.push(log);
        try {
            if (!key.trim())
                throw new Error('IDEMPOTENCY_KEY_REQUIRED');
            if (write) {
                const k = JSON.stringify([op, key]), fingerprint = hash(payload), old = this.fingerprints.get(k);
                if (old && old !== fingerprint)
                    throw new Error('IDEMPOTENCY_KEY_REUSED');
                this.fingerprints.set(k, fingerprint);
            }
            const c = this.config(), now = Date.parse(log.time), window = c.rateLimit?.windows?.find(w => now >= Date.parse(w.from) && now < Date.parse(w.to));
            if (window || rng.uniform() < (c.rateLimit?.probability ?? 0))
                throw new RateLimitError(window?.retryAfterSeconds ?? c.rateLimit?.retryAfterSeconds ?? 60);
            if (rng.uniform() < (c.serverError?.probability ?? 0))
                throw new TransientServerError();
            const result = await fn(rng, c);
            log.outcome = Array.isArray(result) && result.some(x => typeof x === 'object' && x && 'ok' in x && !x.ok) ? 'partial' : 'ok';
            if (Array.isArray(result) && result.every(x => typeof x === 'object' && x && 'ok' in x))
                log.results = structuredClone(result) as BatchResult[];
            return result;
        }
        catch (e) {
            log.outcome = e instanceof Error ? e.message : String(e);
            throw e;
        }
    }
    private async batch<T>(op: string, items: readonly T[], key: string, id: (x: T) => string, write: (x: T, k: string) => Promise<readonly BatchResult[]>, campaign: (x: T) => string, kind: 'keyword' | 'negative', create = false): Promise<readonly BatchResult[]> {
        const batchKey=JSON.stringify([op,key]),identities=this.batchIdentities.get(batchKey);if(identities&&items.some(item=>!identities.has(id(item))))throw new Error('IDEMPOTENCY_KEY_REUSED');if(!identities)this.batchIdentities.set(batchKey,new Set(items.map(id)));
        for(const item of items){const k=JSON.stringify([op,key,id(item)]),fingerprint=hash(item),old=this.fingerprints.get(k);if(old&&old!==fingerprint)throw new Error('IDEMPOTENCY_KEY_REUSED');this.fingerprints.set(k,fingerprint);}
        return this.call(op, key, null, true, async (r, c) => {
            const cacheKey = JSON.stringify([op, key]), success = this.successes.get(cacheKey) ?? new Map<string, BatchResult>();
            this.successes.set(cacheKey, success);
            const partial = r.uniform() < (c.partialBatch?.probability ?? 0), results: BatchResult[] = [];
            for (const [i, item] of items.entries()) {
                const identity = id(item), cached = success.get(identity);
                if (cached) {
                    results.push(cached);
                    continue;
                }
                // SPEC-AMBIGUITY: partialBatch probability selects a faulty batch; each element then fails independently at 50%.
                if (partial && r.fork(`element:${i}`).uniform() < .5) {
                    results.push({ id: identity, ok: false, error: 'TRANSIENT_ITEM_ERROR' });
                    continue;
                }
                const cid = campaign(item), targetBefore = await this.inner.listTargets(cid), now = Date.parse(this.clock.now()), before = kind === 'keyword' ? await this.inner.listKeywords(cid, 'snapshot') : await this.inner.listNegatives(cid, 'snapshot');
                try {
                    await write(item, `${key}:${identity}`);
                    const result = { id: identity, ok: true };
                    success.set(identity, result);
                    results.push(result);
                    if (c.staleReadMinutes) {
                        const targetList=this.targetStale.get(cid)??[];targetList.push({until:now+c.staleReadMinutes*60000,value:targetBefore});this.targetStale.set(cid,targetList);
                        if (kind === 'keyword') {
                            const list = this.keywordStale.get(cid) ?? [];
                            list.push({ until: now + c.staleReadMinutes * 60000, value: before as Target[] });
                            this.keywordStale.set(cid, list);
                        }
                        else {
                            const list = this.negativeStale.get(cid) ?? [];
                            list.push({ until: now + c.staleReadMinutes * 60000, value: before as NegativeKeyword[] });
                            this.negativeStale.set(cid, list);
                        }
                    }
                    if (create && c.createSucceedsButInvisible)
                        this.invisible.set(identity, now + c.createSucceedsButInvisible * 60000);
                }
                catch (e) {
                    results.push({ id: identity, ok: false, error: e instanceof Error ? e.message : String(e) });
                }
            }
            return results;
        });
    }
    updateCampaign(c: Campaign, key: string): Promise<void> {
        return this.call('updateCampaign', key, c, true, async (_,config) => {
            const before=await this.inner.getCampaigns([c.id]);
            await this.inner.updateCampaign(c,key);
            if(config.staleReadMinutes&&before.length){const list=this.campaignStale.get(c.id)??[];list.push({until:Date.parse(this.clock.now())+config.staleReadMinutes*60000,value:before});this.campaignStale.set(c.id,list);}
        });
    }
    updatePlacement(id: string, pct: number, key: string): Promise<void> {
        return this.call('updatePlacement', key, [id, pct], true, async (_,config) => {const before=await this.inner.getCampaigns([id]);await this.inner.updatePlacement(id,pct,key);if(config.staleReadMinutes){const list=this.campaignStale.get(id)??[];list.push({until:Date.parse(this.clock.now())+config.staleReadMinutes*60000,value:before});this.campaignStale.set(id,list);}});
    }
    updateTargets(items: readonly TargetUpdate[], endpoint: TargetEndpoint, key: string): Promise<readonly BatchResult[]> {
        return this.batch(`updateTargets:${endpoint}`, items, key, u => u.target.id, (u, k) => this.inner.updateTargets([u], endpoint, k), u => u.target.campaignId, 'keyword');
    }
    createKeywords(items: readonly Target[], key: string): Promise<readonly BatchResult[]> {
        return this.batch('createKeywords', items, key, t => t.id, (t, k) => this.inner.createKeywords([t], k), t => t.campaignId, 'keyword', true);
    }
    createNegatives(items: readonly NegativeKeyword[], key: string): Promise<readonly BatchResult[]> {
        return this.batch('createNegatives', items, key, n => JSON.stringify([n.campaignId, n.adGroupId ?? null, n.text, n.matchType]), (n, k) => this.inner.createNegatives([n], k), n => n.campaignId, 'negative');
    }
    private snapshot<T>(identity:string,key:string,value:T):T {
        if(key.startsWith('daily:')){if(!this.readSnapshots.has(identity))this.readSnapshots.set(identity,structuredClone(value));return structuredClone(this.readSnapshots.get(identity)) as T;}
        return structuredClone(value);
    }
    getCampaigns(ids:readonly string[],key='read'):Promise<readonly Campaign[]> {
        return this.call('getCampaigns',key,ids,false,async()=>{
            const values:Campaign[]=[];for(const id of ids){const stale=(this.campaignStale.get(id)??[]).filter(x=>x.until>Date.parse(this.clock.now()));this.campaignStale.set(id,stale);values.push(...(stale[0]?.value??await this.inner.getCampaigns([id])));}
            return this.snapshot(`campaigns:${key}`,key,values);
        });
    }
    listTargets(id:string,key='read'):Promise<readonly Target[]> {
        return this.call('listTargets',key,id,false,async()=>{const stale=(this.targetStale.get(id)??[]).filter(x=>x.until>Date.parse(this.clock.now()));this.targetStale.set(id,stale);return this.snapshot(`targets:${id}:${key}`,key,stale[0]?.value??await this.inner.listTargets(id));});
    }
    listKeywords(id: string, key: string): Promise<readonly Target[]> {
        return this.call('listKeywords', key, id, false, async () => {
            const now = Date.parse(this.clock.now()), stale = (this.keywordStale.get(id) ?? []).filter(x => x.until > now);
            this.keywordStale.set(id, stale);
            const values = stale[0]?.value ?? await this.inner.listKeywords(id, key);
            return structuredClone(values.filter(t => (this.invisible.get(t.id) ?? 0) <= now));
        });
    }
    listNegatives(id: string, key: string): Promise<readonly NegativeKeyword[]> {
        return this.call('listNegatives', key, id, false, async () => {
            const now = Date.parse(this.clock.now()), stale = (this.negativeStale.get(id) ?? []).filter(x => x.until > now);
            this.negativeStale.set(id, stale);
            return structuredClone(stale[0]?.value ?? await this.inner.listNegatives(id, key));
        });
    }
}
