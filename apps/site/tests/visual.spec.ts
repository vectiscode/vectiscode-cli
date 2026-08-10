import { expect, test, type Page } from "@playwright/test";

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Content.Security.Policy|violates the following directive|integrity attribute|failed to load resource/i.test(text)) {
      throw new Error(`Browser safety error: ${text}`);
    }
  });
});

async function expectDocumentFitsViewport(page: Page) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectNoVisibleOverflow(page: Page, selector: string) {
  const overflow = await page.locator(selector).evaluate((root) => {
    const elements = [root, ...Array.from(root.querySelectorAll("*"))] as HTMLElement[];
    return elements
      .filter((element) => !element.classList.contains("vc-sr-only") && element.scrollWidth > element.clientWidth + 1)
      .slice(0, 10)
      .map((element) => ({ tag: element.tagName, className: element.className, client: element.clientWidth, scroll: element.scrollWidth }));
  });
  expect(overflow).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/login");
  const account = page.getByRole("heading", { name: "Small by design." });
  if (await account.isVisible().catch(() => false)) return;
  const button = page.getByRole("button", { name: "Continue to sign in" });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await account.waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("public website", () => {
  test("homepage states the shipped CLI product and metadata", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Build in Roblox. Stay in control." })).toBeVisible();
    await expect(page.getByText("npm install -g vectiscode@alpha")).toBeVisible();
    await expect(page.getByText("Native Studio connection")).toBeVisible();
    await expect(page).toHaveTitle("VectisCode | Local Roblox coding agent");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://vectiscode.com/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow, max-image-preview:large");
    await expectDocumentFitsViewport(page);
    await expectNoVisibleOverflow(page, ".vc-public");
  });

  for (const route of ["/docs", "/status", "/download", "/privacy", "/terms", "/login"]) {
    test(`${route} uses the editorial shell without overflow`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(".vc-public")).toBeVisible();
      await expect(page.locator(".vc-header")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
      await expectDocumentFitsViewport(page);
      await expectNoVisibleOverflow(page, ".vc-public");
    });
  }

  test("the site is dark-only and honors reduced motion", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("vectis-theme", "light"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const tokens = await page.locator("html").evaluate((element) => {
      const styles = getComputedStyle(element);
      return { background: styles.getPropertyValue("--bg-app").trim(), text: styles.getPropertyValue("--text-primary").trim() };
    });
    expect(tokens).toEqual({ background: "#08090b", text: "#f2f1ec" });
    await page.keyboard.press("Tab");
    const focus = await page.locator(":focus-visible").evaluate((element) => {
      const styles = getComputedStyle(element);
      return { outline: styles.outlineStyle, width: styles.outlineWidth, transition: styles.transitionDuration };
    });
    expect(focus.outline).toBe("solid");
    expect(focus.width).toBe("2px");
    expect(Number.parseFloat(focus.transition)).toBeLessThanOrEqual(0.001);
  });

  test("waitlist reports success without navigating away", async ({ page }) => {
    await page.route("**/subscribe", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "You are on the alpha list." }) }));
    await page.goto("/");
    await page.getByLabel("Email address").fill("creator@example.test");
    await page.getByRole("button", { name: "Join the alpha" }).click();
    await expect(page.getByRole("status")).toHaveText("You are on the alpha list.");
  });

  test("robots guidance keeps account and admin routes private", async ({ page }) => {
    const response = await page.request.get("/robots.txt");
    expect(response.ok()).toBeTruthy();
    const robots = await response.text();
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("Disallow: /account");
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Sitemap: https://vectiscode.com/sitemap.xml");
  });
});

test.describe("optional account", () => {
  test("signed-out account requests go to the restrained login page", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Keep the CLI independent." })).toBeVisible();
  });

  test("signed-in account exposes only the hosted convenience boundary", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Small by design." })).toBeVisible();
    await expect(page.getByText("Independent of this account")).toBeVisible();
    await expect(page.getByText("OS keychain only")).toBeVisible();
    await expect(page.getByText("Patch Pipeline")).toHaveCount(0);
    await expect(page.getByText("Upgrade")).toHaveCount(0);
    await expectDocumentFitsViewport(page);
    await expectNoVisibleOverflow(page, ".vc-public");
  });

  test("legacy browser-product routes resolve to CLI documentation", async ({ page }) => {
    await login(page);
    for (const route of ["/new", "/chat/legacy", "/studio", "/models", "/icons"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/docs(?:#studio)?$/);
      await expect(page.getByRole("heading", { name: "From install to first Studio turn." })).toBeVisible();
    }
  });

  test("admin behavior remains available in the restrained dark shell", async ({ page }) => {
    await login(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Workspace Admin" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "User Management" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder("Search by name, email, or ID...")).toBeVisible();
    await expectDocumentFitsViewport(page);
  });
});
