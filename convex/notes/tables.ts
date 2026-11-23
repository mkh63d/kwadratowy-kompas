import { defineTable } from "convex/server";
import { v } from "convex/values";

export const notesTables = {
  notes: defineTable({
    text: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
};
