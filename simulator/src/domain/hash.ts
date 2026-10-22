/** Stable non-cryptographic identity hash. No ambient state or platform APIs. */
export function hash(value: unknown): string {
  let h = 14695981039346656037n;
  for (const c of JSON.stringify(value)) {
    h ^= BigInt(c.codePointAt(0)!);
    h = BigInt.asUintN(64, h * 1099511628211n);
  }
  return h.toString(16).padStart(16, "0");
}
