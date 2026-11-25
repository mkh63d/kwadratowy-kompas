import { defineTable } from "convex/server";
import { v } from "convex/values";

export const switchesTables = {
  switches: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }).index("by_key", ["key"]),

  switchLog: defineTable({
    key: v.string(),
    from: v.boolean(),
    to: v.boolean(),
    at: v.number(),
    by: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    backlog: v.optional(
      v.union(
        v.literal("process"),
        v.literal("onlyNew"),
        v.literal("send"),
        v.literal("skip"),
      ),
    ),
    backlogCount: v.optional(v.number()),
  })
    .index("by_at", ["at"])
    .index("by_key_at", ["key", "at"]),
};
