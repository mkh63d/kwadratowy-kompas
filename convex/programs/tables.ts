import { defineTable } from "convex/server";
import { v } from "convex/values";
import { programKindValidator } from "../lib/enums";

export const programsTables = {
  programs: defineTable({
    name: v.string(),
    slug: v.string(),
    kind: programKindValidator,
    url: v.optional(v.string()),
  }).index("by_slug", ["slug"]),
};
