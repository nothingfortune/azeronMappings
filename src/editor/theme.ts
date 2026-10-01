/**
 * Light and dark, chosen by the user and remembered.
 *
 * The page follows the operating system until the user picks one, and from then on the
 * pick wins. The menu item used to set `data-theme` to `dark` unless it already said
 * `dark`, which is no toggle at all: with no attribute set -- the page following the OS --
 * the first click on a dark system "switched" to dark, and nothing happened.
 */

export type Theme = "light" | "dark";

export const THEME_KEY = "azeron-editor-theme";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** What the page is showing right now, whether the user chose it or the OS did. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (isTheme(chosen)) return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Storage can be absent or throw (private windows, blocked site data); the page works without. */
function remember(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; the choice still holds until the page is reloaded.
  }
}

/** Put back the theme the user chose last time, if they ever did. */
export function applyStoredTheme(): void {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) document.documentElement.dataset.theme = stored;
  } catch {
    // No storage: follow the OS.
  }
}

/** Switch to the other theme from the one on screen, and remember it. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  remember(next);
  return next;
}
