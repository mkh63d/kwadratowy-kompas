import { z } from "zod";

// An empty string means "unset": .env.e2e blanks the URL to force offline mode.
const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value;

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform(emptyToUndefined)
  .pipe(z.url({ message: "must be a valid URL" }).optional());

const envSchema = z.object({
  VITE_CONVEX_URL: optionalUrl,
  VITE_SENTRY_DSN: optionalUrl,
  VITE_COMMIT_SHA: z.string().trim().optional().transform(emptyToUndefined),
});

export type Env = {
  convexUrl: string | undefined;
  sentryDsn: string | undefined;
  commitSha: string | undefined;
};

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid frontend environment: ${details}`);
  }
  return {
    convexUrl: result.data.VITE_CONVEX_URL,
    sentryDsn: result.data.VITE_SENTRY_DSN,
    commitSha: result.data.VITE_COMMIT_SHA,
  };
}

export function getEnv(): Env {
  return parseEnv(import.meta.env);
}
