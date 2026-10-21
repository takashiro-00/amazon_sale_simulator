import type { Micros } from "./money.js";
export type Status = "ENABLED" | "PAUSED";
export type TargetingKind = "KEYWORD" | "PRODUCT" | "AUTO";
export type Placement = "TOP" | "REST_OF_SEARCH" | "PRODUCT_PAGE";
export type Hour =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23;
export interface Campaign {
  readonly id: string;
  readonly asin: string;
  readonly type: "AUTO" | "MANUAL";
  readonly targetingKind: TargetingKind;
  readonly status: Status;
  readonly dailyBudgetMicros: Micros;
  readonly name: string;
  /** Integer 0..900, validated at the port boundary. */ readonly topOfSearchPct: number;
}
export interface AdGroup {
  readonly id: string;
  readonly campaignId: string;
  readonly name: string;
  readonly status: Status;
}
export interface Target {
  readonly id: string;
  readonly campaignId: string;
  readonly adGroupId: string;
  readonly kind: TargetingKind;
  readonly matchType?: "EXACT" | "PHRASE" | "BROAD";
  readonly text: string;
  readonly status: Status;
  readonly bidMicros: Micros;
}
export interface SearchTerm {
  readonly campaignId: string;
  readonly adGroupId: string;
  readonly sourceTargetId: string;
  readonly query: string;
}
export interface NegativeKeyword {
    readonly harvestedAt?: string;
  readonly harvestKeywordId?: string;
  readonly campaignId: string;
  readonly adGroupId?: string;
  readonly text: string;
  readonly matchType: "NEGATIVE_EXACT";
}
