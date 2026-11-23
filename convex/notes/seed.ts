import { internalMutation } from "../_generated/server";

const DEMO_NOTES = [
  "Zadzwonić do dostawcy w sprawie opóźnionej dostawy",
  "Przygotować prezentację na piątkowy przegląd sprintu",
  "Kupić mleko, chleb i kawę w drodze do domu",
  "Pomysł: dodać tryb ciemny do widoku notatek",
  "Odnowić domenę projektu przed końcem miesiąca",
];

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("notes").first();
    if (existing) {
      return { inserted: 0 };
    }
    const now = Date.now();
    for (const [index, text] of DEMO_NOTES.entries()) {
      await ctx.db.insert("notes", {
        text,
        createdAt: now - (DEMO_NOTES.length - index) * 60_000,
      });
    }
    return { inserted: DEMO_NOTES.length };
  },
});
