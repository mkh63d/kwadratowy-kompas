import { query } from "../_generated/server";

const MAX_NOTES = 50;

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_createdAt")
      .order("desc")
      .take(MAX_NOTES);
  },
});
