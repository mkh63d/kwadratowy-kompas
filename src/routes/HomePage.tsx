import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card } from "../components/ui/Card";
import { getEnv } from "../lib/env";

function BackendStatus() {
  const notes = useQuery(api.notes.queries.list);
  return (
    <Card role="status">
      {notes === undefined
        ? "Łączenie z backendem…"
        : `Backend połączony - ${notes.length} notatek`}
    </Card>
  );
}

export function HomePage() {
  const online = getEnv().convexUrl !== undefined;
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight text-indigo-600">
        HackNation Starter
      </h1>
      {online && <BackendStatus />}
    </section>
  );
}
