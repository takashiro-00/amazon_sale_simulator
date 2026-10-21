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
  readonly sourceTargetId?: string;
  readonly query?: string;
}
export interface PendingHarvest {
 readonly query: string; readonly sourceCampaignId: string; readonly sourceTargetId: string; readonly destCampaignId: string; readonly keywordId: string; readonly createdAt: string;
}
export interface EngineState {
 readonly negatives?: Readonly<Record<string, readonly import("../domain/entities.js").NegativeKeyword[]>>;
 readonly pendingHarvests?: readonly PendingHarvest[];
 readonly verifiedHarvests?: readonly PendingHarvest[];
  readonly campaigns: Readonly<Record<string, Campaign>>;
  readonly campaignMemory: Readonly<Record<string, CampaignMemory>>;
  readonly targets: Readonly<Record<string, TargetMemory>>;
  /** Entity snapshots are read-only; all bid writes must use targets[id].baseBidMicros. */ readonly targetEntities: Readonly<
    Record<string, Target>
  >;
}
export interface NotificationLog {
 readonly at: string; readonly campaignId: string;
 readonly type: "API_WRITE_FAILED" | "DRIFT_DETECTED" | "R06_PAUSED" | "R06B_PAUSED" | "R08_ALERT" | "PRODUCT_INFEASIBLE" | "R13_PAUSED" | "R15_VERIFY_TIMEOUT" | "EMPTY_BID_RANGE";
 readonly details: Readonly<Record<string, unknown>>;
}
export interface Proposal {
 readonly outboundTargets?: readonly import("../api/port.js").TargetUpdate[];
  readonly notifications?: readonly NotificationLog[];
  readonly proposedState: EngineState;
  readonly reasons?: readonly string[];
}
export interface Decision {
 readonly measurementReads?: readonly import("../data/metrics.js").MetricRead[];
 readonly zeroOrderWindows?: readonly {entity: string; from: string; to: string}[];
 readonly asOf?: string;
 readonly reasons?: readonly string[];
 readonly outboundTargets?: readonly import("../api/port.js").TargetUpdate[];
  readonly runId: string;
  readonly objectRef: ObjectRef;
  readonly ruleId: RuleId;
  readonly before: EngineState;
  readonly after: EngineState;
  readonly baseBidTargetIds: readonly string[];
  readonly paramsVersion: string;
}
export interface RuleContext {
 readonly submittedBids?: Readonly<Record<string,number>>;
 readonly harvestDestinations?: Readonly<Record<string,string>>;
  readonly metrics: import("../data/metrics.js").MetricsReader;
  readonly thresholdsByCampaign: Readonly<Record<string, DerivedThresholds>>;
  readonly today: string;
  readonly notify: (event: NotificationLog) => void;
  readonly manualReenabledCampaignIds?: readonly string[];
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
  readonly diagnose?: (ref: ObjectRef, ctx: RuleContext) => readonly string[];
  readonly evaluate: (ref: ObjectRef, ctx: RuleContext) => Proposal | null;
}
