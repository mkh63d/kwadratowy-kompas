import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.*s");

describe("notes seed", () => {
  it("inserts demo notes into an empty table", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.notes.seed.run, {});

    expect(result.inserted).toBe(5);
    expect(await t.query(api.notes.queries.list, {})).toHaveLength(5);
  });

  it("yields the same count when run twice", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.notes.seed.run, {});
    const second = await t.mutation(internal.notes.seed.run, {});

    expect(second.inserted).toBe(0);
    expect(await t.query(api.notes.queries.list, {})).toHaveLength(5);
  });

  it("does not seed when the user already has notes", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.notes.mutations.add, { text: "moja notatka" });

    await t.mutation(internal.notes.seed.run, {});

    expect(await t.query(api.notes.queries.list, {})).toHaveLength(1);
  });
});
