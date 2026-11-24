import { defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "../lib/enums";

export const accountsTables = {
  profiles: defineTable({
    userId: v.id("users"),
    role: roleValidator,
    displayName: v.optional(v.string()),
    discordUserId: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_role", ["role"]),

  roleLog: defineTable({
    userId: v.id("users"),
    from: roleValidator,
    to: roleValidator,
    at: v.number(),
    by: v.optional(v.id("users")),
  }).index("by_userId_at", ["userId", "at"]),
};
