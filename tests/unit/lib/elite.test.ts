/**
 * Reading Elite Dangerous's bindings file, and saying in plain words what each of its
 * controls is. The fixture is the owner's own file, as the game wrote it.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import {
  ELITE_MODES,
  EliteError,
  describeControl,
  eliteKeyFor,
  isBound,
  nameForEliteKey,
  parseBinds,
  summarise,
} from "../../../src/lib/elite.js";
import { WIRE_POOL } from "../../../src/lib/wiring.js";

const TEXT = readFileSync(repoPath("tests/fixtures/elite-Custom.4.1.binds"), "utf8");
const binds = parseBinds(TEXT);
const bindable = binds.controls.filter(
  (control) => control.kind === "button" || control.kind === "axis",
);
const control = (tag: string) => {
  const found = binds.controls.find((entry) => entry.tag === tag);
  if (!found) throw new Error(`no ${tag}`);
  return found;
};

describe("reading the file", () => {
  it("keeps every line, so a write can change what it means to and nothing else", () => {
    expect(binds.eol).toBe("\r\n");
    expect(binds.lines.join(binds.eol)).toBe(TEXT);
  });

  it("finds the preset, and every control by kind", () => {
    expect([binds.preset, binds.major, binds.minor]).toEqual(["Custom", "4", "1"]);
    expect(binds.keyboardLayout).toBe("en-US");
    const count = (kind: string) => binds.controls.filter((entry) => entry.kind === kind).length;
    expect(count("button")).toBe(334);
    expect(count("axis")).toBe(62);
    expect(count("setting")).toBe(89);
  });

  it("reads a button's two slots, and the keys held with one", () => {
    const up = control("UpThrustButton");
    expect(up.kind).toBe("button");
    expect(up.slots.map((slot) => slot.slot)).toEqual(["Primary", "Secondary"]);
    expect(up.slots[0]).toMatchObject({
      device: "Keyboard",
      key: "Key_LeftBracket",
      modifiers: [{ device: "Keyboard", key: "Key_LeftShift" }],
    });
    expect(up.slots[0] && isBound(up.slots[0])).toBe(true);
    expect(up.slots[1] && isBound(up.slots[1])).toBe(false);
    // The slot's lines are where the file has them: a write will need them.
    const first = up.slots[0];
    expect(binds.lines[first?.line ?? -1]).toContain('Key="Key_LeftBracket"');
    expect(binds.lines[first?.endLine ?? -1]?.trim()).toBe("</Primary>");
  });

  it("reads an axis with its invert and dead zone, and a setting's value", () => {
    const yaw = control("YawAxisRaw");
    expect(yaw.kind).toBe("axis");
    expect(yaw.slots.map((slot) => slot.slot)).toEqual(["Binding"]);
    expect(yaw.inverted).toBe(false);
    expect(yaw.deadzone).toBe(0);
    expect(control("MouseXMode")).toMatchObject({ kind: "setting", value: "Bindings_MouseRoll" });
  });

  it("reads the hold flag an on-foot binding can carry", () => {
    const held = binds.controls.flatMap((entry) => entry.slots).filter((slot) => slot.hold);
    expect(held.length).toBeGreaterThan(0);
  });

  it("says which controls the file lists twice, as the game's own log complains", () => {
    expect(binds.duplicates).toEqual(["MouseGUI"]);
  });

  it("refuses text that is not a bindings file", () => {
    expect(() => parseBinds("[Section]\nKey=Value\n")).toThrow(EliteError);
  });
});

describe("the game's key names", () => {
  it("translate both ways for every keyboard key the file uses", () => {
    const used = new Set(
      binds.controls
        .flatMap((entry) => entry.slots)
        .flatMap((slot) => [slot, ...slot.modifiers])
        .filter((entry) => entry.device === "Keyboard")
        .map((entry) => entry.key),
    );
    expect(used.size).toBeGreaterThan(50);
    for (const key of used) {
      const ours = nameForEliteKey(key);
      expect(ours, key).not.toBeNull();
      expect(eliteKeyFor(ours ?? ""), key).toBe(key);
    }
  });

  it("cover every key the editor may hand out, so none is sent and never heard", () => {
    for (const key of WIRE_POOL) expect(eliteKeyFor(key), key).not.toBeNull();
    expect(eliteKeyFor("MediaPlayPause")).toBeNull();
    expect(nameForEliteKey("GamePad_FaceDown")).toBeNull();
  });
});

describe("what each control is", () => {
  it("gives every control a mode of play, a group and a name that is not its tag", () => {
    for (const entry of bindable) {
      const told = describeControl(entry.tag);
      expect(Object.keys(ELITE_MODES), entry.tag).toContain(told.mode);
      expect(told.group, entry.tag).not.toBe("");
      expect(told.label, entry.tag).toMatch(/^[A-Z][^_]*$/);
      expect(told.label, entry.tag).not.toMatch(/[a-z][A-Z]/);
      expect(told.label, entry.tag).not.toMatch(/\b(Button|Raw|Humanoid|Buggy)\b/i);
    }
  });

  it("uses the game's own words where the tag would mislead", () => {
    expect(describeControl("UseBoostJuice").label).toBe("Engine boost");
    expect(describeControl("ToggleButtonUpInput").label).toBe("Silent running");
    expect(describeControl("ForwardKey").label).toBe("Increase throttle");
    expect(describeControl("SetSpeedMinus50").label).toBe("Set speed to -50%");
    expect(describeControl("HumanoidSelectEMPGrenade").label).toBe("Select EMP grenade");
    expect(describeControl("AutoBreakBuggyButton").label).toBe("Handbrake");
  });

  it("puts a control in the mode it is used in, whatever its tag is filed under", () => {
    expect(describeControl("ForwardThrustButton").mode).toBe("ship");
    expect(describeControl("ForwardThrustButton_Landing").mode).toBe("landing");
    expect(describeControl("SteerLeftButton").mode).toBe("srv");
    expect(describeControl("GalaxyMapOpen_Buggy").mode).toBe("srv");
    expect(describeControl("HumanoidJumpButton").mode).toBe("foot");
    expect(describeControl("GalaxyMapOpen_Humanoid").mode).toBe("foot");
    expect(describeControl("CamZoomIn").mode).toBe("map");
    expect(describeControl("UI_Select").mode).toBe("ui");
    // Entering the scanner is pressed in the ship; tuning it is done inside.
    expect(describeControl("ExplorationFSSEnter").mode).toBe("ship");
    expect(describeControl("ExplorationFSSZoomIn").mode).toBe("fss");
  });

  it("calls the same control the same thing in each mode that has it", () => {
    expect(describeControl("GalaxyMapOpen_Buggy").label).toBe(
      describeControl("GalaxyMapOpen").label,
    );
    expect(describeControl("FocusCommsPanel_Humanoid").label).toBe(
      describeControl("FocusCommsPanel").label,
    );
    expect(describeControl("LateralThrust_Landing").label).toBe(
      describeControl("LateralThrustRaw").label,
    );
  });

  it("groups by what a control does, and gives it the role the checks use", () => {
    expect(describeControl("PrimaryFire")).toMatchObject({ group: "Weapons", role: "combat" });
    expect(describeControl("FireChaffLauncher")).toMatchObject({ group: "Defence" });
    expect(describeControl("IncreaseWeaponsPower")).toMatchObject({ group: "Power" });
    expect(describeControl("HumanoidPitchUpButton")).toMatchObject({ group: "Turning" });
    expect(describeControl("BackwardKey")).toMatchObject({ group: "Speed", role: "movement" });
    expect(describeControl("Hyperspace")).toMatchObject({ role: "travel" });
    expect(describeControl("GalaxyMapOpen")).toMatchObject({ role: "menu" });
  });

  it("names no two controls alike within a mode, unless one is the axis and one a button", () => {
    const seen = new Map<string, string>();
    for (const entry of bindable) {
      const told = describeControl(entry.tag);
      const key = `${told.mode}|${told.label}|${entry.kind}`;
      expect(seen.get(key), `${entry.tag} and ${seen.get(key) ?? ""}`).toBeUndefined();
      seen.set(key, entry.tag);
    }
  });
});

describe("the file at a glance", () => {
  const summary = summarise(binds);

  it("counts what there is to bind in each mode and how much of it is bound", () => {
    const ship = summary.modes.find((entry) => entry.mode === "ship");
    expect(ship?.label).toBe("Ship");
    expect(ship?.controls).toBeGreaterThan(80);
    expect(ship?.bound).toBeGreaterThan(30);
    expect(summary.modes.reduce((sum, entry) => sum + entry.controls, 0)).toBe(bindable.length);
  });

  it("lists the devices the file binds to, the one that is no longer there included", () => {
    expect(summary.devices.map((entry) => entry.device)).toEqual(["Keyboard", "28DE11FF", "Mouse"]);
    expect(summary.settings).toBe(89);
  });
});
