import type { Instant, MarketplaceDate } from "../time/clock.js";
import type { ObjectRef, RuleId } from "../engine/types.js";
export type AuditOutcome =
  | "MATCHED"
  | "SKIPPED_NOOP"
  | "NOT_ELIGIBLE"
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
  serializeJSONL(): string {
    return (
      this.#events.map((event) => JSON.stringify(event)).join("\n") +
      (this.#events.length ? "\n" : "")
    );
  }
}
