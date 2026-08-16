/* Mounts the real storefront and walks it.
 *
 * These are not detailed UI assertions — they are the check that the shop boots
 * at all, that every route renders something rather than throwing, and that the
 * two things a customer cannot recover from (an empty cart that eats a click, a
 * checkout that opens without an account) behave.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AsmarStore from "../asmar-store.jsx";

const at = (path) => window.history.replaceState({}, "", path);

beforeEach(() => {
  localStorage.clear();
  at("/");
});

/* The boot skeleton is replaced once fetchCatalog/fetchSettings resolve. */
const booted = () => waitFor(() => expect(document.querySelector("header")).toBeInTheDocument());

describe("booting", () => {
  it("renders the storefront without crashing", async () => {
    render(<AsmarStore />);
    await booted();
    expect(screen.getAllByText("Asmar").length).toBeGreaterThan(0);
  });

  it("shows the seeded categories", async () => {
    render(<AsmarStore />);
    await booted();
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: /streaming/i }).length).toBeGreaterThan(0);
    });
  });

  it("defaults to the dark theme", async () => {
    render(<AsmarStore />);
    await booted();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("routes render", () => {
  it.each([
    ["/", /subscription/i],
    ["/p/netflix", /netflix/i],
    ["/c/streaming", /streaming/i],
    ["/track", /order/i],
    ["/page/refund", /refund|warranty/i],
    ["/page/terms", /terms/i],
    ["/login", /sign in/i],
  ])("%s renders", async (path, expected) => {
    at(path);
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(document.body.textContent).toMatch(expected));
  });

  it("sends an unknown category back to the shop rather than a dead page", async () => {
    at("/c/does-not-exist");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("shows a recoverable message for a product that no longer exists", async () => {
    at("/p/not-a-real-product");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(document.body.textContent).toMatch(/no longer|not found|gone/i));
  });
});

describe("document head", () => {
  it("titles each page for what it is", async () => {
    at("/p/netflix");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(document.title).toMatch(/netflix/i));

    const canonical = document.querySelector('link[rel="canonical"]');
    expect(canonical.getAttribute("href")).toMatch(/\/p\/netflix$/);
  });

  it("keeps the account page out of the index", async () => {
    at("/login");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => {
      expect(document.querySelector('meta[name="robots"]').getAttribute("content"))
        .toMatch(/noindex/);
    });
  });

  it("emits product structured data", async () => {
    at("/p/netflix");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(document.getElementById("asmar-jsonld")).toBeInTheDocument());
    const data = JSON.parse(document.getElementById("asmar-jsonld").textContent);
    expect(data["@type"]).toBe("Product");
  });
});

describe("legacy hash links", () => {
  it("upgrades a shared #/p/netflix link to the real path", async () => {
    window.history.replaceState({}, "", "/#/p/netflix");
    render(<AsmarStore />);
    await booted();
    expect(window.location.pathname).toBe("/p/netflix");
    await waitFor(() => expect(document.body.textContent).toMatch(/netflix/i));
  });
});

describe("the cart", () => {
  /* The related-product cards each carry their own "Add to cart — <name>"
     button, so the buy box has to be addressed by its exact name. */
  const buyBox = () => screen.findByRole("button", { name: "Add to cart" });

  it("opens with a message rather than an empty panel", async () => {
    const user = userEvent.setup();
    render(<AsmarStore />);
    await booted();
    await user.click(screen.getByRole("button", { name: /open cart/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/your order is empty/i));
    expect(document.body.textContent).toMatch(/add a subscription to start/i);
  });

  it("adds a product and shows the right line total", async () => {
    const user = userEvent.setup();
    at("/p/netflix");
    render(<AsmarStore />);
    await booted();

    await user.click(await buyBox());

    /* The drawer opens on add, which is the behaviour worth protecting: the
       total and the checkout button have to be in front of the customer. */
    await waitFor(() => expect(document.body.textContent).toMatch(/\$4\.50/));
    expect(JSON.parse(localStorage.getItem("asmar:cart"))).toHaveLength(1);
  });

  it("stops at sign-in instead of letting an account-less order through", async () => {
    const user = userEvent.setup();
    at("/p/netflix");
    render(<AsmarStore />);
    await booted();

    await user.click(await buyBox());
    await waitFor(() => expect(document.body.textContent).toMatch(/\$4\.50/));

    /* No "continue to checkout" for a signed-out visitor — the gate is here. */
    expect(screen.queryByRole("button", { name: /continue to checkout/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in to order/i })).toBeInTheDocument();
  });

  it("survives a reload with the cart intact", async () => {
    const user = userEvent.setup();
    at("/p/netflix");
    const { unmount } = render(<AsmarStore />);
    await booted();
    await user.click(await buyBox());
    await waitFor(() => expect(JSON.parse(localStorage.getItem("asmar:cart"))).toHaveLength(1));

    unmount();
    at("/");
    render(<AsmarStore />);
    await booted();

    /* The badge on the cart button carries the count. */
    await waitFor(() => {
      const cartBtn = screen.getByRole("button", { name: /open cart/i });
      expect(within(cartBtn).getByText("1")).toBeInTheDocument();
    });
  });

  it("lets a signed-in customer reach checkout", async () => {
    const user = userEvent.setup();
    localStorage.setItem("asmar:accounts", JSON.stringify([
      { id: "cus-1", email: "rami@example.com", password: "pw", name: "Rami",
        phone: "70123456", active: true },
    ]));
    localStorage.setItem("asmar:session", JSON.stringify({
      user: { id: "cus-1", email: "rami@example.com", name: "Rami", isAdmin: false },
    }));

    at("/p/netflix");
    render(<AsmarStore />);
    await booted();
    await user.click(await buyBox());

    const proceed = await screen.findByRole("button", { name: /continue to checkout/i });
    await user.click(proceed);

    /* The form prefills from the account — retyping a phone number on a phone
       is where orders get abandoned. */
    await waitFor(() => {
      expect(screen.getByDisplayValue("Rami")).toBeInTheDocument();
      expect(screen.getByDisplayValue("rami@example.com")).toBeInTheDocument();
    });
  });
});

describe("language", () => {
  it("flips the whole document to Arabic and back", async () => {
    const user = userEvent.setup();
    render(<AsmarStore />);
    await booted();

    await user.click(screen.getByRole("button", { name: /switch to arabic/i }));
    await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("rtl"));
    expect(document.documentElement.getAttribute("lang")).toBe("ar");

    await user.click(screen.getByRole("button", { name: /switch to english|الإنجليزية/i }));
    await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("ltr"));
  });

  it("loads the Arabic fonts only once Arabic is asked for", async () => {
    const user = userEvent.setup();
    render(<AsmarStore />);
    await booted();
    expect(document.getElementById("asmar-arabic-fonts")).toBeNull();

    await user.click(screen.getByRole("button", { name: /switch to arabic/i }));
    await waitFor(() => expect(document.getElementById("asmar-arabic-fonts")).toBeInTheDocument());
  });
});

describe("theme", () => {
  it("remembers the choice", async () => {
    const user = userEvent.setup();
    render(<AsmarStore />);
    await booted();
    await user.click(screen.getByRole("button", { name: /light mode/i }));
    await waitFor(() => expect(localStorage.getItem("asmar:theme")).toBe("light"));
  });
});
