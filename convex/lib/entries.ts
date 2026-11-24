import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import { assertEnabled } from "./switches";

type ReadCtx = Pick<QueryCtx, "db">;

type EntryFields = WithoutSystemFields<Doc<"entries">>;

type DerivedField =
  | "slug"
  | "status"
  | "publishedAt"
  | "archiveReason"
  | "withdrawReason"
  | "featuredUntil"
  | "attributionSourceKeys"
  | "noCrosspost"
  | "mergedInto"
  | "searchText"
  | "sortAt"
  | "updatedAt";

type DefaultedField = "sponsored" | "discordPing" | "tags";

export type NewEntry = Omit<EntryFields, DerivedField | DefaultedField> &
  Partial<Pick<EntryFields, DefaultedField>>;

const SLUG_MAX_LENGTH = 60;
const SLUG_FALLBACK = "wpis";

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      // "ł" has no Unicode decomposition, so NFD alone would turn it into a separator.
      .replaceAll("ł", "l")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function slugCandidate(base: string, n: number): string {
  const suffix = n === 1 ? "" : `-${n}`;
  const stem = base
    .slice(0, SLUG_MAX_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return stem + suffix;
}

export async function uniqueSlug(ctx: ReadCtx, title: string): Promise<string> {
  const base = slugify(title) || SLUG_FALLBACK;
  for (let n = 1; ; n++) {
    const slug = slugCandidate(base, n);
    const taken = await ctx.db
      .query("entries")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (taken === null) return slug;
  }
}

function buildSearchText(
  entry: Pick<EntryFields, "title" | "summary" | "organizer" | "tags">,
): string {
  return [entry.title, entry.summary, entry.organizer, ...entry.tags]
    .filter((part) => part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}

export async function insertEntry(
  ctx: MutationCtx,
  entry: NewEntry,
): Promise<Id<"entries">> {
  const source = await ctx.db
    .query("sources")
    .withIndex("by_key", (q) => q.eq("key", entry.sourceKey))
    .unique();
  if (source === null)
    appError("invalid", `Unknown source "${entry.sourceKey}"`);

  const sponsored = entry.sponsored ?? false;
  if (sponsored) await assertEnabled(ctx, "sponsoring");

  const tags = entry.tags ?? [];
  const now = Date.now();
  return ctx.db.insert("entries", {
    ...entry,
    slug: await uniqueSlug(ctx, entry.title),
    status: "pending",
    tags,
    sponsored,
    discordPing: entry.discordPing ?? false,
    attributionSourceKeys: source.attribution === undefined ? [] : [source.key],
    noCrosspost: source.noCrosspost,
    searchText: buildSearchText({ ...entry, tags }),
    sortAt: entry.deadline ?? entry.startsAt ?? now,
    updatedAt: now,
  });
}
