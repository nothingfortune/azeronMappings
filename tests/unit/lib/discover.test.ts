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
