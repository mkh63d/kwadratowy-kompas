import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isEnabled } from "./switches";

type ReadCtx = Pick<QueryCtx, "db">;

type VisibilityFields = Pick<
  Doc<"entries">,
  "status" | "mergedInto" | "sponsored"
>;

async function passesMergeAndSponsoring(
  ctx: ReadCtx,
  entry: VisibilityFields,
): Promise<boolean> {
  if (entry.mergedInto !== undefined) return false;
  return !entry.sponsored || (await isEnabled(ctx, "sponsoring"));
}

export async function isListed(
  ctx: ReadCtx,
  entry: VisibilityFields,
): Promise<boolean> {
  return (
    entry.status === "published" && (await passesMergeAndSponsoring(ctx, entry))
  );
}

export async function isViewable(
  ctx: ReadCtx,
  entry: VisibilityFields,
): Promise<boolean> {
  return (
    (entry.status === "published" || entry.status === "archived") &&
    (await passesMergeAndSponsoring(ctx, entry))
  );
}

export async function isSiteOnly(
  ctx: ReadCtx,
  entry: Pick<Doc<"entries">, "type" | "sourceKey" | "attributionSourceKeys">,
): Promise<boolean> {
  if (entry.type !== "news") return false;
  const keys = new Set([entry.sourceKey, ...entry.attributionSourceKeys]);
  for (const key of keys) {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (source?.newsSiteOnly === true) return true;
  }
  return false;
}
