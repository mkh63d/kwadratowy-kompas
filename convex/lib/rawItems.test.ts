import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { insertEntry } from "./entries";
import type { RawItemState } from "./enums";
import type { AppErrorCode } from "./errors";
import {
  IRRELEVANT_DISCARD_MIN_CONFIDENCE,
  transitionRawItem,
} from "./rawItems";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

function newTest() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newTest>;
type Extra = NonNullable<Parameters<typeof transitionRawItem>[3]>;
type Extraction = NonNullable<Extra["extraction"]>;
type RawItem = Doc<"rawItems">;

const ITEM = {
  sourceKey: "manual",
  externalId: "ext-1",
  text: "Nabór do programu grantowego w Łodzi",
  url: "https://example.org/nabor",
  postedAt: 1_700_000_000_000,
  receivedAt: 1_700_000_100_000,
  contentHash: "a".repeat(64),
};

const ANALYSIS = {
  provider: "mock",
  model: "mock-1",
  processedAt: 1_700_000_200_000,
};
const RELEVANT: Extraction = {
  ok: true,
  ...ANALYSIS,
  relevant: true,
  confidence: 0.95,
};
const IRRELEVANT: Extraction = {
  ok: true,
  ...ANALYSIS,
  relevant: false,
  confidence: 0.9,
};
const IRRELEVANT_AT_MIN: Extraction = { ...IRRELEVANT, confidence: 0.7 };
const LOW_CONFIDENCE: Extraction = {
  ok: true,
  ...ANALYSIS,
  relevant: false,
  confidence: 0.4,
};
const JUST_BELOW_MIN: Extraction = { ...LOW_CONFIDENCE, confidence: 0.69 };
const FAILED: Extraction = { ok: false, ...ANALYSIS, errorCode: "timeout" };

async function setup(): Promise<T> {
  const t = newTest();
  await t.mutation(internal.sources.seed.run, {});
  return t;
}

async function appErrorCode(promise: Promise<unknown>): Promise<AppErrorCode> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to be rejected");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: AppErrorCode }>).data.code;
}

function newEntry(t: T): Promise<Id<"entries">> {
  return t.run((ctx) =>
    insertEntry(ctx, {
      type: "dofinansowanie",
      title: "Grant dla startupów",
      summary: "Do 50 000 zł na MVP.",
      sourceKey: "manual",
    }),
  );
}

function transition(
  t: T,
  id: Id<"rawItems"> | null,
  to: RawItemState,
  extra?: Extra,
): Promise<RawItem> {
  return t.run(async (ctx) => {
    const resultId = await transitionRawItem(ctx, id, to, extra);
    return (await ctx.db.get(resultId))!;
  });
}

function readAll(t: T): Promise<RawItem[]> {
  return t.run((ctx) => ctx.db.query("rawItems").collect());
}

function expectSetIffRules(item: RawItem) {
  expect(item.entryId !== undefined).toBe(item.state === "processed");
  expect(item.discardReason !== undefined).toBe(item.state === "discarded");
}

function fieldsOf(item: RawItem) {
  const { _id, _creationTime, ...fields } = item;
  void _id;
  void _creationTime;
  return fields;
}

type Path =
  "waiting_ai" | "processed" | "manual" | "discarded" | "manual_after_failure";

async function itemIn(t: T, path: Path): Promise<RawItem> {
  const waiting = await transition(t, null, "waiting_ai", { item: ITEM });
  switch (path) {
    case "waiting_ai":
      return waiting;
    case "processed":
      return transition(t, waiting._id, "processed", {
        entryId: await newEntry(t),
        extraction: RELEVANT,
      });
    case "manual":
      return transition(t, waiting._id, "manual");
    case "manual_after_failure":
      return transition(t, waiting._id, "manual", { extraction: FAILED });
    case "discarded":
      return transition(t, waiting._id, "discarded", {
        discardReason: "irrelevant",
        extraction: IRRELEVANT,
      });
  }
}

async function expectRefused(
  t: T,
  id: Id<"rawItems"> | null,
  to: RawItemState,
  extra: Extra | undefined,
  code: AppErrorCode,
) {
  const before = await readAll(t);
  expect(await appErrorCode(transition(t, id, to, extra))).toBe(code);
  expect(await readAll(t)).toStrictEqual(before);
}

describe("IRRELEVANT_DISCARD_MIN_CONFIDENCE", () => {
  it("is 0.7", () => {
    expect(IRRELEVANT_DISCARD_MIN_CONFIDENCE).toBe(0.7);
  });
});

