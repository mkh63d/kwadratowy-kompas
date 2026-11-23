import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesPage } from "./NotesPage";
import { noteFormSchema } from "./schema";

const useQueryMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn());
const summarizeMock = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: useQueryMock,
  useMutation: () => addMock,
  useAction: () => summarizeMock,
}));

describe("notes schema", () => {
  it("trims and enforces 1-500 characters", () => {
    expect(noteFormSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(noteFormSchema.safeParse({ text: "a".repeat(501) }).success).toBe(
      false,
    );
    expect(noteFormSchema.parse({ text: " ok " })).toEqual({ text: "ok" });
  });
});

describe("NotesPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    useQueryMock.mockReset();
    addMock.mockReset();
    summarizeMock.mockReset();
  });

  const online = () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([]);
  };
  const clickSummarize = () =>
    userEvent.click(screen.getByRole("button", { name: "Podsumuj notatki" }));

  it("shows the summary and key points on success", async () => {
    online();
    summarizeMock.mockResolvedValue({
      ok: true,
      data: { summary: "Krótko o planach", keyPoints: ["Punkt A", "Punkt B"] },
      provider: "mock",
    });
    render(<NotesPage />);
    await clickSummarize();
    expect(await screen.findByText("Krótko o planach")).toBeInTheDocument();
    expect(screen.getByText("Punkt A")).toBeInTheDocument();
    expect(screen.getByText("Punkt B")).toBeInTheDocument();
  });

  it("shows the message on ok:false and keeps the page working", async () => {
    online();
    summarizeMock.mockResolvedValue({
      ok: false,
      code: "empty",
      message: "Brak notatek do podsumowania.",
    });
    render(<NotesPage />);
    await clickSummarize();
    expect(
      await screen.findByText("Brak notatek do podsumowania."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nowa notatka")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Podsumuj notatki" }),
    ).toBeEnabled();
  });

  it("shows a friendly message when the action throws", async () => {
    online();
    summarizeMock.mockRejectedValue(new Error("Server Error: secret"));
    render(<NotesPage />);
    await clickSummarize();
    expect(await screen.findByText(/Nie udało się połączyć/)).toBeVisible();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it("is busy and disabled while loading", async () => {
    online();
    let resolve!: (v: unknown) => void;
    summarizeMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<NotesPage />);
    await clickSummarize();
    const button = screen.getByRole("button", { name: "Podsumowuję…" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(summarizeMock).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: { summary: "Wynik", keyPoints: [] } });
    expect(await screen.findByText("Wynik")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gotowe");
    expect(screen.getByRole("status")).not.toHaveTextContent("Wynik");
    expect(
      screen.getByRole("button", { name: "Podsumuj notatki" }),
    ).toHaveFocus();
  });

  it("disables summarize offline with an explanation", () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    render(<NotesPage />);
    expect(
      screen.getByRole("button", { name: "Podsumuj notatki" }),
    ).toBeDisabled();
    expect(screen.getByText(/podsumowanie wymaga backendu/)).toBeVisible();
  });

  it("shows a Polish validation error on empty submit", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([]);
    render(<NotesPage />);
    await userEvent.click(
      screen.getByRole("button", { name: "Dodaj notatkę" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wpisz treść notatki.",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("submits a valid note and clears the field", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([]);
    addMock.mockResolvedValue("id");
    render(<NotesPage />);
    const input = screen.getByLabelText("Nowa notatka");
    await userEvent.type(input, "  Zadzwonić  ");
    await userEvent.click(
      screen.getByRole("button", { name: "Dodaj notatkę" }),
    );
    expect(addMock).toHaveBeenCalledWith({ text: "Zadzwonić" });
    expect(input).toHaveValue("");
  });

  it("renders the list from the query", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([
      { _id: "1", text: "Pierwsza" },
      { _id: "2", text: "Druga" },
    ]);
    render(<NotesPage />);
    expect(screen.getByText("Pierwsza")).toBeInTheDocument();
    expect(screen.getByText("Druga")).toBeInTheDocument();
  });

  it("renders offline with validation and a disabled submit", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    render(<NotesPage />);
    expect(useQueryMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Tryb offline: zapis jest wyłączony/),
    ).toBeVisible();
    const submit = screen.getByRole("button", { name: "Dodaj notatkę" });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText("Nowa notatka");
    await userEvent.type(input, "x");
    expect(submit).toBeDisabled();
    await userEvent.clear(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wpisz treść notatki.",
    );
  });
});
