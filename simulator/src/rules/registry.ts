import { evaluate as R20 } from "./hourly/r20.js";
import { evaluate as R21 } from "./hourly/r21.js";
import { evaluate as R21B } from "./hourly/r21b.js";
import { evaluate as R15 } from "./searchTerm/r15.js";
import { evaluate as R16 } from "./searchTerm/r16.js";
import { evaluate as R17 } from "./searchTerm/r17.js";
import { diagnose as searchDiagnose } from "./searchTerm/shared.js";
import { diagnose as harvestDiagnose } from "./searchTerm/r15.js";
import { evaluate as R18, diagnose as placementDiagnose } from "./placement/r18.js";
import { evaluate as R19 } from "./placement/r19.js";
import { evaluate as R10 } from "./target/r10.js";
import { evaluate as R11 } from "./target/r11.js";
import { evaluate as R12 } from "./target/r12.js";
import { evaluate as R13 } from "./target/r13.js";
import { evaluate as R14 } from "./target/r14.js";
import { evaluate as R01 } from "./campaign/r01.js";
import { evaluate as R02 } from "./campaign/r02.js";
import { evaluate as R03 } from "./campaign/r03.js";
import { evaluate as R04 } from "./campaign/r04.js";
import { evaluate as R04B } from "./campaign/r04b.js";
import { evaluate as R05 } from "./campaign/r05.js";
import { evaluate as R06 } from "./campaign/r06.js";
import { evaluate as R06B } from "./campaign/r06b.js";
import { evaluate as R07 } from "./campaign/r07.js";
import { evaluate as R08 } from "./campaign/r08.js";
import { evaluate as R09 } from "./campaign/r09.js";
import type { RuleId, RuleGroup, RuleDefinition, ObjectRef, RuleContext } from "../engine/types.js";
import { G6_RULES } from "../guards/bid.js";
const IDS: readonly RuleId[] = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R04B",
  "R05",
  "R06",
  "R06B",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R21",
  "R21B",
];
function group(id: RuleId): RuleGroup {
  if (["R10", "R11", "R12", "R13", "R14"].includes(id)) return "TARGET";
  if (["R15", "R16", "R17"].includes(id)) return "SEARCHTERM";
  if (["R18", "R19"].includes(id)) return "PLACEMENT";
  if (["R20", "R21", "R21B"].includes(id)) return "HOURLY";
  return "CAMPAIGN";
}
// SPEC-AMBIGUITY: 22 conflicts with R01..R21 + R04B/R06B/R21B (24). Preserve every explicit ID (registryIds).

