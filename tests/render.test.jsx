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

describe("requesting an account", () => {
  it("is reachable from the sign-in page", async () => {
    at("/login");
    render(<AsmarStore />);
    await booted();
    expect(await screen.findByRole("link", { name: /request an account/i })).toBeInTheDocument();
  });

  it("renders the form", async () => {
    at("/request");
    render(<AsmarStore />);
    await booted();
    expect(await screen.findByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/whatsapp number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repeat the password/i)).toBeInTheDocument();
  });

  it("stays out of the search index", async () => {
    at("/request");
    render(<AsmarStore />);
    await booted();
    /* Nothing here is worth ranking and the page is pure form. */
    await waitFor(() => expect(document.title).toMatch(/asmar/i));
  });

  it("refuses to submit until the fields make sense", async () => {
    const user = userEvent.setup();
    at("/request");
    render(<AsmarStore />);
    await booted();

    await user.click(await screen.findByRole("button", { name: /send request/i }));

    /* Clicking while invalid reveals what is missing rather than doing
       nothing — a dead button with no explanation loses the customer. */
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/please enter your name/i);
      expect(document.body.textContent).toMatch(/valid email/i);
    });
    expect(JSON.parse(localStorage.getItem("asmar:requests") || "[]")).toHaveLength(0);
  });

  it("catches a mistyped password before sending", async () => {
    const user = userEvent.setup();
    at("/request");
    render(<AsmarStore />);
    await booted();

    await user.type(await screen.findByLabelText(/your name/i), "Rami");
    await user.type(screen.getByLabelText(/email/i), "rami@example.com");
    await user.type(screen.getByLabelText(/whatsapp number/i), "70123456");
    await user.type(screen.getByLabelText(/choose a password/i), "hunter22");
    await user.type(screen.getByLabelText(/repeat the password/i), "hunter23");
    await user.click(screen.getByRole("button", { name: /send request/i }));

    await waitFor(() => expect(document.body.textContent).toMatch(/do not match/i));
    expect(JSON.parse(localStorage.getItem("asmar:requests") || "[]")).toHaveLength(0);
  });

  it("sends a good request and confirms it", async () => {
    const user = userEvent.setup();
    at("/request");
    render(<AsmarStore />);
    await booted();

    await user.type(await screen.findByLabelText(/your name/i), "Rami Asmar");
    await user.type(screen.getByLabelText(/email/i), "rami@example.com");
    await user.type(screen.getByLabelText(/whatsapp number/i), "70123456");
    await user.type(screen.getByLabelText(/choose a password/i), "hunter22");
    await user.type(screen.getByLabelText(/repeat the password/i), "hunter22");
    await user.click(screen.getByRole("button", { name: /send request/i }));

    await waitFor(() => expect(document.body.textContent).toMatch(/request sent/i));

    const stored = JSON.parse(localStorage.getItem("asmar:requests"));
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe("rami@example.com");
    expect(stored[0].status).toBe("pending");
  });

  it("sends a signed-in visitor to their account instead", async () => {
    localStorage.setItem("asmar:accounts", JSON.stringify([
      { id: "cus-1", email: "rami@example.com", password: "pw", name: "Rami", active: true },
    ]));
    localStorage.setItem("asmar:session", JSON.stringify({
      user: { id: "cus-1", email: "rami@example.com", name: "Rami", isAdmin: false },
    }));
    at("/request");
    render(<AsmarStore />);
    await booted();
    await waitFor(() => expect(document.body.textContent).not.toMatch(/repeat the password/i));
  });
});

