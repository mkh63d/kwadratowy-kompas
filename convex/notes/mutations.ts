import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from "./limits";

export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length < MIN_NOTE_LENGTH || text.length > MAX_NOTE_LENGTH) {
      throw new ConvexError(
        `Note text must be ${MIN_NOTE_LENGTH}-${MAX_NOTE_LENGTH} characters after trimming`,
      );
    }
    return await ctx.db.insert("notes", { text, createdAt: Date.now() });
  },
});
