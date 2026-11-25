import { convexTest, type TestConvex } from "convex-test";
import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import type { Role } from "./enums";
import { appError, type AppErrorCode } from "./errors";
import {
  adminMutation,
  adminQuery,
  isWrapped,
  moderatorMutation,
  moderatorQuery,
  publicQuery,
  userMutation,
  userQuery,
  type Viewer,
} from "./functions";
import { createUser } from "./testing/fixtures";

const handlerRuns = vi.fn();

function readViewer(ctx: { viewer: Viewer | null }) {
  handlerRuns();
  return ctx.viewer;
}

async function writeThenReadViewer(ctx: {
  viewer: Viewer;
  db: MutationCtx["db"];
}) {
  handlerRuns();
  await ctx.db.insert("switches", {
    key: "probe",
    enabled: true,
    updatedAt: 0,
    updatedBy: ctx.viewer.userId,
  });
  return ctx.viewer;
}

const probe = {
  publicQuery: publicQuery({ args: {}, handler: readViewer }),
  userQuery: userQuery({ args: {}, handler: readViewer }),
  userMutation: userMutation({ args: {}, handler: writeThenReadViewer }),
  moderatorQuery: moderatorQuery({ args: {}, handler: readViewer }),
  moderatorMutation: moderatorMutation({
    args: {},
    handler: writeThenReadViewer,
  }),
  adminQuery: adminQuery({ args: {}, handler: readViewer }),
  adminMutation: adminMutation({ args: {}, handler: writeThenReadViewer }),
};

type WrapperName = keyof typeof probe;

const PROBE_MODULE = "lib/functionsProbe";

const modules = {
  ...import.meta.glob(["../**/*.*s", "!../**/*.test.*s"]),
  [`../${PROBE_MODULE}.ts`]: () => Promise.resolve(probe),
};

type Caller = "anonymous" | Role;
type Outcome = "allow" | Extract<AppErrorCode, "unauthenticated" | "forbidden">;

const KIND: Record<WrapperName, "query" | "mutation"> = {
  publicQuery: "query",
  userQuery: "query",
  userMutation: "mutation",
  moderatorQuery: "query",
  moderatorMutation: "mutation",
  adminQuery: "query",
  adminMutation: "mutation",
};

const MATRIX: Record<WrapperName, Record<Caller, Outcome>> = {
  publicQuery: {
    anonymous: "allow",
    user: "allow",
    moderator: "allow",
    admin: "allow",
  },
  userQuery: {
    anonymous: "unauthenticated",
    user: "allow",
    moderator: "allow",
    admin: "allow",
  },
  userMutation: {
    anonymous: "unauthenticated",
    user: "allow",
    moderator: "allow",
    admin: "allow",
  },
  moderatorQuery: {
    anonymous: "unauthenticated",
    user: "forbidden",
    moderator: "allow",
    admin: "allow",
  },
  moderatorMutation: {
    anonymous: "unauthenticated",
    user: "forbidden",
    moderator: "allow",
    admin: "allow",
  },
  adminQuery: {
    anonymous: "unauthenticated",
    user: "forbidden",
    moderator: "forbidden",
    admin: "allow",
  },
  adminMutation: {
    anonymous: "unauthenticated",
    user: "forbidden",
    moderator: "forbidden",
    admin: "allow",
  },
};

const WRAPPERS = Object.keys(MATRIX) as WrapperName[];
const CALLERS: Caller[] = ["anonymous", "user", "moderator", "admin"];

type Client = Pick<TestConvex<typeof schema>, "query" | "mutation">;

function call(client: Client, wrapper: WrapperName): Promise<Viewer | null> {
  const name = `${PROBE_MODULE}:${wrapper}`;
  return KIND[wrapper] === "query"
    ? client.query(
        makeFunctionReference<"query", Record<string, never>, Viewer | null>(
          name,
        ),
        {},
      )
    : client.mutation(
        makeFunctionReference<"mutation", Record<string, never>, Viewer>(name),
        {},
      );
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the call to be rejected");
    },
    (error: unknown) => error,
  );
}

