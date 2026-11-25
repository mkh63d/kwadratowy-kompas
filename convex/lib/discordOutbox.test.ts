import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  enqueueDiscord,
  pauseInScope,
  releasePaused,
  resolveRoute,
  skipOutboxRows,
} from "./discordOutbox";
import { insertEntry, type NewEntry } from "./entries";
import type { EntryStatus, OutboxAction } from "./enums";
import { setSwitch, type SwitchKey } from "./switches";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

const ROUTED = "111111111111111111";
const POSTED = "222222222222222222";
const OTHER = "333333333333333333";
const TAGGED = "444444444444444444";
const OVERRIDE = "555555555555555555";

const NOT_PUBLISHED: EntryStatus[] = [
  "pending",
  "rejected",
  "archived",
  "withdrawn",
];
const ANY_STATUS: EntryStatus[] = ["published", ...NOT_PUBLISHED];
const REFRESH = ["update", "pin", "crosspost", "remind"] as const;
const GATED = ["create", ...REFRESH] as const;
const UNGATED = ["unpin", "archive", "delete"] as const;
const ALL_ACTIONS: OutboxAction[] = [...GATED, ...UNGATED];

function newTest() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newTest>;
type RouteDoc = Partial<Doc<"discordRoutes">>;
type RowStatus = Doc<"discordOutbox">["status"];

function flip(t: T, key: SwitchKey, enabled: boolean) {
  return t.run((ctx) => setSwitch(ctx, { key, enabled }));
}

function addRoute(t: T, route: RouteDoc = {}) {
  return t.run((ctx) =>
    ctx.db.insert("discordRoutes", {
      entryType: "dofinansowanie",
      channelId: ROUTED,
      channelName: "granty",
      channelKind: "announcement",
      pingPolicy: "never",
      crosspost: true,
      ...route,
    }),
  );
}

// Discord on, one crosspost-capable route for the default entry type.
async function setup(): Promise<T> {
  const t = newTest();
  await t.mutation(internal.sources.seed.run, {});
  await flip(t, "discord", true);
  await addRoute(t);
  return t;
}

function addEntry(
  t: T,
  fields: Partial<NewEntry> = {},
  patch: Partial<Doc<"entries">> = {},
) {
  return t.run(async (ctx) => {
    const { sponsored, ...rest } = fields;
    const id = await insertEntry(ctx, {
      type: "dofinansowanie",
      title: "Grant dla startupów",
      summary: "Do 50 000 zł na MVP.",
      sourceKey: "manual",
      ...rest,
    });
    // `insertEntry` refuses sponsored entries while the switch is off, the default.
    await ctx.db.patch(id, {
      status: "published",
      publishedAt: Date.now(),
      sponsored: sponsored ?? false,
      ...patch,
    });
    return id;
  });
}

function addPost(
  t: T,
  entryId: Id<"entries">,
  post: Partial<Doc<"discordPosts">> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("discordPosts", {
      entryId,
      kind: "main",
      channelId: POSTED,
      messageId: "900000000000000001",
      contentHash: "hash",
      pinned: false,
      ...post,
    }),
  );
}

function addRow(
  t: T,
  entryId: Id<"entries">,
  action: OutboxAction,
  status: RowStatus = "pending",
) {
  return t.run((ctx) =>
    ctx.db.insert("discordOutbox", {
      entryId,
      action,
      channelId: POSTED,
      status,
      nonce: "a".repeat(20),
      attempts: 0,
    }),
  );
}

function enqueue(
  t: T,
  entryId: Id<"entries">,
  action: OutboxAction,
  extra: { suppressNotifications?: boolean } = {},
) {
  return t.run((ctx) => enqueueDiscord(ctx, { entryId, action, ...extra }));
}

async function enqueueRow(t: T, entryId: Id<"entries">, action: OutboxAction) {
  const result = await enqueue(t, entryId, action);
  if (result.kind === "skipped") throw new Error(result.reason);
  return result.outboxId;
}

function rows(t: T) {
  return t.run((ctx) => ctx.db.query("discordOutbox").collect());
}

function row(t: T, id: Id<"discordOutbox">) {
  return t.run(async (ctx) => (await ctx.db.get(id))!);
}

async function deliveries(t: T) {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return jobs.filter((job) => job.name === "discord/actions:deliver");
}

