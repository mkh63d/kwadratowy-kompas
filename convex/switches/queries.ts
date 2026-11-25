import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { appError } from "../lib/errors";
import { publicQuery } from "../lib/functions";
import { isEnabled, isValidSwitchKey } from "../lib/switches";

export const get = internalQuery({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }) => {
    if (!isValidSwitchKey(key))
      appError("invalid", `Unknown switch key "${key}"`);
    return isEnabled(ctx, key);
  },
});

export const publicState = publicQuery({
  args: {},
  returns: v.object({
    registration: v.boolean(),
    submitForm: v.boolean(),
    mcp: v.boolean(),
    sponsoring: v.boolean(),
  }),
  handler: async (ctx) => ({
    registration: await isEnabled(ctx, "registration"),
    submitForm: await isEnabled(ctx, "submitForm"),
    mcp: await isEnabled(ctx, "mcp"),
    sponsoring: await isEnabled(ctx, "sponsoring"),
  }),
});
