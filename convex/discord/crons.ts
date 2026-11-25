import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// Stub: the retry sweeper is implemented by 3.3.
export const retry = internalMutation({
  args: {},
  returns: v.null(),
  handler: () => null,
});
