import { expect, test } from "@playwright/test";

test("home page renders in offline mode", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "HackNation Starter" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Tryb offline");
});

test("home -> notes -> home navigation with offline validation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Notatki" }).click();
  await expect(page).toHaveURL("/notes");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notatki" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dodaj notatkę" }),
  ).toBeDisabled();
  const input = page.getByLabel("Nowa notatka");
  await input.fill("x");
  await input.fill("");
  await expect(page.getByRole("alert")).toContainText("Wpisz treść notatki.");
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "HackNation Starter" }),
  ).toBeVisible();
});

test("unknown route shows not-found and links back home", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(
    page.getByRole("heading", { name: "Nie znaleziono strony" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Wróć na stronę główną" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "HackNation Starter" }),
  ).toBeVisible();
});
