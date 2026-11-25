import { v } from "convex/values";
import { publicQuery } from "../lib/functions";

export const ping = publicQuery({
  args: {},
  returns: v.object({ ok: v.literal(true) }),
  handler: () => ({ ok: true as const }),
});
