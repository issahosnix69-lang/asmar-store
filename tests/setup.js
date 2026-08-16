import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.getElementById("asmar-jsonld")?.remove();
  /* Appended to <head>, which testing-library's cleanup does not touch, so
     without this the next test starts with the previous test's tags. */
  document.getElementById("asmar-arabic-fonts")?.remove();
});

/* jsdom has neither, and the storefront uses both on every page. Without these
   the reveal animation throws on mount and nothing renders at all. */
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

global.matchMedia = global.matchMedia || ((query) => ({
  matches: false, media: query, onchange: null,
  addListener: vi.fn(), removeListener: vi.fn(),
  addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
}));

window.scrollTo = vi.fn();

/* Canvas is used to downscale receipt photographs before upload. */
HTMLCanvasElement.prototype.getContext = () => ({ drawImage: vi.fn() });
HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,test";
