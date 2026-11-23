import type { z } from "zod";

export type ProviderId = "mock" | "openai-compatible";

export type TextResult = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  provider: string;
  model: string;
};

export type StructuredResult<T> = {
  data: T;
  usage?: { inputTokens?: number; outputTokens?: number };
  provider: string;
  model: string;
};

export type ProviderInfo = {
  id: ProviderId;
  model: string;
  baseUrlHost?: string;
};

export interface AIProvider {
  generateText(input: {
    prompt: string;
    system?: string;
    maxTokens?: number;
  }): Promise<TextResult>;
  generateStructuredOutput<T>(input: {
    prompt: string;
    system?: string;
    schema: z.ZodType<T>;
    schemaName: string;
  }): Promise<StructuredResult<T>>;
  getProviderInfo(): ProviderInfo;
}

export type AIProviderErrorCode =
  | "config"
  | "timeout"
  | "unavailable"
  | "auth"
  | "rate_limited"
  | "bad_response";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AIProviderErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
