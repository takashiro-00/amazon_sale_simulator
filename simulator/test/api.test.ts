import { it, expect } from "vitest";
import { stripTags, applyTag, canOverwrite } from "../src/api/tags.js";
import { InMemoryFakePort, idempotencyKey } from "../src/api/port.js";
import { usd } from "../src/domain/money.js";
it("G7 normalizes tag text and never lowers ALERT severity", () => {
  expect(stripTags("[MANAGE] [alert]  Camp A")).toBe("Camp A");
  expect(stripTags("[ manage ] Camp [ ALERT ] A")).toBe("Camp A");
  expect(canOverwrite("ALERT", "MANAGE")).toBe(false);
  expect(applyTag("[ALERT] Camp A", "MANAGE")).toBe("[ALERT] Camp A");
  expect(applyTag("[MANAGE][ALERT] Camp A", "ALERT")).toBe("[ALERT] Camp A");
});
it("G7 rejects duplicate creations and wrong endpoint, replays idempotently", async () => {
  const port = new InMemoryFakePort();
  const k = {
    id: "k",
    campaignId: "c",
    adGroupId: "g",
    kind: "KEYWORD" as const,
    text: "  My   Keyword",
    matchType: "EXACT" as const,
    status: "ENABLED" as const,
    bidMicros: usd("1"),
  };
  await port.createKeywords([k], "key1");
  await port.createKeywords([k], "key1");
  expect(await port.listKeywords("c", "read")).toHaveLength(1);
  await expect(
    port.createKeywords([{ ...k, id: "k2", text: "my keyword" }], "key2"),
  ).rejects.toThrow("DUPLICATE");
  await expect(
    port.updateTargets(
      [{ target: k, bidMicros: usd("1.1") }],
      "/sp/targets",
      "key3",
    ),
  ).rejects.toThrow("WRONG_ENDPOINT");
  for (const kind of ["AUTO", "PRODUCT"] as const)
    await expect(
      port.updateTargets(
        [{ target: { ...k, kind }, bidMicros: usd("1.1") }],
        "/sp/keywords",
        kind,
      ),
    ).rejects.toThrow("WRONG_ENDPOINT");
  const neg = {
    campaignId: "c",
    text: "X  Y",
    matchType: "NEGATIVE_EXACT" as const,
  };
  await port.createNegatives([neg], "neg1");
  await expect(
    port.createNegatives([{ ...neg, text: " x y " }], "neg2"),
  ).rejects.toThrow("DUPLICATE");
  expect(idempotencyKey("r", "e", "R11")).toBe(idempotencyKey("r", "e", "R11"));
  expect(idempotencyKey("r", "e", "R11")).not.toBe(
    idempotencyKey("r", "e", "R12"),
  );
});
it("G7 validates whole batches atomically and rejects changed idempotent payloads", async () => {
  const p = new InMemoryFakePort();
  const k = {
    id: "k",
    campaignId: "c",
    adGroupId: "g",
    kind: "KEYWORD" as const,
    text: "Key",
    matchType: "EXACT" as const,
    status: "ENABLED" as const,
    bidMicros: usd("1"),
  };
  await expect(
    p.createKeywords([k, { ...k, id: "k2", text: " key " }], "badbatch"),
  ).rejects.toThrow("DUPLICATE");
  expect(await p.listKeywords("c", "read")).toEqual([]);
  await p.createKeywords([k], "create");
  await expect(
    p.createKeywords([{ ...k, text: "new" }], "create"),
  ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
  const listed = await p.listKeywords("c", "read");
  expect(listed[0]?.text).toBe("Key");
  await p.updateCampaign(
    {
      id: "c",
      asin: "A",
      type: "MANUAL",
      targetingKind: "KEYWORD",
      status: "ENABLED",
      dailyBudgetMicros: usd("10"),
      name: "C",
      topOfSearchPct: 0,
    },
    "campaign",
  );
  await p.updatePlacement("c", 900, "placement");
  await expect(p.updatePlacement("c", 901, "placement2")).rejects.toThrow(
    "INVALID_TOS_PCT",
  );
  await p.updateTargets(
    [{ target: k, bidMicros: usd("1.1") }],
    "/sp/keywords",
    "update",
  );
  expect((await p.listKeywords("c", "read"))[0]?.bidMicros).toBe(usd("1.1"));
});
it("G7 scopes idempotency to each operation and requires keys on reads", async () => {
  const p = new InMemoryFakePort();
  const c = {
    id: "c",
    asin: "A",
    type: "MANUAL" as const,
    targetingKind: "KEYWORD" as const,
    status: "ENABLED" as const,
    dailyBudgetMicros: usd("10"),
    name: "C",
    topOfSearchPct: 0,
  };
  const key = idempotencyKey("run", "c", "R09");
  await p.updateCampaign(c, key);
  await expect(p.updatePlacement("c", 10, key)).resolves.toBeUndefined();
  await expect(p.listKeywords("c", "")).rejects.toThrow(
    "IDEMPOTENCY_KEY_REQUIRED",
  );
  await expect(p.listNegatives("c", "")).rejects.toThrow(
    "IDEMPOTENCY_KEY_REQUIRED",
  );
});
it('returns a result for every valid batch element including idempotent replay',async()=>{
 const p=new InMemoryFakePort(),t={id:'batch-t',campaignId:'c',adGroupId:'g',kind:'KEYWORD' as const,text:'batch',matchType:'EXACT' as const,status:'ENABLED' as const,bidMicros:usd('.70')};
 expect(await p.createKeywords([t],'create-result')).toEqual([{id:t.id,ok:true}]);
 expect(await p.createKeywords([t],'create-result')).toEqual([{id:t.id,ok:true}]);
 expect(await p.updateTargets([{target:t,bidMicros:usd('.80')}],'/sp/keywords','update-result')).toEqual([{id:t.id,ok:true}]);
 expect(await p.createNegatives([{campaignId:'c',text:'negative',matchType:'NEGATIVE_EXACT'}],'negative-result')).toMatchObject([{ok:true}]);
});
