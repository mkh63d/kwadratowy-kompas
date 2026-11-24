import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { AppErrorCode } from "../lib/errors";
import type { Role } from "../lib/enums";
import { createUser } from "../lib/testing/fixtures";
import schema from "../schema";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

type T = ReturnType<typeof setup>;

function setup() {
  return convexTest(schema, modules);
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

function tables(t: T) {
  return t.run(async (ctx) => ({
    switches: await ctx.db.query("switches").collect(),
    switchLog: await ctx.db.query("switchLog").collect(),
  }));
}

function scheduled(t: T) {
  return t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

async function seedWaitingAi(t: T) {
  await t.run((ctx) =>
    ctx.db.insert("rawItems", {
      sourceKey: "manual",
      externalId: "x",
      text: "text",
      receivedAt: 0,
      contentHash: "0".repeat(64),
      state: "waiting_ai",
    }),
  );
}

describe("api.switches.mutations.set", () => {
  it("refuses an anonymous caller and writes nothing", async () => {
    const t = setup();
    await expect(
      appErrorCode(
        t.mutation(api.switches.mutations.set, { key: "mcp", enabled: false }),
      ),
    ).resolves.toBe("unauthenticated");
    await expect(tables(t)).resolves.toStrictEqual({
      switches: [],
      switchLog: [],
    });
  });

  it.each<Role>(["user", "moderator"])(
    "refuses a %s and writes nothing",
    async (role) => {
      const t = setup();
      const { asUser } = await createUser(t, { role });
      await expect(
        appErrorCode(
          asUser.mutation(api.switches.mutations.set, {
            key: "mcp",
            enabled: false,
          }),
        ),
      ).resolves.toBe("forbidden");
      await expect(tables(t)).resolves.toStrictEqual({
        switches: [],
        switchLog: [],
      });
    },
  );

  it("lets an admin change a switch and logs the admin as by (R2.6)", async () => {
    const t = setup();
    const { userId, asUser } = await createUser(t, { role: "admin" });
    await expect(
      asUser.mutation(api.switches.mutations.set, {
        key: "scraping.source:parp-rss",
        enabled: false,
        reason: "broken feed",
      }),
    ).resolves.toStrictEqual({ backlogCount: 0 });

    const { switches, switchLog } = await tables(t);
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({
      key: "scraping.source:parp-rss",
      enabled: false,
      updatedBy: userId,
    });
    expect(switchLog).toHaveLength(1);
    expect(switchLog[0]).toMatchObject({
      key: "scraping.source:parp-rss",
      from: true,
      to: false,
      by: userId,
      reason: "broken feed",
    });
  });

  it("writes no log row for a no-op", async () => {
    const t = setup();
    const { asUser } = await createUser(t, { role: "admin" });
    await asUser.mutation(api.switches.mutations.set, {
      key: "discord",
      enabled: false,
    });
    await expect(tables(t)).resolves.toStrictEqual({
      switches: [],
      switchLog: [],
    });
  });

  it.each(["scrapping", "scraping.source:", "discord.channel:general"])(
    "throws invalid for the key %j",
    async (key) => {
      const t = setup();
      const { asUser } = await createUser(t, { role: "admin" });
      await expect(
        appErrorCode(
          asUser.mutation(api.switches.mutations.set, { key, enabled: true }),
        ),
      ).resolves.toBe("invalid");
      await expect(tables(t)).resolves.toStrictEqual({
        switches: [],
        switchLog: [],
      });
    },
  );

  it("throws invalid for a backlog mode on a key without a backlog", async () => {
    const t = setup();
    const { asUser } = await createUser(t, { role: "admin" });
    await expect(
      appErrorCode(
        asUser.mutation(api.switches.mutations.set, {
          key: "registration",
          enabled: true,
          backlog: "send",
        }),
      ),
    ).resolves.toBe("invalid");
    await expect(tables(t)).resolves.toStrictEqual({
      switches: [],
      switchLog: [],
    });
  });

  it("enforces R2.5 and accepts a backlog mode", async () => {
    const t = setup();
    const { userId, asUser } = await createUser(t, { role: "admin" });
    await asUser.mutation(api.switches.mutations.set, {
      key: "ai",
      enabled: false,
    });
    await seedWaitingAi(t);

    await expect(
      appErrorCode(
        asUser.mutation(api.switches.mutations.set, {
          key: "ai",
          enabled: true,
        }),
      ),
    ).resolves.toBe("conflict");
    await expect(
      asUser.mutation(api.switches.mutations.set, {
        key: "ai",
        enabled: true,
        backlog: "onlyNew",
      }),
    ).resolves.toStrictEqual({ backlogCount: 1 });

    const { switchLog } = await tables(t);
    expect(
      switchLog.map(({ from, to, by, backlog }) => ({ from, to, by, backlog })),
    ).toStrictEqual([
      { from: true, to: false, by: userId, backlog: undefined },
      { from: false, to: true, by: userId, backlog: "onlyNew" },
    ]);
  });
});

describe("internal.switches.cli.set", () => {
  it("changes a switch with no by", async () => {
    const t = setup();
    await expect(
      t.mutation(internal.switches.cli.set, {
        key: "registration",
        enabled: true,
      }),
    ).resolves.toStrictEqual({ backlogCount: 0 });
    const { switches, switchLog } = await tables(t);
    expect(switches[0]).not.toHaveProperty("updatedBy");
    expect(switchLog).toHaveLength(1);
    expect(switchLog[0]).toMatchObject({
      key: "registration",
      from: false,
      to: true,
    });
    expect(switchLog[0]).not.toHaveProperty("by");
  });

  it("throws invalid for an unknown key and enforces R2.5", async () => {
    const t = setup();
    await expect(
      appErrorCode(
        t.mutation(internal.switches.cli.set, {
          key: "scrapping",
          enabled: true,
        }),
      ),
    ).resolves.toBe("invalid");
    await t.mutation(internal.switches.cli.set, { key: "ai", enabled: false });
    await seedWaitingAi(t);
    await expect(
      appErrorCode(
        t.mutation(internal.switches.cli.set, { key: "ai", enabled: true }),
      ),
    ).resolves.toBe("conflict");
  });
});

describe("internal.switches.queries.get", () => {
  it("returns the default, then the stored value", async () => {
    const t = setup();
    await expect(
      t.query(internal.switches.queries.get, { key: "discord" }),
    ).resolves.toBe(false);
    await t.mutation(internal.switches.cli.set, {
      key: "discord",
      enabled: true,
    });
    await expect(
      t.query(internal.switches.queries.get, { key: "discord" }),
    ).resolves.toBe(true);
  });

  it("throws invalid for an unknown key", async () => {
    const t = setup();
    await expect(
      appErrorCode(
        t.query(internal.switches.queries.get, { key: "scraping.source:" }),
      ),
    ).resolves.toBe("invalid");
  });
});

describe("api.switches.queries.publicState", () => {
  it("answers an anonymous caller with the defaults", async () => {
    const t = setup();
    await expect(
      t.query(api.switches.queries.publicState, {}),
    ).resolves.toStrictEqual({
      registration: false,
      submitForm: true,
      mcp: true,
      sponsoring: false,
    });
  });

  it("follows switch changes", async () => {
    const t = setup();
    await t.mutation(internal.switches.cli.set, {
      key: "registration",
      enabled: true,
    });
    await t.mutation(internal.switches.cli.set, { key: "mcp", enabled: false });
    await expect(
      t.query(api.switches.queries.publicState, {}),
    ).resolves.toStrictEqual({
      registration: true,
      submitForm: true,
      mcp: false,
      sponsoring: false,
    });
  });
});

describe("internal.switches.backlog.processBatch", () => {
  const CHANNEL = "123";
  type Mode = "process" | "onlyNew" | "send" | "skip" | "pause";

  async function change(t: T, key: string, enabled: boolean, mode?: Mode) {
    await t.mutation(internal.switches.cli.set, {
      key,
      enabled,
      backlog: mode === "pause" ? undefined : mode,
    });
    return t.run(async (ctx) => {
      const latest = await ctx.db
        .query("switchLog")
        .withIndex("by_key_at", (q) => q.eq("key", key))
        .order("desc")
        .first();
      return latest!._id;
    });
  }

  async function startChain(t: T, key: string, mode: Mode) {
    const enabled = mode !== "pause";
    await t.mutation(internal.switches.cli.set, { key, enabled: !enabled });
    return change(t, key, enabled, mode);
  }

  function run(t: T, key: string, mode: Mode, cursor?: string) {
    return t.mutation(internal.switches.backlog.processBatch, {
      key,
      mode,
      cursor,
    });
  }

  function encoded(chain: string, page: string | null, position: number) {
    return JSON.stringify({ chain, page, position });
  }

  function snapshot(t: T) {
    return t.run(async (ctx) => ({
      switches: await ctx.db.query("switches").collect(),
      switchLog: await ctx.db.query("switchLog").collect(),
      outbox: await ctx.db.query("discordOutbox").collect(),
      rawItems: await ctx.db.query("rawItems").collect(),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
  }

  it.each([
    { key: "ai", mode: "process" },
    { key: "ai", mode: "onlyNew" },
    { key: "discord", mode: "send" },
    { key: `discord.channel:${CHANNEL}`, mode: "skip" },
    { key: `discord.crosspost:${CHANNEL}`, mode: "pause" },
  ] as const)(
    "runs $mode for $key on the latest change and stalls without rescheduling when a batch makes no progress",
    async ({ key, mode }) => {
      const t = setup();
      const chain = await startChain(t, key, mode);
      for (const cursor of [
        undefined,
        chain,
        encoded(chain, null, 0),
        encoded(chain, "page-2", 200),
      ]) {
        await expect(run(t, key, mode, cursor)).resolves.toBe("stalled");
      }
      await expect(scheduled(t)).resolves.toStrictEqual([]);
    },
  );

  it("on(send), off, on(skip) leaves only the new chain", async () => {
    const t = setup();
    const key = `discord.channel:${CHANNEL}`;
    await change(t, key, false);
    const sendChain = await change(t, key, true, "send");
    const pauseChain = await change(t, key, false, "pause");
    const skipChain = await change(t, key, true, "skip");

    await expect(run(t, key, "send", sendChain)).resolves.toBe("stopped");
    await expect(
      run(t, key, "send", encoded(sendChain, null, 100)),
    ).resolves.toBe("stopped");
    await expect(run(t, key, "send")).resolves.toBe("stopped");
    await expect(run(t, key, "pause", pauseChain)).resolves.toBe("stopped");
    await expect(run(t, key, "skip", skipChain)).resolves.toBe("stalled");
    await expect(run(t, key, "skip")).resolves.toBe("stalled");
  });

  it("a stale chain makes no writes", async () => {
    const t = setup();
    const sendChain = await startChain(t, "discord", "send");
    const offChain = await change(t, "discord", false, "pause");
    const onlyNewChain = await startChain(t, "ai", "onlyNew");
    await change(t, "ai", false);
    await t.run(async (ctx) => {
      const entryId = await ctx.db.insert("entries", {
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
      await ctx.db.insert("discordOutbox", {
        entryId,
        action: "create",
        channelId: CHANNEL,
        status: "paused",
        nonce: "a".repeat(20),
        attempts: 0,
      });
    });
    await seedWaitingAi(t);
    await change(t, "discord", true, "skip");
    const before = await snapshot(t);

    await expect(run(t, "discord", "send", sendChain)).resolves.toBe("stopped");
    await expect(
      run(t, "discord", "send", encoded(sendChain, null, 1)),
    ).resolves.toBe("stopped");
    await expect(run(t, "discord", "pause", offChain)).resolves.toBe("stopped");
    await expect(run(t, "ai", "onlyNew", onlyNewChain)).resolves.toBe(
      "stopped",
    );
    await expect(run(t, "ai", "onlyNew")).resolves.toBe("stopped");
    await expect(snapshot(t)).resolves.toStrictEqual(before);
  });

  it("stops when the key has never changed", async () => {
    const t = setup();
    await expect(run(t, "ai", "process")).resolves.toBe("stopped");
    await expect(run(t, "discord", "pause")).resolves.toBe("stopped");
  });

  it("stops a chain whose mode differs from the change that started it", async () => {
    const t = setup();
    const chain = await startChain(t, "discord", "send");
    await expect(run(t, "discord", "skip", chain)).resolves.toBe("stopped");
    await expect(run(t, "discord", "pause", chain)).resolves.toBe("stopped");
  });

  it("stops a chain started by another key's change", async () => {
    const t = setup();
    const otherChain = await startChain(t, "discord", "send");
    await startChain(t, `discord.channel:${CHANNEL}`, "send");
    await expect(
      run(t, `discord.channel:${CHANNEL}`, "send", otherChain),
    ).resolves.toBe("stopped");
  });

  it("throws invalid for a malformed cursor", async () => {
    const t = setup();
    const chain = await startChain(t, "discord", "send");
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    for (const cursor of [
      "",
      "c",
      "{}",
      "null",
      userId,
      encoded(userId, null, 0),
      encoded(chain, null, -1),
      encoded(chain, null, 1.5),
      JSON.stringify({ chain, page: 3, position: 0 }),
      JSON.stringify({ chain, page: null }),
      JSON.stringify({ chain, page: null, position: 0, extra: true }),
    ]) {
      await expect(
        appErrorCode(run(t, "discord", "send", cursor)),
      ).resolves.toBe("invalid");
    }
  });

  it.each([
    { key: "ai", mode: "send" },
    { key: "ai", mode: "pause" },
    { key: "discord", mode: "process" },
    { key: "discord.crosspost:123", mode: "onlyNew" },
    { key: "scraping", mode: "send" },
    { key: "ingest.source:manual", mode: "pause" },
    { key: "scrapping", mode: "send" },
    { key: "discord.channel:", mode: "pause" },
  ] as const)("throws invalid for $mode on $key", async ({ key, mode }) => {
    const t = setup();
    await expect(appErrorCode(run(t, key, mode))).resolves.toBe("invalid");
  });
});
