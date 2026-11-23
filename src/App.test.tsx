import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: () => [],
}));

describe("App", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the homepage heading offline", () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "HackNation Starter" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tryb offline/)).toBeInTheDocument();
  });
});
