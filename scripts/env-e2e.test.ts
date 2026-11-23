import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe(".env.e2e", () => {
  const file = readFileSync(".env.e2e", "utf8");

  it("blanks the Convex URL so e2e stays offline", () => {
    expect(file).toMatch(/^VITE_CONVEX_URL=$/m);
  });

  it("blanks the Sentry DSN so a DSN in .env.local never sends events from e2e", () => {
    expect(file).toMatch(/^VITE_SENTRY_DSN=$/m);
  });
});
