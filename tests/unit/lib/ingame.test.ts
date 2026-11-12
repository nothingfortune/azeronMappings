/**
 * Reading the game's own binding file. The file belongs to the game, so parsing is
 * lossless and only Key1 on a keyboard row is ever rewritten.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import {
  applyVocabulary,
  compareToGame,
  gameCollisions,
  IngameError,
  KEYBOARD_GROUP,
  ownedCollisions,
  parseInput,
  setKey,
  ueKeyFor,
} from "../../../src/lib/ingame.js";
import { Game } from "../../../src/lib/model.js";
import { ActionSet } from "../../../src/lib/model-core.js";

const LINE = (
  action: string,
  key: string,
  group = "Keyboard",
  scale = "1.000000",
  display = "Thing",
) =>
  `KeybindingsConfig=(Action=${action},ActionName="${action}",AxisName="",Category=0,bIsAxis=False,` +
  `Key1=${key},Key1Mod=None,Key2=None,Key2Mod=None,Scale=${scale},DeadZone=0.100000,` +
  `Sensitivity=1.000000,Exponent=1.000000,bInvert=False,` +
  `DisplayName=NSLOCTEXT("KEY_BINDINGS", "K", "${display}"),GroupName="${group}")`;

const FILE = [
  ";METADATA=(Diff=true, UseCommands=true)",
  "[/Script/ES2.CustomPlayerInput]",
  LINE("Boost", "LeftShift", "Keyboard", "1.000000", "Boost [HOLD]"),
  LINE("Boost", "None", "Joystick", "1.000000", "Boost [HOLD]"),
  LINE("Pitch", "Up", "Keyboard", "1.000000", "Pitch up"),
  LINE("MenuSideCompare", "LeftShift", "Keyboard", "1.000000", "Toggle side by side compare"),
].join("\n");

describe("parseInput", () => {
  it("reads one entry per binding row and ignores the rest", () => {
    const file = parseInput(FILE);
    expect(file.entries.length).toBe(4);
    expect(file.lines.length).toBe(6);
    const boost = file.entries[0];
    expect(boost?.action).toBe("Boost");
    expect(boost?.key).toBe("LeftShift");
    expect(boost?.group).toBe("Keyboard");
    expect(boost?.displayName).toBe("Boost [HOLD]");
  });
});

describe("ueKeyFor", () => {
  it("translates our key names into Unreal's", () => {
    expect(ueKeyFor({ key: "KeyF" })).toBe("F");
    expect(ueKeyFor({ key: "Digit5" })).toBe("Five");
    expect(ueKeyFor({ key: "ArrowUp" })).toBe("Up");
    expect(ueKeyFor({ key: "F9" })).toBe("F9");
    expect(ueKeyFor({ meta: "ShiftLeft" })).toBe("LeftShift");
    expect(ueKeyFor({ mouse: "middle" })).toBe("MiddleMouseButton");
  });

  it("returns null rather than guessing at a key it does not know", () => {
    expect(ueKeyFor({ key: "Fn" })).toBeNull();
    expect(ueKeyFor({})).toBeNull();
  });
});

describe("compareToGame", () => {
  const actions = new ActionSet({
    actions: {
      boost: { label: "Boost", meta: "ShiftLeft" },
      cycle_up: { label: "Cycle weapon (up)", key: "ArrowUp" },
      nothing: { label: "Unbound", key: "F3" },
      sensor: { label: "Pitch", provided_by: "sensor" },
    },
  });

  it("matches on the key, which is the only thing the two sides share", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    const boost = rows.find((row) => row.action === "boost");
    expect(boost?.status).toBe("agrees");
    expect(boost?.theirs.map((entry) => entry.display).sort()).toEqual([
      "Boost [HOLD]",
      "Toggle side by side compare",
    ]);
  });

  it("reports what the game actually does with a key, not what we called it", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    const cycle = rows.find((row) => row.action === "cycle_up");
    expect(cycle?.theirs[0]?.display).toBe("Pitch up");
  });

  it("separates keys the game has nothing on from actions no key sends", () => {
    const rows = compareToGame(actions, parseInput(FILE));
    expect(rows.find((row) => row.action === "nothing")?.status).toBe("unmatched");
    expect(rows.find((row) => row.action === "sensor")?.status).toBe("unsendable");
  });
});

describe("gameCollisions", () => {
  it("reports a key the game binds to more than one action", () => {
    expect(gameCollisions(parseInput(FILE))).toEqual([
      { key: "LeftShift", actions: ["Boost [HOLD]", "Toggle side by side compare"] },
    ]);
  });
});

describe("setKey", () => {
  it("rewrites only Key1 and leaves the rest of the line alone", () => {
    const before = LINE("Boost", "LeftShift");
    const after = setKey(before, "RightShift");
    expect(after).toContain("Key1=RightShift,");
    expect(after.replace("Key1=RightShift", "Key1=LeftShift")).toBe(before);
  });
});

describe("compareToGame with a named row", () => {
  it("reports a row the game has put on another key, which key matching could not see", () => {
    // Matching by key alone says "the game does something with A" and calls it agreement.
    // Naming the row is what catches the game doing something else with it.
    const actions = new ActionSet({
      actions: { strafe_left: { key: "KeyA", ingame: "MoveRight", ingame_scale: -1 } },
    });
    const file = parseInput(
      [
        LINE("MoveRight", "D", "Keyboard", "-1.000000", "Strafe left"),
        LINE("MoveRight", "A", "Keyboard", "1.000000", "Strafe right"),
      ].join("\n"),
    );
    const row = compareToGame(actions, file)[0];
    expect(row?.status).toBe("differs");
    expect(row?.theirs[0]?.key).toBe("D");
  });
});

describe("applyVocabulary", () => {
  /**
   * The in-game half is generated from actions.yaml, so a layout can change on the keypads
   * alone. Checked against the game's own file as it stood before the first apply.
   */
  const game = new Game("games/SpaceSims/everspace");
  const BEFORE = readFileSync(repoPath("tests/fixtures/everspace2-Input.before.ini"), "utf8");
  const owned = new Set(game.config.ingame_owned_categories ?? []);

  function generated() {
    return applyVocabulary(parseInput(BEFORE), game.actions, owned);
  }

  function keyOf(text: string, action: string, scale = 1): string | undefined {
    return parseInput(text).entries.find(
      (entry) =>
        entry.group === KEYBOARD_GROUP &&
        !entry.isAxis &&
        entry.action === action &&
        entry.scale === scale,
    )?.key;
  }

  it("covers every row live while flying, so nothing is left on a key the repo does not know", () => {
    expect(owned.size).toBeGreaterThan(0);
    expect(() => generated()).not.toThrow();
  });

  it("puts strafe back the way every label and stick mode assumes", () => {
    const { text } = generated();
    expect(keyOf(BEFORE, "MoveRight", -1)).toBe("D");
    expect(keyOf(text, "MoveRight", -1)).toBe("A");
    expect(keyOf(text, "MoveRight", 1)).toBe("D");
  });

  it("moves quick load off hover up, and quick save off equip secondary 2", () => {
    const { text } = generated();
    expect(keyOf(BEFORE, "QuickLoad")).toBe(keyOf(BEFORE, "MoveUp", 1));
    expect(keyOf(text, "QuickLoad")).not.toBe(keyOf(text, "MoveUp", 1));
    expect(keyOf(text, "QuickSave")).not.toBe(keyOf(text, "Secondary2"));
  });

  it("leaves no two live rows on one key except the ones the vocabulary allows", () => {
    const collisions = ownedCollisions(parseInput(generated().text), owned);
    const allowed = new Set(game.actions.duplicateKeyAllowlist.map((entry) => entry.key));
    for (const { key } of collisions) {
      // Allowlist keys are ours ("KeyF"); the file's are Unreal's ("F").
      expect([...allowed].map((ours) => ueKeyFor({ key: ours }))).toContain(key);
    }
  });

  it("touches nothing outside the keyboard rows it owns", () => {
    const before = parseInput(BEFORE);
    const after = parseInput(generated().text);
    expect(after.lines.length).toBe(before.lines.length);
    expect(after.eol).toBe("\r\n");
    for (const entry of before.entries) {
      if (entry.group === KEYBOARD_GROUP && owned.has(entry.category) && !entry.isAxis) continue;
      expect(after.lines[entry.index], `${entry.group} ${entry.action}`).toBe(entry.raw);
    }
    // And the lines that are not bindings at all.
    expect(after.lines[0]).toBe(before.lines[0]);
    expect(after.lines[1]).toBe(before.lines[1]);
  });

  it("is a fixed point: generating from its own output changes nothing", () => {
    const once = generated().text;
    expect(applyVocabulary(parseInput(once), game.actions, owned).changes).toEqual([]);
  });

  it("refuses a vocabulary that leaves a live row unnamed, rather than guessing", () => {
    const partial = new ActionSet({
      actions: Object.fromEntries(
        Object.entries(game.actions.actions).filter(([id]) => id !== "quick_load"),
      ),
    });
    expect(() => applyVocabulary(parseInput(BEFORE), partial, owned)).toThrow(IngameError);
    expect(() => applyVocabulary(parseInput(BEFORE), partial, owned)).toThrow(/QuickLoad/);
  });

  it("refuses a reference to a row the game does not have", () => {
    const typo = new ActionSet({
      actions: { ...game.actions.actions, quick_load: { key: "F11", ingame: "QuickLaod" } },
    });
    expect(() => applyVocabulary(parseInput(BEFORE), typo, owned)).toThrow(/QuickLaod/);
  });

  it("agrees with actions.yaml on every row once generated", () => {
    const rows = compareToGame(game.actions, parseInput(generated().text));
    expect(rows.filter((row) => row.status === "differs")).toEqual([]);
  });
});

