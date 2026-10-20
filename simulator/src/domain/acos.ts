import type { Micros } from "./money.js";
export type Acos =
  | { readonly kind: "undefined" }
  | { readonly kind: "infinite" }
  | { readonly kind: "value"; readonly v: number };
export function acos(spend: Micros, sales: Micros): Acos {
  if (spend < 0 || sales < 0) throw new RangeError("Negative ACoS metric");
  return spend === 0
    ? { kind: "undefined" }
    : sales === 0
      ? { kind: "infinite" }
      : { kind: "value", v: spend / sales };
}
export const acosLt = (a: Acos, n: number): boolean =>
  a.kind === "value" && a.v < n;
export const acosLte = (a: Acos, n: number): boolean =>
  a.kind === "value" && a.v <= n;
export const acosGt = (a: Acos, n: number): boolean =>
  a.kind === "infinite" || (a.kind === "value" && a.v > n);
export const acosGte = (a: Acos, n: number): boolean =>
  a.kind === "infinite" || (a.kind === "value" && a.v >= n);
