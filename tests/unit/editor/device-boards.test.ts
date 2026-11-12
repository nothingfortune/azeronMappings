// @vitest-environment happy-dom
/**
 * The keyboard, mouse and controller drawn with what each key does: from the bindings, a
 * bound key naming its action and taking the owner to it.
 */
import { describe, expect, it, vi } from "vitest";

import { keyboardBoard, padBoard } from "../../../src/editor/device-boards.js";

const actions = {
  reload: { label: "Reload", kbm: "KeyR", pad: "X" },
  sprint: { label: "Sprint", kbm: "ShiftLeft+KeyW" },
  fire: { label: "Fire", kbm: "MouseLeft", pad: "RT" },
  melee: { label: "Melee", pad: "X" },
};

const key = (board: HTMLElement, name: string): HTMLElement | undefined =>
  [...board.querySelectorAll<HTMLElement>(".device-key")].find(
    (node) => node.querySelector(".device-key-name")?.textContent === name,
  );

describe("the keyboard and mouse", () => {
  it("shows each bound key's action, a chord on the key pressed last", () => {
    const board = keyboardBoard(actions, () => undefined);
    expect(key(board, "R")?.querySelector(".device-key-action")?.textContent).toBe("Reload");
    expect(key(board, "W")?.title).toMatch(/Sprint \(.*Shift.*W\)/);
    expect(key(board, "Left click")?.classList.contains("bound")).toBe(true);
    expect(key(board, "Q")?.hasAttribute("disabled")).toBe(true);
  });

  it("takes the owner to the action when a bound key is clicked", () => {
    const pick = vi.fn();
    const board = keyboardBoard(actions, pick);
    key(board, "R")?.click();
    expect(pick).toHaveBeenCalledWith("reload");
  });
});

describe("the controller", () => {
  it("shows each control's action, and marks one two actions share", () => {
    const board = padBoard(actions, () => undefined);
    expect(key(board, "RT")?.querySelector(".device-key-action")?.textContent).toBe("Fire");
    expect(key(board, "X")?.classList.contains("shared")).toBe(true);
    expect(key(board, "X")?.title).toBe("Reload\nMelee");
  });
});
