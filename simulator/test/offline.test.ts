import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
}
it("enforces offline source and absence of ambient wall-clock reads", () => {
  for (const file of files(resolve("src")).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(
      /\bfetch\s*\(|(?:from\s*|import\s*\()\s*['"](?:node:)?(?:https?|fetch|@aws-sdk|amazon)[^'"]*['"]/,
    );
    expect(source, file).not.toMatch(/\bMath\.random\s*\(/);
    expect(source, file).not.toMatch(/\bDate\.now\s*\(/);
    if (!file.endsWith("/time/clock.ts"))
      expect(source, file).not.toMatch(/\bDate\.now\s*\(|\bnew\s+Date\s*\(/);
  }
});
