import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { appError } from "../lib/errors";
import {
  isEnabled,
  isValidSwitchKey,
  type BacklogMode,
  type SwitchKey,
} from "../lib/switches";
import { switchesTables } from "./tables";

const BATCH_SIZE = 100;

type Mode = BacklogMode | "pause";

type Batch = {
  key: SwitchKey;
  mode: Mode;
  cursor: string | undefined;
  limit: number;
};
type BatchResult = { done: true } | { done: false; cursor?: string };
type BatchHandler = (ctx: MutationCtx, batch: Batch) => Promise<BatchResult>;

// Per-scope work lands with T09 (discord) and T11 (ai).
const notImplemented: BatchHandler = () => Promise.resolve({ done: true });

const HANDLERS: Record<
  "ai" | "discord",
  Partial<Record<Mode, BatchHandler>>
> = {
  ai: { process: notImplemented, onlyNew: notImplemented },
  discord: {
    send: notImplemented,
    skip: notImplemented,
    pause: notImplemented,
  },
};

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
    v.literal("done"),
    v.literal("continued"),
  ),
  handler: async (
    ctx,
    { key, mode, cursor },
  ): Promise<"stopped" | "done" | "continued"> => {
    if (!isValidSwitchKey(key))
      appError("invalid", `Unknown switch key "${key}"`);
    const handler = handlerFor(key, mode);
    // A later flip of the same switch starts its own chain; this one must not undo it.
    const wantsEnabled = mode !== "pause";
    if ((await isEnabled(ctx, key)) !== wantsEnabled) return "stopped";

    const result = await handler(ctx, { key, mode, cursor, limit: BATCH_SIZE });
    if (result.done) return "done";
    await ctx.scheduler.runAfter(0, internal.switches.backlog.processBatch, {
      key,
      mode,
      cursor: result.cursor,
    });
    return "continued";
  },
});
