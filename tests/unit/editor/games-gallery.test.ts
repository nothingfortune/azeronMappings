// @vitest-environment happy-dom
/**
 * Choosing a game is the first step: a gallery of the games, one card each and one to add
 * a game, in place of a drop-down in the header.
 */
import { describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";

const PAYLOAD = buildPayload();

function twoGames(): typeof PAYLOAD {
  const payload = structuredClone(PAYLOAD);
  const first = payload.games[0];
  if (first) payload.games.push({ ...structuredClone(first), slug: "second", name: "Second game" });
  return payload;
}

const cards = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>(".game-card"),
];

describe("the games gallery", () => {
  it("is where a first visit opens", () => {
    document.body.innerHTML = '<div id="app"></div>';
    start(twoGames(), { firstScreen: "games" });
    expect(cards().map((card) => card.querySelector(".game-name")?.textContent)).toEqual([
      "Everspace 2",
      "Second game",
      "+ Add a new game",
    ]);
    expect(document.querySelector(".hand")).toBeNull();
  });

  it("opens the game chosen on its board, and the header names it", () => {
    document.body.innerHTML = '<div id="app"></div>';
    start(twoGames(), { firstScreen: "games" });
    cards()[1]?.click();
    expect(document.querySelector("header .game-switch")?.textContent).toContain("Second game");
    expect(document.querySelectorAll(".hand").length).toBeGreaterThan(0);
  });

  it("goes back to the gallery from the header, with the open game marked", () => {
    document.body.innerHTML = '<div id="app"></div>';
    start(twoGames());
    document.querySelector<HTMLButtonElement>("header .game-switch")?.click();
    expect(cards()[0]?.classList.contains("current")).toBe(true);
  });

  it("offers a new game as the last card, which opens the form for one", () => {
    document.body.innerHTML = '<div id="app"></div>';
    start(twoGames(), { firstScreen: "games" });
    cards().at(-1)?.click();
    expect(document.querySelector("header .tabs button.primary")?.textContent).toBe("Setup");
  });
});