function errorData(error: unknown): Value {
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<Value>).data;
}

function setup() {
  const t = convexTest(schema, modules);
  const probeWrites = () => t.run((ctx) => ctx.db.query("switches").collect());
  const profileIdOf = (userId: Viewer["userId"]) =>
    t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      return profile!._id;
    });
  return { t, probeWrites, profileIdOf };
}

beforeEach(() => {
  handlerRuns.mockClear();
});

describe("permission wrappers: wrapper × caller matrix (§5.1)", () => {
  const cases = WRAPPERS.flatMap((wrapper) =>
    CALLERS.map((caller) => ({
      wrapper,
      caller,
      outcome: MATRIX[wrapper][caller],
    })),
  );

  it.each(cases)(
    "$wrapper as $caller → $outcome",
    async ({ wrapper, caller, outcome }) => {
      const { t, probeWrites, profileIdOf } = setup();
      let client: Client = t;
      let expectedViewer: Viewer | null = null;
      if (caller !== "anonymous") {
        const { userId, asUser } = await createUser(t, { role: caller });
        client = asUser;
        expectedViewer = {
          userId,
          profileId: await profileIdOf(userId),
          role: caller,
        };
      }

      if (outcome === "allow") {
        await expect(call(client, wrapper)).resolves.toStrictEqual(
          expectedViewer,
        );
        expect(handlerRuns).toHaveBeenCalledOnce();
        expect(await probeWrites()).toHaveLength(
          KIND[wrapper] === "mutation" ? 1 : 0,
        );
        return;
      }

      const error = await errorOf(call(client, wrapper));
      expect(errorData(error)).toStrictEqual({ code: outcome });
      expect(handlerRuns).not.toHaveBeenCalled();
      expect(await probeWrites()).toHaveLength(0);
    },
  );

  it.each(WRAPPERS)(
    "%s treats a signed-in user without a profile as anonymous",
    async (wrapper) => {
      const { t, probeWrites } = setup();
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const client = t.withIdentity({ subject: `${userId}|session` });

      if (MATRIX[wrapper].anonymous === "allow") {
        await expect(call(client, wrapper)).resolves.toBeNull();
        return;
      }
      const error = await errorOf(call(client, wrapper));
      expect(errorData(error)).toStrictEqual({ code: "unauthenticated" });
      expect(handlerRuns).not.toHaveBeenCalled();
      expect(await probeWrites()).toHaveLength(0);
    },
  );

  it("every wrapper and caller is covered", () => {
    expect(cases).toHaveLength(7 * 4);
  });
});

describe("isWrapped", () => {
  it.each(WRAPPERS)("is true for %s output", (wrapper) => {
    expect(isWrapped(probe[wrapper])).toBe(true);
  });

  it("is false for raw builders' output and other values", () => {
    const handler = () => null;
    expect(isWrapped(queryGeneric({ args: {}, handler }))).toBe(false);
    expect(isWrapped(mutationGeneric({ args: {}, handler }))).toBe(false);
    expect(isWrapped(actionGeneric({ args: {}, handler }))).toBe(false);
    expect(isWrapped(internalQueryGeneric({ args: {}, handler }))).toBe(false);
    expect(isWrapped(internalMutationGeneric({ args: {}, handler }))).toBe(
      false,
    );
    expect(isWrapped(publicQuery)).toBe(false);
    expect(isWrapped(handler)).toBe(false);
    expect(isWrapped({})).toBe(false);
    expect(isWrapped(null)).toBe(false);
    expect(isWrapped(undefined)).toBe(false);
  });
});

describe("appError", () => {
  it("throws a ConvexError carrying the code", () => {
    expect(errorData(errorSync(() => appError("not_found")))).toStrictEqual({
      code: "not_found",
    });
  });

  it("adds the message when one is given", () => {
    expect(
      errorData(errorSync(() => appError("conflict", "last admin"))),
    ).toStrictEqual({
      code: "conflict",
      message: "last admin",
    });
  });
});

function errorSync(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}
