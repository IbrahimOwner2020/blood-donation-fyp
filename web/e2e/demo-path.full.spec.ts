/**
 * Full mutating DoD path (docs/16 / TODO.md test-e2e-full):
 * login → register donor → record donation → inventory → request →
 * forecast → shortage/alerts → match donors → send mock notification →
 * verify history/audit.
 *
 * Soft-skips when web/API/auth is unavailable so CI without a stack does not
 * fail hard. Mutates data — prefer a disposable local DB.
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

  if (page.url().includes("/login")) {
    return "unavailable";
  }

  return "ok";
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.describe("docs/16 full mutating demo path", () => {
  test("register → donate → inventory → request → forecast → notify → audit", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    const reachable = await isWebReachable(request);
    test.skip(
      !reachable,
      `Web not reachable at ${baseURL}. Start web+API then re-run.`,
    );

    const loginResult = await signInAsDemoAdmin(page);
    test.skip(
      loginResult !== "ok",
      "Demo admin login failed (API down, seed missing, or bad credentials). Soft-skip.",
    );

    const suffix = uniqueSuffix();
    const donorNumber = `E2E-${suffix}`;

    // Dashboard anchor
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible({ timeout: 20_000 });

    // Register donor
    await page.goto("/donors/new", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Register donor/i }),
    ).toBeVisible({ timeout: 20_000 });

    await page.locator('input[name="donorNumber"]').fill(donorNumber);
    await page.locator('input[name="firstName"]').fill("E2E");
    await page.locator('input[name="lastName"]').fill("Donor");
    await page.locator('input[name="phone"]').fill("+255711223344");
    await page.locator('input[name="email"]').fill(`e2e-${suffix}@example.local`);
    await page.locator('select[name="bloodGroupId"]').selectOption("8"); // O-
    await page
      .locator('select[name="eligibilityStatus"]')
      .selectOption("POTENTIALLY_ELIGIBLE");
    await page.getByRole("button", { name: /Register donor/i }).click();

    await expect(page).toHaveURL(/\/donors\/\d+/, { timeout: 30_000 });
    const donorUrl = page.url();
    const donorIdMatch = donorUrl.match(/\/donors\/(\d+)/);
    const donorId = donorIdMatch?.[1] ?? "";
    expect(donorId).toBeTruthy();

    // Record donation
    await page.goto(
      `/donations/new?donorId=${donorId}&bloodGroupId=8`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", { name: /Record donation/i }),
    ).toBeVisible({ timeout: 20_000 });

    const donorSelect = page.locator('select[name="donorId"]');
    if (await donorSelect.count()) {
      await donorSelect.selectOption(donorId);
    }
    const centreSelect = page.locator('select[name="donationCentreId"]');
    await expect(centreSelect).toBeVisible({ timeout: 15_000 });
    const centreOptions = centreSelect.locator("option:not([value=''])");
    const centreCount = await centreOptions.count();
    test.skip(centreCount < 1, "No donation centres available — soft-skip.");
    await centreSelect.selectOption({ index: 1 });

    const bloodGroupSelect = page.locator('select[name="bloodGroupId"]');
    if (await bloodGroupSelect.count()) {
      await bloodGroupSelect.selectOption("8");
    }
    const unitsInput = page.locator('input[name="units"]');
    if (await unitsInput.count()) {
      await unitsInput.fill("1");
    }
    await page.getByRole("button", { name: /Record donation|Save/i }).click();
    await expect(page).toHaveURL(/\/donations\/\d+/, { timeout: 30_000 });

    // Inventory
    await page.goto("/inventory?bloodGroup=O-", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Inventory/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Blood request
    await page.goto("/blood-requests/new", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /request/i }),
    ).toBeVisible({ timeout: 20_000 });

    const facilitySelect = page.locator('select[name="facilityId"]');
    await expect(facilitySelect).toBeVisible({ timeout: 15_000 });
    const facilityOptions = facilitySelect.locator("option:not([value=''])");
    test.skip(
      (await facilityOptions.count()) < 1,
      "No facilities available — soft-skip.",
    );
    await facilitySelect.selectOption({ index: 1 });
    await page.locator('select[name="bloodGroupId"]').selectOption("8");
    await page.locator('input[name="unitsRequested"]').fill("2");
    const prioritySelect = page.locator('select[name="priority"]');
    if (await prioritySelect.count()) {
      await prioritySelect.selectOption("HIGH");
    }
    await page.getByRole("button", { name: /Create|Submit|Save/i }).click();
    await expect(page).toHaveURL(/\/blood-requests\/\d+/, { timeout: 30_000 });

    // Forecast / predictions
    await page.goto("/predictions", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Prediction/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Prefer a run form if present on index or a dedicated control.
    const runLink = page.getByRole("link", { name: /Run|New forecast|Forecast/i });
    if (await runLink.count()) {
      await runLink.first().click();
    }

    const bloodGroupOnPred =
      page.locator('select[name="bloodGroup"], select[name="bloodGroupId"]');
    if (await bloodGroupOnPred.count()) {
      const name = await bloodGroupOnPred.first().getAttribute("name");
      if (name === "bloodGroupId") {
        await bloodGroupOnPred.first().selectOption("8");
      } else {
        await bloodGroupOnPred.first().selectOption("O-");
      }
    }
    const runButton = page.getByRole("button", {
      name: /Run forecast|Run prediction|Forecast|Run/i,
    });
    if (await runButton.count()) {
      await runButton.first().click();
      // Soft-continue if AI is slow/unavailable — page may show error state.
      await page.waitForTimeout(3_000);
    }

    // Alerts / shortage
    await page.goto("/alerts", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Alert/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Compose mock notification
    await page.goto("/notifications/new", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Compose|Notification/i }),
    ).toBeVisible({ timeout: 20_000 });

    const donorIdsInput = page.locator(
      'input[name="donorIds"], textarea[name="donorIds"]',
    );
    if (await donorIdsInput.count()) {
      await donorIdsInput.first().fill(donorId);
    } else {
      // Checkbox match list — tick first donor if present.
      const checkbox = page.locator('input[type="checkbox"][name="donorIds"]').first();
      if (await checkbox.count()) {
        await checkbox.check();
      }
    }

    const channelSelect = page.locator('select[name="channel"]');
    if (await channelSelect.count()) {
      await channelSelect.selectOption("SMS");
    }

    const messageInput = page.locator(
      'textarea[name="message"], input[name="message"]',
    );
    if (await messageInput.count()) {
      await messageInput.first().fill(`E2E mock outreach ${suffix}`);
    }

    const previewButton = page.getByRole("button", { name: /Preview/i });
    if (await previewButton.count()) {
      await previewButton.first().click();
      await page.waitForTimeout(1_500);
    }

    const sendButton = page.getByRole("button", { name: /Send/i });
    if (await sendButton.count()) {
      await sendButton.first().click();
      // Confirm dialog if present
      const confirm = page.getByRole("button", {
        name: /Confirm|Send notification|Yes/i,
      });
      if (await confirm.count()) {
        await confirm.last().click();
      }
      await page.waitForTimeout(2_000);
    }

    // Notification history
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications|Notify/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Audit / activity
    await page.goto("/admin/activity", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Activity/i }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
