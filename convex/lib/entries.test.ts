import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertEntry, uniqueSlug, type NewEntry } from "./entries";
import type { AppErrorCode } from "./errors";
import { setSwitch } from "./switches";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

function newTest() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newTest>;

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

const BASE: NewEntry = {
  type: "dofinansowanie",
  title: "Grant dla startupów",
  summary: "Do 50 000 zł na MVP.",
  sourceKey: "manual",
};

function insert(t: T, entry: Partial<NewEntry> = {}) {
  return t.run(async (ctx) => {
    const id = await insertEntry(ctx, { ...BASE, ...entry });
    return (await ctx.db.get(id))!;
  });
}

function entryCount(t: T) {
  return t.run(async (ctx) => (await ctx.db.query("entries").collect()).length);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("insertEntry", () => {
  it("applies the §10.1 defaults to a minimal entry", async () => {
    const t = await setup();
    const entry = await insert(t);
    expect(entry).toMatchObject({
      status: "pending",
      sponsored: false,
      discordPing: false,
      tags: [],
      attributionSourceKeys: [],
      noCrosspost: false,
    });
    for (const field of [
      "publishedAt",
      "archiveReason",
      "withdrawReason",
      "featuredUntil",
      "mergedInto",
    ]) {
      expect(entry).not.toHaveProperty(field);
    }
  });

  it("keeps caller-supplied optional fields and explicit defaults", async () => {
    const t = await setup();
    const entry = await insert(t, {
      tags: ["ai", "łódź"],
      discordPing: true,
      organizer: "UMŁ",
      url: "https://example.org",
      sourceRef: "ref-1",
      cost: "free",
    });
    expect(entry).toMatchObject({
      tags: ["ai", "łódź"],
      discordPing: true,
      organizer: "UMŁ",
      url: "https://example.org",
      sourceRef: "ref-1",
      cost: "free",
    });
  });

  it("builds searchText from lower-cased title, summary, organizer and tags", async () => {
    const t = await setup();
    const withOrganizer = await insert(t, {
      title: "Hackathon ŁÓDŹ",
      summary: "Dwa Dni KODU",
      organizer: "Fundacja X",
      tags: ["ai", "fintech"],
    });
    expect(withOrganizer.searchText).toBe(
      "hackathon łódź dwa dni kodu fundacja x ai fintech " +
        "hackathon lodz dwa dni kodu fundacja x ai fintech",
    );
    const withoutOrganizer = await insert(t, {
      title: "Meetup",
      summary: "Wieczór",
    });
    expect(withoutOrganizer.searchText).toBe("meetup wieczór meetup wieczor");
  });

  it("adds no folded copy to searchText when nothing folds", async () => {
    const t = await setup();
    const entry = await insert(t, {
      title: "Demo Day",
      summary: "Pitch 2027",
      tags: ["ai"],
    });
    expect(entry.searchText).toBe("demo day pitch 2027 ai");
  });

  it("makes searchText match both the Polish and the folded spelling", async () => {
    const t = await setup();
    const entry = await insert(t, {
      title: "Zażółć gęślą jaźń w Łodzi",
      summary: "Straße Ørsted Æble Œuvre",
    });
    const words = entry.searchText.split(" ");
    for (const word of ["łodzi", "lodzi", "zażółć", "zazolc", "jaźń", "jazn"]) {
      expect(words).toContain(word);
    }
    for (const word of ["strasse", "orsted", "aeble", "oeuvre"]) {
      expect(words).toContain(word);
    }
  });

  it("stores tags trimmed, lower-cased, deduplicated and without empties", async () => {
    const t = await setup();
    const entry = await insert(t, {
      tags: ["AI", " ai ", "Łódź", "ŁÓDŹ", "", "   ", "FinTech", "fintech"],
    });
    expect(entry.tags).toEqual(["ai", "łódź", "fintech"]);
    expect(entry.searchText).toBe(
      "grant dla startupów do 50 000 zł na mvp. ai łódź fintech " +
        "grant dla startupow do 50 000 zl na mvp. ai lodz fintech",
    );
  });

  it("ignores lifecycle-owned fields passed on a wider object", async () => {
    const t = await setup();
    const otherId = await t.run((ctx) => insertEntry(ctx, BASE));
    const widened = {
      ...BASE,
      title: "Kopia",
      slug: "forced-slug",
      status: "published",
      publishedAt: 1,
      featuredUntil: 2,
      archiveReason: "manual",
      withdrawReason: "spam",
      mergedInto: otherId,
      attributionSourceKeys: ["startupywpolsce-wa"],
      noCrosspost: true,
      searchText: "forced",
      sortAt: 3,
      updatedAt: 4,
      unknownField: "x",
    };
    const entry = await t.run(async (ctx) => {
      const id = await insertEntry(ctx, widened);
      return (await ctx.db.get(id))!;
    });
    for (const field of [
      "publishedAt",
      "featuredUntil",
      "archiveReason",
      "withdrawReason",
      "mergedInto",
      "unknownField",
    ]) {
      expect(entry).not.toHaveProperty(field);
    }
    expect(entry).toMatchObject({
      slug: "kopia",
      status: "pending",
      attributionSourceKeys: [],
      noCrosspost: false,
      searchText: "kopia do 50 000 zł na mvp. kopia do 50 000 zl na mvp.",
    });
    expect(entry.sortAt).not.toBe(3);
    expect(entry.updatedAt).not.toBe(4);
  });

  it("passes every NewEntry field through", async () => {
    const t = await setup();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      const programId = await ctx.db.insert("programs", {
        name: "Program",
        slug: "program",
        kind: "incubator",
      });
      const rawItemId = await ctx.db.insert("rawItems", {
        sourceKey: "manual",
        externalId: "x",
        text: "t",
        receivedAt: 0,
        contentHash: "0".repeat(64),
        state: "waiting_ai",
      });
      return { userId, programId, rawItemId };
    });
    const full: Required<NewEntry> = {
      type: "konkurs",
      title: "Konkurs",
      summary: "s",
      body: "b",
      organizer: "o",
      location: "Łódź",
      isOnline: true,
      url: "https://example.org",
      tags: ["a"],
      stages: ["mvp"],
      amountText: "10 000 zł",
      amountMaxPln: 10000,
      cost: "paid",
      startsAt: 10,
      endsAt: 20,
      deadline: 5,
      sponsored: false,
      sourceKey: "manual",
      sourceRef: "ref",
      rawItemId: ids.rawItemId,
      programId: ids.programId,
      discordChannelOverride: "123",
      discordPing: true,
      createdBy: ids.userId,
    };
    const entry = await insert(t, full);
    expect(entry).toMatchObject(full);
  });

  it("takes attributionSourceKeys and noCrosspost from startupywpolsce-wa", async () => {
    const t = await setup();
    const entry = await insert(t, {
      type: "news",
      sourceKey: "startupywpolsce-wa",
    });
    expect(entry.attributionSourceKeys).toEqual(["startupywpolsce-wa"]);
    expect(entry.noCrosspost).toBe(true);
  });

  it("reads the source's flags at insert time, not the seed's", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      const form = await ctx.db
        .query("sources")
        .withIndex("by_key", (q) => q.eq("key", "form"))
        .unique();
      await ctx.db.patch(form!._id, {
        noCrosspost: true,
        attribution: { name: "Formularz" },
      });
    });
    const entry = await insert(t, { sourceKey: "form" });
    expect(entry.attributionSourceKeys).toEqual(["form"]);
    expect(entry.noCrosspost).toBe(true);
  });

  it("takes attribution and noCrosspost from the source independently", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("sources", {
        key: "attributed-crossposting",
        name: "Attributed",
        kind: "scraper",
        noCrosspost: false,
        newsSiteOnly: false,
        attribution: { name: "Attributed" },
      });
      await ctx.db.insert("sources", {
        key: "unattributed-no-crosspost",
        name: "Unattributed",
        kind: "scraper",
        noCrosspost: true,
        newsSiteOnly: false,
      });
    });
    const attributed = await insert(t, {
      sourceKey: "attributed-crossposting",
    });
    expect(attributed.attributionSourceKeys).toEqual([
      "attributed-crossposting",
    ]);
    expect(attributed.noCrosspost).toBe(false);
    const unattributed = await insert(t, {
      sourceKey: "unattributed-no-crosspost",
    });
    expect(unattributed.attributionSourceKeys).toEqual([]);
    expect(unattributed.noCrosspost).toBe(true);
  });

  it("refuses an unknown sourceKey with invalid and writes nothing", async () => {
    const t = await setup();
    await expect(
      appErrorCode(insert(t, { sourceKey: "no-such-source" })),
    ).resolves.toBe("invalid");
    await expect(entryCount(t)).resolves.toBe(0);
  });

  describe("sortAt (D33)", () => {
    const NOW = Date.UTC(2027, 0, 15, 12);
    const STARTS = Date.UTC(2027, 2, 1);
    const DEADLINE = Date.UTC(2027, 1, 1);

    it("uses deadline when set", async () => {
      vi.useFakeTimers({ now: NOW });
      const t = await setup();
      const entry = await insert(t, { deadline: DEADLINE, startsAt: STARTS });
      expect(entry.sortAt).toBe(DEADLINE);
      expect(entry.updatedAt).toBe(NOW);
    });

    it("falls back to startsAt without a deadline", async () => {
      vi.useFakeTimers({ now: NOW });
      const t = await setup();
      const entry = await insert(t, { startsAt: STARTS });
      expect(entry.sortAt).toBe(STARTS);
    });

    it("falls back to the insert-time Date.now() without deadline and startsAt", async () => {
      vi.useFakeTimers({ now: NOW });
      const t = await setup();
      const entry = await insert(t);
      expect(entry.sortAt).toBe(NOW);
      expect(entry.updatedAt).toBe(NOW);
    });
  });

  describe("sponsoring", () => {
    it("refuses sponsored:true while sponsoring is off with switch_off and writes nothing", async () => {
      const t = await setup();
      await expect(appErrorCode(insert(t, { sponsored: true }))).resolves.toBe(
        "switch_off",
      );
      await expect(entryCount(t)).resolves.toBe(0);
    });

    it("accepts sponsored:true once sponsoring is on", async () => {
      const t = await setup();
      await t.run((ctx) =>
        setSwitch(ctx, { key: "sponsoring", enabled: true }),
      );
      const entry = await insert(t, { sponsored: true });
      expect(entry.sponsored).toBe(true);
    });

    it("accepts sponsored:false while sponsoring is off", async () => {
      const t = await setup();
      const entry = await insert(t, { sponsored: false });
      expect(entry.sponsored).toBe(false);
    });
  });

  it("gives colliding titles distinct slugs", async () => {
    const t = await setup();
    const first = await insert(t, { title: "Nabór: Łódź Startup 2027" });
    const second = await insert(t, { title: "Nabór: Łódź Startup 2027" });
    expect(first.slug).toBe("nabor-lodz-startup-2027");
    expect(second.slug).toBe("nabor-lodz-startup-2027-2");
  });
});