const skippedBy = (reason: string) => ({ kind: "skipped", reason });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enqueueDiscord: queued row", () => {
  it("stores a pending row and schedules exactly one deliver for it", async () => {
    const t = await setup();
    const entryId = await addEntry(t);

    const result = await enqueue(t, entryId, "create");

    expect(result.kind).toBe("queued");
    const [stored, ...others] = await rows(t);
    const [job, ...otherJobs] = await deliveries(t);
    expect(others).toStrictEqual([]);
    expect(otherJobs).toStrictEqual([]);
    expect(stored).toMatchObject({
      entryId,
      action: "create",
      channelId: ROUTED,
      status: "pending",
      attempts: 0,
      scheduledFunctionId: job._id,
    });
    expect(result).toHaveProperty("outboxId", stored._id);
    expect(job.args).toStrictEqual([{ outboxId: stored._id }]);
  });

  it("gives every row its own nonce of 20 chars [a-z0-9]", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    for (const action of ["update", "pin", "remind"] as const) {
      await enqueue(t, entryId, action);
    }

    const nonces = (await rows(t)).map((stored) => stored.nonce);

    for (const nonce of nonces) expect(nonce).toMatch(/^[a-z0-9]{20}$/);
    expect(new Set(nonces).size).toBe(3);
  });

  it("stores suppressNotifications", async () => {
    const t = await setup();
    const entryId = await addEntry(t);

    await enqueue(t, entryId, "create", { suppressNotifications: true });

    expect((await rows(t))[0].suppressNotifications).toBe(true);
  });

  it.each(["discord", `discord.channel:${ROUTED}`] as const)(
    "stores a paused row and schedules nothing while %s is off",
    async (key) => {
      const t = await setup();
      await flip(t, key, false);
      const entryId = await addEntry(t);

      const result = await enqueue(t, entryId, "create");

      expect(result.kind).toBe("paused");
      const [stored] = await rows(t);
      expect(stored.status).toBe("paused");
      expect(stored.scheduledFunctionId).toBeUndefined();
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it("pauses by default: the discord switch starts off", async () => {
    const t = newTest();
    await t.mutation(internal.sources.seed.run, {});
    await addRoute(t);

    const result = await enqueue(t, await addEntry(t), "create");

    expect(result.kind).toBe("paused");
  });

  it("runs the scheduled deliver stub and the retry stub", async () => {
    const t = await setup();
    await enqueue(t, await addEntry(t), "create");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await deliveries(t))[0].state.kind).toBe("success");
    expect(await t.mutation(internal.discord.crons.retry, {})).toBeNull();
  });

  it("throws not_found for a missing entry", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await t.run((ctx) => ctx.db.delete(entryId));

    const error = await enqueue(t, entryId, "delete").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConvexError);
    expect(error).toHaveProperty("data.code", "not_found");
  });
});

