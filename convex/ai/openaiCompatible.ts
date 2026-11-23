import { z } from "zod";
import type { AIConfig, StructuredMode } from "./config";
import {
  AIProviderError,
  type AIProvider,
  type ProviderInfo,
  type StructuredResult,
  type TextResult,
} from "./types";

export type OpenAICompatibleConfig = Extract<
  AIConfig,
  { provider: "openai-compatible" }
>;

export type OpenAICompatibleDeps = {
  sleep?: (ms: number) => Promise<void>;
  backoffBaseMs?: number;
};

type Message = { role: "system" | "user"; content: string };

const BACKOFF_BASE_MS = 500;

const chatCompletion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .nullish(),
});

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function statusError(
  status: number,
  mode: StructuredMode | undefined,
): AIProviderError {
  if (status === 401 || status === 403) {
    return new AIProviderError(
      "auth",
      `AI provider rejected the credentials (HTTP ${status})`,
    );
  }
  if (status === 429) {
    return new AIProviderError("rate_limited", "AI provider rate limit hit", {
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AIProviderError(
      "unavailable",
      `AI provider returned HTTP ${status}`,
      { retryable: true },
    );
  }
  if (status === 404) {
    return new AIProviderError(
      "config",
      "AI provider returned HTTP 404: check that AI_BASE_URL is correct and usually ends with /v1",
    );
  }
  if (
    (status === 400 || status === 422) &&
    (mode === "json_schema" || mode === "json_object")
  ) {
    return new AIProviderError(
      "bad_response",
      `AI provider rejected the request (HTTP ${status}): the server may not support response_format, try AI_STRUCTURED_MODE=json_object or prompt`,
    );
  }
  return new AIProviderError(
    "bad_response",
    `AI provider returned unexpected HTTP ${status}`,
  );
}

// Models in `prompt` mode often wrap JSON in a markdown fence.
function stripFence(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match?.[1] ?? text;
}

function schemaInstruction(jsonSchema: unknown): string {
  return `Respond with a single JSON object and nothing else. It must conform to this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  deps: OpenAICompatibleDeps = {},
): AIProvider {
  const sleep = deps.sleep ?? defaultSleep;
  const backoffBaseMs = deps.backoffBaseMs ?? BACKOFF_BASE_MS;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function attempt(
    body: Record<string, unknown>,
    mode: StructuredMode | undefined,
  ) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        throw new AIProviderError(
          "timeout",
          `AI provider did not answer within ${config.timeoutMs} ms`,
          { retryable: true },
        );
      }
      throw new AIProviderError("unavailable", "AI provider is unreachable", {
        retryable: true,
      });
    }
    if (!response.ok) throw statusError(response.status, mode);

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      if (isTimeout(error)) {
        throw new AIProviderError(
          "timeout",
          `AI provider did not answer within ${config.timeoutMs} ms`,
          { retryable: true },
        );
      }
      throw new AIProviderError(
        "bad_response",
        "AI provider returned a body that is not JSON",
      );
    }
    const parsed = chatCompletion.safeParse(json);
    if (!parsed.success) {
      throw new AIProviderError(
        "bad_response",
        "AI provider response does not match the chat completions shape",
      );
    }
    const { choices, usage } = parsed.data;
    const content = choices.at(0)?.message.content ?? "";
    return {
      content,
      usage: usage
        ? {
            ...(typeof usage.prompt_tokens === "number" && {
              inputTokens: usage.prompt_tokens,
            }),
            ...(typeof usage.completion_tokens === "number" && {
              outputTokens: usage.completion_tokens,
            }),
          }
        : undefined,
    };
  }

  async function complete(
    body: Record<string, unknown>,
    mode?: StructuredMode,
  ) {
    for (let n = 0; ; n++) {
      try {
        return await attempt(body, mode);
      } catch (error) {
        const canRetry =
          error instanceof AIProviderError &&
          error.retryable &&
          n < config.maxRetries;
        if (!canRetry) throw error;
        await sleep(backoffBaseMs * 2 ** n);
      }
    }
  }

  function toMessages(prompt: string, system: string | undefined): Message[] {
    const messages: Message[] = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    return messages;
  }

  return {
    async generateText(input): Promise<TextResult> {
      const result = await complete({
        model: config.model,
        messages: toMessages(input.prompt, input.system),
        ...(input.maxTokens !== undefined && { max_tokens: input.maxTokens }),
      });
      return {
        text: result.content,
        ...(result.usage && { usage: result.usage }),
        provider: "openai-compatible",
        model: config.model,
      };
    },

    async generateStructuredOutput<T>(input: {
      prompt: string;
      system?: string;
      schema: z.ZodType<T>;
      schemaName: string;
    }): Promise<StructuredResult<T>> {
      const jsonSchema = z.toJSONSchema(input.schema);
      const mode = config.structuredMode;
      const system =
        mode === "json_schema"
          ? input.system
          : [input.system, schemaInstruction(jsonSchema)]
              .filter(Boolean)
              .join("\n\n");

      const result = await complete(
        {
          model: config.model,
          messages: toMessages(input.prompt, system),
          ...(mode === "json_schema" && {
            response_format: {
              type: "json_schema",
              json_schema: { name: input.schemaName, schema: jsonSchema },
            },
          }),
          ...(mode === "json_object" && {
            response_format: { type: "json_object" },
          }),
        },
        mode,
      );

      let raw: unknown;
      try {
        raw = JSON.parse(stripFence(result.content));
      } catch {
        throw new AIProviderError(
          "bad_response",
          "AI provider reply is not valid JSON",
        );
      }
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        throw new AIProviderError(
          "bad_response",
          `AI provider reply does not match schema "${input.schemaName}"`,
        );
      }
      return {
        data: parsed.data,
        ...(result.usage && { usage: result.usage }),
        provider: "openai-compatible",
        model: config.model,
      };
    },

    getProviderInfo(): ProviderInfo {
      return {
        id: "openai-compatible",
        model: config.model,
        baseUrlHost: new URL(config.baseUrl).host,
      };
    },
  };
}
