import { defineTable } from "convex/server";
import { v } from "convex/values";
import { discardReasonValidator, rawItemStateValidator } from "../lib/enums";

export const ingestTables = {
  rawItems: defineTable({
    sourceKey: v.string(),
    externalId: v.string(),
    text: v.string(),
    url: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    receivedAt: v.number(),
    contentHash: v.string(),
    state: rawItemStateValidator,
    discardReason: v.optional(discardReasonValidator),
    extraction: v.optional(
      v.union(
        v.object({
          ok: v.literal(true),
          provider: v.string(),
          model: v.string(),
          relevant: v.boolean(),
          confidence: v.number(),
          processedAt: v.number(),
        }),
        v.object({
          ok: v.literal(false),
          provider: v.string(),
          model: v.string(),
          errorCode: v.string(),
          processedAt: v.number(),
        }),
      ),
    ),
    entryId: v.optional(v.id("entries")),
    submittedBy: v.optional(v.id("users")),
  })
    .index("by_source_externalId", ["sourceKey", "externalId"])
    .index("by_state", ["state", "receivedAt"])
    .index("by_contentHash", ["contentHash"])
    .index("by_submittedBy", ["submittedBy", "receivedAt"]),
};
