/** Small helpers for driving the editor page in the unit tests. */

/**
 * Show the keys on the In-game tab. They are hidden while the editor can write them into
 * the game on its own, so a test that moves one by hand asks for them first, as the owner
 * would.
 */
export function showWiring(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-wiring="toggle"]');
  if (toggle?.textContent === "Show the wiring") toggle.click();
}

/**
 * Open one of the Edit dock's tabs -- the checks, or the sticks and pedals -- the way the
 * owner does, by clicking it. Only one shows at a time.
 */
export function showDockTab(tab: "checks" | "pedals"): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-dock-tab="${tab}"]`);
  if (button !== null && !button.classList.contains("active")) button.click();
}