describe("writing the keyboard-and-mouse and controller bindings", () => {
  const file = (): ReturnType<typeof parseInput> =>
    parseInput(
      [
        "[/Script/ES2.CustomPlayerInput]",
        LINE("Reload", "R"),
        LINE("Reload", "Gamepad_FaceButton_Left", "Gamepad"),
        LINE("Jump", "SpaceBar"),
        LINE("Jump", "Gamepad_FaceButton_Bottom", "Gamepad"),
      ].join("\n"),
    );
  const owned = new Set([0]);
  const apply = (actions: Record<string, Record<string, unknown>>) =>
    applyVocabulary(file(), new ActionSet({ actions }), owned);

  it("leaves the file as it was for actions with neither", () => {
    const before = file();
    const out = apply({
      reload: { key: "KeyR", ingame: "Reload" },
      jump: { key: "Space", ingame: "Jump" },
    });
    expect(out.text).toBe(before.lines.join(before.eol));
    expect(out.skipped).toEqual([]);
  });

  it("puts a keyboard key other than the keypad's in Key2, and a controller control in the Gamepad row", () => {
    const out = apply({
      reload: { key: "Insert", ingame: "Reload", kbm: "KeyR", pad: "RB" },
      jump: { key: "Space", ingame: "Jump", kbm: "Space" },
    });
    const rows = parseInput(out.text).entries;
    const reload = rows.find((row) => row.action === "Reload" && row.group === "Keyboard");
    expect([reload?.key, reload?.key2]).toEqual(["Insert", "R"]);
    const pad = rows.find((row) => row.action === "Reload" && row.group === "Gamepad");
    expect(pad?.key).toBe("Gamepad_RightShoulder");
    // The same key as the keypad's is not written twice.
    const jump = rows.find((row) => row.action === "Jump" && row.group === "Keyboard");
    expect(jump?.key2).toBe("None");
    // Jump has no controller binding: its Gamepad row is left as the game has it.
    const jumpPad = rows.find((row) => row.action === "Jump" && row.group === "Gamepad");
    expect(jumpPad?.key).toBe("Gamepad_FaceButton_Bottom");
  });

  it("writes a mouse binding by Unreal's name", () => {
    const out = apply({
      reload: { key: "KeyR", ingame: "Reload", kbm: "MouseRight" },
      jump: { key: "Space", ingame: "Jump" },
    });
    const reload = parseInput(out.text).entries.find(
      (row) => row.action === "Reload" && row.group === "Keyboard",
    );
    expect(reload?.key2).toBe("RightMouseButton");
  });

  it("says what it could not write yet, and writes the rest", () => {
    const out = apply({
      reload: { key: "KeyR", ingame: "Reload", kbm: "ControlLeft+KeyR", pad: "LeftStickUp" },
      jump: { key: "Space", ingame: "Jump" },
    });
    expect(out.skipped).toHaveLength(2);
    expect(out.skipped.join(" ")).toMatch(/single keys.*sticks are axes/s);
  });
});

