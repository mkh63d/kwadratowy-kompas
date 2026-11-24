import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { appError } from "../lib/errors";
import { isValidSwitchKey, setSwitch } from "../lib/switches";
import { switchesTables } from "./tables";

export const set = internalMutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
    backlog: switchesTables.switchLog.validator.fields.backlog,
  },
  returns: v.object({ backlogCount: v.number() }),
  handler: async (ctx, { key, ...change }) => {
    if (!isValidSwitchKey(key))
      appError("invalid", `Unknown switch key "${key}"`);
    return setSwitch(ctx, { key, ...change });
  },
});
