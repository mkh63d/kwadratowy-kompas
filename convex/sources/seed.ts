import type { WithoutSystemFields } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { appError } from "../lib/errors";
import { isValidSwitchKey, type SWITCH_PATTERNS } from "../lib/switches";

type SeedSource = Omit<
  WithoutSystemFields<Doc<"sources">>,
  "ingestTokenHash" | "ingestTokenRotatedAt"
>;

const SOURCES: readonly SeedSource[] = [
  {
    key: "manual",
    name: "Wpis ręczny",
    kind: "manual",
    noCrosspost: false,
    newsSiteOnly: false,
  },
  {
    key: "form",
    name: "Formularz „Zgłoś wpis”",
    kind: "form",
    noCrosspost: false,
    newsSiteOnly: false,
  },
  {
    key: "startupywpolsce-wa",
    name: "StartupywPolsce.pl (WhatsApp)",
    kind: "whatsapp",
    noCrosspost: true,
    newsSiteOnly: true,
    attribution: { name: "StartupywPolsce.pl" },
  },
];

const PER_SOURCE_SWITCHES = [
  "scraping.source",
  "ingest.source",
  "promo.source",
] as const satisfies readonly (keyof typeof SWITCH_PATTERNS)[];

function assertSwitchableKey(key: string): void {
  for (const prefix of PER_SOURCE_SWITCHES) {
    if (!isValidSwitchKey(`${prefix}:${key}`)) {
      appError("invalid", `Source key "${key}" cannot name a ${prefix} switch`);
    }
  }
}

// Insert-only: an existing row is never touched, so admin edits and ingest token hashes survive.
export const run = internalMutation({
  args: {},
  returns: v.object({ created: v.array(v.string()) }),
  handler: async (ctx) => {
    SOURCES.forEach((source) => assertSwitchableKey(source.key));
    const created: string[] = [];
    for (const source of SOURCES) {
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_key", (q) => q.eq("key", source.key))
        .unique();
      if (existing !== null) continue;
      await ctx.db.insert("sources", source);
      created.push(source.key);
    }
    return { created };
  },
});
