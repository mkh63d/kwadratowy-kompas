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

const CALLER_FIELDS = {
  type: true,
  title: true,
  summary: true,
  body: true,
  organizer: true,
  location: true,
  isOnline: true,
  url: true,
  tags: true,
  stages: true,
  amountText: true,
  amountMaxPln: true,
  cost: true,
  startsAt: true,
  endsAt: true,
  deadline: true,
  sponsored: true,
  sourceKey: true,
  sourceRef: true,
  rawItemId: true,
  programId: true,
  discordChannelOverride: true,
  discordPing: true,
  createdBy: true,
} as const satisfies Record<keyof NewEntry, true>;

// NewEntry only blocks lifecycle fields on object literals; a wider object passed through a
// variable would otherwise smuggle e.g. featuredUntil or mergedInto onto a pending row.
function pickCallerFields(entry: NewEntry): NewEntry {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(CALLER_FIELDS)) {
    const value = (entry as Record<string, unknown>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked as NewEntry;
}

const SLUG_MAX_LENGTH = 60;
const SLUG_FALLBACK = "wpis";
const SLUG_MAX_NUMBERED = 21;
const SLUG_RANDOM_LENGTH = 6;
const SLUG_RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

// Letters without a Unicode decomposition, so NFD alone leaves them unfolded.
const UNDECOMPOSABLE: Record<string, string> = {
  ł: "l",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
};

function foldDiacritics(lowerCased: string): string {
  return lowerCased
    .replace(/[łßæœø]/g, (letter) => UNDECOMPOSABLE[letter])
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function slugify(title: string): string {
  return foldDiacritics(title.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidate(base: string, suffix: string): string {
  const stem = base
    .slice(0, SLUG_MAX_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return stem + suffix;
}

function randomSlugSuffix(): string {
  let suffix = "-";
  for (let i = 0; i < SLUG_RANDOM_LENGTH; i++) {
    suffix +=
      SLUG_RANDOM_ALPHABET[
        Math.floor(Math.random() * SLUG_RANDOM_ALPHABET.length)
      ];
  }
  return suffix;
}

async function isSlugFree(ctx: ReadCtx, slug: string): Promise<boolean> {
  const taken = await ctx.db
    .query("entries")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  return taken === null;
}

export async function uniqueSlug(ctx: ReadCtx, title: string): Promise<string> {
  const base = slugify(title) || SLUG_FALLBACK;
  for (let n = 1; n <= SLUG_MAX_NUMBERED; n++) {
    const slug = slugCandidate(base, n === 1 ? "" : `-${n}`);
    if (await isSlugFree(ctx, slug)) return slug;
  }
  const slug = slugCandidate(base, randomSlugSuffix());
  if (await isSlugFree(ctx, slug)) return slug;
  appError("conflict", `No free slug for "${base}"`);
}

function normalizeTags(tags: readonly string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().toLocaleLowerCase("pl"))
    .filter((tag) => tag !== "");
  return [...new Set(normalized)];
}

function buildSearchText(
  entry: Pick<EntryFields, "title" | "summary" | "organizer" | "tags">,
): string {
  const text = [entry.title, entry.summary, entry.organizer, ...entry.tags]
    .filter((part) => part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
  const folded = foldDiacritics(text);
  return folded === text ? text : `${text} ${folded}`;
}

export async function insertEntry(
  ctx: MutationCtx,
  newEntry: NewEntry,
): Promise<Id<"entries">> {
  const entry = pickCallerFields(newEntry);
  const source = await ctx.db
    .query("sources")
    .withIndex("by_key", (q) => q.eq("key", entry.sourceKey))
    .unique();
  if (source === null)
    appError("invalid", `Unknown source "${entry.sourceKey}"`);

  const sponsored = entry.sponsored ?? false;
  if (sponsored) await assertEnabled(ctx, "sponsoring");

  const tags = normalizeTags(entry.tags ?? []);
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
