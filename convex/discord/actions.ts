import { v } from "convex/values";
import { internalAction } from "../_generated/server";

// Stub: delivery is implemented by 3.3.
export const deliver = internalAction({
  args: { outboxId: v.id("discordOutbox") },
  returns: v.null(),
  handler: () => null,
});