// SPEC-AMBIGUITY: R07/R08/R09 run every 3 days; no cooldown gate unless tagRulesGatedByCooldown is enabled.
const metadata: Record<RuleId, Pick<RuleDefinition, "schedule" | "cooldownGate" | "cooldownSets" | "windowDays">> = {
  R01: { schedule: "daily", cooldownGate: null, cooldownSets: [], windowDays: null },
  R02: { schedule: "daily", cooldownGate: "budget", cooldownSets: [{ kind: "budget", days: 2 }], windowDays: { kind: "rolling", days: 3 } },
  R03: { schedule: "daily", cooldownGate: "budget", cooldownSets: [{ kind: "budget", days: 2 }], windowDays: { kind: "rolling", days: 3 } },
  R04: { schedule: "daily", cooldownGate: "budget", cooldownSets: [{ kind: "budget", days: 2 }], windowDays: { kind: "rolling", days: 3 } },
  R04B: { schedule: "daily", cooldownGate: "budget", cooldownSets: [{ kind: "budget", days: 3 }], windowDays: { kind: "rolling", days: 7 } },
  R05: { schedule: "daily", cooldownGate: "budget", cooldownSets: [{ kind: "budget", days: 2 }], windowDays: { kind: "rolling", days: 3 } },
  R06: { schedule: "daily", cooldownGate: null, cooldownSets: [], windowDays: { kind: "post", days: 14 } },
  R06B: { schedule: "daily", cooldownGate: null, cooldownSets: [{ kind: "budget", days: 2 }, { kind: "bid", days: 3 }], windowDays: { kind: "rolling", days: 14 } },
  R07: { schedule: "every3Days", cooldownGate: null, cooldownSets: [{ kind: "budget", days: 3 }, { kind: "bid", days: 3 }], windowDays: { kind: "rolling", days: 7 } },
  R08: { schedule: "every3Days", cooldownGate: null, cooldownSets: [{ kind: "budget", days: 3 }], windowDays: { kind: "rolling", days: 3 } },
  R09: { schedule: "every3Days", cooldownGate: null, cooldownSets: [{ kind: "budget", days: 3 }, { kind: "bid", days: 3 }], windowDays: { kind: "rolling", days: 7 } },
  R10: { schedule: "daily", cooldownGate: "bid", cooldownSets: [{ kind: "bid", days: 3 }], windowDays: { kind: "rolling", days: 14 } },
  R11: { schedule: "daily", cooldownGate: "bid", cooldownSets: [{ kind: "bid", days: 3 }], windowDays: { kind: "post", days: 30 } },
  R12: { schedule: "daily", cooldownGate: "bid", cooldownSets: [{ kind: "bid", days: 5 }], windowDays: { kind: "post", days: 14 } },
  R13: { schedule: "daily", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 14 } },
  R14: { schedule: "daily", cooldownGate: "bid", cooldownSets: [{ kind: "bid", days: 7 }], windowDays: { kind: "rolling", days: 7 } },
  R15: { schedule: "weeklySunday", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 14 } },
  R16: { schedule: "daily", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 14 } },
  R17: { schedule: "daily", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 14 } },
  R18: { schedule: "daily", cooldownGate: "placement", cooldownSets: [{ kind: "placement", days: 7 }], windowDays: { kind: "rolling", days: 14 } },
  R19: { schedule: "daily", cooldownGate: "placement", cooldownSets: [{ kind: "placement", days: 7 }], windowDays: { kind: "rolling", days: 14 } },
  R20: { schedule: "weekly", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 28 } },
  R21: { schedule: "weekly", cooldownGate: null, cooldownSets: [], windowDays: { kind: "rolling", days: 28 } },
  R21B: { schedule: "hourBoundary", cooldownGate: null, cooldownSets: [], windowDays: null },
};
export const registry: readonly RuleDefinition[] = Object.freeze(
  IDS.map((id) =>
    Object.freeze({
      id,
      group: group(id),
      ...metadata[id],
      blockedByTag: Object.freeze([
        ...(["R02", "R03", "R04", "R04B", "R10", "R14", "R18", "R21"].includes(id) ? ["MANAGE", "ALERT"] as const : []),
        ...(group(id) === "CAMPAIGN" && id !== "R01" ? ["PAUSED_AUTO"] as const : []),
      ]),
      ...(["R16","R17"].includes(id) ? { diagnose: searchDiagnose } : id === "R15" ? { diagnose: harvestDiagnose } : {}),
      ...(id === "R18" ? { diagnose: placementDiagnose } : {}),
      appliesG6: G6_RULES.includes(id),
      evaluate: (ref: ObjectRef, ctx: RuleContext) => {
        if (!ctx.state || !ctx.metrics) return null;
        if (group(id) === "TARGET" && !ctx.state.targets[ref.id]) return null;
        if (group(id) === "PLACEMENT" && !ctx.state.campaignMemory[ref.id]) return null;
        if (group(id) === "SEARCHTERM" && (!ref.sourceTargetId || !ctx.state.campaigns[ref.campaignId!])) return null;
        return (({R01,R02,R03,R04,R04B,R05,R06,R06B,R07,R08,R09,R10,R11,R12,R13,R14,R15,R16,R17,R18,R19,R20,R21,R21B} as Partial<Record<RuleId, RuleDefinition["evaluate"]>>)[id] ?? (() => null))(ref, ctx);
      },
    }),
  ),
);
