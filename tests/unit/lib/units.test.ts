/**
 * Whether the Azeron app holds a layout as it is now. The units only ever get what was
 * imported into the app, and a board that had moved on from it -- Ultimate on Ring 4, the
 * unit still sending Inventory there -- looked like a broken key.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { findStoredProfiles } from "../../../src/lib/install.js";
import { Game } from "../../../src/lib/model.js";
import { unitsReport } from "../../../src/lib/tasks.js";
import { compareUnit, describeControl } from "../../../src/lib/units.js";
import { readFileSync } from "node:fs";
import type { ExportDocument, ExportProfile, InputRecord } from "../../../src/types/azeron.js";

const game = new Game("games/SpaceSims/everspace");
const SET = "akimbo-v10";
const right = game.loadedProfiles().find((p) => p.set === SET && p.unit === "right");
const left = game.loadedProfiles().find((p) => p.set === SET && p.unit === "left");
if (!right || !left) throw new Error("the fixture has no akimbo-v10 pair");

const compiled = (unit: "left" | "right"): ExportProfile => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${unit}.json`), "utf8"),
  ) as ExportDocument;
  const profile = document.profiles[0];
  if (!profile) throw new Error("no profile");
  return profile;
};

const record = (profile: ExportProfile, pin: number): InputRecord => {
  const found = profile.inputs.find((entry) => entry.pinOne === pin);
  if (!found) throw new Error(`no pin ${String(pin)}`);
  return found;
};

/** The right unit's file as the app might hold it: Inventory moved from Middle 5 to Ring 4. */
function oldRight(): ExportProfile {
  const app = structuredClone(compiled("right"));
  const ring4 = record(app, 8);
  const middle5 = record(app, 13);
  ring4.types = ["1", "11", "11"];
  ring4.keyValues = ["KeyI", "0", "0", "0"];
  ring4.label = "Inventory";
  middle5.types = ["11", "11", "11"];
  middle5.keyValues = ["0", "0", "0", "0"];
  delete middle5.label;
  return app;
}

describe("compareUnit", () => {
  it("finds nothing between a file and itself", () => {
    expect(compareUnit(compiled("right"), compiled("right"), right.device, game.actions)).toEqual(
      [],
    );
  });

  it("names each control the app has otherwise, and what each side sends from it", () => {
    const differences = compareUnit(compiled("right"), oldRight(), right.device, game.actions);
    expect(differences.map((entry) => entry.position)).toEqual(["ring_4", "middle_5"]);
    const ring4 = differences[0];
    expect(ring4?.where).toBe("Ring 4");
    expect(ring4?.app).toBe('Inventory (I) -- labelled "Inventory"');
    expect(ring4?.layout).toBe("nothing");
    expect(ring4?.labelOnly).toBe(false);
    expect(differences[1]?.app).toBe("nothing");
    expect(differences[1]?.layout).toBe('Inventory (I) -- labelled "Inventory"');
  });

  it("calls a renamed key a difference in its name only", () => {
    const app = structuredClone(compiled("right"));
    record(app, 13).label = "Bag";
    const [difference] = compareUnit(compiled("right"), app, right.device, game.actions);
    expect(difference?.position).toBe("middle_5");
    expect(difference?.labelOnly).toBe(true);
  });

  it("reads a key the app spells another way as the same key", () => {
    // The compiler writes the arrows as legacy keycodes; the app may hold the code string.
    const app = structuredClone(compiled("right"));
    const dpadUp = record(app, 36);
    expect(dpadUp.keyValues[0]).toBe("38");
    dpadUp.keyValues = ["ArrowUp", ...dpadUp.keyValues.slice(1)];
    expect(compareUnit(compiled("right"), app, right.device, game.actions)).toEqual([]);
  });

  it("sees a stick direction, a repeat and a latch", () => {
    const app = structuredClone(compiled("right"));
    const stick = record(app, 31).analogSettings;
    if (!stick) throw new Error("no stick");
    stick.analogKeys.right.up = [0, 0, 0];
    const pulse = record(app, 14);
    pulse.isTurbo = false;
    record(app, 13).isHold = true;
    const found = compareUnit(compiled("right"), app, right.device, game.actions);
    expect(found.map((entry) => entry.position).sort()).toEqual(["middle_4", "middle_5", "stick"]);
    const stickRow = found.find((entry) => entry.position === "stick");
    expect(stickRow?.layout).toContain("up Thrust forward (W)");
    expect(stickRow?.app).not.toContain("up ");
    expect(found.find((entry) => entry.position === "middle_4")?.layout).toContain("repeats");
    expect(found.find((entry) => entry.position === "middle_5")?.app).toContain("latches");
  });

  it("leaves alone what the compiler never writes: the profile switch, unidentified pins", () => {
    const app = structuredClone(compiled("right"));
    record(app, 0).keyValues = ["KeyZ", "0", "0", "0"];
    record(app, 28).keyValues = ["KeyZ", "0", "0", "0"];
    expect(compareUnit(compiled("right"), app, right.device, game.actions)).toEqual([]);
  });

  it("says a control the app's copy has no record for is missing there", () => {
    const app = structuredClone(compiled("right"));
    app.inputs = app.inputs.filter((entry) => entry.pinOne !== 13);
    const [difference] = compareUnit(compiled("right"), app, right.device, game.actions);
    expect(difference).toMatchObject({ position: "middle_5", app: "no such key" });
  });
});

