import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.*s");

const OPENAI_ENV = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://llm.example.com/v1",
  AI_MODEL: "bielik",
  AI_API_KEY: "secret-key",
  AI_MAX_RETRIES: "0",
};

function stubEnv(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

async function setup(...texts: string[]) {
  const t = convexTest(schema, modules);
  for (const text of texts) await t.mutation(api.notes.mutations.add, { text });
  return t;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notes.actions.summarize", () => {
  it("summarizes with the mock provider by default", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    const t = await setup("pierwsza notatka");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toMatchObject({ ok: true, provider: "mock" });
    if (result.ok) {
      expect(result.data.summary).not.toBe("");
      expect(result.data.keyPoints.length).toBeGreaterThan(0);
    }
  });

  it("returns a user-safe error on the [mock:error] path", async () => {
    stubEnv({ AI_PROVIDER: "mock" });
    const t = await setup("[mock:error] wymuszony błąd");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toEqual({
      ok: false,
      code: "unavailable",
      message: "AI niedostępne. Spróbuj ponownie za chwilę.",
    });
  });

  it("returns an empty error when there are no notes", async () => {
    stubEnv({ AI_PROVIDER: "mock" });
    const t = await setup();

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toMatchObject({ ok: false, code: "empty" });
  });

  it("uses the openai-compatible provider with a stubbed fetch", async () => {
    stubEnv(OPENAI_ENV);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Krótko o notatkach",
                  keyPoints: ["punkt 1"],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const t = await setup("notatka testowa");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toEqual({
      ok: true,
      data: { summary: "Krótko o notatkach", keyPoints: ["punkt 1"] },
      provider: "openai-compatible",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to the mock when the real provider fails, and hides internals", async () => {
    stubEnv(OPENAI_ENV);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
    );
    const t = await setup("notatka testowa");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toMatchObject({ ok: false, code: "auth" });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(JSON.stringify(result)).not.toContain("llm.example.com");
  });

  it("logs unexpected non-provider errors server-side and keeps the user message fixed", async () => {
    stubEnv(OPENAI_ENV);
    const boom = new TypeError("internal boom");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        get ok(): boolean {
          throw boom;
        },
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup("notatka testowa");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), boom);
    expect(result).toEqual({
      ok: false,
      code: "unavailable",
      message: "AI niedostępne. Spróbuj ponownie za chwilę.",
    });
    errorSpy.mockRestore();
  });

  it("returns a config error instead of crashing on invalid config", async () => {
    stubEnv({ AI_PROVIDER: "openai-compatible" });
    const t = await setup("notatka testowa");

    const result = await t.action(api.notes.actions.summarize, {});

    expect(result).toMatchObject({ ok: false, code: "config" });
    if (!result.ok) expect(result.message).not.toContain("AI_BASE_URL");
  });
});
