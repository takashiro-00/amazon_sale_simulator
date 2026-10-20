import type { RuleId, RuleGroup, RuleDefinition } from "../engine/types.js";
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
      appliesG6: G6_RULES.includes(id),
      evaluate: () => null,
    }),
  ),
);