describe("transitionRawItem: allowed transitions (§10.5)", () => {
  it("(insert) → waiting_ai stores the item without extraction, entryId or discardReason", async () => {
    const t = await setup();
    const item = await transition(t, null, "waiting_ai", { item: ITEM });
    expect(fieldsOf(item)).toStrictEqual({ ...ITEM, state: "waiting_ai" });
    expectSetIffRules(item);
  });

  it("(insert) → waiting_ai keeps submittedBy and ignores lifecycle fields on a wider item", async () => {
    const t = await setup();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const entryId = await newEntry(t);
    const wide = {
      ...ITEM,
      submittedBy: userId,
      state: "processed",
      entryId,
      discardReason: "dismissed",
      extraction: RELEVANT,
    };
    const item = await transition(t, null, "waiting_ai", { item: wide });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      submittedBy: userId,
      state: "waiting_ai",
    });
  });

  it("(insert) → discarded (prefilter) stores the item without extraction", async () => {
    const t = await setup();
    const item = await transition(t, null, "discarded", {
      item: ITEM,
      discardReason: "prefilter",
    });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "discarded",
      discardReason: "prefilter",
    });
    expectSetIffRules(item);
  });

  it("waiting_ai → processed sets entryId and an { ok: true } extraction", async () => {
    const t = await setup();
    const waiting = await itemIn(t, "waiting_ai");
    const entryId = await newEntry(t);
    const item = await transition(t, waiting._id, "processed", {
      entryId,
      extraction: RELEVANT,
    });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "processed",
      entryId,
      extraction: RELEVANT,
    });
    expectSetIffRules(item);
  });

  it.each([
    ["well above", IRRELEVANT],
    ["exactly at", IRRELEVANT_AT_MIN],
  ])(
    "waiting_ai → discarded (irrelevant) with confidence %s the minimum keeps { ok: true }",
    async (_label, extraction) => {
      const t = await setup();
      const waiting = await itemIn(t, "waiting_ai");
      const item = await transition(t, waiting._id, "discarded", {
        discardReason: "irrelevant",
        extraction,
      });
      expect(fieldsOf(item)).toStrictEqual({
        ...ITEM,
        state: "discarded",
        discardReason: "irrelevant",
        extraction,
      });
      expectSetIffRules(item);
    },
  );

  it.each([
    ["an extraction error", FAILED],
    ["relevant:false with low confidence", LOW_CONFIDENCE],
    ["relevant:false just below the minimum", JUST_BELOW_MIN],
  ])(
    "waiting_ai → manual after %s keeps that extraction",
    async (_label, extraction) => {
      const t = await setup();
      const waiting = await itemIn(t, "waiting_ai");
      const item = await transition(t, waiting._id, "manual", { extraction });
      expect(fieldsOf(item)).toStrictEqual({
        ...ITEM,
        state: "manual",
        extraction,
      });
      expectSetIffRules(item);
    },
  );

  it("waiting_ai → manual from the ai backlog (onlyNew) has no extraction", async () => {
    const t = await setup();
    const waiting = await itemIn(t, "waiting_ai");
    const item = await transition(t, waiting._id, "manual", {});
    expect(fieldsOf(item)).toStrictEqual({ ...ITEM, state: "manual" });
    expectSetIffRules(item);
  });

  it("manual → processed sets entryId and keeps the earlier extraction", async () => {
    const t = await setup();
    const manual = await itemIn(t, "manual_after_failure");
    const entryId = await newEntry(t);
    const item = await transition(t, manual._id, "processed", { entryId });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "processed",
      entryId,
      extraction: FAILED,
    });
    expectSetIffRules(item);
  });

  it("manual → processed without an earlier extraction stays without one", async () => {
    const t = await setup();
    const manual = await itemIn(t, "manual");
    const entryId = await newEntry(t);
    const item = await transition(t, manual._id, "processed", { entryId });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "processed",
      entryId,
    });
  });

  it("manual → discarded (dismissed) keeps the earlier extraction", async () => {
    const t = await setup();
    const manual = await itemIn(t, "manual_after_failure");
    const item = await transition(t, manual._id, "discarded", {
      discardReason: "dismissed",
    });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "discarded",
      discardReason: "dismissed",
      extraction: FAILED,
    });
    expectSetIffRules(item);
  });

  it("discarded → manual clears discardReason and keeps the extraction", async () => {
    const t = await setup();
    const discarded = await itemIn(t, "discarded");
    const item = await transition(t, discarded._id, "manual");
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "manual",
      extraction: IRRELEVANT,
    });
    expectSetIffRules(item);
  });

  it("discarded (prefilter) → manual has no extraction", async () => {
    const t = await setup();
    const discarded = await transition(t, null, "discarded", {
      item: ITEM,
      discardReason: "prefilter",
    });
    const item = await transition(t, discarded._id, "manual", {});
    expect(fieldsOf(item)).toStrictEqual({ ...ITEM, state: "manual" });
    expectSetIffRules(item);
  });

  it("a restored item can be processed by hand afterwards", async () => {
    const t = await setup();
    const discarded = await itemIn(t, "discarded");
    await transition(t, discarded._id, "manual");
    const entryId = await newEntry(t);
    const item = await transition(t, discarded._id, "processed", { entryId });
    expect(fieldsOf(item)).toStrictEqual({
      ...ITEM,
      state: "processed",
      entryId,
      extraction: IRRELEVANT,
    });
  });
});

