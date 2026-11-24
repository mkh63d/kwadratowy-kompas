import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import type { AppErrorCode } from "./errors";
import type { OutboxAction, OutboxStatus, RawItemState } from "./enums";
import {
  assertEnabled,
  backlogCount,
  isEnabled,
  isValidSwitchKey,
  setSwitch,
  SWITCH_DEFAULTS,
  SWITCH_PATTERNS,
  type SwitchKey,
} from "./switches";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

const SPEC_DEFAULTS: Record<string, boolean> = {
  scraping: true,
  "scraping.source:parp-rss": true,
  "ingest.source:startupywpolsce-wa": true,
  "promo.source:startupywpolsce-wa": true,
  ai: true,
  discord: false,
  "discord.channel:123456789012345678": true,
  "discord.crosspost:123456789012345678": true,
  sponsoring: false,
  reminders: true,
  digest: true,
  mcp: true,
  submitForm: true,
  registration: false,
};

const INVALID_KEYS = [
  "",
  "scrapping",
  "Scraping",
  "scraping.source:",
  "scraping.source:Parp-RSS",
  "scraping.source:parp rss",
  "scraping.source:a:b",
  "scraping.source",
  "scraping:parp-rss",
  "discord.channel:",
  "discord.channel:general",
  "discord.crosspost:12a",
  "unknown.source:parp-rss",
  "toString",
  "constructor",
  "__proto__",
];

const CHANNEL = "111111111111111111";
const OTHER_CHANNEL = "222222222222222222";

type Ctx = MutationCtx;

async function appErrorCode(promise: Promise<unknown>): Promise<Value> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to be rejected");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: AppErrorCode }>).data.code;
}

function asKey(key: string): SwitchKey {
  return key as SwitchKey;
}

async function insertRawItems(ctx: Ctx, state: RawItemState, n: number) {
  for (let i = 0; i < n; i++) {
    await ctx.db.insert("rawItems", {
      sourceKey: "manual",
      externalId: `${state}-${i}`,
      text: "text",
      receivedAt: i,
      contentHash: "0".repeat(64),
      state,
      ...(state === "discarded" ? { discardReason: "prefilter" as const } : {}),
    });
  }
}

async function insertEntry(ctx: Ctx): Promise<Id<"entries">> {
  return ctx.db.insert("entries", {
    slug: "entry",
    type: "event",
    title: "Entry",
    summary: "Summary",
    tags: [],
    status: "published",
    publishedAt: 1,
    sponsored: false,
    sourceKey: "manual",
    attributionSourceKeys: [],
    noCrosspost: false,
    discordPing: false,
    searchText: "entry",
    sortAt: 1,
    updatedAt: 1,
  });
}

async function insertOutbox(
  ctx: Ctx,
  rows: { channelId: string; action: OutboxAction; status: OutboxStatus }[],
) {
  const entryId = await insertEntry(ctx);
  for (const row of rows) {
    await ctx.db.insert("discordOutbox", {
      entryId,
      nonce: "a".repeat(20),
      attempts: 0,
      ...row,
    });
  }
}

async function tables(ctx: Ctx) {
  return {
    switches: await ctx.db.query("switches").collect(),
    switchLog: await ctx.db.query("switchLog").collect(),
  };
}

function setup() {
  return convexTest(schema, modules);
}

describe("switch keys", () => {
  it("declares exactly the §6.2 static keys and patterns", () => {
    const staticKeys = Object.keys(SPEC_DEFAULTS).filter(
      (k) => !k.includes(":"),
    );
    const patterns = Object.keys(SPEC_DEFAULTS)
      .filter((k) => k.includes(":"))
      .map((k) => k.slice(0, k.indexOf(":")));
    expect(Object.keys(SWITCH_DEFAULTS).sort()).toStrictEqual(
      staticKeys.sort(),
    );
    expect(Object.keys(SWITCH_PATTERNS).sort()).toStrictEqual(patterns.sort());
  });

  it.each(Object.keys(SPEC_DEFAULTS))("accepts %s", (key) => {
    expect(isValidSwitchKey(key)).toBe(true);
  });

  it.each(INVALID_KEYS)("rejects %j", (key) => {
    expect(isValidSwitchKey(key)).toBe(false);
  });
});

