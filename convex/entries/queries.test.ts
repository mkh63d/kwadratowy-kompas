import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { publicEntryValidator } from "../lib/publicEntry";
import { getBySlug, list, search, upcoming } from "./queries";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

type Queries = typeof api.entries.queries;

// `Required` makes tsc fail here when an arg is added, removed or renamed.
const LIST_ARGS: Required<FunctionArgs<Queries["list"]>> = {
  type: "news",
  stage: "mvp",
  tag: "ai",
  from: 0,
  to: 1,
  featured: true,
  order: "desc",
  includeSiteOnly: true,
  paginationOpts: { numItems: 10, cursor: null },
};
const GET_ARGS: Required<FunctionArgs<Queries["getBySlug"]>> = {
  slug: "demo",
  includeSiteOnly: true,
};
const UPCOMING_ARGS: Required<FunctionArgs<Queries["upcoming"]>> = {
  type: "event",
  limit: 5,
  includeSiteOnly: true,
};
const SEARCH_ARGS: Required<FunctionArgs<Queries["search"]>> = {
  query: "grant",
  type: "konkurs",
  limit: 5,
  includeSiteOnly: true,
};

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

type ExportedValidator = { type: string; value?: unknown };
type ExportedFields = Record<
  string,
  { fieldType: ExportedValidator; optional: boolean }
>;

// exportArgs/exportReturns exist on registered functions but are not in their public types.
function exported(
  fn: unknown,
  which: "exportArgs" | "exportReturns",
): ExportedValidator {
  const read = Reflect.get(fn as object, which) as () => string;
  return JSON.parse(read()) as ExportedValidator;
}

function argsOf(fn: unknown): Record<string, "required" | "optional"> {
  const fields = exported(fn, "exportArgs").value as ExportedFields;
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      field.optional ? "optional" : "required",
    ]),
  );
}

const PUBLIC_ENTRY = (publicEntryValidator as unknown as { json: unknown })
  .json;

describe("entries.queries stubs (§10.2)", () => {
  it("list returns an empty final page, with and without the optional args", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.entries.queries.list, LIST_ARGS),
    ).resolves.toStrictEqual(EMPTY_PAGE);
    await expect(
      t.query(api.entries.queries.list, {
        paginationOpts: LIST_ARGS.paginationOpts,
      }),
    ).resolves.toStrictEqual(EMPTY_PAGE);
  });

  it("getBySlug returns null", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.entries.queries.getBySlug, GET_ARGS),
    ).resolves.toBeNull();
    await expect(
      t.query(api.entries.queries.getBySlug, { slug: "demo" }),
    ).resolves.toBeNull();
  });

  it("upcoming and search return an empty list", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.entries.queries.upcoming, UPCOMING_ARGS),
    ).resolves.toStrictEqual([]);
    await expect(
      t.query(api.entries.queries.upcoming, { limit: 5 }),
    ).resolves.toStrictEqual([]);
    await expect(
      t.query(api.entries.queries.search, SEARCH_ARGS),
    ).resolves.toStrictEqual([]);
    await expect(
      t.query(api.entries.queries.search, { query: "grant", limit: 5 }),
    ).resolves.toStrictEqual([]);
  });

  it("rejects a non-boolean includeSiteOnly", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.entries.queries.getBySlug, {
        slug: "demo",
        includeSiteOnly: "yes" as unknown as boolean,
      }),
    ).rejects.toThrow(/Expected `boolean`/);
  });

  it("declares the final args", () => {
    expect(argsOf(list)).toStrictEqual({
      type: "optional",
      stage: "optional",
      tag: "optional",
      from: "optional",
      to: "optional",
      featured: "optional",
      order: "optional",
      includeSiteOnly: "optional",
      paginationOpts: "required",
    });
    expect(argsOf(getBySlug)).toStrictEqual({
      slug: "required",
      includeSiteOnly: "optional",
    });
    expect(argsOf(upcoming)).toStrictEqual({
      type: "optional",
      limit: "required",
      includeSiteOnly: "optional",
    });
    expect(argsOf(search)).toStrictEqual({
      query: "required",
      type: "optional",
      limit: "required",
      includeSiteOnly: "optional",
    });
  });

  it("validates returns with publicEntryValidator", () => {
    const array = { type: "array", value: PUBLIC_ENTRY };
    expect(exported(upcoming, "exportReturns")).toStrictEqual(array);
    expect(exported(search, "exportReturns")).toStrictEqual(array);
    expect(exported(getBySlug, "exportReturns")).toStrictEqual({
      type: "union",
      value: [PUBLIC_ENTRY, { type: "null" }],
    });
    expect(exported(list, "exportReturns")).toMatchObject({
      type: "object",
      value: { page: { fieldType: array, optional: false } },
    });
  });
});
