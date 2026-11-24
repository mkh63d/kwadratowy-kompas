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
  it.each([
    { key: "ai", mode: "process", enabled: true },
    { key: "ai", mode: "onlyNew", enabled: true },
    { key: "discord", mode: "send", enabled: true },
    { key: "discord.channel:123", mode: "skip", enabled: true },
    { key: "discord.crosspost:123", mode: "pause", enabled: false },
  ] as const)(
    "runs $mode for $key while the switch matches and leaves nothing scheduled",
    async ({ key, mode, enabled }) => {
      const t = setup();
      await t.mutation(internal.switches.cli.set, { key, enabled });
      await expect(
        t.mutation(internal.switches.backlog.processBatch, { key, mode }),
      ).resolves.toBe("done");
      await expect(scheduled(t)).resolves.toStrictEqual([]);
    },
  );

  it.each([
    { key: "ai", mode: "process" },
    { key: "discord.channel:123", mode: "send" },
    { key: "discord", mode: "pause" },
  ] as const)(
    "stops for $mode on $key when the switch no longer matches",
    async ({ key, mode }) => {
      const t = setup();
      await t.mutation(internal.switches.cli.set, {
        key,
        enabled: mode === "pause",
      });
      await expect(
        t.mutation(internal.switches.backlog.processBatch, {
          key,
          mode,
          cursor: "c",
        }),
      ).resolves.toBe("stopped");
      await expect(scheduled(t)).resolves.toStrictEqual([]);
    },
  );

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
    await expect(
      appErrorCode(
        t.mutation(internal.switches.backlog.processBatch, { key, mode }),
      ),
    ).resolves.toBe("invalid");
  });
});