describe("§8.4 entry must be published (post and refresh groups)", () => {
  it.each(
    GATED.flatMap((action) =>
      NOT_PUBLISHED.map((status) => [action, status] as const),
    ),
  )("%s refuses a %s entry", async (action, status) => {
    const t = await setup();
    const entryId = await addEntry(t, {}, { status });
    await addPost(t, entryId);

    expect(await enqueue(t, entryId, action)).toStrictEqual(
      skippedBy("not_published"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
  });

  it.each(GATED)("%s refuses a merged entry", async (action) => {
    const t = await setup();
    const target = await addEntry(t);
    const entryId = await addEntry(t, {}, { mergedInto: target });
    await addPost(t, entryId);

    expect(await enqueue(t, entryId, action)).toStrictEqual(
      skippedBy("not_published"),
    );
    expect(await rows(t)).toStrictEqual([]);
  });
});

describe("§8.4 entry in any status (unpin and teardown groups)", () => {
  it.each(
    UNGATED.flatMap((action) =>
      ANY_STATUS.map((status) => [action, status] as const),
    ),
  )("%s is queued for a %s entry", async (action, status) => {
    const t = await setup();
    const entryId = await addEntry(t, {}, { status });
    await addPost(t, entryId);

    expect((await enqueue(t, entryId, action)).kind).toBe("queued");
    expect(await deliveries(t)).toHaveLength(1);
  });
});

describe("§8.4 sponsoring gate", () => {
  it.each(GATED)("%s refuses a sponsored entry while off", async (action) => {
    const t = await setup();
    const entryId = await addEntry(t, { sponsored: true });
    await addPost(t, entryId);

    expect(await enqueue(t, entryId, action)).toStrictEqual(
      skippedBy("sponsoring_off"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
  });

  it.each(UNGATED)("%s is allowed for it while off", async (action) => {
    const t = await setup();
    const entryId = await addEntry(t, { sponsored: true });
    await addPost(t, entryId);

    expect((await enqueue(t, entryId, action)).kind).toBe("queued");
  });

  it.each(GATED)("%s is queued for it while on", async (action) => {
    const t = await setup();
    await flip(t, "sponsoring", true);
    const entryId = await addEntry(t, { sponsored: true });
    if (action !== "create") await addPost(t, entryId, { channelId: ROUTED });

    expect((await enqueue(t, entryId, action)).kind).toBe("queued");
  });
});

describe("§8.4 channel", () => {
  it("create goes to the resolved route's channel", async () => {
    const t = await setup();
    await enqueue(t, await addEntry(t), "create");

    expect((await rows(t))[0].channelId).toBe(ROUTED);
  });

  it("create returns no_route and writes nothing without a route", async () => {
    const t = await setup();
    const entryId = await addEntry(t, { type: "konkurs" });

    expect(await enqueue(t, entryId, "create")).toStrictEqual(
      skippedBy("no_route"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
  });

  it.each([...REFRESH, ...UNGATED])(
    "%s uses the main post's channel after the route and override changed (R4.8)",
    async (action) => {
      const t = await setup();
      await addRoute(t, { channelId: POSTED, entryType: "konkurs" });
      const entryId = await addEntry(
        t,
        {},
        { discordChannelOverride: OVERRIDE },
      );
      await addPost(t, entryId);

      await enqueue(t, entryId, action);

      expect((await rows(t))[0]).toMatchObject({ action, channelId: POSTED });
    },
  );

  it.each([...REFRESH, ...UNGATED])(
    "%s needs no route when a main post exists",
    async (action) => {
      const t = await setup();
      const entryId = await addEntry(t, { type: "konkurs" });
      await addRoute(t, { channelId: POSTED, entryType: "event" });
      await addPost(t, entryId);

      expect((await enqueue(t, entryId, action)).kind).toBe("queued");
    },
  );

  it("is switched by the main post's channel, not the routed one", async () => {
    const t = await setup();
    await flip(t, `discord.channel:${POSTED}`, false);
    const entryId = await addEntry(t);
    await addPost(t, entryId);

    expect((await enqueue(t, entryId, "update")).kind).toBe("paused");
  });
});

describe("§8.4 main post", () => {
  it("create becomes update when a main post exists", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);

    expect((await enqueue(t, entryId, "create")).kind).toBe("queued");

    expect(await rows(t)).toMatchObject([
      { action: "update", channelId: POSTED },
    ]);
  });

  it("create stays a create when the main post is deleted", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId, { deletedAt: Date.now() });

    await enqueue(t, entryId, "create");

    expect(await rows(t)).toMatchObject([
      { action: "create", channelId: ROUTED },
    ]);
  });

  it("a reminder post is not the main post", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId, { kind: "reminder" });

    expect(await enqueue(t, entryId, "update")).toStrictEqual(
      skippedBy("no_post"),
    );
  });

  it.each(["pending", "paused"] as const)(
    "update folds into a %s create",
    async (status) => {
      const t = await setup();
      const entryId = await addEntry(t);
      const createId = await addRow(t, entryId, "create", status);
      if (status === "paused") await flip(t, "discord", false);

      expect(await enqueue(t, entryId, "update")).toStrictEqual({
        kind: "coalesced",
        outboxId: createId,
      });
      expect(await rows(t)).toMatchObject([{ action: "create", status }]);
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it.each(["sent", "failed", "needs_review", "skipped"] as const)(
    "update does not fold into a %s create",
    async (status) => {
      const t = await setup();
      const entryId = await addEntry(t);
      await addRow(t, entryId, "create", status);

      expect(await enqueue(t, entryId, "update")).toStrictEqual(
        skippedBy("no_post"),
      );
    },
  );

  it.each(REFRESH)("%s returns no_post without any row", async (action) => {
    const t = await setup();
    const entryId = await addEntry(t);

    expect(await enqueue(t, entryId, action)).toStrictEqual(
      skippedBy("no_post"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
  });

  it.each(["pin", "crosspost", "remind"] as const)(
    "%s returns no_post and leaves a pending create intact",
    async (action) => {
      const t = await setup();
      const entryId = await addEntry(t);
      const createId = await enqueueRow(t, entryId, "create");
      const before = await row(t, createId);

      expect(await enqueue(t, entryId, action)).toStrictEqual(
        skippedBy("no_post"),
      );
      expect(await rows(t)).toStrictEqual([before]);
      expect((await deliveries(t))[0].state.kind).toBe("pending");
    },
  );

  it.each(["pending", "paused"] as const)(
    "unpin with a %s create skips only pin rows",
    async (status) => {
      const t = await setup();
      const entryId = await addEntry(t);
      const createId = await addRow(t, entryId, "create", status);
      const pinId = await addRow(t, entryId, "pin", status);
      const updateId = await addRow(t, entryId, "update", status);

      expect(await enqueue(t, entryId, "unpin")).toStrictEqual(
        skippedBy("no_post"),
      );

      expect(await row(t, pinId)).toMatchObject({
        status: "skipped",
        skipReason: "cancelled_by_teardown",
      });
      expect((await row(t, createId)).status).toBe(status);
      expect((await row(t, updateId)).status).toBe(status);
      expect(await rows(t)).toHaveLength(3);
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it("unpin returns no_post without any row", async () => {
    const t = await setup();
    const entryId = await addEntry(t);

    expect(await enqueue(t, entryId, "unpin")).toStrictEqual(
      skippedBy("no_post"),
    );
    expect(await rows(t)).toStrictEqual([]);
  });

  it("unpin leaves pin rows alone when a main post exists", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    const pinId = await enqueueRow(t, entryId, "pin");

    expect((await enqueue(t, entryId, "unpin")).kind).toBe("queued");

    expect((await row(t, pinId)).status).toBe("pending");
  });

  it.each(
    (["archive", "delete"] as const).flatMap((action) =>
      (["pending", "paused"] as const).map(
        (status) => [action, status] as const,
      ),
    ),
  )("%s cancels a %s create", async (action, status) => {
    const t = await setup();
    await flip(t, "discord", status === "pending");
    const entryId = await addEntry(t);
    const createId = await enqueueRow(t, entryId, "create");

    expect(await enqueue(t, entryId, action)).toStrictEqual(
      skippedBy("cancelled_create"),
    );

    expect(await rows(t)).toMatchObject([
      {
        _id: createId,
        status: "skipped",
        skipReason: "cancelled_by_teardown",
      },
    ]);
    expect((await deliveries(t)).map((job) => job.state.kind)).toStrictEqual(
      status === "pending" ? ["canceled"] : [],
    );
  });

  it.each(["archive", "delete"] as const)(
    "%s returns no_post without a post or an open create",
    async (action) => {
      const t = await setup();
      const entryId = await addEntry(t);
      await addRow(t, entryId, "create", "failed");

      expect(await enqueue(t, entryId, action)).toStrictEqual(
        skippedBy("no_post"),
      );
      expect(await rows(t)).toMatchObject([{ status: "failed" }]);
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it.each(["archive", "delete"] as const)(
    "%s treats a deleted main post as no post",
    async (action) => {
      const t = await setup();
      const entryId = await addEntry(t);
      await addPost(t, entryId, { deletedAt: Date.now() });

      expect(await enqueue(t, entryId, action)).toStrictEqual(
        skippedBy("no_post"),
      );
    },
  );
});

describe("delete supersedes open rows", () => {
  it("skips every pending and paused row of the entry, cancelling their jobs", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    const other = await addEntry(t);
    const updateId = await enqueueRow(t, entryId, "update");
    const pausedIds: Id<"discordOutbox">[] = [];
    for (const action of [
      "create",
      "pin",
      "unpin",
      "crosspost",
      "remind",
      "archive",
    ] as const) {
      pausedIds.push(await addRow(t, entryId, action, "paused"));
    }
    const keptIds = [
      await addRow(t, entryId, "remind", "sent"),
      await addRow(t, entryId, "crosspost", "failed"),
      await addRow(t, other, "update", "pending"),
    ];

    const result = await enqueue(t, entryId, "delete");

    expect(result.kind).toBe("queued");
    for (const id of [updateId, ...pausedIds]) {
      expect(await row(t, id)).toMatchObject({
        status: "skipped",
        skipReason: "superseded_by_delete",
      });
    }
    expect(
      await Promise.all(keptIds.map(async (id) => (await row(t, id)).status)),
    ).toStrictEqual(["sent", "failed", "pending"]);
    expect((await deliveries(t)).map((job) => job.state.kind)).toStrictEqual([
      "canceled",
      "pending",
    ]);
  });

  it("keeps an open delete row and coalesces into it", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    const deleteId = await enqueueRow(t, entryId, "delete");

    expect(await enqueue(t, entryId, "delete")).toStrictEqual({
      kind: "coalesced",
      outboxId: deleteId,
    });
    expect((await row(t, deleteId)).status).toBe("pending");
  });

  it("supersedes the other open rows even without a main post", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    const createId = await addRow(t, entryId, "create");
    const archiveId = await addRow(t, entryId, "archive", "paused");

    expect(await enqueue(t, entryId, "delete")).toStrictEqual(
      skippedBy("cancelled_create"),
    );

    expect((await row(t, createId)).skipReason).toBe("cancelled_by_teardown");
    expect((await row(t, archiveId)).skipReason).toBe("superseded_by_delete");
  });

  it("archive supersedes nothing", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    const updateId = await enqueueRow(t, entryId, "update");

    await enqueue(t, entryId, "archive");

    expect((await row(t, updateId)).status).toBe("pending");
  });
});

describe("coalescing on (entryId, action)", () => {
  it.each(
    ALL_ACTIONS.flatMap((action) =>
      (["pending", "paused"] as const).map(
        (status) => [action, status] as const,
      ),
    ),
  )("%s coalesces into a %s row", async (action, status) => {
    const t = await setup();
    const entryId = await addEntry(t);
    if (action !== "create") await addPost(t, entryId, { channelId: ROUTED });
    const openId = await addRow(t, entryId, action, status);
    if (status === "paused") await flip(t, "discord", false);

    expect(await enqueue(t, entryId, action)).toStrictEqual({
      kind: "coalesced",
      outboxId: openId,
    });
    expect(await rows(t)).toMatchObject([{ _id: openId, status }]);
    expect(await deliveries(t)).toStrictEqual([]);
  });

  it.each(["sent", "failed", "needs_review", "skipped"] as const)(
    "a %s row does not absorb a new one",
    async (status) => {
      const t = await setup();
      const entryId = await addEntry(t);
      await addPost(t, entryId);
      await addRow(t, entryId, "update", status);

      expect((await enqueue(t, entryId, "update")).kind).toBe("queued");
      expect(await rows(t)).toHaveLength(2);
    },
  );

  it("does not coalesce across actions or entries", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    const other = await addEntry(t);
    await addPost(t, entryId);
    await addRow(t, entryId, "pin");
    await addRow(t, other, "update");

    expect((await enqueue(t, entryId, "update")).kind).toBe("queued");
  });
});

describe("crosspost gating (R4.3)", () => {
  async function posted(patch: Partial<Doc<"entries">> = {}) {
    const t = await setup();
    const entryId = await addEntry(t, {}, patch);
    await addPost(t, entryId, { channelId: ROUTED });
    return { t, entryId };
  }

  async function expectRefused(t: T, entryId: Id<"entries">) {
    expect(await enqueue(t, entryId, "crosspost")).toStrictEqual(
      skippedBy("no_crosspost"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
  }

  it("is queued when entry, channel and switch allow it", async () => {
    const { t, entryId } = await posted();

    expect((await enqueue(t, entryId, "crosspost")).kind).toBe("queued");
  });

  it("refuses an entry with noCrosspost", async () => {
    const { t, entryId } = await posted({ noCrosspost: true });

    await expectRefused(t, entryId);
  });

  it("refuses a channel whose routes all forbid it", async () => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, crosspost: false });
    const entryId = await addEntry(t);
    await addPost(t, entryId, { channelId: OTHER });

    await expectRefused(t, entryId);
  });

  it("refuses a channel without any route", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId, { channelId: OTHER });

    await expectRefused(t, entryId);
  });

  it("is allowed when any route on the channel allows it", async () => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, crosspost: false });
    await addRoute(t, {
      channelId: OTHER,
      entryType: "konkurs",
      crosspost: true,
    });
    const entryId = await addEntry(t);
    await addPost(t, entryId, { channelId: OTHER });

    expect((await enqueue(t, entryId, "crosspost")).kind).toBe("queued");
  });

  it("refuses while discord.crosspost:<channelId> is off", async () => {
    const { t, entryId } = await posted();
    await flip(t, `discord.crosspost:${ROUTED}`, false);

    await expectRefused(t, entryId);
    expect((await enqueue(t, entryId, "update")).kind).toBe("queued");
  });

  it.each(["discord", `discord.channel:${ROUTED}`] as const)(
    "is paused while %s is off",
    async (key) => {
      const { t, entryId } = await posted();
      await flip(t, key, false);

      expect((await enqueue(t, entryId, "crosspost")).kind).toBe("paused");
    },
  );
});

