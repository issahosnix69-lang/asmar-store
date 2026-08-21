/* End-to-end, against the production build.
 *
 * The unit and render tests cover behaviour. These cover the things that only
 * exist once the site is built and served: prerendered head tags, the SPA
 * fallback that makes a shared link work, and a full browse-to-order run in a
 * real browser.
 */
import { test, expect } from "@playwright/test";

/* Accounts are created by the owner, not by signup, so the e2e run seeds one
   into localStorage the same way the admin would have. */
const SEED_ACCOUNT = `
  localStorage.setItem("asmar:accounts", JSON.stringify([
    { id: "cus-e2e", email: "rami@example.com", password: "pw", name: "Rami",
      phone: "70123456", active: true }
  ]));
  localStorage.setItem("asmar:wallet", JSON.stringify([
    { id: 1, customerId: "cus-e2e", amount: 50, kind: "topup", ref: "TOP-E2E",
      created_at: new Date().toISOString() }
  ]));
`;

/* The shop pulls its four typefaces from Google Fonts. That is a decision about
   the product, not something these tests are checking — but `page.goto` waits
   for "load", and "load" waits for those files, so on a connection that cannot
   reach fonts.gstatic.com every test here times out at 30s against a shop that
   is working perfectly. Which tests fail then depends on which worker got the
   slow socket, so the suite fails differently on each run and stops meaning
   anything. Cut the dependency: the browser falls back to a system font and
   every assertion below is about behaviour, not letterforms.

   Answered with an empty stylesheet rather than aborted: an abort surfaces as
   "Failed to load resource: net::ERR_FAILED" in the console, which the cold-load
   test below would then correctly report as an error. An empty sheet asks for no
   woff2 at all, so nothing is left to fail. */
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
});

const signIn = async (page) => {
  await page.addInitScript(SEED_ACCOUNT);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("rami@example.com");
  await page.getByLabel(/password/i).fill("pw");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/account/);
};

test.describe("the shop loads", () => {
  test("homepage renders the catalogue", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /streaming/i }).first()).toBeVisible();
  });

  test("no console errors on a cold load", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/");
    /* Deliberately not networkidle. The shop pulls four woff2 files from
       fonts.gstatic.com, so "no requests in flight" is a statement about a
       third-party CDN, not about the shop — on a connection that cannot reach
       it this test fails for 30s while the page itself rendered perfectly and
       logged nothing. Wait for the app to have mounted, then give late errors
       a moment to surface. */
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});

test.describe("shared links resolve", () => {
  /* This is what the whole routing migration was for: a link pasted into
     WhatsApp has to open the product, not the homepage and not a 404. */
  test("a product link opens that product directly", async ({ page }) => {
    const res = await page.goto("/p/netflix");
    expect(res.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Netflix", level: 1 })).toBeVisible();
  });

  test("its head is correct before any JavaScript runs", async ({ page }) => {
    /* Reading the served HTML rather than the rendered DOM proves the
       prerender step did the work, not React. */
    const res = await page.request.get("/p/netflix");
    const html = await res.text();
    expect(html).toContain("<title>Netflix subscription in Lebanon");
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('content="index, follow"');
  });

  test("account pages are marked noindex in the served HTML", async ({ page }) => {
    const html = await (await page.request.get("/account")).text();
    expect(html).toContain("noindex");
  });

  test("an old #/ link still lands on the right page", async ({ page }) => {
    await page.goto("/#/p/netflix");
    await expect(page).toHaveURL(/\/p\/netflix$/);
    await expect(page.getByRole("heading", { name: "Netflix", level: 1 })).toBeVisible();
  });

  test("robots.txt and sitemap.xml are served", async ({ page }) => {
    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("Sitemap:");

    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain("/p/netflix");
    expect(xml).not.toContain("/account");
  });
});

test.describe("navigation", () => {
  test("moves between pages without a full reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /streaming/i }).first().click();
    await expect(page).toHaveURL(/\/c\/streaming/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/streaming/i);
  });

  test("the back button works", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /streaming/i }).first().click();
    await expect(page).toHaveURL(/\/c\/streaming/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the title changes per page", async ({ page }) => {
    await page.goto("/");
    const home = await page.title();
    await page.goto("/p/netflix");
    expect(await page.title()).not.toBe(home);
    expect(await page.title()).toContain("Netflix");
  });
});

test.describe("browse to order", () => {
  test("a signed-in customer can pay from their balance", async ({ page }) => {
    await signIn(page);

    await page.goto("/p/netflix");
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();

    await expect(page.getByText("$4.50").first()).toBeVisible();
    await page.getByRole("button", { name: /continue to checkout/i }).click();

    /* Prefilled from the account. */
    await expect(page.getByLabel(/name/i)).toHaveValue("Rami");

    await page.getByRole("button", { name: /balance/i }).click();
    await page.getByRole("button", { name: /place order/i }).click();

    /* The receipt carries the code the customer tracks the order with. */
    await expect(page.getByText(/ASM-/)).toBeVisible();
  });

  test("a signed-out visitor is stopped at the cart", async ({ page }) => {
    await page.goto("/p/netflix");
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await expect(page.getByRole("button", { name: /sign in to order/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /continue to checkout/i })).toHaveCount(0);
  });

  test("the cart survives a reload", async ({ page }) => {
    await page.goto("/p/netflix");
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await expect(page.getByText("$4.50").first()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /open cart/i }).click();
    await expect(page.getByText("Netflix").first()).toBeVisible();
  });
});

test.describe("requesting an account", () => {
  test("a stranger can send their details in one go", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /request an account/i }).click();
    await expect(page).toHaveURL(/\/request$/);

    await page.getByLabel(/your name/i).fill("Rami Asmar");
    await page.getByLabel(/email/i).fill("rami.e2e@example.com");
    await page.getByLabel(/whatsapp number/i).fill("+961 70 123 456");
    await page.getByLabel(/choose a password/i).fill("hunter22");
    await page.getByLabel(/repeat the password/i).fill("hunter22");
    await page.getByRole("button", { name: /send request/i }).click();

    await expect(page.getByText(/request sent/i)).toBeVisible();
    await expect(page.getByText(/rami\.e2e@example\.com/)).toBeVisible();
  });

  test("is reachable from a full cart", async ({ page }) => {
    await page.goto("/p/netflix");
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
    await expect(page.getByRole("link", { name: /request an account/i })).toBeVisible();
  });

  test("will not send a mismatched password", async ({ page }) => {
    await page.goto("/request");
    await page.getByLabel(/your name/i).fill("Rami");
    await page.getByLabel(/email/i).fill("rami@example.com");
    await page.getByLabel(/whatsapp number/i).fill("70123456");
    await page.getByLabel(/choose a password/i).fill("hunter22");
    await page.getByLabel(/repeat the password/i).fill("hunter23");
    await page.getByRole("button", { name: /send request/i }).click();

    await expect(page.getByText(/do not match/i)).toBeVisible();
    await expect(page.getByText(/request sent/i)).toHaveCount(0);
  });
});

test.describe("bilingual", () => {
  test("flips to Arabic and back", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /switch to arabic/i }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    await page.reload();
    /* The choice has to survive a reload or a customer re-picks it every visit. */
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});

test.describe("theme", () => {
  test("is dark by default and remembers a switch to light", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: /light mode/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
