import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import type { EntryStatus, EntryType } from "./enums";
import { insertEntry } from "./entries";
import { setSwitch } from "./switches";
import { isListed, isSiteOnly, isViewable } from "./visibility";

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

const STATUSES: EntryStatus[] = [
  "pending",
  "published",
  "rejected",
  "archived",
  "withdrawn",
];

type Row = {
  status: EntryStatus;
  merged: boolean;
  sponsored: boolean;
  sponsoring: boolean;
};

function rows(): Row[] {
  const out: Row[] = [];
  for (const status of STATUSES)
    for (const merged of [false, true])
      for (const sponsored of [false, true])
        for (const sponsoring of [false, true])
          out.push({ status, merged, sponsored, sponsoring });
  return out;
}

function expectedListed(row: Row): boolean {
  return (
    row.status === "published" &&
    !row.merged &&
    (!row.sponsored || row.sponsoring)
  );
}

function expectedViewable(row: Row): boolean {
  return (
    (row.status === "published" || row.status === "archived") &&
    !row.merged &&
    (!row.sponsored || row.sponsoring)
  );
}

function label(row: Row): string {
  return `${row.status}${row.merged ? " merged" : ""}${row.sponsored ? " sponsored" : ""}, sponsoring ${row.sponsoring ? "on" : "off"}`;
}

async function entryFor(t: T, row: Row): Promise<Doc<"entries">> {
  return t.run(async (ctx) => {
    const target = await insertEntry(ctx, {
      type: "event",
      title: "Target",
      summary: "s",
      sourceKey: "manual",
    });
    const id = await insertEntry(ctx, {
      type: "event",
      title: "Entry",
      summary: "s",
      sourceKey: "manual",
    });
    // The lifecycle helpers that set these fields land in T10; tests patch them directly.
    await ctx.db.patch(id, {
      status: row.status,
      sponsored: row.sponsored,
      mergedInto: row.merged ? target : undefined,
    });
    if (row.sponsoring) {
      await setSwitch(ctx, { key: "sponsoring", enabled: true });
    }
    return (await ctx.db.get(id))!;
  });
}

describe("isListed / isViewable truth tables (§10.3)", () => {
  for (const row of rows()) {
    it(`${label(row)} → listed ${expectedListed(row)}, viewable ${expectedViewable(row)}`, async () => {
      const t = await setup();
      const entry = await entryFor(t, row);
      await expect(t.run((ctx) => isListed(ctx, entry))).resolves.toBe(
        expectedListed(row),
      );
      await expect(t.run((ctx) => isViewable(ctx, entry))).resolves.toBe(
        expectedViewable(row),
      );
    });
  }

  it("covers both outcomes of each predicate", () => {
    const all = rows();
    expect(all).toHaveLength(40);
    expect(all.filter(expectedListed)).toHaveLength(3);
    expect(all.filter(expectedViewable)).toHaveLength(6);
  });

  it("reads the sponsoring switch live", async () => {
    const t = await setup();
    const entry = await entryFor(t, {
      status: "published",
      merged: false,
      sponsored: true,
      sponsoring: true,
    });
    await expect(t.run((ctx) => isListed(ctx, entry))).resolves.toBe(true);
    await t.run((ctx) => setSwitch(ctx, { key: "sponsoring", enabled: false }));
    await expect(t.run((ctx) => isListed(ctx, entry))).resolves.toBe(false);
    await expect(t.run((ctx) => isViewable(ctx, entry))).resolves.toBe(false);
  });
});

describe("isSiteOnly (D22)", () => {
  async function insert(
    t: T,
    type: EntryType,
    sourceKey: string,
    attributionSourceKeys?: string[],
  ): Promise<Id<"entries">> {
    return t.run(async (ctx) => {
      const id = await insertEntry(ctx, {
        type,
        title: "Wpis",
        summary: "s",
        sourceKey,
      });
      if (attributionSourceKeys !== undefined) {
        await ctx.db.patch(id, { attributionSourceKeys });
      }
      return id;
    });
  }

  function siteOnly(t: T, id: Id<"entries">) {
    return t.run(async (ctx) => isSiteOnly(ctx, (await ctx.db.get(id))!));
  }

  function setNewsSiteOnly(t: T, key: string, newsSiteOnly: boolean) {
    return t.run(async (ctx) => {
      const source = await ctx.db
        .query("sources")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      await ctx.db.patch(source!._id, { newsSiteOnly });
    });
  }

  it("SwP news → true", async () => {
    const t = await setup();
    const id = await insert(t, "news", "startupywpolsce-wa");
    await expect(siteOnly(t, id)).resolves.toBe(true);
  });

  it("SwP dofinansowanie → false", async () => {
    const t = await setup();
    const id = await insert(t, "dofinansowanie", "startupywpolsce-wa");
    await expect(siteOnly(t, id)).resolves.toBe(false);
  });

  it("manual news → false", async () => {
    const t = await setup();
    const id = await insert(t, "news", "manual");
    await expect(siteOnly(t, id)).resolves.toBe(false);
  });

  it("manual news with startupywpolsce-wa in attributionSourceKeys → true", async () => {
    const t = await setup();
    const id = await insert(t, "news", "manual", ["startupywpolsce-wa"]);
    await expect(siteOnly(t, id)).resolves.toBe(true);
  });

  it("SwP-sourced news stays site-only with empty attributionSourceKeys", async () => {
    const t = await setup();
    const id = await insert(t, "news", "startupywpolsce-wa", []);
    await expect(siteOnly(t, id)).resolves.toBe(true);
  });

  it("is false for every non-news type from SwP", async () => {
    const t = await setup();
    const types: EntryType[] = [
      "dofinansowanie",
      "konkurs",
      "hackathon",
      "szkolenie",
      "event",
      "ogloszenie",
    ];
    for (const type of types) {
      const id = await insert(t, type, "startupywpolsce-wa");
      await expect(siteOnly(t, id)).resolves.toBe(false);
    }
  });

  it("follows sources.newsSiteOnly live for an existing entry", async () => {
    const t = await setup();
    const swp = await insert(t, "news", "startupywpolsce-wa");
    const manual = await insert(t, "news", "manual");

    await setNewsSiteOnly(t, "startupywpolsce-wa", false);
    await expect(siteOnly(t, swp)).resolves.toBe(false);

    await setNewsSiteOnly(t, "manual", true);
    await expect(siteOnly(t, manual)).resolves.toBe(true);

    await setNewsSiteOnly(t, "startupywpolsce-wa", true);
    await expect(siteOnly(t, swp)).resolves.toBe(true);
  });

  it("ignores attribution keys of sources that no longer exist", async () => {
    const t = await setup();
    const id = await insert(t, "news", "manual", ["gone-source"]);
    await expect(siteOnly(t, id)).resolves.toBe(false);
  });

  it("is independent of status", async () => {
    const t = await setup();
    const id = await insert(t, "news", "startupywpolsce-wa");
    await t.run((ctx) => ctx.db.patch(id, { status: "archived" }));
    await expect(siteOnly(t, id)).resolves.toBe(true);
  });
});
