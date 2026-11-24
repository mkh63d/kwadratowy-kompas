import { v } from "convex/values";
import { appError } from "../lib/errors";
import { adminMutation } from "../lib/functions";
import { isValidSwitchKey, setSwitch } from "../lib/switches";
import { switchesTables } from "./tables";

export const set = adminMutation({
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
    return setSwitch(ctx, { key, ...change, by: ctx.viewer.userId });
  },
});
