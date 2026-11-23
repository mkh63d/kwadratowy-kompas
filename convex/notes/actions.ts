import { z } from "zod";
import { api } from "../_generated/api";
import { action } from "../_generated/server";
import { parseAIConfig } from "../ai/config";
import { getProvider } from "../ai/index";
import { AIProviderError, type AIProviderErrorCode } from "../ai/types";

// tsconfig.app.json typechecks this file via _generated/api.d.ts; Node types there would hide browser-only bugs in src/.
declare const process: { env: Record<string, string | undefined> };

const summarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
});

export type NotesSummary = z.infer<typeof summarySchema>;

export type SummarizeResult =
  | { ok: true; data: NotesSummary; provider: string }
  | { ok: false; code: AIProviderErrorCode | "empty"; message: string };

const SYSTEM =
  "Jesteś asystentem, który streszcza notatki użytkownika po polsku. Zwróć zwięzłe podsumowanie i listę najważniejszych punktów.";

const MESSAGES: Record<AIProviderErrorCode | "empty", string> = {
  empty: "Brak notatek do podsumowania.",
  config: "AI jest nieprawidłowo skonfigurowane. Sprawdź ustawienia serwera.",
  timeout: "AI niedostępne: odpowiedź trwała zbyt długo. Spróbuj ponownie.",
  unavailable: "AI niedostępne. Spróbuj ponownie za chwilę.",
  auth: "AI niedostępne: dostawca odrzucił dane dostępowe.",
  rate_limited: "AI niedostępne: zbyt wiele zapytań. Spróbuj ponownie później.",
  bad_response: "AI zwróciło nieoczekiwaną odpowiedź. Spróbuj ponownie.",
};

function failure(code: AIProviderErrorCode | "empty"): SummarizeResult {
  return { ok: false, code, message: MESSAGES[code] };
}

export const summarize = action({
  args: {},
  handler: async (ctx): Promise<SummarizeResult> => {
    try {
      const provider = getProvider(parseAIConfig(process.env));
      const notes = await ctx.runQuery(api.notes.queries.list, {});
      if (notes.length === 0) return failure("empty");

      const result = await provider.generateStructuredOutput({
        system: SYSTEM,
        prompt: notes.map((note) => note.text).join("\n\n"),
        schema: summarySchema,
        schemaName: "notesSummary",
      });
      return { ok: true, data: result.data, provider: result.provider };
    } catch (error) {
      if (!(error instanceof AIProviderError)) {
        console.error("notes.summarize failed unexpectedly", error);
      }
      return failure(
        error instanceof AIProviderError ? error.code : "unavailable",
      );
    }
  },
});
