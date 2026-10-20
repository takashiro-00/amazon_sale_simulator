import { micros, usd, roundBidToCent, scaleMoney, type Micros } from "./money.js";
import type { SimConfig } from "../../config/defaults.js";
function check(index: number, config: SimConfig): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= config.budgetLadder.length
  )
    throw new RangeError("Invalid budget tier");
}
export function stepUp(index: number, config: SimConfig): number {
  check(index, config);
  return Math.min(index + 1, config.budgetLadder.length - 1);
}
export function stepDown(index: number, config: SimConfig): number {
  check(index, config);
  return Math.max(index - 1, 0);
}

/** R04B: multiply, round to cents, then cap at $25. */
export function budgetMultiplyStep(currentMicros: Micros): Micros {
  // Spec ladder is authoritative: $20.74 advances to $24.88, despite
  // multiplying the already-rounded amount yielding $24.89.
  const ladder = ["12", "14.40", "17.28", "20.74", "24.88", "25"].map(usd);
  const tier = ladder.indexOf(currentMicros);
  if (tier >= 0) return ladder[Math.min(tier + 1, ladder.length - 1)]!;
  return micros(Math.min(usd("25"), roundBidToCent(scaleMoney(currentMicros, 1.2))));
}
