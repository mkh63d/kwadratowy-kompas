import { describe, expect, it } from "vitest";
import { getProvider } from "./index";

describe("getProvider", () => {
  it("returns the mock provider for the mock config", () => {
    expect(getProvider({ provider: "mock" }).getProviderInfo().id).toBe("mock");
  });

  it("returns the openai-compatible provider without exposing the key", () => {
    const info = getProvider({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
      model: "bielik",
      apiKey: "secret-key",
      timeoutMs: 1000,
      maxRetries: 0,
      structuredMode: "json_schema",
    }).getProviderInfo();

    expect(info.id).toBe("openai-compatible");
    expect(info.model).toBe("bielik");
    expect(info.baseUrlHost).toBe("llm.example.com");
    expect(JSON.stringify(info)).not.toContain("secret-key");
  });
});