describe("isEnabled", () => {
  it.each(Object.entries(SPEC_DEFAULTS))(
    "returns the §6.2 default for an unset %s (%s)",
    async (key, expected) => {
      const t = setup();
      await expect(t.run((ctx) => isEnabled(ctx, asKey(key)))).resolves.toBe(
        expected,
      );
    },
  );

  it("returns the stored value over the default", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("switches", {
        key: "discord",
        enabled: true,
        updatedAt: 1,
      });
      await ctx.db.insert("switches", {
        key: "scraping.source:parp-rss",
        enabled: false,
        updatedAt: 1,
      });
    });
    await expect(t.run((ctx) => isEnabled(ctx, "discord"))).resolves.toBe(true);
    await expect(
      t.run((ctx) => isEnabled(ctx, "scraping.source:parp-rss")),
    ).resolves.toBe(false);
    await expect(
      t.run((ctx) => isEnabled(ctx, "scraping.source:other")),
    ).resolves.toBe(true);
  });

  it.each(INVALID_KEYS)("throws invalid for %j", async (key) => {
    const t = setup();
    await expect(
      appErrorCode(t.run((ctx) => isEnabled(ctx, asKey(key)))),
    ).resolves.toBe("invalid");
  });
});

describe("assertEnabled", () => {
  it("passes when on and throws switch_off when off", async () => {
    const t = setup();
    await t.run((ctx) => assertEnabled(ctx, "scraping"));
    await expect(
      appErrorCode(t.run((ctx) => assertEnabled(ctx, "discord"))),
    ).resolves.toBe("switch_off");
  });

  it("throws invalid for an unknown key", async () => {
    const t = setup();
    await expect(
      appErrorCode(t.run((ctx) => assertEnabled(ctx, asKey("scrapping")))),
    ).resolves.toBe("invalid");
  });
});

describe("setSwitch: log", () => {
  it("writes the switch and exactly one log row per change", async () => {
    const t = setup();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const result = await t.run((ctx) =>
      setSwitch(ctx, {
        key: "mcp",
        enabled: false,
        by: userId,
        reason: "abuse",
      }),
    );
    expect(result).toStrictEqual({ backlogCount: 0 });

    const { switches, switchLog } = await t.run(tables);
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({
      key: "mcp",
      enabled: false,
      updatedBy: userId,
    });
    expect(switchLog).toHaveLength(1);
    const [row] = switchLog;
    expect(row).toMatchObject({
      key: "mcp",
      from: true,
      to: false,
      by: userId,
      reason: "abuse",
    });
    expect(row.at).toBe(switches[0].updatedAt);
    expect(row).not.toHaveProperty("backlog");
    expect(row).not.toHaveProperty("backlogCount");
    await expect(t.run((ctx) => isEnabled(ctx, "mcp"))).resolves.toBe(false);
  });

  it("writes nothing for a no-op against the default", async () => {
    const t = setup();
    await expect(
      t.run((ctx) => setSwitch(ctx, { key: "scraping", enabled: true })),
    ).resolves.toStrictEqual({ backlogCount: 0 });
    await expect(t.run(tables)).resolves.toStrictEqual({
      switches: [],
      switchLog: [],
    });
  });

  it("writes no second log row for a no-op against a stored value", async () => {
    const t = setup();
    await t.run((ctx) =>
      setSwitch(ctx, { key: "registration", enabled: true }),
    );
    const before = await t.run(tables);
    await t.run((ctx) =>
      setSwitch(ctx, { key: "registration", enabled: true, reason: "again" }),
    );
    await expect(t.run(tables)).resolves.toStrictEqual(before);
  });

  it("logs each flip and clears updatedBy when the CLI changes it", async () => {
    const t = setup();
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await t.run((ctx) =>
      setSwitch(ctx, { key: "digest", enabled: false, by: userId }),
    );
    await t.run((ctx) => setSwitch(ctx, { key: "digest", enabled: true }));

    const { switches, switchLog } = await t.run(tables);
    expect(switches).toHaveLength(1);
    expect(switches[0]).not.toHaveProperty("updatedBy");
    expect(
      switchLog.map(({ from, to, by }) => ({ from, to, by })),
    ).toStrictEqual([
      { from: true, to: false, by: userId },
      { from: false, to: true, by: undefined },
    ]);
  });

  it.each(INVALID_KEYS)(
    "throws invalid for %j and writes nothing",
    async (key) => {
      const t = setup();
      await expect(
        appErrorCode(
          t.run((ctx) => setSwitch(ctx, { key: asKey(key), enabled: false })),
        ),
      ).resolves.toBe("invalid");
      await expect(t.run(tables)).resolves.toStrictEqual({
        switches: [],
        switchLog: [],
      });
    },
  );
});

