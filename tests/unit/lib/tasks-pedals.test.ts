/**
 * The live layout's pedals through the tasks the CLI and the editor call, against copies of
 * the game's file -- never the owner's. The rudder's name is inferred and no toe is bound
 * to anything, so generation writes the rudder and says how far it trusts the name.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { IngameError } from "../../../src/lib/ingame.js";
import { Game } from "../../../src/lib/model.js";
import {
  applyIngame,
  capturePedalsFrom,
  ingameDistPath,
  ingameReport,
  pedalsFor,
  setPedalCandidates,
} from "../../../src/lib/tasks.js";
import {
  AXIS1,
  AXIS2,
  bindJoystick,
  withFlightStick,
  withMisboundYaw,
  withRudderBound,
} from "../../helpers/pedals.js";

const game = new Game("games/SpaceSims/everspace");
const COMMITTED = repoPath(ingameDistPath(game));

function scratch(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "azeron-pedals-"));
  const path = join(dir, "Input.ini");
  writeFileSync(path, text, "utf8");
  return path;
}

describe("the live layout's pedals", () => {
  it("are the rudder on yaw, resolved to the game's row, and no toe on anything", () => {
    const pedals = pedalsFor(game);
    expect(pedals?.set).toBe("akimbo-v10");
    expect(pedals?.axes.map((axis) => [axis.pedalAxis, axis.row])).toEqual([["rudder", "Yaw"]]);
  });

  it("report the rudder's name as inferred, which is not flown", () => {
    const report = ingameReport(game, COMMITTED);
    expect(report.pedals?.axes.map((axis) => [axis.pedalAxis, axis.name, axis.status])).toEqual([
      ["rudder", AXIS2, "inferred"],
    ]);
  });

  it("refuse a set that is not there, and say none when the set has no pedals", () => {
    expect(() => pedalsFor(game, "no-such-set")).toThrow(IngameError);
    expect(pedalsFor(game, "single-v5")).toBeNull();
  });
});

describe("applyIngame with pedals", () => {
  it("leaves the committed copy a fixed point of the whole generation", () => {
    const result = applyIngame(game, { write: false, override: COMMITTED });
    expect(result.changes).toEqual([]);
    expect(result.pedals?.changes).toEqual([]);
    expect(result.pedals?.waiting).toEqual([]);
    expect(result.written).toEqual([]);
  });

  it("writes the rudder into the game's file from one where it is not yet bound, and says it is inferred", () => {
    const result = applyIngame(game, { write: false, override: scratch(withFlightStick()) });
    expect(
      result.pedals?.changes.map((change) => [
        change.pedalAxis,
        change.row,
        change.to,
        change.status,
      ]),
    ).toEqual([["rudder", "Yaw", AXIS2, "inferred"]]);
  });

  it("moves the owner's mis-bound Yaw, a toe brake, onto the rudder", () => {
    const result = applyIngame(game, { write: false, override: scratch(withMisboundYaw()) });
    expect(result.pedals?.changes).toEqual([
      expect.objectContaining({ row: "Yaw", field: "Key1", from: AXIS1, to: AXIS2 }),
    ]);
  });

  it("is not refused for want of a name when every axis of the layout has one", () => {
    expect(() =>
      applyIngame(game, { write: false, override: COMMITTED, requirePedals: true }),
    ).not.toThrow();
  });
});

describe("capturePedalsFrom", () => {
  it("finds the rudder where the layout expects it and records nothing new", () => {
    const done = capturePedalsFrom(game, { write: false, override: scratch(withRudderBound()) });
    expect(done.set).toBe("akimbo-v10");
    expect(done.result.known.map((found) => [found.pedalAxis, found.status])).toEqual([
      ["rudder", "inferred"],
    ]);
    expect(done.result.recorded).toEqual([]);
    expect(done.result.conflicts).toEqual([]);
    expect(done.written).toBeNull();
  });

  it("reports the owner's file as it is today as a disagreement, and writes nothing", () => {
    const before = readFileSync(repoPath("devices/logitech-pro-flight-pedals.yaml"), "utf8");
    const done = capturePedalsFrom(game, { write: false, override: scratch(withMisboundYaw()) });
    expect(done.result.conflicts.map((found) => [found.pedalAxis, found.name, found.row])).toEqual([
      ["right_toe", AXIS1, "Yaw"],
    ]);
    expect(done.result.recorded).toEqual([]);
    expect(done.written).toBeNull();
    // A dry run leaves the device file in the repo as it was.
    expect(readFileSync(repoPath("devices/logitech-pro-flight-pedals.yaml"), "utf8")).toBe(before);
  });

  it("finds nothing to record in a file with only the flight stick bound", () => {
    const stickAxis = bindJoystick(withFlightStick(), "Pitch", true, "JS-1_T16000M_YAxis");
    const done = capturePedalsFrom(game, { write: false, override: scratch(stickAxis) });
    expect(done.result.recorded).toEqual([]);
    expect(done.result.otherDevices).toEqual(["T16000M"]);
    expect(done.result.unproven.map((entry) => entry.pedalAxis)).toEqual(["rudder"]);
  });

  it("refuses a set with no pedals", () => {
    expect(() => capturePedalsFrom(game, { write: false, set: "single-v5" })).toThrow(
      /no pedals to capture/,
    );
  });
});

describe("setPedalCandidates", () => {
  it("writes a hand-written name as a candidate in a dry run, and changes no file", () => {
    const done = setPedalCandidates(game, { write: false, names: { rudder: AXIS2 } });
    expect(done.written).toBeNull();
    expect(done.text).toContain(`{name: "${AXIS2}", status: candidate`);
    expect(readFileSync(repoPath("devices/logitech-pro-flight-pedals.yaml"), "utf8")).toContain(
      "status: inferred",
    );
  });

  it("refuses an axis the device does not have, and a name another axis already has", () => {
    expect(() => setPedalCandidates(game, { write: false, names: { brake: AXIS1 } })).toThrow(
      /no axis 'brake'/,
    );
    expect(() => setPedalCandidates(game, { write: false, names: { left_toe: AXIS1 } })).toThrow(
      /also the name of left_toe/,
    );
  });
});
