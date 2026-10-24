/**
 * Before every unit test: an empty localStorage. The editor keeps where it was (the game,
 * the layout, the tab) across a reload, and a test that mounts it must not open where the
 * test before it left off.
 */
import { beforeEach } from "vitest";

beforeEach(() => {
  try {
    globalThis.localStorage.clear();
  } catch {
    // No DOM in this test: nothing kept to clear.
  }
});