describe("setSwitch: backlog (R2.5)", () => {
  type Case = {
    key: SwitchKey;
    mode: "process" | "send";
    otherMode: "onlyNew" | "skip";
    wrongMode: "send" | "process";
    seed: (ctx: Ctx) => Promise<void>;
    count: number;
  };
  const cases: Case[] = [
    {
      key: "ai",
      mode: "process",
      otherMode: "onlyNew",
      wrongMode: "send",
      count: 3,
      seed: async (ctx) => {
        await insertRawItems(ctx, "waiting_ai", 3);
        await insertRawItems(ctx, "manual", 2);
        await insertRawItems(ctx, "discarded", 1);
      },
    },
    {
      key: "discord",
      mode: "send",
      otherMode: "skip",
      wrongMode: "process",
      count: 3,
      seed: (ctx) =>
        insertOutbox(ctx, [
          { channelId: CHANNEL, action: "create", status: "paused" },
          { channelId: OTHER_CHANNEL, action: "update", status: "paused" },
          { channelId: CHANNEL, action: "crosspost", status: "paused" },
          { channelId: CHANNEL, action: "create", status: "pending" },
          { channelId: CHANNEL, action: "create", status: "sent" },
        ]),
    },
    {
      key: `discord.channel:${CHANNEL}`,
      mode: "send",
      otherMode: "skip",
      wrongMode: "process",
      count: 2,
      seed: (ctx) =>
        insertOutbox(ctx, [
          { channelId: CHANNEL, action: "create", status: "paused" },
          { channelId: CHANNEL, action: "crosspost", status: "paused" },
          { channelId: OTHER_CHANNEL, action: "create", status: "paused" },
          { channelId: CHANNEL, action: "update", status: "pending" },
        ]),
    },
    {
      key: `discord.crosspost:${CHANNEL}`,
      mode: "send",
      otherMode: "skip",
      wrongMode: "process",
      count: 1,
      seed: (ctx) =>
        insertOutbox(ctx, [
          { channelId: CHANNEL, action: "crosspost", status: "paused" },
          { channelId: CHANNEL, action: "create", status: "paused" },
          { channelId: OTHER_CHANNEL, action: "crosspost", status: "paused" },
          { channelId: CHANNEL, action: "crosspost", status: "skipped" },
        ]),
    },
  ];

  async function seededOff({ key, seed }: Case) {
    const t = setup();
    await t.run(async (ctx) => {
      await seed(ctx);
      await ctx.db.insert("switches", { key, enabled: false, updatedAt: 0 });
    });
    return t;
  }

  describe.each(cases)("$key", (c) => {
    it("counts only its scope", async () => {
      const t = await seededOff(c);
      await expect(t.run((ctx) => backlogCount(ctx, c.key))).resolves.toBe(
        c.count,
      );
    });

    it("rejects turning on without a backlog mode and writes nothing", async () => {
      const t = await seededOff(c);
      const before = await t.run(tables);
      await expect(
        appErrorCode(
          t.run((ctx) => setSwitch(ctx, { key: c.key, enabled: true })),
        ),
      ).resolves.toBe("conflict");
      await expect(t.run(tables)).resolves.toStrictEqual(before);
    });

    it.each(["mode", "otherMode"] as const)(
      "turns on with %s and logs it",
      async (which) => {
        const t = await seededOff(c);
        const mode = c[which];
        await expect(
          t.run((ctx) =>
            setSwitch(ctx, { key: c.key, enabled: true, backlog: mode }),
          ),
        ).resolves.toStrictEqual({ backlogCount: c.count });
        const { switchLog } = await t.run(tables);
        expect(switchLog).toHaveLength(1);
        expect(switchLog[0]).toMatchObject({
          key: c.key,
          from: false,
          to: true,
          backlog: mode,
          backlogCount: c.count,
        });
      },
    );

    it("rejects a mode of another key family", async () => {
      const t = await seededOff(c);
      await expect(
        appErrorCode(
          t.run((ctx) =>
            setSwitch(ctx, { key: c.key, enabled: true, backlog: c.wrongMode }),
          ),
        ),
      ).resolves.toBe("invalid");
    });

    it("rejects a backlog mode when turning off", async () => {
      const t = setup();
      await expect(
        appErrorCode(
          t.run((ctx) =>
            setSwitch(ctx, { key: c.key, enabled: false, backlog: c.mode }),
          ),
        ),
      ).resolves.toBe("invalid");
      await expect(t.run(tables)).resolves.toStrictEqual({
        switches: [],
        switchLog: [],
      });
    });

    it("turns on without a mode when the backlog is empty", async () => {
      const t = setup();
      await t.run((ctx) =>
        ctx.db.insert("switches", { key: c.key, enabled: false, updatedAt: 0 }),
      );
      await expect(
        t.run((ctx) => setSwitch(ctx, { key: c.key, enabled: true })),
      ).resolves.toStrictEqual({ backlogCount: 0 });
      const { switchLog } = await t.run(tables);
      expect(switchLog[0]).toMatchObject({ backlogCount: 0 });
      expect(switchLog[0]).not.toHaveProperty("backlog");
    });

    it("turns off without a mode even with a backlog", async () => {
      const t = setup();
      await t.run(c.seed);
      await t.run((ctx) =>
        ctx.db.insert("switches", { key: c.key, enabled: true, updatedAt: 0 }),
      );
      await expect(
        t.run((ctx) => setSwitch(ctx, { key: c.key, enabled: false })),
      ).resolves.toStrictEqual({ backlogCount: 0 });
      const { switchLog } = await t.run(tables);
      expect(switchLog[0]).not.toHaveProperty("backlogCount");
    });
  });

  it.each([
    "scraping",
    "scraping.source:parp-rss",
    "ingest.source:startupywpolsce-wa",
    "promo.source:startupywpolsce-wa",
    "sponsoring",
    "reminders",
    "digest",
    "mcp",
    "submitForm",
    "registration",
  ] as const)("rejects any backlog mode for %s", async (key) => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("switches", { key, enabled: false, updatedAt: 0 }),
    );
    const before = await t.run(tables);
    for (const backlog of ["process", "onlyNew", "send", "skip"] as const) {
      await expect(
        appErrorCode(
          t.run((ctx) => setSwitch(ctx, { key, enabled: true, backlog })),
        ),
      ).resolves.toBe("invalid");
    }
    await expect(t.run(tables)).resolves.toStrictEqual(before);
    await expect(backlogCountOf(t, key)).resolves.toBe(0);
  });

  it("stops counting at 1000 and names the cap in the refusal", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await insertRawItems(ctx, "waiting_ai", 1001);
      await ctx.db.insert("switches", {
        key: "ai",
        enabled: false,
        updatedAt: 0,
      });
    });
    await expect(backlogCountOf(t, "ai")).resolves.toBe(1000);
    await expect(
      t.run((ctx) => setSwitch(ctx, { key: "ai", enabled: true })),
    ).rejects.toThrow(/1000\+/);
  });
});

function backlogCountOf(t: ReturnType<typeof setup>, key: SwitchKey) {
  return t.run((ctx) => backlogCount(ctx, key));
}

describe("backlogCount", () => {
  it("throws invalid for an unknown key", async () => {
    const t = setup();
    await expect(
      appErrorCode(backlogCountOf(t, asKey("discord.channel:"))),
    ).resolves.toBe("invalid");
  });
});
