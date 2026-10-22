import { scaleMoney, micros, type Micros } from "./money.js";
import { hash } from "./hash.js";
import type { SimConfig } from "../../config/defaults.js";
export interface ProductParams {
  readonly asin: string;
  readonly priceMicros: Micros;
  readonly breakEvenAcos: number;
  readonly expCvr?: number;
}
export interface DerivedThresholds {
  readonly breakEvenAcos: number;
  readonly T_win: number;
  readonly T_ok: number;
  readonly T_bad: number;
  readonly CPA_target: Micros;
  readonly Spend_zero: Micros;
  readonly N2: number;
  readonly N3: number;
  readonly N2h: number;
  readonly N17: number;
  readonly Bid_min: Micros;
  readonly Bid_max_raw: Micros;
  readonly Bid_max: Micros;
  readonly paramsVersion: string;
}
export function deriveThresholds(
  params: ProductParams,
  config: SimConfig,
): { thresholds: Readonly<DerivedThresholds>; warnings: readonly string[] } {
  const c = config.product,
    cv = params.expCvr ?? c.expCvr;
  if (
    !Number.isFinite(cv) ||
    cv <= 0 ||
    cv > 1 ||
    !Number.isFinite(params.breakEvenAcos) ||
    params.breakEvenAcos <= 0 ||
    !Number.isSafeInteger(params.priceMicros) ||
    params.priceMicros <= 0
  )
    throw new RangeError("Invalid product parameters");
  // SPEC-AMBIGUITY: Normalize decimal rate arithmetic to avoid treating 36% as below 0.9 × 40%.
  const rate = (n: number) => Number(n.toFixed(12));
  const T_win = rate(Math.min(c.winCap, c.winFactor * params.breakEvenAcos)),
    T_ok = rate(Math.min(c.okCap, c.okFactor * params.breakEvenAcos)),
    T_bad = rate(Math.min(c.badCap, c.badFactor * params.breakEvenAcos));
  const CPA_target = scaleMoney(params.priceMicros, T_win),
    N2 = Math.ceil(c.n2Orders / cv);
  const Bid_max_raw = micros(
    Math.min(config.bid.max, scaleMoney(params.priceMicros, cv * T_ok)),
  );
  return {
    thresholds: Object.freeze({
      breakEvenAcos: params.breakEvenAcos,
      T_win,
      T_ok,
      T_bad,
      CPA_target,
      Spend_zero: micros(
        Math.max(
          c.spendMin,
          Math.min(c.spendMax, scaleMoney(CPA_target, c.spendFactor)),
        ),
      ),
      N2,
      N3: Math.ceil(c.n3Orders / cv),
      N2h: Math.ceil(N2 / 2),
      N17: Math.ceil(c.n17Factor * N2),
      Bid_min: config.bid.min,
      Bid_max_raw,
      Bid_max: micros(Math.max(config.bid.min, Bid_max_raw)),
      paramsVersion: hash({
        asin: params.asin,
        priceMicros: params.priceMicros,
        breakEvenAcos: params.breakEvenAcos,
        expCvr: cv,
        product: config.product,
        bid: config.bid,
      }),
    }),
    warnings:
      Bid_max_raw < config.bid.min ? ["PRODUCT_INFEASIBLE_AT_MIN_BID"] : [],
  };
}
