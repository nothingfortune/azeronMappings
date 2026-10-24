/**
 * Two ways the game's binding file used to be left wrong with a success message.
 *
 * Nothing here touches the owner's real config: the game's `ingame_config` is pointed at a
 * path that does not exist, and the source is the committed copy.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { applyVocabulary, IngameError, parseInput } from "../../../src/lib/ingame.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet } from "../../../src/lib/model-core.js";
import { applyIngame } from "../../../src/lib/tasks.js";

const COMMITTED = repoPath("dist/SpaceSims/everspace/Input.ini");

describe("applyIngame to a game file that is not there", () => {
  const MISSING = "/nonexistent-game-dir/Saved/Config/Windows/Input.ini";

  it("refuses, names the path, and writes nothing", () => {
    const game = new Game("games/SpaceSims/everspace");
    game.config.ingame_config = MISSING;
    const modified = statSync(COMMITTED).mtimeMs;
    let message = "";
    try {
      applyIngame(game, { write: true, toGame: true, override: COMMITTED });
    } catch (error) {
      expect(error).toBeInstanceOf(IngameError);
      message = (error as Error).message;
    }
    expect(message).toContain(MISSING);
    expect(statSync(COMMITTED).mtimeMs).toBe(modified);
    expect(existsSync(MISSING)).toBe(false);
  });

  it("still writes the committed copy when the game is not the target", () => {
    const game = new Game("games/SpaceSims/everspace");
    game.config.ingame_config = MISSING;
    const before = readFileSync(COMMITTED, "utf8");
    const result = applyIngame(game, { write: false, override: COMMITTED });
    expect(result.written).toEqual([]);
    expect(readFileSync(COMMITTED, "utf8")).toBe(before);
  });
});

describe("applyVocabulary with a key the game cannot spell", () => {
  const FILE = parseInput(
    [
      "[/Script/ES2.CustomPlayerInput]",
      'KeybindingsConfig=(Action=Boost,ActionName="Boost",AxisName="",Category=0,bIsAxis=False,' +
        "Key1=LeftShift,Key1Mod=None,Key2=None,Key2Mod=None,Scale=1.000000,DeadZone=0.100000," +
        "Sensitivity=1.000000,Exponent=1.000000,bInvert=False," +
        'DisplayName=NSLOCTEXT("KEY_BINDINGS", "K", "Boost"),GroupName="Keyboard")',
    ].join("\n"),
  );
  const owned = new Set([0]);

  it("refuses, naming the action and the key, rather than leaving the row unbound", () => {
    const actions = new ActionSet({
      actions: { boost: { key: "Fn", ingame: "Boost" } },
    });
    expect(() => applyVocabulary(FILE, actions, owned)).toThrow(IngameError);
    expect(() => applyVocabulary(FILE, actions, owned)).toThrow(/boost.*Fn/);
  });

  it("still leaves a row unbound for an action that has no key at all", () => {
    const actions = new ActionSet({ actions: { boost: { ingame: "Boost" } } });
    expect(applyVocabulary(FILE, actions, owned).text).toContain("Key1=None");
  });
});
