import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.*s");

describe("notes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists a note after it was added, with trimmed text", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.notes.mutations.add, { text: "  hello  " });

    const notes = await t.query(api.notes.queries.list, {});

    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe("hello");
  });

  it("returns newest first", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(1_000);
    await t.mutation(api.notes.mutations.add, { text: "first" });
    vi.setSystemTime(2_000);
    await t.mutation(api.notes.mutations.add, { text: "second" });

    const notes = await t.query(api.notes.queries.list, {});

    expect(notes.map((n) => n.text)).toEqual(["second", "first"]);
  });

  it("returns at most 50 notes", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 55; i++) {
      vi.setSystemTime(1_000 + i);
      await t.mutation(api.notes.mutations.add, { text: `note ${i}` });
    }

    const notes = await t.query(api.notes.queries.list, {});

    expect(notes).toHaveLength(50);
    expect(notes[0]?.text).toBe("note 54");
  });

  it("rejects empty and whitespace-only text", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.notes.mutations.add, { text: "" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.notes.mutations.add, { text: "   " }),
    ).rejects.toThrow();
    expect(await t.query(api.notes.queries.list, {})).toHaveLength(0);
  });

  it("rejects 501-char text and accepts 500", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.notes.mutations.add, { text: "a".repeat(501) }),
    ).rejects.toThrow();
    await t.mutation(api.notes.mutations.add, { text: "a".repeat(500) });
    expect(await t.query(api.notes.queries.list, {})).toHaveLength(1);
  });
});
