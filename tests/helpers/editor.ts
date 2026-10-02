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
