import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../../components/ui/Card";
import { getEnv } from "../../lib/env";
import { NoteForm } from "./NoteForm";
import { SummarizePanel } from "./SummarizePanel";

function OnlineNotes() {
  const notes = useQuery(api.notes.queries.list);
  const add = useMutation(api.notes.mutations.add);
  const summarize = useAction(api.notes.actions.summarize);
  return (
    <>
      <NoteForm
        offline={false}
        onSubmit={async ({ text }) => {
          await add({ text });
        }}
      />
      <SummarizePanel offline={false} onSummarize={() => summarize({})} />
      {notes === undefined ? (
        <p>Ładowanie notatek…</p>
      ) : notes.length === 0 ? (
        <p>Brak notatek.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note._id}>
              <Card>{note.text}</Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function NotesPage() {
  const online = getEnv().convexUrl !== undefined;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Notatki</h1>
      {online ? (
        <OnlineNotes />
      ) : (
        <>
          <NoteForm offline onSubmit={() => Promise.resolve()} />
          <SummarizePanel offline />
        </>
      )}
    </section>
  );
}