describe("resolveRoute (§8.3)", () => {
  function resolve(t: T, entryId: Id<"entries">) {
    return t.run(async (ctx) =>
      resolveRoute(ctx, (await ctx.db.get(entryId))!),
    );
  }

  it.each([true, false])(
    "uses the override channel; crosspost %s as its routes say",
    async (crosspost) => {
      const t = await setup();
      await addRoute(t, {
        channelId: OVERRIDE,
        entryType: "konkurs",
        crosspost,
      });
      const entryId = await addEntry(
        t,
        {},
        { discordChannelOverride: OVERRIDE },
      );

      expect(await resolve(t, entryId)).toStrictEqual({
        channelId: OVERRIDE,
        crosspost,
      });
    },
  );

  it("uses an override channel that has no route, without crosspost", async () => {
    const t = await setup();
    const entryId = await addEntry(
      t,
      { type: "news" },
      { discordChannelOverride: OVERRIDE },
    );

    expect(await resolve(t, entryId)).toStrictEqual({
      channelId: OVERRIDE,
      crosspost: false,
    });
  });

  it("routes a paid, unsponsored szkolenie as an event", async () => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, entryType: "szkolenie" });
    await addRoute(t, { channelId: TAGGED, entryType: "event" });
    const entryId = await addEntry(t, { type: "szkolenie", cost: "paid" });

    expect((await resolve(t, entryId))?.channelId).toBe(TAGGED);
  });

  it.each<[string, Partial<NewEntry>]>([
    ["free", { cost: "free" }],
    ["subsidised", { cost: "subsidised" }],
    ["without cost", {}],
    ["paid but sponsored", { cost: "paid", sponsored: true }],
  ])("routes a %s szkolenie as szkolenie", async (_label, fields) => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, entryType: "szkolenie" });
    await addRoute(t, { channelId: TAGGED, entryType: "event" });
    const entryId = await addEntry(t, { type: "szkolenie", ...fields });

    expect((await resolve(t, entryId))?.channelId).toBe(OTHER);
  });

  it("prefers the first of the entry's tags that has a route", async () => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, tag: "fintech" });
    await addRoute(t, { channelId: TAGGED, tag: "ai" });
    const entryId = await addEntry(t, { tags: ["brak", "fintech", "ai"] });

    expect((await resolve(t, entryId))?.channelId).toBe(OTHER);
  });

  it("does not fall back to a szkolenie route for a paid szkolenie", async () => {
    const t = await setup();
    await addRoute(t, { channelId: OTHER, entryType: "szkolenie" });
    const entryId = await addEntry(t, { type: "szkolenie", cost: "paid" });

    expect(await resolve(t, entryId)).toBeNull();
  });

  it("falls back to the untagged route of the type", async () => {
    const t = newTest();
    await t.mutation(internal.sources.seed.run, {});
    await addRoute(t, { channelId: TAGGED, tag: "ai" });
    await addRoute(t, { channelId: OTHER, crosspost: false });
    const entryId = await addEntry(t, { tags: ["fintech"] });

    expect(await resolve(t, entryId)).toStrictEqual({
      channelId: OTHER,
      crosspost: false,
    });
  });

  it("returns null when only another type or another tag has a route", async () => {
    const t = await setup();
    await addRoute(t, { channelId: TAGGED, entryType: "konkurs", tag: "ai" });
    const entryId = await addEntry(t, { type: "konkurs", tags: ["fintech"] });

    expect(await resolve(t, entryId)).toBeNull();
  });
});

