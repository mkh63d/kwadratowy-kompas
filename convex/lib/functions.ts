import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { Id } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Role } from "./enums";
import { appError } from "./errors";

export type Viewer = {
  userId: Id<"users">;
  profileId: Id<"profiles">;
  role: Role;
};

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

const wrapped = new WeakSet<object>();

export function isWrapped(fn: unknown): boolean {
  return typeof fn === "function" && wrapped.has(fn);
}

function tracked<Builder extends (definition: never) => object>(
  builder: Builder,
): Builder {
  return ((definition: never) => {
    const registered = builder(definition);
    wrapped.add(registered);
    return registered;
  }) as Builder;
}

async function resolveViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (profile === null) return null;
  return { userId, profileId: profile._id, role: profile.role };
}

async function requireViewer(ctx: QueryCtx, minRole: Role): Promise<Viewer> {
  const viewer = await resolveViewer(ctx);
  if (viewer === null) appError("unauthenticated");
  if (ROLE_RANK[viewer.role] < ROLE_RANK[minRole]) appError("forbidden");
  return viewer;
}

function roleQuery(minRole: Role) {
  return tracked(
    customQuery(
      query,
      customCtx(async (ctx) => ({ viewer: await requireViewer(ctx, minRole) })),
    ),
  );
}

function roleMutation(minRole: Role) {
  return tracked(
    customMutation(
      mutation,
      customCtx(async (ctx) => ({ viewer: await requireViewer(ctx, minRole) })),
    ),
  );
}

export const publicQuery = tracked(
  customQuery(
    query,
    customCtx(async (ctx) => ({ viewer: await resolveViewer(ctx) })),
  ),
);

export const userQuery = roleQuery("user");
export const userMutation = roleMutation("user");
export const moderatorQuery = roleQuery("moderator");
export const moderatorMutation = roleMutation("moderator");
export const adminQuery = roleQuery("admin");
export const adminMutation = roleMutation("admin");
