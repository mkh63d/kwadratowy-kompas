import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { pauseInScope, releasePaused } from "../lib/discordOutbox";
import { appError } from "../lib/errors";
import {
  isValidSwitchKey,
  type BacklogMode,
  type SwitchKey,
} from "../lib/switches";
import { switchesTables } from "./tables";

const BATCH_SIZE = 100;

type Mode = BacklogMode | "pause";

type Progress = { page: string | null; position: number };
type ChainCursor = Progress & { chain: Id<"switchLog"> };

type Batch = Progress & {
  key: SwitchKey;
  mode: Mode;
  chosenAt: number;
  limit: number;
};
type BatchResult = { done: true } | ({ done: false } & Progress);
type BatchHandler = (ctx: MutationCtx, batch: Batch) => Promise<BatchResult>;

function nextStep(
  { isDone, page, handled }: Awaited<ReturnType<typeof pauseInScope>>,
  position: number,
): BatchResult {
  return isDone
    ? { done: true }
    : { done: false, page, position: position + handled };
}

const pause: BatchHandler = async (ctx, { key, page, position, limit }) =>
  nextStep(await pauseInScope(ctx, { key, page, limit }), position);

function release(mode: "send" | "skip"): BatchHandler {
  return async (ctx, { key, chosenAt, page, position, limit }) =>
    nextStep(
      await releasePaused(ctx, { key, mode, chosenAt, page, limit }),
      position,
    );
}

// The `ai` work lands with T11; until then its batch makes no progress.
const notImplemented: BatchHandler = (_ctx, { page, position }) =>
  Promise.resolve({ done: false, page, position });

const HANDLERS: Record<
  "ai" | "discord",
  Partial<Record<Mode, BatchHandler>>
> = {
  ai: { process: notImplemented, onlyNew: notImplemented },
  discord: { send: release("send"), skip: release("skip"), pause },
};

const encodedCursor = z.strictObject({
  chain: z.string(),
  page: z.string().nullable(),
  position: z.int().nonnegative(),
});

function encodeCursor(cursor: ChainCursor): string {
  return JSON.stringify(cursor);
}

// The chain starter may pass the bare `switchLog` id of its change; later runs carry the JSON form.
function decodeCursor(ctx: MutationCtx, cursor: string): ChainCursor {
  const startedBy = ctx.db.normalizeId("switchLog", cursor);
  if (startedBy !== null) return { chain: startedBy, page: null, position: 0 };

  let json: unknown;
  try {
    json = JSON.parse(cursor);
  } catch {
    json = undefined;
  }
  const parsed = encodedCursor.safeParse(json);
  const chain = parsed.success
    ? ctx.db.normalizeId("switchLog", parsed.data.chain)
    : null;
  if (!parsed.success || chain === null) {
    appError("invalid", "Malformed backlog cursor");
  }
  return { ...parsed.data, chain };
}

function handlerFor(key: SwitchKey, mode: Mode): BatchHandler {
  const scope =
    key === "ai"
      ? "ai"
      : key === "discord" ||
          key.startsWith("discord.channel:") ||
          key.startsWith("discord.crosspost:")
        ? "discord"
        : null;
  const handler = scope === null ? undefined : HANDLERS[scope][mode];
  if (handler === undefined) {
    appError("invalid", `Backlog mode "${mode}" does not apply to "${key}"`);
  }
  return handler;
}

function startsChain(change: Doc<"switchLog">, mode: Mode): boolean {
  return mode === "pause" ? !change.to : change.to && change.backlog === mode;
}

export const processBatch = internalMutation({
  args: {
    key: v.string(),
    mode: v.union(
      ...switchesTables.switchLog.validator.fields.backlog.members,
      v.literal("pause"),
    ),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.literal("stopped"),
    v.literal("stalled"),
    v.literal("done"),
    v.literal("continued"),
  ),
  handler: async (
    ctx,
    { key, mode, cursor },
  ): Promise<"stopped" | "stalled" | "done" | "continued"> => {
    if (!isValidSwitchKey(key))
      appError("invalid", `Unknown switch key "${key}"`);
    const handler = handlerFor(key, mode);

    const latest = await ctx.db
      .query("switchLog")
      .withIndex("by_key_at", (q) => q.eq("key", key))
      .order("desc")
      .first();
    const current =
      cursor !== undefined
        ? decodeCursor(ctx, cursor)
        : latest === null
          ? null
          : { chain: latest._id, page: null, position: 0 };
    // Every switch change writes a switchLog row, so only the chain started by the latest row
    // for this key may act; an older chain stops even if the switch is back in its state.
    if (
      latest === null ||
      current === null ||
      current.chain !== latest._id ||
      !startsChain(latest, mode)
    ) {
      return "stopped";
    }

    const result = await handler(ctx, {
      key,
      mode,
      chosenAt: latest.at,
      page: current.page,
      position: current.position,
      limit: BATCH_SIZE,
    });
    if (result.done) return "done";
    if (result.page === current.page && result.position === current.position) {
      console.warn(`Backlog chain stalled: mode "${mode}" for "${key}"`);
      return "stalled";
    }
    await ctx.scheduler.runAfter(0, internal.switches.backlog.processBatch, {
      key,
      mode,
      cursor: encodeCursor({
        chain: current.chain,
        page: result.page,
        position: result.position,
      }),
    });
    return "continued";
  },
});
