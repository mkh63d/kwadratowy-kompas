export function OfflineBanner() {
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      Tryb offline: backend Convex nie jest skonfigurowany. Uruchom{" "}
      <code>npm run dev</code>, aby go połączyć.
    </div>
  );
}
