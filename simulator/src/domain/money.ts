declare const microsBrand: unique symbol;
export type Micros = number & { readonly [microsBrand]: "Micros" };
export const MICROS_PER_USD = 1_000_000;
export const MICROS_PER_CENT = 10_000;
export function micros(value: number): Micros {
  if (!Number.isSafeInteger(value))
    throw new RangeError("Money must be safe integer micros");
  return value as Micros;
}
function fraction(value: string): readonly [bigint, bigint] {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || !(match[2] || match[3]))
    throw new RangeError("Invalid decimal");
  const digits = (match[2] || "0") + (match[3] || "");
  const exp = Number(match[4] || 0) - (match[3]?.length || 0);
  if (Math.abs(exp) > 100) throw new RangeError("Decimal exponent too large");
  const n = BigInt(digits) * (match[1] === "-" ? -1n : 1n);
  return exp >= 0 ? [n * 10n ** BigInt(exp), 1n] : [n, 10n ** BigInt(-exp)];
}
function divideRounded(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  return sign * ((n * sign + d / 2n) / d);
}
export function usd(value: string | number): Micros {
  const [n, d] = fraction(String(value));
  return micros(Number(divideRounded(n * BigInt(MICROS_PER_USD), d)));
}
/** Decimal rendering avoids floating-point currency arithmetic. */
export function toUsd(value: Micros): string {
  const n = BigInt(value);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}
/** Ratios may be numbers; multiplication is rational and rounded once to micros. */
export function scaleMoney(
  value: Micros,
  ratio: number,
  mode: "nearest" | "floor" | "ceil" = "nearest",
): Micros {
  if (!Number.isFinite(ratio)) throw new RangeError("Invalid ratio");
  const [n, d] = fraction(String(ratio));
  const product = BigInt(value) * n;
  const q =
    mode === "nearest"
      ? divideRounded(product, d)
      : mode === "floor"
        ? product >= 0n
          ? product / d
          : (product - d + 1n) / d
        : product >= 0n
          ? (product + d - 1n) / d
          : product / d;
  return micros(Number(q));
}
export function roundBidToCent(value: Micros): Micros {
  return micros(
    Number(divideRounded(BigInt(value), BigInt(MICROS_PER_CENT))) *
      MICROS_PER_CENT,
  );
}