describe("uniqueSlug", () => {
  async function insertWithSlug(t: T, slug: string) {
    const id = await t.run((ctx) => insertEntry(ctx, BASE));
    await t.run((ctx) => ctx.db.patch(id, { slug }));
  }

  it("folds Polish diacritics and punctuation", async () => {
    const t = await setup();
    await expect(
      t.run((ctx) => uniqueSlug(ctx, "Nabór: Łódź Startup 2027")),
    ).resolves.toBe("nabor-lodz-startup-2027");
    await expect(
      t.run((ctx) => uniqueSlug(ctx, "  Zażółć gęślą jaźń — ĄĆĘŁŃÓŚŹŻ!  ")),
    ).resolves.toBe("zazolc-gesla-jazn-acelnoszz");
  });

  it("numbers collisions -2, -3, …", async () => {
    const t = await setup();
    const title = "Nabór: Łódź Startup 2027";
    await insertWithSlug(t, "nabor-lodz-startup-2027");
    await expect(t.run((ctx) => uniqueSlug(ctx, title))).resolves.toBe(
      "nabor-lodz-startup-2027-2",
    );
    await insertWithSlug(t, "nabor-lodz-startup-2027-2");
    await expect(t.run((ctx) => uniqueSlug(ctx, title))).resolves.toBe(
      "nabor-lodz-startup-2027-3",
    );
  });

  it("treats a slug held by an entry of any status as taken", async () => {
    const t = await setup();
    const id = await t.run((ctx) => insertEntry(ctx, BASE));
    await t.run((ctx) =>
      ctx.db.patch(id, { slug: "wycofany", status: "withdrawn" }),
    );
    await expect(t.run((ctx) => uniqueSlug(ctx, "Wycofany"))).resolves.toBe(
      "wycofany-2",
    );
  });

  it("keeps slugs within 60 chars, suffix included, without a trailing dash", async () => {
    const t = await setup();
    const title = `${"a".repeat(58)} bcd`;
    const base = await t.run((ctx) => uniqueSlug(ctx, title));
    expect(base).toBe("a".repeat(58) + "-b");
    expect(base).toHaveLength(60);
    await insertWithSlug(t, base);
    const second = await t.run((ctx) => uniqueSlug(ctx, title));
    expect(second).toBe("a".repeat(58) + "-2");
    expect(second.length).toBeLessThanOrEqual(60);

    const dashAtCut = `${"a".repeat(59)} b`;
    await expect(t.run((ctx) => uniqueSlug(ctx, dashAtCut))).resolves.toBe(
      "a".repeat(59),
    );
  });

  it("folds ß, æ, œ and ø like other diacritics", async () => {
    const t = await setup();
    await expect(
      t.run((ctx) => uniqueSlug(ctx, "Straße Ørsted Æble Œuvre ẞ")),
    ).resolves.toBe("strasse-orsted-aeble-oeuvre-ss");
  });

  it("switches to a random suffix after -21 is taken", async () => {
    const t = await setup();
    await insertWithSlug(t, "demo");
    for (let n = 2; n <= 21; n++) await insertWithSlug(t, `demo-${n}`);
    const slug = await t.run((ctx) => uniqueSlug(ctx, "Demo"));
    expect(slug).toMatch(/^demo-[a-z0-9]{6}$/);
  });

  it("returns -21 while it is still free", async () => {
    const t = await setup();
    await insertWithSlug(t, "demo");
    for (let n = 2; n <= 20; n++) await insertWithSlug(t, `demo-${n}`);
    await expect(t.run((ctx) => uniqueSlug(ctx, "Demo"))).resolves.toBe(
      "demo-21",
    );
  });

  it("keeps a random suffix within 60 chars", async () => {
    const t = await setup();
    const base = "a".repeat(60);
    await insertWithSlug(t, base);
    for (let n = 2; n <= 21; n++) {
      await insertWithSlug(t, `${"a".repeat(60 - String(n).length - 1)}-${n}`);
    }
    const slug = await t.run((ctx) => uniqueSlug(ctx, base));
    expect(slug).toMatch(/^a{53}-[a-z0-9]{6}$/);
  });

  it("does at most 22 slug reads, then refuses with conflict", async () => {
    let reads = 0;
    const everySlugTaken = {
      db: {
        query: () => ({
          withIndex: () => ({
            first: () => {
              reads++;
              return Promise.resolve({ _id: "taken" });
            },
          }),
        }),
      },
    };
    await expect(
      appErrorCode(uniqueSlug(everySlugTaken as never, "Demo")),
    ).resolves.toBe("conflict");
    expect(reads).toBe(22);
  });

  it("falls back to a non-empty slug for a title without letters or digits", async () => {
    const t = await setup();
    const slug = await t.run((ctx) => uniqueSlug(ctx, "!!! — ???"));
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("only ever yields [a-z0-9-] slugs", async () => {
    const t = await setup();
    for (const title of ["Ü Straße ﬁ №1", "🚀 Launch", "C++ & C#", "a--b__c"]) {
      const slug = await t.run((ctx) => uniqueSlug(ctx, title));
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
