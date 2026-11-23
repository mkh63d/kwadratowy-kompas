import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRoutes, collectFeatures } from "./router";

const useQueryMock = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: useQueryMock,
}));

function renderAt(
  path: string,
  offline: boolean,
  features = collectFeatures({}),
) {
  const router = createMemoryRouter(buildRoutes(features, offline), {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

describe("app shell", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    useQueryMock.mockReset();
  });

  it("shows the offline banner and no backend status when offline", () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    renderAt("/", true);
    expect(screen.getByText(/Tryb offline/)).toBeInTheDocument();
    expect(screen.queryByText(/Backend połączony/)).not.toBeInTheDocument();
    expect(useQueryMock).not.toHaveBeenCalled();
  });

  it("shows the backend status with the note count when online", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([{}, {}, {}]);
    renderAt("/", false);
    expect(screen.queryByText(/Tryb offline/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Backend połączony - 3 notatek"),
    ).toBeInTheDocument();
  });

  it("shows a loading state while the query is pending", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue(undefined);
    renderAt("/", false);
    expect(screen.getByText(/Łączenie z backendem/)).toBeInTheDocument();
  });

  it("renders the not-found page with a link home", () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    renderAt("/nope", true);
    expect(
      screen.getByRole("heading", { name: "Nie znaleziono strony" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Wróć na stronę główną" }),
    ).toHaveAttribute("href", "/");
  });

  it("adds a fixture feature to routes and nav without touching the router", () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    const features = collectFeatures({
      "../features/demo/feature.tsx": {
        default: {
          path: "/demo",
          navLabel: "Demo",
          order: 1,
          element: <h1>Demo page</h1>,
        },
      },
    });
    renderAt("/demo", true, features);
    expect(screen.getByRole("link", { name: "Demo" })).toHaveAttribute(
      "href",
      "/demo",
    );
    expect(
      screen.getByRole("heading", { name: "Demo page" }),
    ).toBeInTheDocument();
  });

  it("orders features by `order` and rejects invalid modules", () => {
    const make = (path: string, order: number) => ({
      default: { path, navLabel: path, order, element: <p /> },
    });
    const sorted = collectFeatures({
      a: make("/b", 2),
      b: make("/a", 1),
    });
    expect(sorted.map((f) => f.path)).toEqual(["/a", "/b"]);
    expect(() => collectFeatures({ bad: { default: { path: "x" } } })).toThrow(
      /Invalid feature module bad/,
    );
  });
});
