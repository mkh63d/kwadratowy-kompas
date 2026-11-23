import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

function ConvexBoundary({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const client = useMemo(() => new ConvexReactClient(url), [url]);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

export function Providers({
  convexUrl,
  children,
}: {
  convexUrl: string | undefined;
  children: ReactNode;
}) {
  if (!convexUrl) return <>{children}</>;
  return <ConvexBoundary url={convexUrl}>{children}</ConvexBoundary>;
}
