import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { discordTables } from "../discord/tables";
import { outboxActionValidator, type OutboxAction } from "./enums";
import { appError } from "./errors";
import { isEnabled, isValidSwitchKey } from "./switches";
import { isListed } from "./visibility";

type SkipReason = NonNullable<
  Infer<typeof discordTables.discordOutbox.validator.fields.skipReason>
>;

export type Route = { channelId: string; crosspost: boolean };

export type EnqueueResult =
  | {
      kind: "queued" | "paused" | "coalesced";
      outboxId: Id<"discordOutbox">;
    }
  | {
      kind: "skipped";
      reason:
        | "no_route"
        | "no_post"
        | "no_crosspost"
        | "sponsoring_off"
        | "not_published"
        | "cancelled_create";
    };

type ReadCtx = Pick<QueryCtx, "db">;

type RoutedEntry = Pick<
  Doc<"entries">,
  "_id" | "type" | "tags" | "cost" | "sponsored" | "discordChannelOverride"
>;

const NONCE_LENGTH = 20;
const NONCE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const SUPERSEDED_BY_DELETE = outboxActionValidator.members
  .map((member) => member.value)
  .filter((action) => action !== "delete");

// Teardown must still reach posts of entries that are no longer listed (§8.4).
const IGNORES_VISIBILITY: ReadonlySet<OutboxAction> = new Set([
  "unpin",
  "archive",
  "delete",
]);

function skipped(
  reason: Extract<EnqueueResult, { kind: "skipped" }>["reason"],
): EnqueueResult {
  return { kind: "skipped", reason };
}

function createNonce(): string {
  let nonce = "";
  for (let i = 0; i < NONCE_LENGTH; i++) {
    nonce += NONCE_ALPHABET[Math.floor(Math.random() * NONCE_ALPHABET.length)];
  }
  return nonce;
}

async function channelAllowsCrosspost(
  ctx: ReadCtx,
  channelId: string,
): Promise<boolean> {
  const routes = await ctx.db
    .query("discordRoutes")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  return routes.some((route) => route.crosspost);
}

// A malformed id cannot name a `discord.channel:*` switch, so using it would throw and roll back
// the caller (or, with `discord` off, store a row that can never be released).
function isUsableChannel(entry: RoutedEntry, channelId: string): boolean {
  const usable = isValidSwitchKey(`discord.channel:${channelId}`);
  if (!usable) {
    console.warn(
      `Ignoring a malformed Discord channel id for entry ${entry._id}`,
    );
  }
  return usable;
}

async function matchChannel(
  ctx: ReadCtx,
  entry: RoutedEntry,
): Promise<string | null> {
  const override = entry.discordChannelOverride;
  if (override !== undefined) {
    return isUsableChannel(entry, override) ? override : null;
  }
  const entryType =
    entry.type === "szkolenie" && entry.cost === "paid" && !entry.sponsored
      ? "event"
      : entry.type;
  for (const tag of [...entry.tags, undefined]) {
    const routes = await ctx.db
      .query("discordRoutes")
      .withIndex("by_type_tag", (q) =>
        q.eq("entryType", entryType).eq("tag", tag),
      )
      .collect();
    const route = routes.find(({ channelId }) =>
      isUsableChannel(entry, channelId),
    );
    if (route !== undefined) return route.channelId;
  }
  return null;
}

export async function resolveRoute(
  ctx: ReadCtx,
  entry: RoutedEntry,
): Promise<Route | null> {
  const channelId = await matchChannel(ctx, entry);
  if (channelId === null) return null;
  return {
    channelId,
    crosspost: await channelAllowsCrosspost(ctx, channelId),
  };
}

async function readOpenRows(
  ctx: ReadCtx,
  entryId: Id<"entries">,
  action: OutboxAction,
): Promise<Doc<"discordOutbox">[]> {
  const rows: Doc<"discordOutbox">[] = [];
  for (const status of ["pending", "paused"] as const) {
    const inStatus = await ctx.db
      .query("discordOutbox")
      .withIndex("by_entry_action_status", (q) =>
        q.eq("entryId", entryId).eq("action", action).eq("status", status),
      )
      .collect();
    rows.push(...inStatus);
  }
  return rows;
}

// Only a job that has not started is cancelled: cancelling a running delivery would also cancel
// whatever it schedules afterwards.
async function cancelDelivery(
  ctx: MutationCtx,
  { scheduledFunctionId }: Doc<"discordOutbox">,
): Promise<void> {
  if (scheduledFunctionId === undefined) return;
  const job = await ctx.db.system.get(scheduledFunctionId);
  if (job?.state.kind === "pending") {
    await ctx.scheduler.cancel(scheduledFunctionId);
  }
}

