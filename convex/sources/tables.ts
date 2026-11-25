import { defineTable } from "convex/server";
import { v } from "convex/values";
import { sourceKindValidator } from "../lib/enums";

export const sourcesTables = {
  sources: defineTable({
    key: v.string(),
    name: v.string(),
    kind: sourceKindValidator,
    ingestTokenHash: v.optional(v.string()),
    ingestTokenRotatedAt: v.optional(v.number()),
    noCrosspost: v.boolean(),
    newsSiteOnly: v.boolean(),
    attribution: v.optional(
      v.object({ name: v.string(), url: v.optional(v.string()) }),
    ),
    promoLine: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    lastItemCount: v.optional(v.number()),
    lastNonEmptyAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_key", ["key"]),
};
