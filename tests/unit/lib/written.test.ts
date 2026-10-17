/**
 * What the editor wrote straight to the units: a fingerprint of what the unit holds, and the
 * report counting a unit current when its last clean write is the layout as it is now.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { loadDirectWrites, saveDirectWrite } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { unitsReport } from "../../../src/lib/tasks.js";
import {
  currentWrite,
  layoutFingerprint,
  parseDirectWrite,
  recordWrite,
} from "../../../src/lib/written.js";
import type { DirectWrite } from "../../../src/lib/written.js";
import type { ExportDocument, ExportProfile } from "../../../src/types/azeron.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const UNKNOWN = [0, 28, 29];
const compiled = (side: "left" | "right"): ExportProfile => {
  const document = JSON.parse(
    readFileSync(repoPath(`dist/SpaceSims/everspace/everspace_akimbo_v10_${side}.json`), "utf8"),
  ) as ExportDocument;
  const profile = document.profiles[0];
  if (!profile) throw new Error("no profile");
  return profile;
};
const write = (overrides: Partial<DirectWrite> = {}): DirectWrite => ({
  deviceId: "49229",
  slot: 2,
  set: LIVE_SET,
  unit: "left",
  name: "Everspace 2 akimbo",
  fingerprint: layoutFingerprint(compiled("left"), UNKNOWN) ?? "",
  at: "2026-10-17T10:00:00.000Z",
  ...overrides,
});

describe("the fingerprint of what a unit holds", () => {
  it("is the same for the same layout, and 16 hex digits", () => {
    const one = layoutFingerprint(compiled("left"), UNKNOWN);
    expect(one).toMatch(/^[0-9a-f]{16}$/);
    expect(layoutFingerprint(structuredClone(compiled("left")), UNKNOWN)).toBe(one);
    expect(layoutFingerprint(compiled("right"), UNKNOWN)).not.toBe(one);
  });

  it("ignores labels, which never reach a unit, and sees a key that changed", () => {
    const profile = compiled("left");
    const relabelled = {
      ...profile,
      inputs: profile.inputs.map((input) => ({ ...input, label: "x" })),
    };
    expect(layoutFingerprint(relabelled, UNKNOWN)).toBe(layoutFingerprint(profile, UNKNOWN));
    const first = profile.inputs.find((input) => input.types[0] === "1");
    if (!first) throw new Error("no key");
    const rekeyed = {
      ...profile,
      inputs: profile.inputs.map((input) =>
        input === first ? { ...input, keyValues: ["KeyZ", "0", "0", "0"] } : input,
      ),
    };
    expect(layoutFingerprint(rekeyed, UNKNOWN)).not.toBe(layoutFingerprint(profile, UNKNOWN));
  });

  it("is null for a layout the unit cannot hold, which was never written", () => {
    const profile = compiled("left");
    const broken = {
      ...profile,
      inputs: profile.inputs.map((input) =>
        input.types[0] === "1" ? { ...input, keyValues: ["IntlBackslash", "0", "0", "0"] } : input,
      ),
    };
    expect(layoutFingerprint(broken, UNKNOWN)).toBeNull();
  });
});

describe("the record of direct writes", () => {
  it("keeps the last write into each slot", () => {
    const first = recordWrite({ writes: [] }, write({ name: "old" }));
    const second = recordWrite(first, write({ name: "new" }));
    expect(second.writes.map((entry) => entry.name)).toEqual(["new"]);
    const other = recordWrite(second, write({ slot: 3 }));
    expect(other.writes).toHaveLength(2);
  });

  it("finds the newest write of this unit that is the layout now, in any slot", () => {
    const fingerprint = write().fingerprint;
    const record = {
      writes: [
        write({ slot: 3, at: "2026-10-16T00:00:00.000Z" }),
        write({ slot: 2, at: "2026-10-17T00:00:00.000Z" }),
        write({ deviceId: "29993" }),
      ],
    };
    expect(currentWrite(record, "49229", fingerprint)?.slot).toBe(2);
    expect(currentWrite(record, "49229", "0000000000000000")).toBeNull();
    expect(currentWrite(record, undefined, fingerprint)).toBeNull();
  });

  it("refuses a record that is not one", () => {
    expect(() => parseDirectWrite({ ...write(), slot: -1 })).toThrow(/slot/);
    expect(() => parseDirectWrite({ ...write(), fingerprint: "nope" })).toThrow(/16 hex/);
    expect(() => parseDirectWrite({ ...write(), deviceId: "" })).toThrow(/deviceId/);
  });
});

describe("the units report, after a direct write", () => {
  let logs = "";
  const game = new Game("games/SpaceSims/everspace");
  const saved = process.env.AZERON_LOGS;

  beforeEach(() => {
    logs = mkdtempSync(join(tmpdir(), "azeron-logs-"));
    process.env.AZERON_LOGS = logs;
  });
  afterEach(() => {
    process.env.AZERON_LOGS = saved;
    rmSync(logs, { recursive: true, force: true });
  });

  const left = (): ReturnType<typeof unitsReport>["units"][number] | undefined =>
    unitsReport(game, LIVE_SET).units.find((unit) => unit.unit === "left");

  it("counts a unit current when its last clean write is the layout now, without the app", () => {
    expect(left()?.status).toBe("missing");
    saveDirectWrite(write());
    expect(loadDirectWrites().writes).toHaveLength(1);
    expect(left()?.status).toBe("written");
    expect(left()?.written).toEqual({ slot: 2, at: "2026-10-17T10:00:00.000Z" });
    // The right unit was not written, so it is still judged by the app's copy.
    expect(unitsReport(game, LIVE_SET).units.find((unit) => unit.unit === "right")?.status).toBe(
      "missing",
    );
  });

  it("goes back to the app's copy once the layout has changed since the write", () => {
    saveDirectWrite(write({ fingerprint: "0123456789abcdef" }));
    expect(left()?.status).toBe("missing");
  });
});
