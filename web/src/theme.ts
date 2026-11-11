// Light or dark. The page follows the system until the visitor picks one with
// the button in the nav; the pick is remembered. (A small script in
// index.html's <head> sets the mode before the first paint, so there's no
// flash; this keeps it in step afterwards.)

const MODE_KEY = "kulhi-mode";
const root = document.documentElement;
const system = window.matchMedia("(prefers-color-scheme: dark)");
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse; the choice just won't be remembered.
  }
};

const isDark = () => root.dataset.mode === "dark";

/** The browser's own bar takes the page's paper colour. */
const paintBar = () => {
  if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue("--paper").trim();
};

const setMode = (mode: "light" | "dark") => {
  root.dataset.mode = mode;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode-toggle]")) {
    b.setAttribute("aria-label", mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme");
  }
  paintBar();
};

export function theme() {
  setMode(isDark() ? "dark" : "light");

  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode-toggle]")) {
    b.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      store(MODE_KEY, next);
      setMode(next);
    });
  }

  // Until the visitor chooses, follow the system as it changes.
  system.addEventListener("change", (e) => {
    if (stored(MODE_KEY)) return;
    setMode(e.matches ? "dark" : "light");
  });
}

