import { z } from "zod";
import { AIProviderError } from "./types";

export type StructuredMode = "json_schema" | "json_object" | "prompt";

export type AIConfig =
  | { provider: "mock" }
  | {
      provider: "openai-compatible";
      baseUrl: string;
      model: string;
      apiKey: string;
      timeoutMs: number;
      maxRetries: number;
      structuredMode: StructuredMode;
    };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

const baseUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}, "must be an https URL without credentials (http is allowed only for localhost or 127.0.0.1)");

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const envNumber = (name: string, fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: "custom",
          message: `${name} must be an integer between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const schema = z.discriminatedUnion("AI_PROVIDER", [
  z.object({ AI_PROVIDER: z.literal("mock") }),
  z.object({
    AI_PROVIDER: z.literal("openai-compatible"),
    AI_BASE_URL: baseUrl,
    AI_MODEL: required("AI_MODEL"),
    AI_API_KEY: required("AI_API_KEY"),
    AI_TIMEOUT_MS: envNumber("AI_TIMEOUT_MS", 20000, 1, 120000),
    AI_MAX_RETRIES: envNumber("AI_MAX_RETRIES", 1, 0, 3),
    AI_STRUCTURED_MODE: z
      .enum(["json_schema", "json_object", "prompt"])
      .default("json_schema"),
  }),
]);

// Empty strings count as unset so `npx convex env set X ""` behaves like no value.
function normalize(env: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("AI_") && value !== undefined && value !== "")
      out[key] = value;
  }
  out.AI_PROVIDER ??= "mock";
  return out;
}

// Messages are built from issue paths and our own texts only, never from the input values,
// so a malformed AI_API_KEY cannot leak through an error.
export function parseAIConfig(
  env: Record<string, string | undefined>,
): AIConfig {
  const result = schema.safeParse(normalize(env));
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join(".");
        if (issue.code === "invalid_union")
          return "AI_PROVIDER must be mock or openai-compatible";
        if (issue.code === "invalid_value") {
          return `${field} must be one of: ${issue.values.join(", ")}`;
        }
        return issue.message.includes(field)
          ? issue.message
          : `${field}: ${issue.message}`;
      })
      .join("; ");
    throw new AIProviderError("config", `Invalid AI configuration: ${details}`);
  }

  const data = result.data;
  if (data.AI_PROVIDER === "mock") return { provider: "mock" };
  return {
    provider: "openai-compatible",
    baseUrl: data.AI_BASE_URL,
    model: data.AI_MODEL,
    apiKey: data.AI_API_KEY,
    timeoutMs: data.AI_TIMEOUT_MS,
    maxRetries: data.AI_MAX_RETRIES,
    structuredMode: data.AI_STRUCTURED_MODE,
  };
}
