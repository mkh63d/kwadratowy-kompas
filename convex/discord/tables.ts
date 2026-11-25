import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  channelKindValidator,
  entryTypeValidator,
  outboxActionValidator,
  outboxStatusValidator,
  pingPolicyValidator,
  postKindValidator,
} from "../lib/enums";

export const discordTables = {
  discordRoutes: defineTable({
    entryType: entryTypeValidator,
    tag: v.optional(v.string()),
    channelId: v.string(),
    channelName: v.string(),
    channelKind: channelKindValidator,
    pingRoleId: v.optional(v.string()),
    pingPolicy: pingPolicyValidator,
    crosspost: v.boolean(),
  })
    .index("by_type_tag", ["entryType", "tag"])
    .index("by_channel", ["channelId"]),

  discordPosts: defineTable({
    entryId: v.id("entries"),
    kind: postKindValidator,
    channelId: v.string(),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    contentHash: v.string(),
    pinned: v.boolean(),
    crosspostedAt: v.optional(v.number()),
    remindedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_entry_kind", ["entryId", "kind"])
    .index("by_message", ["messageId"]),

  discordOutbox: defineTable({
    entryId: v.id("entries"),
    action: outboxActionValidator,
    channelId: v.string(),
    status: outboxStatusValidator,
    nonce: v.string(),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    skipReason: v.optional(
      v.union(
        v.literal("backlog_skipped"),
        v.literal("cancelled_by_teardown"),
        v.literal("cancelled_by_restore"),
        v.literal("superseded_by_delete"),
        v.literal("recheck_refused"),
      ),
    ),
    suppressNotifications: v.optional(v.boolean()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_entry_action_status", ["entryId", "action", "status"])
    .index("by_entry_status", ["entryId", "status"])
    .index("by_status_nextAttempt", ["status", "nextAttemptAt"])
    .index("by_channel_status", ["channelId", "status"]),
};
