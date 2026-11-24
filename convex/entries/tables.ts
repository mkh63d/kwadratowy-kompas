import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  archiveReasonValidator,
  costValidator,
  entryStatusValidator,
  entryTypeValidator,
  stageValidator,
  withdrawReasonValidator,
} from "../lib/enums";

export const entriesTables = {
  entries: defineTable({
    slug: v.string(),
    type: entryTypeValidator,
    title: v.string(),
    summary: v.string(),
    body: v.optional(v.string()),
    organizer: v.optional(v.string()),
    location: v.optional(v.string()),
    isOnline: v.optional(v.boolean()),
    url: v.optional(v.string()),
    tags: v.array(v.string()),
    stages: v.optional(v.array(stageValidator)),
    amountText: v.optional(v.string()),
    amountMaxPln: v.optional(v.number()),
    cost: v.optional(costValidator),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    deadline: v.optional(v.number()),
    status: entryStatusValidator,
    publishedAt: v.optional(v.number()),
    archiveReason: v.optional(archiveReasonValidator),
    withdrawReason: v.optional(withdrawReasonValidator),
    featuredUntil: v.optional(v.number()),
    sponsored: v.boolean(),
    sourceKey: v.string(),
    sourceRef: v.optional(v.string()),
    attributionSourceKeys: v.array(v.string()),
    noCrosspost: v.boolean(),
    rawItemId: v.optional(v.id("rawItems")),
    programId: v.optional(v.id("programs")),
    discordChannelOverride: v.optional(v.string()),
    discordPing: v.boolean(),
    mergedInto: v.optional(v.id("entries")),
    searchText: v.string(),
    sortAt: v.number(),
    createdBy: v.optional(v.id("users")),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status_type", ["status", "type"])
    .index("by_status_deadline", ["status", "deadline"])
    .index("by_status_startsAt", ["status", "startsAt"])
    .index("by_status_publishedAt", ["status", "publishedAt"])
    .index("by_status_sortAt", ["status", "sortAt"])
    .index("by_status_featuredUntil", ["status", "featuredUntil"])
    .index("by_rawItem", ["rawItemId"])
    .index("by_source_ref", ["sourceKey", "sourceRef"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["status", "type"],
    }),
};