describe("clashes the second key makes", () => {
  it("counts a keyboard binding in Key2 against another row's Key1", () => {
    const out = applyVocabulary(
      parseInput(
        [
          "[/Script/ES2.CustomPlayerInput]",
          LINE("Fire", "F", "Keyboard", "1.000000", "Fire"),
          LINE("Reload", "R", "Keyboard", "1.000000", "Reload"),
        ].join("\n"),
      ),
      new ActionSet({
        actions: {
          fire: { key: "KeyF", ingame: "Fire", kbm: "KeyR" },
          reload: { key: "KeyR", ingame: "Reload" },
        },
      }),
      new Set([0]),
    );
    expect(ownedCollisions(parseInput(out.text), new Set([0]))).toEqual([
      { key: "R", actions: ["Fire", "Reload"] },
    ]);
  });
});

describe("a controller button written onto one another row has", () => {
  it("is reported as a clash; the game's own overlaps elsewhere are not", () => {
    const out = applyVocabulary(
      parseInput(
        [
          "[/Script/ES2.CustomPlayerInput]",
          LINE("Reload", "R", "Keyboard", "1.000000", "Reload"),
          LINE("Reload", "Gamepad_FaceButton_Left", "Gamepad", "1.000000", "Reload"),
          LINE("Jump", "SpaceBar", "Keyboard", "1.000000", "Jump"),
          LINE("Jump", "Gamepad_FaceButton_Bottom", "Gamepad", "1.000000", "Jump"),
        ].join("\n"),
      ),
      new ActionSet({
        actions: {
          reload: { key: "KeyR", ingame: "Reload", pad: "A" },
          jump: { key: "Space", ingame: "Jump" },
        },
      }),
      new Set([0]),
    );
    expect(out.padClashes).toEqual([
      { key: "Gamepad_FaceButton_Bottom", actions: ["Jump", "Reload"] },
    ]);
  });
});