describe("transitionRawItem: forbidden transitions throw conflict and write nothing", () => {
  const ENTRY = "entry" as const;
  const forbidden: [Path | "insert", RawItemState, Extra | typeof ENTRY][] = [
    ["insert", "processed", ENTRY],
    ["insert", "manual", {}],
    ["waiting_ai", "waiting_ai", {}],
    ["manual", "waiting_ai", {}],
    ["manual", "manual", {}],
    ["discarded", "waiting_ai", {}],
    ["discarded", "processed", ENTRY],
    ["discarded", "discarded", { discardReason: "dismissed" }],
    ["processed", "waiting_ai", {}],
    ["processed", "processed", ENTRY],
    ["processed", "manual", {}],
    ["processed", "discarded", { discardReason: "dismissed" }],
  ];

  it.each(forbidden)("%s → %s", async (from, to, extraSpec) => {
    const t = await setup();
    const id = from === "insert" ? null : (await itemIn(t, from))._id;
    const extra: Extra =
      extraSpec === ENTRY
        ? { entryId: await newEntry(t), extraction: RELEVANT }
        : extraSpec;
    if (from === "insert") extra.item = ITEM;
    await expectRefused(t, id, to, extra, "conflict");
  });

  it("an unknown raw item id is not_found and writes nothing", async () => {
    const t = await setup();
    const gone = await itemIn(t, "waiting_ai");
    await t.run((ctx) => ctx.db.delete(gone._id));
    await expectRefused(t, gone._id, "manual", {}, "not_found");
  });
});

