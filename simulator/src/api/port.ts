import type { Campaign, Target, NegativeKeyword } from "../domain/entities.js";
import type { Micros } from "../domain/money.js";
import type { RuleId } from "../engine/types.js";
import { hash } from "../domain/hash.js";
import { normalizeText } from "./tags.js";
export type TargetEndpoint = "/sp/keywords" | "/sp/targets";
export interface TargetUpdate {
    readonly target: Target;
    readonly bidMicros: Micros;
}
export interface BatchResult {
    readonly id: string;
    readonly ok: boolean;
    readonly error?: string;
}
export interface AmazonAdsPort {
    getCampaigns(ids: readonly string[], key?: string): Promise<readonly Campaign[]>;
    listTargets(campaignId: string, key?: string): Promise<readonly Target[]>;
    updateCampaign(campaign: Campaign, idempotencyKey: string): Promise<void>;
    updateTargets(updates: readonly TargetUpdate[], endpoint: TargetEndpoint, idempotencyKey: string): Promise<readonly BatchResult[]>;
    createKeywords(keywords: readonly Target[], idempotencyKey: string): Promise<readonly BatchResult[]>;
    createNegatives(negatives: readonly NegativeKeyword[], idempotencyKey: string): Promise<readonly BatchResult[]>;
    listKeywords(campaignId: string, idempotencyKey: string): Promise<readonly Target[]>;
    listNegatives(campaignId: string, idempotencyKey: string): Promise<readonly NegativeKeyword[]>;
    updatePlacement(campaignId: string, topOfSearchPct: number, idempotencyKey: string): Promise<void>;
}
export function idempotencyKey(runId: string, entityId: string, ruleId: RuleId): string {
    return hash([runId, entityId, ruleId]);
}
function validatePct(pct: number): void {
    if (!Number.isInteger(pct) || pct < 0 || pct > 900)
        throw new RangeError("INVALID_TOS_PCT");
}
function keywordKey(k: Target): string {
    return JSON.stringify([
        k.campaignId,
        k.adGroupId,
        normalizeText(k.text),
        k.matchType,
    ]);
}
function negativeKey(n: NegativeKeyword): string {
    return JSON.stringify([
        n.campaignId,
        n.adGroupId ?? null,
        normalizeText(n.text),
        n.matchType,
    ]);
}
/** Offline fake only. No adapter, network transport, credentials, or SDK. */
export class InMemoryFakePort implements AmazonAdsPort {
    readonly idempotencyLog: { operation: string; key: string }[] = [];
    readonly #readSnapshots = new Map<string, unknown>();
    readonly #campaigns = new Map<string, Campaign>();
    readonly #keywords = new Map<string, Target>();
    readonly #targets = new Map<string, Target>();
    readonly #negatives = new Map<string, NegativeKeyword>();
    readonly #keys = new Map<string, string>();
    private replay(key: string, operation: string, payload: unknown): boolean {
        if (!key.trim())
            throw new Error("IDEMPOTENCY_KEY_REQUIRED");
        const fingerprint = hash([operation, payload]), old = this.#keys.get(JSON.stringify([operation, key]));
        if (old !== undefined && old !== fingerprint)
            throw new Error("IDEMPOTENCY_KEY_REUSED");
        return old === fingerprint;
    }
    private remember(key: string, operation: string, payload: unknown): void {
        this.#keys.set(JSON.stringify([operation, key]), hash([operation, payload]));
        this.idempotencyLog.push({operation,key});
    }
    async getCampaigns(ids: readonly string[], key = ''): Promise<readonly Campaign[]> {
        return this.snapshotRead(`campaigns:${key}`, key, [...this.#campaigns.values()].filter(c => ids.includes(c.id)));
    }
    async listTargets(campaignId: string, key = ''): Promise<readonly Target[]> {
        return this.snapshotRead(`targets:${campaignId}:${key}`, key, [...this.#keywords.values(), ...this.#targets.values()].filter(t => t.campaignId === campaignId));
    }
    private snapshotRead<T>(identity: string, key: string, value: T): T {
        // SPEC-AMBIGUITY: daily read keys freeze the initial remote view for crash replay.
        if (key.startsWith('daily:')) {
            if (!this.#readSnapshots.has(identity)) this.#readSnapshots.set(identity, structuredClone(value));
            return structuredClone(this.#readSnapshots.get(identity)) as T;
        }
        return structuredClone(value);
    }
    async updateCampaign(campaign: Campaign, key: string): Promise<void> {
        if (this.replay(key, "updateCampaign", campaign))
            return;
        validatePct(campaign.topOfSearchPct);
        this.#campaigns.set(campaign.id, structuredClone(campaign));
        this.remember(key, "updateCampaign", campaign);
    }
    async updateTargets(updates: readonly TargetUpdate[], endpoint: TargetEndpoint, key: string): Promise<readonly BatchResult[]> {
        if (this.replay(key, "updateTargets", [updates, endpoint]))
            return updates.map((u) => ({ id: u.target.id, ok: true }));
        for (const u of updates) {
            if ((u.target.kind === "KEYWORD" ? "/sp/keywords" : "/sp/targets") !==
                endpoint)
                throw new Error("WRONG_ENDPOINT");
            if (!Number.isSafeInteger(u.bidMicros) ||
                u.bidMicros <= 0 ||
                u.bidMicros % 10000 !== 0)
                throw new Error("INVALID_BID");
        }
        for (const u of updates)
            (u.target.kind === "KEYWORD" ? this.#keywords : this.#targets).set(u.target.id, { ...structuredClone(u.target), bidMicros: u.bidMicros });
        this.remember(key, "updateTargets", [updates, endpoint]);
        return updates.map((u) => ({ id: u.target.id, ok: true }));
    }
    async listKeywords(campaignId: string, idempotencyKey: string): Promise<readonly Target[]> {
        if (!idempotencyKey.trim())
            throw new Error("IDEMPOTENCY_KEY_REQUIRED");
        return structuredClone([...this.#keywords.values()].filter((k) => k.campaignId === campaignId));
    }
    async listNegatives(campaignId: string, idempotencyKey: string): Promise<readonly NegativeKeyword[]> {
        if (!idempotencyKey.trim())
            throw new Error("IDEMPOTENCY_KEY_REQUIRED");
        return structuredClone([...this.#negatives.values()].filter((k) => k.campaignId === campaignId));
    }
    async createKeywords(keywords: readonly Target[], key: string): Promise<readonly BatchResult[]> {
        if (this.replay(key, "createKeywords", keywords))
            return keywords.map((k) => ({ id: k.id, ok: true }));
        const seen = new Set([...this.#keywords.values()].map(keywordKey)), ids = new Set(this.#keywords.keys());
        for (const k of keywords) {
            if (k.kind !== "KEYWORD")
                throw new Error("WRONG_ENDPOINT");
            const normalized = keywordKey(k);
            if (seen.has(normalized) || ids.has(k.id))
                throw new Error("DUPLICATE_KEYWORD");
            seen.add(normalized);
            ids.add(k.id);
        }
        for (const k of keywords)
            this.#keywords.set(k.id, structuredClone(k));
        this.remember(key, "createKeywords", keywords);
        return keywords.map((k) => ({ id: k.id, ok: true }));
    }
    async createNegatives(negatives: readonly NegativeKeyword[], key: string): Promise<readonly BatchResult[]> {
        if (this.replay(key, "createNegatives", negatives))
            return negatives.map((n) => ({ id: negativeKey(n), ok: true }));
        const seen = new Set(this.#negatives.keys());
        for (const n of negatives) {
            const normalized = negativeKey(n);
            if (seen.has(normalized))
                throw new Error("DUPLICATE_NEGATIVE");
            seen.add(normalized);
        }
        for (const n of negatives)
            this.#negatives.set(negativeKey(n), structuredClone(n));
        this.remember(key, "createNegatives", negatives);
        return negatives.map((n) => ({ id: negativeKey(n), ok: true }));
    }
    async updatePlacement(campaignId: string, pct: number, key: string): Promise<void> {
        if (this.replay(key, "updatePlacement", [campaignId, pct]))
            return;
        validatePct(pct);
        const c = this.#campaigns.get(campaignId);
        if (!c)
            throw new Error("CAMPAIGN_NOT_FOUND");
        this.#campaigns.set(campaignId, { ...c, topOfSearchPct: pct });
        this.remember(key, "updatePlacement", [campaignId, pct]);
    }
}
