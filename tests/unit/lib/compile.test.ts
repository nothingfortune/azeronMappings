/**
 * Regression fixture: templates/everspace2-v5.json, a known-good export.
 *
 * The compiler must reproduce it exactly. A divergence means a field is being rewritten
 * that the compiler does not model.
 */

import { describe, expect, it } from "vitest";

import { compileProfile } from "../../../src/lib/compile.js";
import { decompile } from "../../../src/lib/decompile.js";
import { loadProfile, loadTemplate } from "../../../src/lib/io.js";
import { Game } from "../../../src/lib/model.js";
import { Profile } from "../../../src/lib/model-core.js";

const GOLDEN = "templates/everspace2-v5.json";
const SINGLE_V5 = "games/SpaceSims/everspace/profiles/single-v5.yaml";

function fixture() {
  const game = new Game("games/SpaceSims/everspace");
  const profile = loadProfile(SINGLE_V5, game);
  const template = loadTemplate(GOLDEN);
  return { game, profile, template };
}

describe("compileProfile", () => {
  it("reproduces the export byte for byte", () => {
    const { game, profile, template } = fixture();
    const built = compileProfile(profile, { template, actions: game.actions.actions });
    const expected = { ...template, profiles: [template.profiles[0]] };
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected));
  });

  it("is idempotent through a decompile", () => {
    const { game, profile, template } = fixture();
    const first = compileProfile(profile, { template, actions: game.actions.actions });
    const data = decompile(first, profile.device, { actions: game.actions });
    const rebuilt = new Profile(data, profile.device, { path: profile.path, game });
    const second = compileProfile(rebuilt, { template, actions: game.actions.actions });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("leaves unidentified pins and unused slots exactly as the template had them", () => {
    const { game, profile, template } = fixture();
    const built = compileProfile(profile, { template, actions: game.actions.actions });
    const golden = loadTemplate(GOLDEN).profiles[0];
    const byId = new Map(golden?.inputs.map((record) => [record.id, record]));
    const untouched = built.profiles[0]?.inputs.filter(
      (record) => profile.device.unknownPins.has(record.pinOne) || record.pinOne === 255,
    );
    expect(untouched?.length).toBeGreaterThan(0);
    for (const record of untouched ?? []) {
      expect(JSON.stringify(record)).toBe(JSON.stringify(byId.get(record.id)));
    }
  });

  it("refuses a stick mode it cannot encode rather than guessing", () => {
    const { game, profile, template } = fixture();
    const data = structuredClone(profile.data);
    const stick = data.positions.stick;
    if (stick) {
      stick.mode = "gamepad";
      delete stick.raw;
    }
    const mutated = new Profile(data, profile.device, { path: profile.path, game });
    expect(() => compileProfile(mutated, { template, actions: game.actions.actions })).toThrow(
      /no known type code/,
    );
  });
});

describe("decompile", () => {
  it("reproduces the checked-in YAML for the golden profile", () => {
    const { game, profile, template } = fixture();
    const data = decompile(template, profile.device, {
      actions: game.actions,
      meta: {
        golden: true,
        ...(profile.meta.set === undefined ? {} : { set: profile.meta.set }),
        ...(profile.meta.template === undefined ? {} : { template: profile.meta.template }),
        ...(profile.meta.output === undefined ? {} : { output: profile.meta.output }),
      },
    });
    expect(JSON.parse(JSON.stringify(data.positions))).toEqual(
      JSON.parse(JSON.stringify(profile.positions)),
    );
  });
});

describe("turbo", () => {
  /**
   * Turbo repeats a key while it is held, so it spends part of its time up. For an
   * action the game reads as on/off -- thrust -- that averages to part power, which is
   * the only way to get a part-power press out of a digital key.
   */
  function withTurbo(change: (data: ReturnType<typeof fixture>["profile"]["data"]) => void) {
    const { game, profile, template } = fixture();
    const data = structuredClone(profile.data);
    change(data);
    const mutated = new Profile(data, profile.device, { path: profile.path, game });
    return compileProfile(mutated, { template, actions: game.actions.actions });
  }

  it("writes the repeat and its interval", () => {
    const doc = withTurbo((data) => {
      const boost = data.positions.index_3;
      if (boost) {
        boost.turbo = true;
        boost.turbo_interval = 60;
      }
    });
    const record = doc.profiles[0]?.inputs.find((input) => input.pinOne === 24);
    expect(record?.isTurbo).toBe(true);
    expect(record?.turboInterval).toBe(60);
  });

  it("leaves it off everywhere it is not asked for", () => {
    const doc = withTurbo(() => undefined);
    for (const record of doc.profiles[0]?.inputs ?? []) {
      expect(record.isTurbo, `pin ${String(record.pinOne)}`).toBeFalsy();
    }
  });

  it("comes back out of an export rather than being dropped", () => {
    const { game, profile } = fixture();
    const doc = withTurbo((data) => {
      const boost = data.positions.index_3;
      if (boost) {
        boost.turbo = true;
        boost.turbo_interval = 45;
      }
    });
    const back = decompile(doc, profile.device, { actions: game.actions });
    expect(back.positions.index_3?.turbo).toBe(true);
    expect(back.positions.index_3?.turbo_interval).toBe(45);
  });
});

describe("the unit's optical sensor", () => {
  function built(meta: Record<string, unknown>) {
    const { game, profile, template } = fixture();
    const data = structuredClone(profile.data);
    Object.assign(data.profile, meta);
    const mutated = new Profile(data, profile.device, { path: profile.path, game });
    return compileProfile(mutated, { template, actions: game.actions.actions });
  }

  it("turns the sensor off when a profile says to", () => {
    // Two units both running their sensors drive the same pointer at once.
    expect(built({ sensor: false }).profiles[0]?.profileSettings?.isSensorOn).toBe(false);
    expect(built({ sensor: true }).profiles[0]?.profileSettings?.isSensorOn).toBe(true);
  });

  it("leaves it as the template had it when the profile is silent", () => {
    const { template } = fixture();
    const before = template.profiles[0]?.profileSettings?.isSensorOn;
    expect(built({}).profiles[0]?.profileSettings?.isSensorOn).toBe(before);
  });

  it("selects a sensitivity step by its DPI", () => {
    const doc = built({ dpi: 7500 });
    const steps = doc.profiles[0]?.profileSettings?.profileSensitivitySettings;
    expect(steps?.sensitivityValues[steps.currentSensitivityIndex]).toBe(7500);
  });

  it("refuses a DPI the profile has no step for", () => {
    expect(() => built({ dpi: 1234 })).toThrow(/not one of this profile's steps/);
  });
});
