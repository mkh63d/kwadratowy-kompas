import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OpenAICompatibleConfig } from "./openaiCompatible";
import { createOpenAICompatibleProvider } from "./openaiCompatible";
import { AIProviderError } from "./types";

const KEY = "sk-test-secret-key-123";

const baseConfig: OpenAICompatibleConfig = {
  provider: "openai-compatible",
  baseUrl: "https://llm.example.com/v1/",
  model: "bielik-11b",
  apiKey: KEY,
  timeoutMs: 5000,
  maxRetries: 2,
  structuredMode: "json_schema",
};

const notesSummary = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
});

const completion = (content: string, usage?: object) => ({
  choices: [{ message: { content } }],
  ...(usage && { usage }),
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function setup(
  config: Partial<OpenAICompatibleConfig> = {},
  ...responses: Array<Response | Error>
) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fetchMock);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const provider = createOpenAICompatibleProvider(
    { ...baseConfig, ...config },
    { sleep },
  );
  return { provider, fetchMock, sleep };
}

type RequestBody = {
  messages: { role: string; content: string }[];
  response_format?: {
    type: string;
    json_schema?: {
      name: string;
      schema: { properties: Record<string, unknown> };
    };
  };
};

const requestBody = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
  JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as RequestBody;

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as AIProviderError;
  }
  throw new Error("expected rejection");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai-compatible provider", () => {
  it("posts to chat/completions with bearer auth and returns text", async () => {
    const { provider, fetchMock } = setup(
      {},
      jsonResponse(completion("Cześć")),
    );
    const result = await provider.generateText({
      prompt: "Hej",
      system: "Bądź miły",
      maxTokens: 50,
    });

    expect(result).toEqual({
      text: "Cześć",
      provider: "openai-compatible",
      model: "bielik-11b",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(requestBody(fetchMock)).toEqual({
      model: "bielik-11b",
      messages: [
        { role: "system", content: "Bądź miły" },
        { role: "user", content: "Hej" },
      ],
      max_tokens: 50,
    });
  });

  it("maps usage when present and omits it otherwise", async () => {
    const { provider } = setup(
      {},
      jsonResponse(completion("a", { prompt_tokens: 7, completion_tokens: 3 })),
      jsonResponse(completion("b")),
    );
    expect((await provider.generateText({ prompt: "x" })).usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
    expect(await provider.generateText({ prompt: "x" })).not.toHaveProperty(
      "usage",
    );
  });

  it("maps a timeout to a retryable timeout error", async () => {
    const abort = new DOMException("timed out", "TimeoutError");
    const { provider, sleep } = setup({ maxRetries: 0 }, abort);
    const error = await failure(provider.generateText({ prompt: "x" }));
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a network error with exponential backoff, then succeeds", async () => {
    const { provider, fetchMock, sleep } = setup(
      {},
      new TypeError("fetch failed"),
      jsonResponse({}, 503),
      jsonResponse(completion("ok")),
    );
    const result = await provider.generateText({ prompt: "x" });
    expect(result.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it("gives up after maxRetries and reports unavailable", async () => {
    const { provider, fetchMock } = setup(
      { maxRetries: 1 },
      jsonResponse({}, 500),
      jsonResponse({}, 502),
      jsonResponse(completion("never reached")),
    );
    const error = await failure(provider.generateText({ prompt: "x" }));
    expect(error.code).toBe("unavailable");
    expect(error.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 429 to rate_limited and retries it", async () => {
    const { provider, fetchMock } = setup(
      { maxRetries: 1 },
      jsonResponse({}, 429),
      jsonResponse({}, 429),
    );
    const error = await failure(provider.generateText({ prompt: "x" }));
    expect(error.code).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    "does not retry HTTP %i and never leaks the key",
    async (status) => {
      const { provider, fetchMock, sleep } = setup(
        {},
        jsonResponse({ error: `bad key ${KEY}` }, status),
      );
      const error = await failure(provider.generateText({ prompt: "x" }));
      expect(error.code).toBe("auth");
      expect(error.retryable).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(error.message).not.toContain(KEY);
      expect(JSON.stringify(error.cause ?? null)).not.toContain(KEY);
    },
  );

  it("does not leak the key when the network fails", async () => {
    const { provider } = setup(
      { maxRetries: 0 },
      new TypeError(`fetch failed for ${KEY}`),
    );
    const error = await failure(provider.generateText({ prompt: "x" }));
    expect(error.code).toBe("unavailable");
    expect(JSON.stringify(error.message)).not.toContain(KEY);
    expect(JSON.stringify(error.cause ?? null)).not.toContain(KEY);
  });

  it.each([
    ["not JSON", new Response("<html>oops</html>", { status: 200 })],
    ["wrong shape", jsonResponse({ choices: [] })],
    ["non-string content", jsonResponse({ choices: [{ message: {} }] })],
  ])(
    "treats a malformed body (%s) as bad_response without retry",
    async (_n, response) => {
      const { provider, fetchMock } = setup({}, response);
      const error = await failure(provider.generateText({ prompt: "x" }));
      expect(error.code).toBe("bad_response");
      expect(error.retryable).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("exposes only the host and model via getProviderInfo", () => {
    const { provider } = setup({
      baseUrl: "https://llm.example.com:8443/v1",
    });
    const info = provider.getProviderInfo();
    expect(info).toEqual({
      id: "openai-compatible",
      model: "bielik-11b",
      baseUrlHost: "llm.example.com:8443",
    });
    expect(JSON.stringify(info)).not.toContain(KEY);
  });

  it("tolerates null usage and null token counts", async () => {
    const { provider } = setup(
      {},
      jsonResponse({ ...completion("a"), usage: null }),
      jsonResponse(
        completion("b", { prompt_tokens: null, completion_tokens: 4 }),
      ),
    );
    const first = await provider.generateText({ prompt: "x" });
    expect(first.text).toBe("a");
    expect(first).not.toHaveProperty("usage");
    const second = await provider.generateText({ prompt: "x" });
    expect(second.usage).toEqual({ outputTokens: 4 });
  });

  it("maps 404 to a non-retryable config error hinting at /v1", async () => {
    const { provider, fetchMock } = setup({}, jsonResponse({}, 404));
    const error = await failure(provider.generateText({ prompt: "x" }));
    expect(error.code).toBe("config");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("/v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 422])(
    "hints at AI_STRUCTURED_MODE on HTTP %i in json_schema mode",
    async (status) => {
      const { provider, fetchMock } = setup(
        { structuredMode: "json_schema" },
        jsonResponse({}, status),
      );
      const error = await failure(
        provider.generateStructuredOutput({
          prompt: "x",
          schema: notesSummary,
          schemaName: "notesSummary",
        }),
      );
      expect(error.code).toBe("bad_response");
      expect(error.retryable).toBe(false);
      expect(error.message).toContain("AI_STRUCTURED_MODE");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("gives no structured-mode hint on HTTP 400 for plain text or prompt mode", async () => {
    const text = setup({}, jsonResponse({}, 400));
    const textError = await failure(
      text.provider.generateText({ prompt: "x" }),
    );
    expect(textError.message).not.toContain("AI_STRUCTURED_MODE");

    const prompt = setup({ structuredMode: "prompt" }, jsonResponse({}, 400));
    const promptError = await failure(
      prompt.provider.generateStructuredOutput({
        prompt: "x",
        schema: notesSummary,
        schemaName: "notesSummary",
      }),
    );
    expect(promptError.message).not.toContain("AI_STRUCTURED_MODE");
  });
});

describe("openai-compatible structured output", () => {
  const good = { summary: "Krótko", keyPoints: ["a", "b"] };

  it("json_schema mode sends response_format with the JSON schema", async () => {
    const { provider, fetchMock } = setup(
      { structuredMode: "json_schema" },
      jsonResponse(completion(JSON.stringify(good), { prompt_tokens: 1 })),
    );
    const result = await provider.generateStructuredOutput({
      prompt: "Podsumuj",
      system: "Sys",
      schema: notesSummary,
      schemaName: "notesSummary",
    });
    expect(result.data).toEqual(good);
    expect(result.usage).toEqual({ inputTokens: 1 });

    const body = requestBody(fetchMock);
    expect(body.response_format?.type).toBe("json_schema");
    expect(body.response_format?.json_schema?.name).toBe("notesSummary");
    expect(body.response_format?.json_schema?.schema.properties).toHaveProperty(
      "keyPoints",
    );
    expect(body.messages[0]).toEqual({ role: "system", content: "Sys" });
  });

  it("json_object mode sends json_object and the schema in the system prompt", async () => {
    const { provider, fetchMock } = setup(
      { structuredMode: "json_object" },
      jsonResponse(completion(JSON.stringify(good))),
    );
    await provider.generateStructuredOutput({
      prompt: "Podsumuj",
      system: "Sys",
      schema: notesSummary,
      schemaName: "notesSummary",
    });
    const body = requestBody(fetchMock);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("Sys");
    expect(body.messages[0]?.content).toContain("keyPoints");
  });

  it("prompt mode sends no response_format and tolerates a code fence", async () => {
    const { provider, fetchMock } = setup(
      { structuredMode: "prompt" },
      jsonResponse(completion("```JSON\n" + JSON.stringify(good) + "\n```")),
    );
    const result = await provider.generateStructuredOutput({
      prompt: "Podsumuj",
      schema: notesSummary,
      schemaName: "notesSummary",
    });
    expect(result.data).toEqual(good);
    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("response_format");
    expect(body.messages[0]?.content).toContain("keyPoints");
    expect(body.messages[1]).toEqual({ role: "user", content: "Podsumuj" });
  });

  it("rejects invalid JSON with bad_response", async () => {
    const { provider } = setup({}, jsonResponse(completion("not json")));
    const error = await failure(
      provider.generateStructuredOutput({
        prompt: "x",
        schema: notesSummary,
        schemaName: "notesSummary",
      }),
    );
    expect(error.code).toBe("bad_response");
  });

  it("rejects a schema mismatch with bad_response and does not retry", async () => {
    const { provider, fetchMock } = setup(
      {},
      jsonResponse(completion(JSON.stringify({ summary: 1 }))),
    );
    const error = await failure(
      provider.generateStructuredOutput({
        prompt: "x",
        schema: notesSummary,
        schemaName: "notesSummary",
      }),
    );
    expect(error.code).toBe("bad_response");
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
