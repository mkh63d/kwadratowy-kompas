import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  archiveReasonValidator,
  costValidator,
  entryTypeValidator,
  stageValidator,
} from "./enums";
import { appError } from "./errors";
import { isEnabled, isValidSwitchKey } from "./switches";
import { isSiteOnly } from "./visibility";

export const publicEntryValidator = v.object({
  slug: v.string(),
  type: entryTypeValidator,
  title: v.string(),
  summary: v.string(),
  body: v.optional(v.string()),
  organizer: v.optional(v.string()),
  location: v.optional(v.string()),
  isOnline: v.optional(v.boolean()),
  url: v.optional(v.string()),
  tags: v.array(v.string()),
  stages: v.optional(v.array(stageValidator)),
  amountText: v.optional(v.string()),
  amountMaxPln: v.optional(v.number()),
  cost: v.optional(costValidator),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  deadline: v.optional(v.number()),
  publishedAt: v.number(),
  archived: v.boolean(),
  archiveReason: v.optional(archiveReasonValidator),
  featured: v.boolean(),
  sponsored: v.boolean(),
  attributions: v.array(
    v.object({ name: v.string(), url: v.optional(v.string()) }),
  ),
  promos: v.array(v.object({ sourceName: v.string(), line: v.string() })),
  program: v.optional(v.object({ slug: v.string(), name: v.string() })),
  siteOnly: v.boolean(),
});

export type PublicEntry = Infer<typeof publicEntryValidator>;

type ReadCtx = Pick<QueryCtx, "db">;

// A promo without a valid switch key could never be turned off, so it is not shown.
async function isPromoOn(ctx: ReadCtx, sourceKey: string): Promise<boolean> {
  const switchKey = `promo.source:${sourceKey}`;
  return isValidSwitchKey(switchKey) && (await isEnabled(ctx, switchKey));
}

async function readSourceCredits(ctx: ReadCtx, sourceKeys: readonly string[]) {
  const attributions: PublicEntry["attributions"] = [];
  const promos: PublicEntry["promos"] = [];
  for (const key of new Set(sourceKeys)) {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (source === null) continue;
    const { attribution, promoLine } = source;
    if (attribution !== undefined) {
      attributions.push({ name: attribution.name, url: attribution.url });
    }
    if (promoLine && (await isPromoOn(ctx, key))) {
      promos.push({
        sourceName: attribution?.name ?? source.name,
        line: promoLine,
      });
    }
  }
  return { attributions, promos };
}

async function readProgram(ctx: ReadCtx, entry: Doc<"entries">) {
  if (entry.programId === undefined) return undefined;
  const program = await ctx.db.get(entry.programId);
  return program === null
    ? undefined
    : { slug: program.slug, name: program.name };
}

// Fields are listed one by one so that a new schema field stays private until added here.
export async function toPublicEntry(
  ctx: ReadCtx,
  entry: Doc<"entries">,
): Promise<PublicEntry> {
  if (entry.publishedAt === undefined) {
    appError("invalid", `Entry "${entry.slug}" was never published`);
  }
  const { attributions, promos } = await readSourceCredits(
    ctx,
    entry.attributionSourceKeys,
  );
  return {
    slug: entry.slug,
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    body: entry.body,
    organizer: entry.organizer,
    location: entry.location,
    isOnline: entry.isOnline,
    url: entry.url,
    tags: entry.tags,
    stages: entry.stages,
    amountText: entry.amountText,
    amountMaxPln: entry.amountMaxPln,
    cost: entry.cost,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    deadline: entry.deadline,
    publishedAt: entry.publishedAt,
    archived: entry.status === "archived",
    archiveReason: entry.archiveReason,
    featured:
      entry.featuredUntil !== undefined && entry.featuredUntil > Date.now(),
    sponsored: entry.sponsored,
    attributions,
    promos,
    program: await readProgram(ctx, entry),
    siteOnly: await isSiteOnly(ctx, entry),
  };
}
