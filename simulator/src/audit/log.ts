import { createHash } from 'node:crypto';
import type { Instant, MarketplaceDate } from "../time/clock.js";
import type { ObjectRef, RuleId } from "../engine/types.js";
export type AuditOutcome =
  | "MATCHED"
  | "SKIPPED_NOOP"
  | "SKIPPED_CROSS_LEVEL"
  | "NOT_ELIGIBLE"
  | "NOT_SCHEDULED"
  | "BLOCKED_BY_TAG"
  | "BLOCKED_BY_COOLDOWN"
  | "BLOCKED_BY_GRACE"
  | "ERROR";
export interface AuditEvent {
  readonly runId: string;
  readonly at: Instant;
  readonly marketplaceDate: MarketplaceDate;
  readonly objectRef: ObjectRef;
  readonly ruleId: RuleId;
  readonly outcome: AuditOutcome;
  readonly reasons: readonly string[];
  readonly inputsSnapshot: unknown;
  readonly before: unknown;
  readonly after: unknown;
  readonly paramsVersion: string;
}
export function immutableSnapshot<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v !== null && typeof v === "object") {
      for (const child of Object.values(v)) freeze(child);
      Object.freeze(v);
    }
  };
  freeze(clone);
  return clone;
}
/** In-memory append-only log. Serialization performs no file I/O. */
export class AuditLog {
  readonly #events: AuditEvent[] = [];
  append(event: AuditEvent): void {
    this.#events.push(immutableSnapshot(event));
  }
  get events(): readonly AuditEvent[] {
    return Object.freeze([...this.#events]);
  }
  *[Symbol.iterator](): IterableIterator<AuditEvent> { yield* this.#events; }
  *jsonLines(): IterableIterator<string> { for (const event of this) yield JSON.stringify(event) + "\n"; }
  serializeJSONL(): string {
    return (
      this.#events.map((event) => JSON.stringify(event)).join("\n") +
      (this.#events.length ? "\n" : "")
    );
  }
}

/** Sparse recursive field diff; null represents an absent field on either side. */
export function stateDiff(before: unknown, after: unknown): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const left: Record<string, unknown> = {}, right: Record<string, unknown> = {};
  const a = (before ?? {}) as Record<string, unknown>, b = (after ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (a[key] && b[key] && typeof a[key] === 'object' && typeof b[key] === 'object' && !Array.isArray(a[key]) && !Array.isArray(b[key])) {
      const nested = stateDiff(a[key], b[key]); left[key] = nested.before; right[key] = nested.after;
    } else { left[key] = a[key] ?? null; right[key] = b[key] ?? null; }
  }
  return {before:left, after:right};
}
export function compactDecision(d: import('../engine/types.js').Decision) {
  const {before, after, ...metadata} = d;
  return {...metadata, ...stateDiff(before, after)};
}

export function configHash(config: import("../../config/defaults.js").SimConfig): string { return createHash("sha256").update(JSON.stringify(config)).digest("hex"); }