describe("malformed channel id (R4.4)", () => {
  const cases = ["", "#granty"].flatMap((channelId) =>
    [true, false].map((discordOn) => [channelId, discordOn] as const),
  );

  async function expectNoRoute(t: T, entryId: Id<"entries">) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await enqueue(t, entryId, "create")).toStrictEqual(
      skippedBy("no_route"),
    );
    expect(await rows(t)).toStrictEqual([]);
    expect(await deliveries(t)).toStrictEqual([]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(entryId),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(cases)(
    "override %j is no_route, without falling through (discord on: %s)",
    async (channelId, discordOn) => {
      const t = await setup();
      await flip(t, "discord", discordOn);
      const entryId = await addEntry(
        t,
        {},
        { discordChannelOverride: channelId },
      );

      await expectNoRoute(t, entryId);
    },
  );

  it.each(cases)(
    "configured route %j is no_route (discord on: %s)",
    async (channelId, discordOn) => {
      const t = await setup();
      await flip(t, "discord", discordOn);
      await addRoute(t, { channelId, entryType: "konkurs" });
      const entryId = await addEntry(t, { type: "konkurs" });

      await expectNoRoute(t, entryId);
    },
  );

  it.each<[string, RouteDoc]>([
    ["a tagged route", { tag: "ai" }],
    ["another route for the same type", {}],
  ])("passes over %s with a malformed id", async (_label, bad) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = newTest();
    await t.mutation(internal.sources.seed.run, {});
    await addRoute(t, { ...bad, channelId: "#granty" });
    await addRoute(t, { channelId: OTHER });
    const entryId = await addEntry(t, { tags: ["ai"] });

    const route = await t.run(async (ctx) =>
      resolveRoute(ctx, (await ctx.db.get(entryId))!),
    );

    expect(route?.channelId).toBe(OTHER);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("skipOutboxRows", () => {
  it("skips only open rows of the given actions, cancels their jobs and counts them", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    const other = await addEntry(t);
    await addPost(t, entryId);
    await addPost(t, other, { messageId: "900000000000000002" });
    const updateId = await enqueueRow(t, entryId, "update");
    const pinId = await enqueueRow(t, entryId, "pin");
    const otherEntryId = await enqueueRow(t, other, "update");
    const pausedId = await addRow(t, entryId, "remind", "paused");
    const keptIds = [
      await addRow(t, entryId, "update", "sent"),
      await addRow(t, entryId, "update", "failed"),
      await addRow(t, entryId, "update", "needs_review"),
    ];

    const count = await t.run((ctx) =>
      skipOutboxRows(ctx, {
        entryId,
        actions: ["update", "remind", "update"],
        reason: "recheck_refused",
      }),
    );

    expect(count).toBe(2);
    for (const id of [updateId, pausedId]) {
      expect(await row(t, id)).toMatchObject({
        status: "skipped",
        skipReason: "recheck_refused",
      });
    }
    for (const id of [pinId, otherEntryId, ...keptIds]) {
      expect((await row(t, id)).skipReason).toBeUndefined();
    }
    expect((await deliveries(t)).map((job) => job.state.kind)).toStrictEqual([
      "canceled",
      "pending",
      "pending",
    ]);
  });

  it("leaves a finished job as it is", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    const createId = await enqueueRow(t, entryId, "create");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const count = await t.run((ctx) =>
      skipOutboxRows(ctx, {
        entryId,
        actions: ["create"],
        reason: "cancelled_by_restore",
      }),
    );

    expect(count).toBe(1);
    expect((await row(t, createId)).skipReason).toBe("cancelled_by_restore");
    expect((await deliveries(t))[0].state.kind).toBe("success");
  });

  it("returns 0 when nothing is open", async () => {
    const t = await setup();
    const entryId = await addEntry(t);

    const count = await t.run((ctx) =>
      skipOutboxRows(ctx, {
        entryId,
        actions: ["archive"],
        reason: "cancelled_by_restore",
      }),
    );

    expect(count).toBe(0);
  });
});

function latestChange(t: T, key: SwitchKey) {
  return t.run(async (ctx) => {
    const change = await ctx.db
      .query("switchLog")
      .withIndex("by_key_at", (q) => q.eq("key", key))
      .order("desc")
      .first();
    return change!;
  });
}

// Runs the first batch of the chain without firing the timers, so `deliver` jobs stay pending.
async function runChain(t: T, key: SwitchKey) {
  const change = await latestChange(t, key);
  return t.mutation(internal.switches.backlog.processBatch, {
    key,
    mode: change.to ? change.backlog! : "pause",
    cursor: change._id,
  });
}

async function turnOn(t: T, key: SwitchKey, backlog: "send" | "skip") {
  await t.run((ctx) => setSwitch(ctx, { key, enabled: true, backlog }));
  return runChain(t, key);
}

function statuses(t: T, ids: Id<"discordOutbox">[]) {
  return Promise.all(ids.map(async (id) => (await row(t, id)).status));
}

describe("coalescing into a paused row while its switches are on (§6.3)", () => {
  async function expectReleased(t: T, outboxId: Id<"discordOutbox">) {
    const [job, ...others] = await deliveries(t);
    expect(others).toStrictEqual([]);
    expect(job.args).toStrictEqual([{ outboxId }]);
    expect(await row(t, outboxId)).toMatchObject({
      status: "pending",
      scheduledFunctionId: job._id,
    });
  }

  it.each(ALL_ACTIONS)("releases the paused %s row", async (action) => {
    const t = await setup();
    const entryId = await addEntry(t);
    if (action !== "create") await addPost(t, entryId, { channelId: ROUTED });
    const openId = await addRow(t, entryId, action, "paused");

    expect(await enqueue(t, entryId, action)).toStrictEqual({
      kind: "coalesced",
      outboxId: openId,
    });
    await expectReleased(t, openId);
  });

  it("releases a paused create that an update folds into", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    const createId = await addRow(t, entryId, "create", "paused");

    expect(await enqueue(t, entryId, "update")).toStrictEqual({
      kind: "coalesced",
      outboxId: createId,
    });
    await expectReleased(t, createId);
  });

  it.each(["discord", `discord.channel:${POSTED}`] as const)(
    "leaves a create paused under an update while %s is off",
    async (key) => {
      const t = await setup();
      await flip(t, key, false);
      const entryId = await addEntry(t);
      const createId = await addRow(t, entryId, "create", "paused");

      await enqueue(t, entryId, "update");

      expect((await row(t, createId)).status).toBe("paused");
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it("keeps a new event that arrives before a skip chain reaches its row", async () => {
    const t = await setup();
    await flip(t, "discord", false);
    const entryId = await addEntry(t);
    const createId = await enqueueRow(t, entryId, "create");
    await t.run((ctx) =>
      setSwitch(ctx, { key: "discord", enabled: true, backlog: "skip" }),
    );

    await enqueue(t, entryId, "create");
    await runChain(t, "discord");

    expect((await row(t, createId)).status).toBe("pending");
  });
});

describe("discord backlog scopes (§6.3)", () => {
  const CROSSPOST = `discord.crosspost:${ROUTED}` as const;
  const CHANNEL = `discord.channel:${ROUTED}` as const;
  const SCOPES = [
    { key: "discord", inScope: [true, true, true, true] },
    { key: CHANNEL, inScope: [true, true, false, false] },
    { key: CROSSPOST, inScope: [false, true, false, false] },
  ] as const;

  async function seedRows(t: T, status: RowStatus) {
    const entryId = await addEntry(t);
    const ids: Id<"discordOutbox">[] = [];
    for (const [channelId, action] of [
      [ROUTED, "update"],
      [ROUTED, "crosspost"],
      [OTHER, "update"],
      [OTHER, "crosspost"],
    ] as const) {
      const id = await addRow(t, entryId, action, status);
      await t.run((ctx) => ctx.db.patch(id, { channelId }));
      ids.push(id);
    }
    return ids;
  }

  function expected(
    inScope: readonly boolean[],
    changed: RowStatus,
    kept: RowStatus,
  ) {
    return inScope.map((hit) => (hit ? changed : kept));
  }

  it("pauses pending rows and cancels their jobs when discord goes off", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    await addPost(t, entryId);
    const ids = [
      await enqueueRow(t, entryId, "update"),
      await enqueueRow(t, entryId, "pin"),
    ];
    const sentId = await addRow(t, entryId, "remind", "sent");
    await flip(t, "discord", false);

    expect(await runChain(t, "discord")).toBe("done");

    expect(await statuses(t, [...ids, sentId])).toStrictEqual([
      "paused",
      "paused",
      "sent",
    ]);
    expect((await deliveries(t)).map((job) => job.state.kind)).toStrictEqual([
      "canceled",
      "canceled",
    ]);
  });

  it.each(SCOPES)(
    "$key off pauses only its pending rows",
    async ({ key, inScope }) => {
      const t = await setup();
      const ids = await seedRows(t, "pending");
      await flip(t, key, false);

      await runChain(t, key);

      expect(await statuses(t, ids)).toStrictEqual(
        expected(inScope, "paused", "pending"),
      );
    },
  );

  it.each(SCOPES)(
    "$key on with send releases and schedules only its paused rows",
    async ({ key, inScope }) => {
      const t = await setup();
      await flip(t, key, false);
      const ids = await seedRows(t, "paused");

      expect(await turnOn(t, key, "send")).toBe("done");

      expect(await statuses(t, ids)).toStrictEqual(
        expected(inScope, "pending", "paused"),
      );
      const released = ids.filter((_, i) => inScope[i]);
      const jobs = await deliveries(t);
      expect(jobs.map((job) => job.args[0] as unknown)).toStrictEqual(
        released.map((outboxId) => ({ outboxId })),
      );
      for (const [i, id] of released.entries()) {
        expect((await row(t, id)).scheduledFunctionId).toBe(jobs[i]._id);
      }
    },
  );

  it.each(SCOPES)(
    "$key on with skip skips only its paused rows",
    async ({ key, inScope }) => {
      const t = await setup();
      await flip(t, key, false);
      const ids = await seedRows(t, "paused");

      await turnOn(t, key, "skip");

      expect(await statuses(t, ids)).toStrictEqual(
        expected(inScope, "skipped", "paused"),
      );
      for (const [i, id] of ids.entries()) {
        expect((await row(t, id)).skipReason).toBe(
          inScope[i] ? "backlog_skipped" : undefined,
        );
      }
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it.each([
    { off: CHANNEL, released: [false, false, true, true] },
    { off: CROSSPOST, released: [true, false, true, true] },
  ])(
    "a discord send leaves paused the rows held by $off",
    async ({ off, released }) => {
      const t = await setup();
      await flip(t, "discord", false);
      await flip(t, off, false);
      const ids = await seedRows(t, "paused");

      expect(await turnOn(t, "discord", "send")).toBe("done");

      expect(await statuses(t, ids)).toStrictEqual(
        expected(released, "pending", "paused"),
      );
    },
  );

  it.each([
    { key: CHANNEL, off: "discord" },
    { key: CROSSPOST, off: "discord" },
    { key: CROSSPOST, off: CHANNEL },
  ] as const)(
    "a $key send releases nothing while $off is off",
    async ({ key, off }) => {
      const t = await setup();
      await flip(t, off, false);
      await flip(t, key, false);
      const ids = await seedRows(t, "paused");

      expect(await turnOn(t, key, "send")).toBe("done");

      expect(await statuses(t, ids)).toStrictEqual([
        "paused",
        "paused",
        "paused",
        "paused",
      ]);
      expect(await deliveries(t)).toStrictEqual([]);
    },
  );

  it("skip also takes delete rows and rows held by another switch", async () => {
    const t = await setup();
    await flip(t, "discord", false);
    await flip(t, CHANNEL, false);
    const entryId = await addEntry(t);
    const ids = [await addRow(t, entryId, "delete", "paused")];
    const heldId = await addRow(t, entryId, "update", "paused");
    await t.run((ctx) => ctx.db.patch(heldId, { channelId: ROUTED }));

    await turnOn(t, "discord", "skip");

    expect(await statuses(t, [...ids, heldId])).toStrictEqual([
      "skipped",
      "skipped",
    ]);
  });

  it("a send leaves a row with a malformed channel id paused", async () => {
    const t = await setup();
    await flip(t, "discord", false);
    const entryId = await addEntry(t);
    const badId = await addRow(t, entryId, "update", "paused");
    await t.run((ctx) => ctx.db.patch(badId, { channelId: "#granty" }));
    const goodId = await addRow(t, entryId, "pin", "paused");

    expect(await turnOn(t, "discord", "send")).toBe("done");

    expect(await statuses(t, [badId, goodId])).toStrictEqual([
      "paused",
      "pending",
    ]);
  });

  it("reports its progress page by page", async () => {
    const t = await setup();
    const entryId = await addEntry(t);
    for (let i = 0; i < 3; i++) await addRow(t, entryId, "update", "pending");

    const first = await t.run((ctx) =>
      pauseInScope(ctx, { key: "discord", page: null, limit: 2 }),
    );
    expect(first).toMatchObject({ isDone: false, handled: 2 });
    const second = await t.run((ctx) =>
      pauseInScope(ctx, { key: "discord", page: first.page, limit: 2 }),
    );
    expect(second).toMatchObject({ isDone: true, handled: 1 });

    const released = await t.run((ctx) =>
      releasePaused(ctx, {
        key: "discord",
        mode: "skip",
        chosenAt: Date.now(),
        page: null,
        limit: 2,
      }),
    );
    expect(released).toMatchObject({ isDone: false, handled: 2 });
    expect((await rows(t)).map((stored) => stored.status)).toStrictEqual([
      "skipped",
      "skipped",
      "paused",
    ]);
  });
});
