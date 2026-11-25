import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { insertEntry, type NewEntry } from "./entries";
import { publicEntryValidator, toPublicEntry } from "./publicEntry";
import { setSwitch } from "./switches";
import { isSiteOnly } from "./visibility";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

const SWP = "startupywpolsce-wa";
const NOW = Date.UTC(2027, 0, 15);

// Spec §10.2, written out here so that a field added to the DTO has to be added twice.
const PUBLIC_KEYS = [
  "amountMaxPln",
  "amountText",
  "archiveReason",
  "archived",
  "attributions",
  "body",
  "cost",
  "deadline",
  "endsAt",
  "featured",
  "isOnline",
  "location",
  "organizer",
  "program",
  "promos",
  "publishedAt",
  "siteOnly",
  "slug",
  "sponsored",
  "stages",
  "startsAt",
  "summary",
  "tags",
  "title",
  "type",
  "url",
];

function newTest() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newTest>;

async function setup(): Promise<T> {
  const t = newTest();
  await t.mutation(internal.sources.seed.run, {});
  return t;
}

// publishEntry lands in T10, so the published state is patched in directly.
function insertPublished(
  t: T,
  entry: Partial<NewEntry> = {},
  patch: Partial<Doc<"entries">> = {},
): Promise<Id<"entries">> {
  return t.run(async (ctx) => {
    const id = await insertEntry(ctx, {
      type: "event",
      title: "Demo day",
      summary: "Pitch przed inwestorami.",
      sourceKey: "manual",
      ...entry,
    });
    await ctx.db.patch(id, {
      status: "published",
      publishedAt: NOW,
      ...patch,
    });
    return id;
  });
}

function publicOf(t: T, id: Id<"entries">) {
  return t.run(async (ctx) => toPublicEntry(ctx, (await ctx.db.get(id))!));
}

function patchEntryDoc(
  t: T,
  id: Id<"entries">,
  patch: Partial<Doc<"entries">>,
) {
  return t.run((ctx) => ctx.db.patch(id, patch));
}

function patchSource(t: T, key: string, patch: Partial<Doc<"sources">>) {
  return t.run(async (ctx) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    await ctx.db.patch(source!._id, patch);
  });
}

function addSource(t: T, source: Partial<Doc<"sources">> & { key: string }) {
  return t.run((ctx) =>
    ctx.db.insert("sources", {
      name: source.key,
      kind: "scraper",
      noCrosspost: false,
      newsSiteOnly: false,
      ...source,
    }),
  );
}

function setPromo(t: T, key: string, enabled: boolean) {
  return t.run((ctx) =>
    setSwitch(ctx, { key: `promo.source:${key}`, enabled }),
  );
}

