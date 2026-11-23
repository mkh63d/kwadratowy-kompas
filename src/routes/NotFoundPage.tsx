import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-3xl font-bold tracking-tight">
        Nie znaleziono strony
      </h1>
      <p className="mt-2">
        <Link to="/" className="text-indigo-600 underline">
          Wróć na stronę główną
        </Link>
      </p>
    </section>
  );
}
