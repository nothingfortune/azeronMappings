/**
 * A game's controls read from its own input file: Unreal's engine mappings, and Everspace
 * 2's own rows.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { discoverControls } from "../../../src/lib/discover.js";

const UNREAL = [
  "[/Script/Engine.InputSettings]",
  '+ActionMappings=(ActionName="Jump",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=SpaceBar)',
  '+ActionMappings=(ActionName="Jump",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=Gamepad_FaceButton_Bottom)',
  '+ActionMappings=(ActionName="Fire",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=LeftMouseButton)',
  '+ActionMappings=(ActionName="Fire",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=Gamepad_RightTrigger)',
  '+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)',
  '+AxisMappings=(AxisName="MoveForward",Scale=-1.000000,Key=S)',
  '+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=Gamepad_LeftY)',
  '+AxisMappings=(AxisName="Turn",Scale=1.000000,Key=MouseX)',
].join("\r\n");

describe("discoverControls", () => {
  it("reads Unreal's engine mappings into actions with keyboard and controller keys", () => {
    expect(discoverControls(UNREAL)).toEqual([
      { id: "jump", label: "Jump", kbm: "Space", pad: "A" },
      { id: "fire", label: "Fire", kbm: "MouseLeft", pad: "RT" },
      { id: "move_forward", label: "Move forward", kbm: "KeyW", pad: "LeftStickUp" },
      {
        id: "move_forward_reverse",
        label: "Move forward (reverse)",
        kbm: "KeyS",
        pad: "LeftStickDown",
      },
      // The mouse's own movement is not a key: the action is found, with nothing to bind.
      { id: "turn", label: "Turn" },
    ]);
  });

  it("reads Everspace 2's rows, with the game's own names and the row each one is", () => {
    const text = readFileSync(repoPath("dist/SpaceSims/everspace/Input.ini"), "utf8");
    const found = discoverControls(text);
    expect(found.length).toBeGreaterThan(50);
    const boost = found.find((action) => action.ingame === "Boost");
    expect(boost).toMatchObject({ id: "boost", ingame: "Boost" });
    expect(boost?.label).toMatch(/Boost/);
    expect(new Set(found.map((action) => action.id)).size).toBe(found.length);
  });

  it("finds nothing in a file of neither shape", () => {
    expect(discoverControls("[Section]\nfoo=bar\n")).toEqual([]);
  });
});

describe("discoverControls, the details", () => {
  it("keeps the modifiers a mapping asks to be held, as a chord", () => {
    const found = discoverControls(
      '+ActionMappings=(ActionName="QuickSave",bShift=False,bCtrl=True,bAlt=False,bCmd=False,Key=S)',
    );
    expect(found[0]?.kbm).toBe("ControlLeft+KeyS");
  });

  it("turns a stick round when its scale is negative", () => {
    const found = discoverControls(
      '+AxisMappings=(AxisName="LookUp",Scale=-1.000000,Key=Gamepad_RightY)',
    );
    expect(found.map((action) => [action.id, action.pad])).toEqual([
      ["look_up", "RightStickDown"],
      ["look_up_reverse", "RightStickUp"],
    ]);
  });
});

describe("an Everspace row with its binding in the second slot", () => {
  it("keeps it when the first is empty", () => {
    const line =
      'KeybindingsConfig=(Action=Fire,ActionName="Fire",AxisName="",Category=0,bIsAxis=False,' +
      "Key1=None,Key1Mod=None,Key2=LeftMouseButton,Key2Mod=None,Scale=1.000000,DeadZone=0.1," +
      'Sensitivity=1.0,Exponent=1.0,bInvert=False,DisplayName=NSLOCTEXT("K", "K", "Fire"),' +
      'GroupName="Keyboard")';
    expect(discoverControls(`[/Script/ES2.CustomPlayerInput]\n${line}`)[0]?.kbm).toBe("MouseLeft");
  });
});

describe("Everspace's stick axes", () => {
  it("give the direction actions their halves of the stick", () => {
    const text = readFileSync(repoPath("dist/SpaceSims/everspace/Input.ini"), "utf8");
    const found = discoverControls(text);
    const forward = found.find((a) => a.ingame === "MoveForward" && a.ingame_scale === undefined);
    const back = found.find((a) => a.ingame === "MoveForward" && a.ingame_scale === -1);
    expect(forward?.pad).toMatch(/^LeftStick(Up|Down)$/);
    expect(back?.pad).toMatch(/^LeftStick(Up|Down)$/);
    expect(back?.pad).not.toBe(forward?.pad);
  });
});