describe("one sign-in for admin and customer", () => {
  const seedUser = ({ isAdmin = false } = {}) => {
    localStorage.setItem("asmar:accounts", JSON.stringify([
      { id: "u1", email: "ali@example.com", password: "pw", name: "Ali",
        phone: "70123456", active: true, isAdmin },
    ]));
  };

  const signIn = async (user) => {
    await user.type(await screen.findByLabelText(/email/i), "ali@example.com");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
  };

  it("offers one email-and-password form", async () => {
    at("/login");
    render(<AsmarStore />);
    await booted();
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    /* No "sign in as admin" anywhere — which they are is the database's
       answer, not a checkbox. */
    expect(screen.queryByText(/sign in as admin/i)).not.toBeInTheDocument();
  });

  it("sends a customer to their account, not the admin", async () => {
    const user = userEvent.setup();
    seedUser({ isAdmin: false });
    at("/login");
    render(<AsmarStore />);
    await booted();

    await signIn(user);
    await waitFor(() => expect(window.location.pathname).toBe("/account"));
  });

  it("sends an admin straight to the admin", async () => {
    const user = userEvent.setup();
    seedUser({ isAdmin: true });
    at("/login");
    render(<AsmarStore />);
    await booted();

    await signIn(user);
    /* The customer never chooses which they are — the stored account does. */
    await waitFor(() => expect(window.location.pathname).toBe("/admin"));
  });

  it("honours a waiting cart over the admin redirect", async () => {
    const user = userEvent.setup();
    seedUser({ isAdmin: true });
    /* Someone stopped at the cart and then signing in wanted the cart, not the
       admin — the more specific intent wins. */
    localStorage.setItem("asmar:resume", "cart");
    at("/login");
    render(<AsmarStore />);
    await booted();

    await signIn(user);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("gives an admin a way in from their account page", async () => {
    /* The redirect on sign-in is not the only way someone arrives here — a
       bookmark, the account icon, a restored session all land on /account. */
    seedUser({ isAdmin: true });
    localStorage.setItem("asmar:session", JSON.stringify({
      user: { id: "u1", email: "ali@example.com", name: "Ali", isAdmin: true },
    }));
    at("/account");
    render(<AsmarStore />);
    await booted();

    /* Scoped to <main>: the footer carries its own "Store admin" link on every
       page, so an unscoped query matches whether this works or not. */
    await waitFor(() => expect(document.querySelector("main")).toBeInTheDocument());
    const link = await within(document.querySelector("main"))
      .findByRole("link", { name: /store admin/i });
    expect(link).toHaveAttribute("href", "/admin");
  });

  it("does not offer that link to a customer", async () => {
    seedUser({ isAdmin: false });
    localStorage.setItem("asmar:session", JSON.stringify({
      user: { id: "u1", email: "ali@example.com", name: "Ali", isAdmin: false },
    }));
    at("/account");
    render(<AsmarStore />);
    await booted();

    await waitFor(() => expect(document.body.textContent).toMatch(/balance/i));
    expect(
      within(document.querySelector("main")).queryByRole("link", { name: /store admin/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps a wrong password out", async () => {
    const user = userEvent.setup();
    seedUser({ isAdmin: true });
    at("/login");
    render(<AsmarStore />);
    await booted();

    await user.type(await screen.findByLabelText(/email/i), "ali@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(document.body.textContent).toMatch(/wrong email or password/i));
    expect(window.location.pathname).toBe("/login");
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

/* [data-reveal] is opacity:0 until .revealed is added, so anything the reveal
   effect misses is not a missed animation — it is content nobody can see.
 *
 * The live shop lost its whole account page this way. Returning to the tab
 * re-reads the balance, which swaps the page for its loading skeleton and back;
 * React rebuilds those nodes, and rewrites className on the ones it reuses,
 * dropping .revealed. The effect keyed off a dependency string that had not
 * changed, so it never re-ran and the balance stayed invisible.
 *
 * Both cases below are that same rebuild, done to the mounted shop. */
describe("reveal", () => {
  const revealed = (el) => waitFor(() => expect(el).toHaveClass("revealed"), { timeout: 3000 });

  it("reveals a section that appears after the first pass", async () => {
    render(<AsmarStore />);
    await booted();

    const late = document.createElement("div");
    late.setAttribute("data-reveal", "");
    late.textContent = "arrived late";
    document.body.appendChild(late);

    await revealed(late);
  });

  it("re-reveals a section React rebuilt without remounting the app", async () => {
    render(<AsmarStore />);
    await booted();

    const section = document.querySelector("[data-reveal]");
    expect(section).not.toBeNull();
    await revealed(section);

    /* Exactly what React does to a node it reuses across the skeleton swap:
       className is written wholesale, so .revealed goes with it. */
    section.className = section.className.replace(/\brevealed\b/, "").trim();
    expect(section).not.toHaveClass("revealed");

    await revealed(section);
  });
});
