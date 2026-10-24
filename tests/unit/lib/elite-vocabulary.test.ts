/**
 * Elite's actions, made from its bindings files: every button control, named, in its mode,
 * with the key the base file gives where the keypad can send it.
 */
import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { ELITE_MODES, parseBinds } from "../../../src/lib/elite.js";
import {
  eliteActionId,
  eliteActionsYaml,
  eliteVocabulary,
  sharedKeys,
} from "../../../src/lib/elite-vocabulary.js";

const CUSTOM = parseBinds(readFileSync(repoPath("tests/fixtures/elite-Custom.4.1.binds"), "utf8"));
const buttons = CUSTOM.controls.filter((control) => control.kind === "button");

/** A small file of the same shape, for what the owner's file does not show. */
const SMALL = parseBinds(
  [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<Root PresetName="Small" MajorVersion="4" MinorVersion="1">',
    "\t<UseBoostJuice>",
    '\t\t<Primary Device="Keyboard" Key="Key_Tab" />',
    '\t\t<Secondary Device="{NoDevice}" Key="" />',
    "\t</UseBoostJuice>",
    "\t<UIFocus>",
    '\t\t<Primary Device="Keyboard" Key="Key_LeftShift" />',
    '\t\t<Secondary Device="{NoDevice}" Key="" />',
    "\t</UIFocus>",
    "\t<UpThrustButton>",
    '\t\t<Primary Device="Keyboard" Key="Key_R">',
    '\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />',
    "\t\t</Primary>",
    '\t\t<Secondary Device="{NoDevice}" Key="" />',
    "\t</UpThrustButton>",
    "\t<CycleFireGroupNext>",
    '\t\t<Primary Device="Mouse" Key="Mouse_5" />',
    '\t\t<Secondary Device="{NoDevice}" Key="" />',
    "\t</CycleFireGroupNext>",
    "\t<PrimaryFire>",
    '\t\t<Primary Device="28DE11FF" Key="GamePad_RTrigger" />',
    '\t\t<Secondary Device="Mouse" Key="Mouse_1" />',
    "\t</PrimaryFire>",
    "\t<GunsightSystem>",
    '\t\t<Primary Device="{NoDevice}" Key="" />',
    '\t\t<Secondary Device="{NoDevice}" Key="" />',
    "\t</GunsightSystem>",
    "</Root>",
  ].join("\r\n"),
);

describe("the action ids", () => {
  it("are the tag in snake case, and the space-sim ids for the ship's movement", () => {
    expect(eliteActionId("GalaxyMapOpen_Buggy")).toBe("galaxy_map_open_buggy");
    expect(eliteActionId("HumanoidJumpButton")).toBe("humanoid_jump_button");
    expect(eliteActionId("UI_Up")).toBe("ui_up");
    expect(eliteActionId("ForwardThrustButton")).toBe("throttle_up");
    expect(eliteActionId("UpThrustButton")).toBe("hover_up");
    expect(eliteActionId("YawLeftButton")).toBe("yaw_left");
  });
});

describe("the vocabulary from the owner's file", () => {
  const actions = eliteVocabulary([CUSTOM]);

  it("has every button control as an action, and no axis", () => {
    expect(Object.keys(actions)).toHaveLength(buttons.length);
    const tags = new Set(Object.values(actions).map((spec) => spec.ingame));
    for (const control of buttons) expect(tags.has(control.tag), control.tag).toBe(true);
    expect(tags.has("YawAxisRaw")).toBe(false);
  });

  it("gives each its mode, its name and its role", () => {
    expect(actions.use_boost_juice).toMatchObject({
      ingame: "UseBoostJuice",
      mode: "ship",
      label: "Engine boost",
    });
    expect(actions.humanoid_jump_button).toMatchObject({
      mode: "foot",
      tags: ["movement", "required"],
    });
    for (const spec of Object.values(actions))
      expect(Object.keys(ELITE_MODES)).toContain(spec.mode);
  });
});

describe("the keys it starts with", () => {
  const actions = eliteVocabulary([SMALL, CUSTOM]);

  it("are the base file's, in the three shapes a keypad sends", () => {
    expect(actions.use_boost_juice).toMatchObject({ key: "Tab" });
    // A modifier on its own is sent as one; a key with one held is a key and its modifier.
    expect(actions.ui_focus).toMatchObject({ meta: "ShiftLeft" });
    expect(actions.ui_focus?.key).toBeUndefined();
    expect(actions.hover_up).toMatchObject({ key: "KeyR", meta: "ShiftLeft" });
    // The gamepad is not the keypad's; the mouse button behind it is.
    expect(actions.primary_fire).toMatchObject({ mouse: "left" });
  });

  it("leave out what the keypad has not been seen to send", () => {
    expect(actions.cycle_fire_group_next?.mouse).toBeUndefined();
    expect(actions.cycle_fire_group_next?.key).toBeUndefined();
  });

  it("come from the first file only; later files add controls it lacks, without keys", () => {
    expect(actions.gunsight_system).toMatchObject({ ingame: "GunsightSystem" });
    // In the owner's file but not the small one: present, and with no key from it.
    expect(actions.landing_gear_toggle).toBeDefined();
    expect(actions.landing_gear_toggle?.key).toBeUndefined();
  });
});

describe("the file it is written to", () => {
  const actions = eliteVocabulary([CUSTOM]);
  const allow = sharedKeys(actions, (a, b) => a.mode === b.mode);
  const text = eliteActionsYaml(actions, ELITE_MODES, allow, "# header");

  it("reads back as the vocabulary, one action to a line", () => {
    const back = parse(text) as { actions: Record<string, unknown>; game: string };
    expect(back.game).toBe("Elite Dangerous");
    expect(back.actions).toEqual(actions);
    const lines = text.split("\n").filter((line) => /^ {2}[a-z_0-9]+:\s+\{/.test(line));
    expect(lines).toHaveLength(Object.keys(actions).length);
  });

  it("allows only the keys the base file shares between actions live together", () => {
    for (const entry of allow) {
      const modes = new Set(entry.actions.map((id) => actions[id]?.mode));
      expect(modes.size, entry.key).toBe(1);
    }
    const back = parse(text) as { duplicate_key_allowlist?: unknown[] };
    expect(back.duplicate_key_allowlist ?? []).toHaveLength(allow.length);
  });
});