describe("transitionRawItem: a wrong extra for an allowed transition is invalid and writes nothing", () => {
  type Case = [
    string,
    Path | "insert",
    RawItemState,
    (entryId: Id<"entries">) => Extra,
  ];
  const cases: Case[] = [
    [
      "(insert) → waiting_ai without the item",
      "insert",
      "waiting_ai",
      () => ({}),
    ],
    [
      "(insert) → waiting_ai with a discardReason",
      "insert",
      "waiting_ai",
      () => ({ item: ITEM, discardReason: "prefilter" }),
    ],
    [
      "(insert) → waiting_ai with an extraction",
      "insert",
      "waiting_ai",
      () => ({ item: ITEM, extraction: RELEVANT }),
    ],
    [
      "(insert) → waiting_ai with an entryId",
      "insert",
      "waiting_ai",
      (entryId) => ({ item: ITEM, entryId }),
    ],
    [
      "(insert) → discarded without a reason",
      "insert",
      "discarded",
      () => ({ item: ITEM }),
    ],
    [
      "(insert) → discarded as irrelevant",
      "insert",
      "discarded",
      () => ({ item: ITEM, discardReason: "irrelevant" }),
    ],
    [
      "(insert) → discarded without the item",
      "insert",
      "discarded",
      () => ({ discardReason: "prefilter" }),
    ],
    [
      "waiting_ai → processed without entryId",
      "waiting_ai",
      "processed",
      () => ({ extraction: RELEVANT }),
    ],
    [
      "waiting_ai → processed without extraction",
      "waiting_ai",
      "processed",
      (entryId) => ({ entryId }),
    ],
    [
      "waiting_ai → processed with a failed extraction",
      "waiting_ai",
      "processed",
      (entryId) => ({ entryId, extraction: FAILED }),
    ],
    [
      "waiting_ai → processed with relevant:false",
      "waiting_ai",
      "processed",
      (entryId) => ({ entryId, extraction: LOW_CONFIDENCE }),
    ],
    [
      "waiting_ai → processed with a discardReason",
      "waiting_ai",
      "processed",
      (entryId) => ({
        entryId,
        extraction: RELEVANT,
        discardReason: "irrelevant",
      }),
    ],
    [
      "waiting_ai → discarded below the minimum confidence",
      "waiting_ai",
      "discarded",
      () => ({ discardReason: "irrelevant", extraction: JUST_BELOW_MIN }),
    ],
    [
      "waiting_ai → discarded with relevant:true",
      "waiting_ai",
      "discarded",
      () => ({ discardReason: "irrelevant", extraction: RELEVANT }),
    ],
    [
      "waiting_ai → discarded with a failed extraction",
      "waiting_ai",
      "discarded",
      () => ({ discardReason: "irrelevant", extraction: FAILED }),
    ],
    [
      "waiting_ai → discarded without extraction",
      "waiting_ai",
      "discarded",
      () => ({ discardReason: "irrelevant" }),
    ],
    [
      "waiting_ai → discarded as dismissed",
      "waiting_ai",
      "discarded",
      () => ({ discardReason: "dismissed", extraction: IRRELEVANT }),
    ],
    [
      "waiting_ai → discarded with an entryId",
      "waiting_ai",
      "discarded",
      (entryId) => ({
        discardReason: "irrelevant",
        extraction: IRRELEVANT,
        entryId,
      }),
    ],
    [
      "waiting_ai → manual with relevant:true",
      "waiting_ai",
      "manual",
      () => ({ extraction: RELEVANT }),
    ],
    [
      "waiting_ai → manual with relevant:false at the minimum confidence",
      "waiting_ai",
      "manual",
      () => ({ extraction: IRRELEVANT_AT_MIN }),
    ],
    [
      "waiting_ai → manual with a discardReason",
      "waiting_ai",
      "manual",
      () => ({ discardReason: "dismissed" }),
    ],
    [
      "waiting_ai → manual with an entryId",
      "waiting_ai",
      "manual",
      (entryId) => ({ entryId }),
    ],
    ["manual → processed without entryId", "manual", "processed", () => ({})],
    [
      "manual → processed with a new extraction",
      "manual",
      "processed",
      (entryId) => ({ entryId, extraction: RELEVANT }),
    ],
    ["manual → discarded without a reason", "manual", "discarded", () => ({})],
    [
      "manual → discarded as irrelevant",
      "manual",
      "discarded",
      () => ({ discardReason: "irrelevant" }),
    ],
    [
      "manual → discarded with a new extraction",
      "manual",
      "discarded",
      () => ({ discardReason: "dismissed", extraction: IRRELEVANT }),
    ],
    [
      "discarded → manual with a discardReason",
      "discarded",
      "manual",
      () => ({ discardReason: "dismissed" }),
    ],
    [
      "discarded → manual with an extraction",
      "discarded",
      "manual",
      () => ({ extraction: FAILED }),
    ],
    [
      "discarded → manual with an entryId",
      "discarded",
      "manual",
      (entryId) => ({ entryId }),
    ],
  ];

  it.each(cases)("%s", async (_label, from, to, makeExtra) => {
    const t = await setup();
    const id = from === "insert" ? null : (await itemIn(t, from))._id;
    await expectRefused(t, id, to, makeExtra(await newEntry(t)), "invalid");
  });

  it("an entryId that does not exist is invalid", async () => {
    const t = await setup();
    const waiting = await itemIn(t, "waiting_ai");
    const entryId = await newEntry(t);
    await t.run((ctx) => ctx.db.delete(entryId));
    await expectRefused(
      t,
      waiting._id,
      "processed",
      { entryId, extraction: RELEVANT },
      "invalid",
    );
  });

  it("a NaN confidence fits neither discarded nor manual", async () => {
    const t = await setup();
    const waiting = await itemIn(t, "waiting_ai");
    const extraction: Extraction = { ...IRRELEVANT, confidence: Number.NaN };
    await expectRefused(
      t,
      waiting._id,
      "discarded",
      { discardReason: "irrelevant", extraction },
      "invalid",
    );
    await expectRefused(t, waiting._id, "manual", { extraction }, "invalid");
  });
});