async function insertEverything(t: T): Promise<Id<"entries">> {
  await patchSource(t, SWP, { promoLine: "Dołącz do społeczności." });
  const refs = await t.run(async (ctx) => ({
    createdBy: await ctx.db.insert("users", {}),
    programId: await ctx.db.insert("programs", {
      name: "Akcelerator Łódź",
      slug: "akcelerator-lodz",
      kind: "accelerator",
      url: "https://example.org/program",
    }),
    rawItemId: await ctx.db.insert("rawItems", {
      sourceKey: SWP,
      externalId: "1",
      text: "raw",
      receivedAt: NOW,
      contentHash: "hash",
      state: "processed",
    }),
  }));
  const target = await insertPublished(t);
  await t.run((ctx) => setSwitch(ctx, { key: "sponsoring", enabled: true }));
  return insertPublished(
    t,
    {
      ...refs,
      type: "news",
      sourceKey: SWP,
      sourceRef: "ref-1",
      body: "Treść",
      organizer: "Fundacja",
      location: "Łódź",
      isOnline: false,
      url: "https://example.org",
      tags: ["ai"],
      stages: ["idea", "mvp"],
      amountText: "do 50 000 zł",
      amountMaxPln: 50_000,
      cost: "free",
      startsAt: NOW + 1000,
      endsAt: NOW + 2000,
      deadline: NOW + 500,
      sponsored: true,
      discordChannelOverride: "123",
      discordPing: true,
    },
    {
      status: "archived",
      archiveReason: "cancelled",
      withdrawReason: "error",
      featuredUntil: Number.MAX_SAFE_INTEGER,
      mergedInto: target,
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("toPublicEntry fields", () => {
  it("returns exactly the §10.2 keys for an entry with every field set", async () => {
    const t = await setup();
    const result = await publicOf(t, await insertEverything(t));

    expect(Object.keys(result).sort()).toStrictEqual(PUBLIC_KEYS);
    expect(Object.keys(publicEntryValidator.fields).sort()).toStrictEqual(
      PUBLIC_KEYS,
    );
    expect(result).toStrictEqual({
      slug: "demo-day-2",
      type: "news",
      title: "Demo day",
      summary: "Pitch przed inwestorami.",
      body: "Treść",
      organizer: "Fundacja",
      location: "Łódź",
      isOnline: false,
      url: "https://example.org",
      tags: ["ai"],
      stages: ["idea", "mvp"],
      amountText: "do 50 000 zł",
      amountMaxPln: 50_000,
      cost: "free",
      startsAt: NOW + 1000,
      endsAt: NOW + 2000,
      deadline: NOW + 500,
      publishedAt: NOW,
      archived: true,
      archiveReason: "cancelled",
      featured: true,
      sponsored: true,
      attributions: [{ name: "StartupywPolsce.pl" }],
      promos: [
        {
          sourceName: "StartupywPolsce.pl",
          line: "Dołącz do społeczności.",
        },
      ],
      program: { slug: "akcelerator-lodz", name: "Akcelerator Łódź" },
      siteOnly: true,
    });
  });

  it("does not copy a property the DTO does not list", async () => {
    const t = await setup();
    const id = await insertPublished(t);
    const keys = await t.run(async (ctx) => {
      const entry = (await ctx.db.get(id))!;
      const widened = { ...entry, internalNote: "secret" };
      return Object.keys(await toPublicEntry(ctx, widened));
    });
    expect(keys).not.toContain("internalNote");
  });

  it("omits absent optional fields", async () => {
    const t = await setup();
    const result = await publicOf(t, await insertPublished(t));
    expect(result).toStrictEqual({
      slug: "demo-day",
      type: "event",
      title: "Demo day",
      summary: "Pitch przed inwestorami.",
      tags: [],
      publishedAt: NOW,
      archived: false,
      featured: false,
      sponsored: false,
      attributions: [],
      promos: [],
      siteOnly: false,
    });
  });

  it("is featured only while featuredUntil is in the future", async () => {
    const until = NOW + 60_000;
    vi.useFakeTimers({ now: NOW });
    const t = await setup();
    const id = await insertPublished(t, {}, { featuredUntil: until });
    await expect(publicOf(t, id)).resolves.toMatchObject({ featured: true });

    vi.setSystemTime(until);
    await expect(publicOf(t, id)).resolves.toMatchObject({ featured: false });
  });

  it("omits a program that no longer exists", async () => {
    const t = await setup();
    const programId = await t.run((ctx) =>
      ctx.db.insert("programs", { name: "P", slug: "p", kind: "other" }),
    );
    const id = await insertPublished(t, { programId });
    await t.run((ctx) => ctx.db.delete(programId));
    expect(await publicOf(t, id)).not.toHaveProperty("program");
  });

  it("refuses an entry that was never published", async () => {
    const t = await setup();
    const id = await insertPublished(
      t,
      {},
      { status: "pending", publishedAt: undefined },
    );
    const error = await publicOf(t, id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data.code).toBe("invalid");
  });
});

describe("attributions (D26)", () => {
  it("are read live from sources for an existing entry", async () => {
    const t = await setup();
    const id = await insertPublished(t, { sourceKey: SWP });
    await expect(publicOf(t, id)).resolves.toMatchObject({
      attributions: [{ name: "StartupywPolsce.pl" }],
    });

    for (const url of ["https://example.org/a", "https://example.org/b"]) {
      await patchSource(t, SWP, {
        attribution: { name: "StartupywPolsce.pl", url },
      });
      expect((await publicOf(t, id)).attributions).toStrictEqual([
        { name: "StartupywPolsce.pl", url },
      ]);
    }
  });

  it("follow attributionSourceKeys, once per key", async () => {
    const t = await setup();
    await addSource(t, { key: "parp", attribution: { name: "PARP" } });
    const id = await insertPublished(t);
    await patchEntryDoc(t, id, {
      attributionSourceKeys: [SWP, "parp", SWP],
    });
    expect((await publicOf(t, id)).attributions).toStrictEqual([
      { name: "StartupywPolsce.pl" },
      { name: "PARP" },
    ]);
  });

  it("skip keys without a source or without attribution", async () => {
    const t = await setup();
    const id = await insertPublished(t);
    await patchEntryDoc(t, id, {
      attributionSourceKeys: ["gone", "Not A Key:x", "", "form", SWP],
    });
    await expect(publicOf(t, id)).resolves.toMatchObject({
      attributions: [{ name: "StartupywPolsce.pl" }],
      promos: [],
    });
  });
});

describe("promos (promo.source:<key>)", () => {
  async function swpEntry(t: T) {
    await patchSource(t, SWP, { promoLine: "Promo SwP" });
    return insertPublished(t, { sourceKey: SWP });
  }

  it("are on by default, empty while the switch is off, and attribution stays", async () => {
    const t = await setup();
    const id = await swpEntry(t);
    const on = [{ sourceName: "StartupywPolsce.pl", line: "Promo SwP" }];
    expect((await publicOf(t, id)).promos).toStrictEqual(on);

    await setPromo(t, SWP, false);
    await expect(publicOf(t, id)).resolves.toMatchObject({
      promos: [],
      attributions: [{ name: "StartupywPolsce.pl" }],
    });

    await setPromo(t, SWP, true);
    expect((await publicOf(t, id)).promos).toStrictEqual(on);
  });

  it("are switched per source", async () => {
    const t = await setup();
    const id = await swpEntry(t);
    await addSource(t, {
      key: "parp",
      name: "PARP RSS",
      promoLine: "Promo PARP",
    });
    await patchEntryDoc(t, id, { attributionSourceKeys: [SWP, "parp"] });

    await setPromo(t, SWP, false);
    expect((await publicOf(t, id)).promos).toStrictEqual([
      { sourceName: "PARP RSS", line: "Promo PARP" },
    ]);
  });

  it("skip an empty promo line", async () => {
    const t = await setup();
    const id = await swpEntry(t);
    await patchSource(t, SWP, { promoLine: "" });
    expect((await publicOf(t, id)).promos).toStrictEqual([]);
  });

  it("are hidden, without failing the read, for a key no switch can name", async () => {
    const t = await setup();
    await addSource(t, {
      key: "Bad_Key",
      attribution: { name: "Bad" },
      promoLine: "Unswitchable",
    });
    const id = await insertPublished(t, { sourceKey: "Bad_Key" });
    await expect(publicOf(t, id)).resolves.toMatchObject({
      attributions: [{ name: "Bad" }],
      promos: [],
    });
  });
});

describe("siteOnly (D22)", () => {
  function siteOnlyAgrees(t: T, id: Id<"entries">) {
    return t.run(async (ctx) => {
      const entry = (await ctx.db.get(id))!;
      const { siteOnly } = await toPublicEntry(ctx, entry);
      expect(siteOnly).toBe(await isSiteOnly(ctx, entry));
      return siteOnly;
    });
  }

  it("is true for SwP news and false after a type change, attribution unchanged", async () => {
    const t = await setup();
    const id = await insertPublished(t, { type: "news", sourceKey: SWP });
    await expect(siteOnlyAgrees(t, id)).resolves.toBe(true);

    await patchEntryDoc(t, id, { type: "dofinansowanie" });
    await expect(siteOnlyAgrees(t, id)).resolves.toBe(false);
    expect((await publicOf(t, id)).attributions).toStrictEqual([
      { name: "StartupywPolsce.pl" },
    ]);
  });

  it("is false for manual news", async () => {
    const t = await setup();
    const id = await insertPublished(t, { type: "news" });
    await expect(siteOnlyAgrees(t, id)).resolves.toBe(false);
  });
});
