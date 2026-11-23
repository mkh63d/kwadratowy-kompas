import { expect, test } from "@playwright/test";

test("home page renders in offline mode", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "HackNation Starter" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Tryb offline");
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
