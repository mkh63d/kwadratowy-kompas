import { useMemo } from "react";
import { RouterProvider } from "react-router/dom";
import { Providers } from "./app/Providers";
import { createAppRouter } from "./app/router";
import { getEnv } from "./lib/env";

export default function App() {
  const { convexUrl } = getEnv();
  const router = useMemo(
    () => createAppRouter(convexUrl === undefined),
    [convexUrl],
  );
  return (
    <Providers convexUrl={convexUrl}>
      <RouterProvider router={router} />
    </Providers>
  );
}
