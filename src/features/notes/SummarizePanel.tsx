import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { SummarizeResult } from "../../../convex/notes/actions";

export type SummarizeOutcome =
  Extract<SummarizeResult, { ok: true }> | { ok: false; message: string };

const NETWORK_ERROR = "Nie udało się połączyć z serwerem. Spróbuj ponownie.";

export function SummarizePanel({
  offline,
  onSummarize,
}: {
  offline: boolean;
  onSummarize?: () => Promise<SummarizeOutcome>;
}) {
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SummarizeOutcome | null>(null);

  async function run() {
    if (!onSummarize || loading) return;
    setLoading(true);
    setOutcome(null);
    try {
      setOutcome(await onSummarize());
    } catch {
      setOutcome({ ok: false, message: NETWORK_ERROR });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-2" aria-label="Podsumowanie notatek">
      <Button
        disabled={offline}
        aria-disabled={loading || undefined}
        aria-busy={loading}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => void run()}
      >
        {loading ? "Podsumowuję…" : "Podsumuj notatki"}
      </Button>
      {offline && (
        <p className="text-sm text-slate-600">
          Tryb offline: podsumowanie wymaga backendu Convex.
        </p>
      )}
      <div role="status" aria-live="polite">
        {loading && (
          <span className="sr-only">Trwa podsumowywanie notatek…</span>
        )}
        {outcome?.ok === true && <span className="sr-only">Gotowe</span>}
        {outcome?.ok === false && (
          <p className="text-sm text-red-700">{outcome.message}</p>
        )}
      </div>
      {outcome?.ok === true && (
        <Card className="space-y-2">
          <p>{outcome.data.summary}</p>
          {outcome.data.keyPoints.length > 0 && (
            <ul className="list-disc pl-5">
              {outcome.data.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </section>
  );
}