export async function skipOutboxRows(
  ctx: MutationCtx,
  {
    entryId,
    actions,
    reason,
  }: {
    entryId: Id<"entries">;
    actions: readonly OutboxAction[];
    reason: SkipReason;
  },
): Promise<number> {
  let count = 0;
  for (const action of new Set(actions)) {
    for (const row of await readOpenRows(ctx, entryId, action)) {
      await cancelDelivery(ctx, row);
      await ctx.db.patch(row._id, { status: "skipped", skipReason: reason });
      count++;
    }
  }
  return count;
}

// A soft-deleted row does not count: a new `create` may replace it.
async function readMainPost(ctx: ReadCtx, entryId: Id<"entries">) {
  const post = await ctx.db
    .query("discordPosts")
    .withIndex("by_entry_kind", (q) =>
      q.eq("entryId", entryId).eq("kind", "main"),
    )
    .unique();
  return post === null || post.deletedAt !== undefined ? null : post;
}

async function withoutMainPost(
  ctx: MutationCtx,
  entryId: Id<"entries">,
  action: Exclude<OutboxAction, "create">,
): Promise<EnqueueResult> {
  switch (action) {
    case "update": {
      const [create] = await readOpenRows(ctx, entryId, "create");
      return create === undefined
        ? skipped("no_post")
        : { kind: "coalesced", outboxId: create._id };
    }
    case "unpin":
      await skipOutboxRows(ctx, {
        entryId,
        actions: ["pin"],
        reason: "cancelled_by_teardown",
      });
      return skipped("no_post");
    case "archive":
    case "delete": {
      const cancelled = await skipOutboxRows(ctx, {
        entryId,
        actions: ["create"],
        reason: "cancelled_by_teardown",
      });
      return skipped(cancelled > 0 ? "cancelled_create" : "no_post");
    }
    case "pin":
    case "crosspost":
    case "remind":
      return skipped("no_post");
  }
}

async function addToOutbox(
  ctx: MutationCtx,
  {
    entry,
    action,
    channelId,
    suppressNotifications,
  }: {
    entry: Doc<"entries">;
    action: OutboxAction;
    channelId: string;
    suppressNotifications?: boolean;
  },
): Promise<EnqueueResult> {
  if (
    action === "crosspost" &&
    (entry.noCrosspost ||
      !(await channelAllowsCrosspost(ctx, channelId)) ||
      !(await isEnabled(ctx, `discord.crosspost:${channelId}`)))
  ) {
    return skipped("no_crosspost");
  }

  const [open] = await readOpenRows(ctx, entry._id, action);
  if (open !== undefined) return { kind: "coalesced", outboxId: open._id };

  const on =
    (await isEnabled(ctx, "discord")) &&
    (await isEnabled(ctx, `discord.channel:${channelId}`));
  const outboxId = await ctx.db.insert("discordOutbox", {
    entryId: entry._id,
    action,
    channelId,
    status: on ? "pending" : "paused",
    nonce: createNonce(),
    attempts: 0,
    suppressNotifications,
  });
  if (!on) return { kind: "paused", outboxId };

  const scheduledFunctionId = await ctx.scheduler.runAfter(
    0,
    internal.discord.actions.deliver,
    { outboxId },
  );
  await ctx.db.patch(outboxId, { scheduledFunctionId });
  return { kind: "queued", outboxId };
}

export async function enqueueDiscord(
  ctx: MutationCtx,
  {
    entryId,
    action: requested,
    suppressNotifications,
  }: {
    entryId: Id<"entries">;
    action: OutboxAction;
    suppressNotifications?: boolean;
  },
): Promise<EnqueueResult> {
  const entry = await ctx.db.get(entryId);
  if (entry === null) appError("not_found", "entry not found");

  if (!IGNORES_VISIBILITY.has(requested)) {
    if (entry.status !== "published" || entry.mergedInto !== undefined) {
      return skipped("not_published");
    }
    // With status and merge settled above, only the sponsoring rule can still hide the entry.
    if (!(await isListed(ctx, entry))) return skipped("sponsoring_off");
  }

  const post = await readMainPost(ctx, entryId);
  const action = requested === "create" && post !== null ? "update" : requested;
  const add = (channelId: string) =>
    addToOutbox(ctx, { entry, action, channelId, suppressNotifications });

  let result: EnqueueResult;
  if (action === "create") {
    const route = await resolveRoute(ctx, entry);
    result = route === null ? skipped("no_route") : await add(route.channelId);
  } else if (post === null) {
    result = await withoutMainPost(ctx, entryId, action);
  } else {
    result = await add(post.channelId);
  }

  if (action === "delete") {
    await skipOutboxRows(ctx, {
      entryId,
      actions: SUPERSEDED_BY_DELETE,
      reason: "superseded_by_delete",
    });
  }
  return result;
}
