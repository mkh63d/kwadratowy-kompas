import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { createUser } from "../lib/testing/fixtures";

const modules = import.meta.glob(["/convex/**/*.*s", "!/convex/**/*.test.*s"]);

describe("health.queries.ping", () => {
  it("answers an anonymous caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.health.queries.ping, {})).resolves.toStrictEqual({
      ok: true,
    });
  });

  it("answers a signed-in caller", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createUser(t, { role: "user" });
    await expect(
      asUser.query(api.health.queries.ping, {}),
    ).resolves.toStrictEqual({ ok: true });
  });
});
