import type { TestConvex } from "convex-test";
import type { Id } from "../../_generated/dataModel";
import type schema from "../../schema";
import type { Role } from "../enums";

type AppTestConvex = TestConvex<typeof schema>;

const SESSION_TTL_MS = 60 * 60 * 1000;

export async function createUser(
  t: AppTestConvex,
  { role }: { role: Role },
): Promise<{
  userId: Id<"users">;
  asUser: ReturnType<AppTestConvex["withIdentity"]>;
}> {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    await ctx.db.insert("profiles", { userId, role });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + SESSION_TTL_MS,
    });
    return { userId, sessionId };
  });
  return {
    userId,
    asUser: t.withIdentity({ subject: `${userId}|${sessionId}` }),
  };
}
