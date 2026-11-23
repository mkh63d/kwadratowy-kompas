import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts a valid URL", () => {
    expect(
      parseEnv({ VITE_CONVEX_URL: "https://example.convex.cloud" }),
    ).toEqual({ convexUrl: "https://example.convex.cloud" });
  });

  it("treats a missing value as unset", () => {
    expect(parseEnv({})).toEqual({ convexUrl: undefined });
  });

  it("treats an empty string as unset", () => {
    expect(parseEnv({ VITE_CONVEX_URL: "" })).toEqual({ convexUrl: undefined });
  });

  it("rejects an invalid URL with a clear message", () => {
    expect(() => parseEnv({ VITE_CONVEX_URL: "not-a-url" })).toThrow(
      /Invalid frontend environment: VITE_CONVEX_URL/,
    );
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the stubbed import.meta.env", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://stubbed.convex.cloud");
    expect(getEnv().convexUrl).toBe("https://stubbed.convex.cloud");
    vi.stubEnv("VITE_CONVEX_URL", "");
    expect(getEnv().convexUrl).toBeUndefined();
  });
});
