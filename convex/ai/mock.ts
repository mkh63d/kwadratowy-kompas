import type { z } from "zod";
import {
  AIProviderError,
  type AIProvider,
  type ProviderInfo,
  type StructuredResult,
  type TextResult,
} from "./types";

const PROVIDER = "mock";
const MODEL = "mock";

const FIXTURES: Record<string, unknown> = {
  notesSummary: {
    summary:
      "Notatka omawia kluczowe ustalenia i kolejne kroki. To przykładowe podsumowanie wygenerowane przez dostawcę testowego.",
    keyPoints: [
      "Najważniejsze ustalenie z notatki",
      "Kolejny krok do wykonania",
      "Otwarte pytanie do omówienia",
    ],
  },
};

function simulateFailure(prompt: string): void {
  if (prompt.startsWith("[mock:error]")) {
    throw new AIProviderError("unavailable", "Mock provider forced an error", {
      retryable: true,
    });
  }
  if (prompt.startsWith("[mock:timeout]")) {
    throw new AIProviderError("timeout", "Mock provider forced a timeout", {
      retryable: true,
    });
  }
}

function cannedText(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const start = words.slice(0, 5).join(" ");
  return `Podsumowanie (tryb testowy): tekst ma ${prompt.length} znaków i zaczyna się od „${start}”.`;
}

// Everything here is synchronous; the executor turns a throw into a rejection.
function settle<T>(run: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(run());
  });
}

export function createMockProvider(): AIProvider {
  return {
    generateText(input): Promise<TextResult> {
      return settle(() => {
        simulateFailure(input.prompt);
        return {
          text: cannedText(input.prompt),
          provider: PROVIDER,
          model: MODEL,
        };
      });
    },

    generateStructuredOutput<T>(input: {
      prompt: string;
      system?: string;
      schema: z.ZodType<T>;
      schemaName: string;
    }): Promise<StructuredResult<T>> {
      return settle(() => {
        simulateFailure(input.prompt);
        if (!Object.hasOwn(FIXTURES, input.schemaName)) {
          throw new AIProviderError(
            "config",
            `Mock provider has no fixture for schema "${input.schemaName}"`,
          );
        }
        const parsed = input.schema.safeParse(FIXTURES[input.schemaName]);
        if (!parsed.success) {
          throw new AIProviderError(
            "bad_response",
            `Mock fixture "${input.schemaName}" does not match the schema`,
          );
        }
        return { data: parsed.data, provider: PROVIDER, model: MODEL };
      });
    },

    getProviderInfo(): ProviderInfo {
      return { id: "mock", model: MODEL };
    },
  };
}
