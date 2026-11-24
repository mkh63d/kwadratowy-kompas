import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { AppErrorCode } from "../lib/errors";
import * as switches from "../lib/switches";
import schema from "../schema";

vi.mock("../lib/switches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/switches")>();
  return { ...actual, isValidSwitchKey: vi.fn(actual.isValidSwitchKey) };
});

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

function newTest() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newTest>;

const SEEDED_KEYS = ["manual", "form", "startupywpolsce-wa"];
const PER_SOURCE_PREFIXES = [
  "scraping.source",
  "ingest.source",
  "promo.source",
];

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

function seed(t: T) {
  return t.mutation(internal.sources.seed.run, {});
}

function allSources(t: T) {
  return t.run((ctx) => ctx.db.query("sources").collect());
}

function sourceByKey(t: T, key: string) {
  return t.run((ctx) =>
    ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
  );
}

const actual =
  await vi.importActual<typeof import("../lib/switches")>("../lib/switches");

beforeEach(() => {
  vi.mocked(switches.isValidSwitchKey)
    .mockClear()
    .mockImplementation(actual.isValidSwitchKey);
});

describe("internal.sources.seed.run", () => {
  it("creates exactly the §14 seeded sources", async () => {
    const t = newTest();
    await expect(seed(t)).resolves.toEqual({ created: SEEDED_KEYS });
    const keys = (await allSources(t)).map((s) => s.key).sort();
    expect(keys).toEqual([...SEEDED_KEYS].sort());
  });

  it("seeds manual and form as plain sources", async () => {
    const t = newTest();
    await seed(t);
    for (const [key, kind] of [
      ["manual", "manual"],
      ["form", "form"],
    ] as const) {
      const source = await sourceByKey(t, key);
      expect(source).toMatchObject({
        kind,
        noCrosspost: false,
        newsSiteOnly: false,
      });
      expect(source).not.toHaveProperty("attribution");
    }
  });

  it("seeds startupywpolsce-wa per §4.4", async () => {
    const t = newTest();
    await seed(t);
    const swp = await sourceByKey(t, "startupywpolsce-wa");
    expect(swp).toMatchObject({
      kind: "whatsapp",
      noCrosspost: true,
      newsSiteOnly: true,
      attribution: { name: "StartupywPolsce.pl" },
    });
    expect(swp!.attribution).not.toHaveProperty("url");
  });

  it("sets newsSiteOnly true only for startupywpolsce-wa", async () => {
    const t = newTest();
    await seed(t);
    const siteOnly = (await allSources(t))
      .filter((s) => s.newsSiteOnly)
      .map((s) => s.key);
    expect(siteOnly).toEqual(["startupywpolsce-wa"]);
  });

  it("never writes ingestTokenHash or ingestTokenRotatedAt", async () => {
    const t = newTest();
    await seed(t);
    for (const source of await allSources(t)) {
      expect(source).not.toHaveProperty("ingestTokenHash");
      expect(source).not.toHaveProperty("ingestTokenRotatedAt");
    }
  });

  it("gives every seeded key a valid per-source switch key", async () => {
    const t = newTest();
    await seed(t);
    for (const source of await allSources(t)) {
      for (const prefix of PER_SOURCE_PREFIXES) {
        expect(actual.isValidSwitchKey(`${prefix}:${source.key}`)).toBe(true);
      }
    }
  });

  it("checks each seeded key against every per-source switch prefix", async () => {
    const t = newTest();
    await seed(t);
    const checked = vi
      .mocked(switches.isValidSwitchKey)
      .mock.calls.map(([key]) => key);
    for (const key of SEEDED_KEYS) {
      for (const prefix of PER_SOURCE_PREFIXES) {
        expect(checked).toContain(`${prefix}:${key}`);
      }
    }
  });

  for (const prefix of PER_SOURCE_PREFIXES) {
    it(`refuses with invalid and writes nothing when a key fails ${prefix}`, async () => {
      const t = newTest();
      vi.mocked(switches.isValidSwitchKey).mockImplementation(
        (key: string) =>
          key !== `${prefix}:startupywpolsce-wa` &&
          actual.isValidSwitchKey(key),
      );
      await expect(appErrorCode(seed(t))).resolves.toBe("invalid");
      await expect(allSources(t)).resolves.toEqual([]);
    });
  }

  describe("idempotence", () => {
    it("a second run creates nothing and changes nothing", async () => {
      const t = newTest();
      await seed(t);
      const before = await allSources(t);
      await expect(seed(t)).resolves.toEqual({ created: [] });
      await expect(allSources(t)).resolves.toStrictEqual(before);
    });

    it("keeps an edited attribution.url and other admin edits", async () => {
      const t = newTest();
      await seed(t);
      const swp = await sourceByKey(t, "startupywpolsce-wa");
      await t.run((ctx) =>
        ctx.db.patch(swp!._id, {
          attribution: {
            name: "StartupywPolsce.pl",
            url: "https://startupywpolsce.pl/spolecznosc",
          },
          promoLine: "Dołącz do społeczności",
          noCrosspost: false,
        }),
      );
      const edited = await allSources(t);
      await seed(t);
      await expect(allSources(t)).resolves.toStrictEqual(edited);
      const after = await sourceByKey(t, "startupywpolsce-wa");
      expect(after!.attribution?.url).toBe(
        "https://startupywpolsce.pl/spolecznosc",
      );
    });

    it("preserves an existing ingest token hash on re-seed", async () => {
      const t = newTest();
      await seed(t);
      const swp = await sourceByKey(t, "startupywpolsce-wa");
      const hash = "ab".repeat(32);
      await t.run((ctx) =>
        ctx.db.patch(swp!._id, {
          ingestTokenHash: hash,
          ingestTokenRotatedAt: 1_700_000_000_000,
        }),
      );
      await seed(t);
      await expect(sourceByKey(t, "startupywpolsce-wa")).resolves.toMatchObject(
        {
          ingestTokenHash: hash,
          ingestTokenRotatedAt: 1_700_000_000_000,
        },
      );
    });

    it("creates only the missing sources", async () => {
      const t = newTest();
      await t.run((ctx) =>
        ctx.db.insert("sources", {
          key: "manual",
          name: "Renamed by admin",
          kind: "manual",
          noCrosspost: true,
          newsSiteOnly: false,
        }),
      );
      await expect(seed(t)).resolves.toEqual({
        created: ["form", "startupywpolsce-wa"],
      });
      await expect(sourceByKey(t, "manual")).resolves.toMatchObject({
        name: "Renamed by admin",
        noCrosspost: true,
      });
      await expect(allSources(t)).resolves.toHaveLength(3);
    });
  });
});
