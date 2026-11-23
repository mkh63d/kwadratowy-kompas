import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { noteFormSchema, type NoteForm as NoteFormValues } from "./schema";

export function NoteForm({
  onSubmit,
  offline,
}: {
  onSubmit: (values: NoteFormValues) => Promise<void>;
  offline: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = noteFormSchema.safeParse({ text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    if (offline) return;
    setPending(true);
    try {
      await onSubmit(parsed.data);
      setText("");
    } catch {
      setError("Nie udało się zapisać notatki. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="space-y-2"
    >
      <label htmlFor="note-text" className="block text-sm font-medium">
        Nowa notatka
      </label>
      <Input
        id="note-text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (offline) {
            const parsed = noteFormSchema.safeParse({
              text: event.target.value,
            });
            setError(
              parsed.success ? undefined : parsed.error.issues[0]?.message,
            );
          }
        }}
        aria-invalid={error !== undefined}
        aria-describedby={error ? "note-error" : undefined}
      />
      {error && (
        <p id="note-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {offline && (
        <p className="text-sm text-slate-600">
          Tryb offline: zapis jest wyłączony, bo backend nie jest połączony.
        </p>
      )}
      <Button type="submit" disabled={offline || pending}>
        Dodaj notatkę
      </Button>
    </form>
  );
}
