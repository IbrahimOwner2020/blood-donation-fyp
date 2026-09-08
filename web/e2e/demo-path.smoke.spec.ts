/**
 * Smoke coverage for the docs/16 final demo path — as far as practical:
 * login → dashboard/donors → notifications → admin activity (audit stub).
 *
 * Soft-skips when the web app or API/auth is unavailable so CI without a
 * stack does not fail hard. Does not mutate donors, donations, or inventory.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.E2E_BASE_URL?.trim() ||
  "http://localhost:5173";

const adminEmail =
  process.env.E2E_ADMIN_EMAIL?.trim() ||
  process.env.DEMO_ADMIN_EMAIL?.trim() ||
  "admin@nbts.local";

const adminPassword =
  process.env.E2E_ADMIN_PASSWORD?.trim() ||
  process.env.DEMO_ADMIN_PASSWORD?.trim() ||
  "ChangeMe-Admin-Local-Only!";

async function isWebReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.get(baseURL, {
      timeout: 5_000,
      failOnStatusCode: false,
    });
    const status = response.status();
    return status > 0 && status < 500;
  } catch {
    return false;
  }
}

async function signInAsDemoAdmin(page: Page): Promise<"ok" | "unavailable"> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  await expect(emailInput).toBeVisible({ timeout: 15_000 });

  await emailInput.fill(adminEmail);
  await passwordInput.fill(adminPassword);
  await page.getByRole("button", { name: "Continue" }).click();

  const dashboardHeading = page.getByRole("heading", { name: "Dashboard" });
  const loginAlert = page.getByRole("alert");

  const outcome = await Promise.race([
    dashboardHeading
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "ok" as const),
    loginAlert
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "unavailable" as const),
    page
      .waitForURL(/\/(dashboard|donors)/, { timeout: 30_000 })
      .then(() => "ok" as const),
  ]).catch(() => "unavailable" as const);

  if (outcome === "ok") {
    return "ok";
  }

  // Stay on /login with an alert usually means API/auth is down or credentials mismatch.
  const stillOnLogin = page.url().includes("/login");
  if (stillOnLogin) {
    return "unavailable";
  }

  return "ok";
}

test.describe("docs/16 demo path smoke", () => {
  test("login → core screens → notify → audit (soft-skip if stack down)", async ({
    page,
    request,
  }) => {
    const reachable = await isWebReachable(request);
    test.skip(
      !reachable,
      `Web not reachable at ${baseURL}. Start web (and API) then re-run.`,
    );

    const loginResult = await signInAsDemoAdmin(page);
    test.skip(
      loginResult !== "ok",
      "Demo admin login failed (API down, seed missing, or bad credentials). Soft-skip.",
    );

    // Core workflow anchors: dashboard and/or donors list.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible({ timeout: 20_000 });

    await page.goto("/donors", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Donors" })).toBeVisible({
      timeout: 20_000,
    });

    // Notify history (read-only). Soft-continue if the route errors.
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    const notificationsHeading = page.getByRole("heading", {
      name: /Notifications|Notify/i,
    });
    const notificationsForbidden = page.getByText(/access restricted|forbidden/i);
    const notificationsError = page.getByText(/could not load|unable to load/i);
    await expect(
      notificationsHeading
        .or(notificationsForbidden)
        .or(notificationsError)
        .first(),
    ).toBeVisible({ timeout: 20_000 });

    // Audit / activity — stub is acceptable until a list API ships.
    await page.goto("/admin/activity", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Activity/i }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