describe("controller clashes, from the file as written", () => {
  const pads = (assign: Record<string, string>) =>
    applyVocabulary(
      parseInput(
        [
          "[/Script/ES2.CustomPlayerInput]",
          LINE("Reload", "R", "Keyboard", "1.000000", "Reload"),
          LINE("Reload", "Gamepad_FaceButton_Left", "Gamepad", "1.000000", "Reload"),
          LINE("Jump", "SpaceBar", "Keyboard", "1.000000", "Jump"),
          LINE("Jump", "Gamepad_FaceButton_Bottom", "Gamepad", "1.000000", "Jump"),
        ].join("\n"),
      ),
      new ActionSet({
        actions: {
          reload: {
            key: "KeyR",
            ingame: "Reload",
            ...(assign.reload ? { pad: assign.reload } : {}),
          },
          jump: { key: "Space", ingame: "Jump", ...(assign.jump ? { pad: assign.jump } : {}) },
        },
      }),
      new Set([0]),
    ).padClashes;

  it("finds no clash in a swap", () => {
    expect(pads({ reload: "A", jump: "X" })).toEqual([]);
  });

  it("finds two actions moved onto one new button", () => {
    expect(pads({ reload: "Y", jump: "Y" })).toEqual([
      { key: "Gamepad_FaceButton_Top", actions: ["Jump", "Reload"] },
    ]);
  });
});
