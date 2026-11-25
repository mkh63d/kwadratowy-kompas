import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { entryTypeValidator, stageValidator } from "../lib/enums";
import { publicQuery } from "../lib/functions";
import { publicEntryValidator } from "../lib/publicEntry";

// Empty until 3.1; args and return types are final (spec §10.2).
export const list = publicQuery({
  args: {
    type: v.optional(entryTypeValidator),
    stage: v.optional(stageValidator),
    tag: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    featured: v.optional(v.boolean()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    includeSiteOnly: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(publicEntryValidator),
  handler: () => ({ page: [], isDone: true, continueCursor: "" }),
});

export const getBySlug = publicQuery({
  args: { slug: v.string(), includeSiteOnly: v.optional(v.boolean()) },
  returns: v.union(publicEntryValidator, v.null()),
  handler: () => null,
});

export const upcoming = publicQuery({
  args: {
    type: v.optional(entryTypeValidator),
    limit: v.number(),
    includeSiteOnly: v.optional(v.boolean()),
  },
  returns: v.array(publicEntryValidator),
  handler: () => [],
});

export const search = publicQuery({
  args: {
    query: v.string(),
    type: v.optional(entryTypeValidator),
    limit: v.number(),
    includeSiteOnly: v.optional(v.boolean()),
  },
  returns: v.array(publicEntryValidator),
  handler: () => [],
});