describe("describeControl", () => {
  it("puts the action's name first and the key it sends after", () => {
    expect(describeControl({ tap: { key: "KeyI" } }, game.actions)).toBe("Inventory (I)");
    expect(describeControl({ tap: { key: "F13" } }, game.actions)).toBe("F13");
    expect(describeControl({}, game.actions)).toBe("nothing");
    expect(
      describeControl({ tap: { key: "KeyI" }, long: { key: "KeyM" } }, game.actions),
    ).toContain("long press Map (M)");
  });
});

describe("unitsReport against the app's own folder", () => {
  let store: string;

  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "azeron-store-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  const put = (deviceId: string, file: string, profile: ExportProfile, when?: Date): void => {
    const dir = join(store, deviceId, "ProfileStorage");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    writeFileSync(path, JSON.stringify(profile));
    if (when) utimesSync(path, when, when);
  };

  it("says a unit whose profile the app does not have is missing, with the file to import", () => {
    const report = unitsReport(game, SET, store);
    expect(report.store).not.toBeNull();
    expect(report.units.map((unit) => [unit.unit, unit.status]).sort()).toEqual([
      ["left", "missing"],
      ["right", "missing"],
    ]);
    expect(report.units[0]?.importPath).toMatch(/everspace_akimbo_v10_(left|right)\.json$/);
  });

  it("finds each copy by its name, whatever id the app gave it, and compares the newest", () => {
    put("4855", "profile_a.json", { ...compiled("left"), id: "fresh-uuid-left" });
    put("4855", "profile_old.json", compiled("right"), new Date("2026-09-01T00:00:00Z"));
    put("4855", "profile_new.json", oldRight(), new Date("2026-10-02T05:47:00Z"));
    const report = unitsReport(game, SET, store);
    const byUnit = new Map(report.units.map((unit) => [unit.unit, unit]));
    expect(byUnit.get("left")?.status).toBe("matches");
    const behind = byUnit.get("right");
    expect(behind?.status).toBe("differs");
    expect(behind?.copies).toBe(2);
    expect(behind?.appFile).toMatch(/profile_new\.json$/);
    expect(behind?.differences.map((entry) => entry.where)).toEqual(["Ring 4", "Middle 5"]);
  });

  it("only reads: a file that does not parse is passed over, and nothing is written", () => {
    put("4855", "profile_left.json", compiled("left"));
    writeFileSync(join(store, "4855", "ProfileStorage", "profile_bad.json"), "{ half");
    expect(findStoredProfiles(store, "Everspace 2 akimbo v10 (left)")).toHaveLength(1);
    expect(unitsReport(game, SET, store).units.find((u) => u.unit === "left")?.status).toBe(
      "matches",
    );
  });

  it("narrows to one layout, or reports every layout of the game", () => {
    expect(new Set(unitsReport(game, SET, store).units.map((unit) => unit.set))).toEqual(
      new Set([SET]),
    );
    const sets = new Set(unitsReport(game, undefined, store).units.map((unit) => unit.set));
    expect(sets.size).toBeGreaterThan(1);
  });
});
