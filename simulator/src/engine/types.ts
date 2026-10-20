import type { Campaign, Target } from "../domain/entities.js";
import type {
  CampaignMemory,
  TargetMemory,
  CampaignTag,
} from "../domain/state.js";
import type { DerivedThresholds } from "../domain/params.js";
import type { Clock, Schedule } from "../time/clock.js";
import type { SimConfig } from "../../config/defaults.js";
import type { AuditLog } from "../audit/log.js";
import type { CooldownKind } from "./cooldown.js";
export type RuleId =
  | "R01"
  | "R02"
  | "R03"
  | "R04"
  | "R04B"
  | "R05"
  | "R06"
  | "R06B"
  | "R07"
  | "R08"
  | "R09"
  | "R10"
  | "R11"
  | "R12"
  | "R13"
  | "R14"
  | "R15"
  | "R16"
  | "R17"
  | "R18"
  | "R19"
  | "R20"
  | "R21"
  | "R21B";
export type RuleGroup =
  | "CAMPAIGN"
  | "TARGET"
  | "SEARCHTERM"
  | "PLACEMENT"
  | "HOURLY";
export interface ObjectRef {
  readonly group: RuleGroup;
  readonly id: string;
  readonly campaignId?: string;
}
export interface EngineState {
  readonly campaigns: Readonly<Record<string, Campaign>>;
  readonly campaignMemory: Readonly<Record<string, CampaignMemory>>;
  readonly targets: Readonly<Record<string, TargetMemory>>;
  /** Entity snapshots are read-only; all bid writes must use targets[id].baseBidMicros. */ readonly targetEntities: Readonly<
    Record<string, Target>
  >;
}
export interface Proposal {
  readonly proposedState: EngineState;
  readonly reasons?: readonly string[];
}
export interface Decision {
  readonly runId: string;
  readonly objectRef: ObjectRef;
  readonly ruleId: RuleId;
  readonly before: EngineState;
  readonly after: EngineState;
  readonly baseBidTargetIds: readonly string[];
  readonly paramsVersion: string;
}
export interface RuleContext {
  readonly runId: string;
  readonly clock: Clock;
  readonly config: SimConfig;
  readonly state: EngineState;
  readonly thresholds: Readonly<Record<string, DerivedThresholds>>;
  readonly audit: AuditLog;
  readonly decisions: Decision[];
  readonly paramsVersion: string;
}
export interface RuleDefinition {
  readonly id: RuleId;
  readonly group: RuleGroup;
  readonly schedule: Schedule | null;
  readonly cooldownGate: CooldownKind | null;
  readonly cooldownSets: ReadonlyArray<{ readonly kind: CooldownKind; readonly days: number }>;
  readonly windowDays: import("../data/windows.js").WindowSpec | null;
  readonly blockedByTag: readonly CampaignTag[];
  readonly appliesG6: boolean;
  readonly evaluate: (ref: ObjectRef, ctx: RuleContext) => Proposal | null;
}
