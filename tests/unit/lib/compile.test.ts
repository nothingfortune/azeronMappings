/**
 * Regression fixture: templates/everspace2-v5.json, a known-good export.
 *
 * The compiler must reproduce it exactly. A divergence means a field is being rewritten
 * that the compiler does not model.
 */

import { describe, expect, it } from "vitest";

import { compileProfile } from "../../../src/lib/compile.js";
import * as keys from "../../../src/lib/keys.js";
import { removeKey } from "../../../src/lib/object.js";
import type { InputRecord } from "../../../src/types/azeron.js";
import {
  DEFAULT_DOUBLE_DELAY,
  DEFAULT_FEATURE_DELAY,
  HOLD_FIELDS,
  SLOTS,
  SLOT_FIELDS,
  TURBO_FIELDS,
  TURBO_INTERVAL_FIELDS,
  TYPE_NONE,
} from "../../../src/types/azeron.js";
import { activeAnalogKeys } from "../../../src/types/azeron.js";
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
    // The template is given a repeat on every record first. Without that the sweep
    // passed against a compiler that never wrote the field and one that never cleared it.
    const { game, profile, template } = fixture();
    const loaded = structuredClone(template);
    for (const record of loaded.profiles[0]?.inputs ?? []) {
      record.isTurbo = true;
      record.turboInterval = 60;
    }
    const doc = compileProfile(profile, { template: loaded, actions: game.actions.actions });
    for (const record of doc.profiles[0]?.inputs ?? []) {
      // An unidentified pin keeps whatever the template had; the rest are cleared.
      if (profile.device.unknownPins.has(record.pinOne) || record.pinOne === 255) continue;
      expect(record.isTurbo, `pin ${String(record.pinOne)}`).toBe(false);
      expect(record.turboInterval, `pin ${String(record.pinOne)}`).toBe(0);
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

describe("neutralizing what the profile no longer says", () => {
  /**
   * The byte-for-byte contract above cannot see this. The golden template happens to
   * carry no repeat, no latch and no non-default delay, and applying a position only ever
   * sets fields -- so a compiler that neutralized nothing at all would still reproduce
   * the fixture exactly. What neutralizing is for is the opposite case: a template that
   * does carry state, and a profile that has stopped asking for it. Left behind, that
   * state is a key still firing on the hardware after the binding was deleted.
   */
  const PIN = "pinky_1";

  function compileWith(
    changeTemplate: (record: InputRecord) => void,
    changeData: (data: ReturnType<typeof fixture>["profile"]["data"]) => void = () => undefined,
  ) {
    const { game, profile, template } = fixture();
    const pin = profile.device.positions[PIN]?.pin;
    if (pin === undefined) throw new Error(`the device has no ${PIN}`);
    const loaded = structuredClone(template);
    const record = loaded.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    if (!record) throw new Error(`the template has no record for pin ${String(pin)}`);
    changeTemplate(record);

    const data = structuredClone(profile.data);
    changeData(data);
    const mutated = new Profile(data, profile.device, { path: profile.path, game });
    const built = compileProfile(mutated, { template: loaded, actions: game.actions.actions });
    const out = built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    if (!out) throw new Error("the compiled profile lost the record");
    return out;
  }

  it("blanks a position the profile has stopped mentioning", () => {
    const record = compileWith(
      () => undefined,
      (data) => {
        removeKey(data.positions, PIN);
      },
    );
    expect(record.types).toEqual([TYPE_NONE, TYPE_NONE, TYPE_NONE]);
    for (const slot of SLOTS) {
      const [keyField, metaField] = SLOT_FIELDS[slot];
      expect((record[keyField] as string[])[0], `${slot} key`).toBe(keys.NONE_TOKEN);
      expect((record[metaField] as string[])[0], `${slot} meta`).toBe(keys.NONE_TOKEN);
    }
    expect(record.label).toBeUndefined();
  });

  it("clears a repeat the template carried and the profile does not ask for", () => {
    const record = compileWith((template) => {
      template.isTurbo = true;
      template.turboInterval = 60;
      template.isTurboLong = true;
      template.turboIntervalLong = 80;
    });
    // pinky_1 is still bound -- only the repeat is gone.
    expect(record.types[0]).not.toBe(TYPE_NONE);
    for (const slot of SLOTS) {
      expect(record[TURBO_FIELDS[slot]], slot).toBe(false);
      expect(record[TURBO_INTERVAL_FIELDS[slot]], slot).toBe(0);
    }
  });

  it("unlatches a key the template latched", () => {
    const record = compileWith((template) => {
      template.isHold = true;
      template.isHoldLong = true;
      template.isHoldDouble = true;
    });
    for (const slot of SLOTS) expect(record[HOLD_FIELDS[slot]], slot).toBe(false);
  });

  it("puts a delay the template carried back to the default", () => {
    const record = compileWith((template) => {
      template.featureDelay = 1234;
      template.doubleDelay = 999;
    });
    expect(record.featureDelay).toBe(DEFAULT_FEATURE_DELAY);
    expect(record.doubleDelay).toBe(DEFAULT_DOUBLE_DELAY);
  });

  // Not neutralizing -- applyStick zeroes an unnamed direction itself. Pinned here
  // because it is the same guarantee from the other side, and nothing else asserts it.
  it("zeroes a stick direction the profile no longer names", () => {
    const { game, profile, template } = fixture();
    const pin = profile.device.positions.stick?.pin;
    if (pin === undefined) throw new Error("the device has no stick");
    const data = structuredClone(profile.data);
    const stick = data.positions.stick;
    if (!stick?.directions) throw new Error("the fixture's stick has no directions");
    removeKey(stick.directions, "left");
    const mutated = new Profile(data, profile.device, { path: profile.path, game });
    const built = compileProfile(mutated, { template, actions: game.actions.actions });
    const record = built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    expect(record?.analogSettings?.analogKeys.left.left[0]).toBe(0);
    // The directions it still names are untouched.
    expect(record?.analogSettings?.analogKeys.left.up[0]).not.toBe(0);
  });
});

describe("a right-hand unit's stick", () => {
  /**
   * The format was designed around a left-handed unit and has two direction blocks. A
   * right-hand unit exports `isRightAnalog: true` and reads `analogKeys.right`; writing
   * `left` compiles, lints clean and does nothing on the hardware. That is what happened
   * to the akimbo right unit: the profile said the stick thrusts and strafes while the
   * block the device reads still held thrust and roll from the imported layout.
   */
  const RIGHT = "games/SpaceSims/everspace/profiles/akimbo-v9-right.yaml";

  function rightStick() {
    const game = new Game("games/SpaceSims/everspace");
    const profile = loadProfile(RIGHT, game);
    const templatePath = profile.data.profile.template;
    if (templatePath === undefined) throw new Error("the right profile names no template");
    const template = loadTemplate(templatePath);
    const built = compileProfile(profile, { template, actions: game.actions.actions });
    const pin = profile.device.positions.stick?.pin;
    const record = built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    const settings = record?.analogSettings;
    if (!settings) throw new Error("the compiled stick record has no analogSettings");
    return { game, profile, template, settings, pin };
  }

  it("writes the block the unit actually reads", () => {
    const { settings } = rightStick();
    expect(settings.isRightAnalog).toBe(true);
    const live = activeAnalogKeys(settings);
    expect(live).toBe(settings.analogKeys.right);
    // KeyW / KeyD / KeyS / KeyA -- thrust and strafe, as the profile says.
    expect(live.up[0]).toBe(keys.nameToAnalog("KeyW"));
    expect(live.right[0]).toBe(keys.nameToAnalog("KeyD"));
    expect(live.down[0]).toBe(keys.nameToAnalog("KeyS"));
    expect(live.left[0]).toBe(keys.nameToAnalog("KeyA"));
  });

  it("leaves the block the unit ignores exactly as the template had it", () => {
    // Inert, so rewriting it would churn the export for nothing -- and the left unit's
    // template holds string zeros there, which the byte-for-byte contract depends on.
    const { settings, template, pin } = rightStick();
    const before = template.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    expect(JSON.stringify(settings.analogKeys.left)).toBe(
      JSON.stringify(before?.analogSettings?.analogKeys.left),
    );
  });

  it("reads back the directions it wrote, not the inert ones", () => {
    const { game, profile, template } = rightStick();
    const built = compileProfile(profile, { template, actions: game.actions.actions });
    const back = decompile(built, profile.device, { actions: game.actions });
    expect(back.positions.stick?.directions).toEqual({
      up: "throttle_up",
      right: "strafe_right",
      down: "throttle_down",
      left: "strafe_left",
    });
  });
});

describe("records the compiler must not rewrite", () => {
  /**
   * A pin the device map names is not automatically a key. Pin 0 carries type "2", the
   * profile switch, and the app repairs a profile that overwrites it -- that is how pin 0
   * was identified in the first place. Codes "6", "29" and "30" are not understood at all.
   * Today pin 0 is safe only because both device files list it under `unknown_pins`; a map
   * that named it would have had it blanked.
   */
  const PIN = "pinky_1";

  function withType(type: string) {
    const { game, profile, template } = fixture();
    const pin = profile.device.positions[PIN]?.pin;
    if (pin === undefined) throw new Error(`the device has no ${PIN}`);
    const loaded = structuredClone(template);
    const record = loaded.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    if (!record) throw new Error("no record for the pin");
    record.types = [type, TYPE_NONE, TYPE_NONE];
    record.label = "owned by the app";
    return { game, profile, loaded, pin, before: structuredClone(record) };
  }

  it("leaves a record it does not understand exactly as the template had it", () => {
    const { game, profile, loaded, pin, before } = withType("2");
    const data = structuredClone(profile.data);
    removeKey(data.positions, PIN);
    const silent = new Profile(data, profile.device, { path: profile.path, game });
    const built = compileProfile(silent, { template: loaded, actions: game.actions.actions });
    const after = built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("refuses to bind one rather than writing over it", () => {
    const { game, profile, loaded } = withType("2");
    expect(() =>
      compileProfile(profile, { template: loaded, actions: game.actions.actions }),
    ).toThrow(/carries type '2'/);
  });

  it("still rewrites an empty slot, which is an ordinary unbound key", () => {
    const { game, profile, loaded, pin } = withType(TYPE_NONE);
    const built = compileProfile(profile, { template: loaded, actions: game.actions.actions });
    const after = built.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    expect(after?.types[0]).toBe("1");
    expect(after?.label).toBe("Consume 1");
  });
});

describe("what decompiling must not lose", () => {
  /**
   * The rule is that anything which will not round-trip canonically is kept raw rather
   * than dropped. Two paths broke it silently, and silence is the problem: a binding the
   * app holds disappears, the next build writes 0 over it, and nothing says so.
   */
  const RIGHT = "games/SpaceSims/everspace/profiles/akimbo-v9-right.yaml";

  function loaded() {
    const game = new Game("games/SpaceSims/everspace");
    const profile = loadProfile(RIGHT, game);
    const templatePath = profile.data.profile.template;
    if (templatePath === undefined) throw new Error("no template");
    return { game, profile, template: loadTemplate(templatePath) };
  }

  it("keeps a stick direction whose keycode it cannot name", () => {
    const { game, profile, template } = loaded();
    const doc = compileProfile(profile, { template, actions: game.actions.actions });
    const pin = profile.device.positions.stick?.pin;
    const record = doc.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    const settings = record?.analogSettings;
    if (!settings) throw new Error("no analogSettings");
    // 8 is Backspace -- a real keycode this repo has no analog entry for.
    activeAnalogKeys(settings).up[0] = 8;

    const back = decompile(doc, profile.device, { actions: game.actions });
    expect(back.positions.stick?.directions?.up).toEqual({ key_raw: "8" });

    // And it survives the next build rather than being zeroed.
    const rebuilt = compileProfile(
      new Profile(back, profile.device, { path: profile.path, game }),
      { template, actions: game.actions.actions },
    );
    const again = rebuilt.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    const settingsAgain = again?.analogSettings;
    if (!settingsAgain) throw new Error("no analogSettings");
    expect(activeAnalogKeys(settingsAgain).up[0]).toBe("8");
  });

  it("keeps a repeat interval per slot rather than collapsing them", () => {
    const { game, profile, template } = loaded();
    const loadedTemplate = structuredClone(template);
    const pin = profile.device.positions.middle_1?.pin;
    const record = loadedTemplate.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    if (!record) throw new Error("no record");
    record.isTurbo = true;
    record.turboInterval = 40;
    record.isTurboLong = true;
    record.turboIntervalLong = 120;

    const doc = compileProfile(profile, {
      template: loadedTemplate,
      actions: game.actions.actions,
    });
    const built = doc.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    // The profile asks for a tap repeat at 40, and says nothing about a long press.
    expect(built?.turboInterval).toBe(40);
    expect(built?.isTurboLong).toBe(false);

    // Decompiling a record that sets both keeps both numbers.
    const two = structuredClone(doc);
    const slot = two.profiles[0]?.inputs.find((input) => input.pinOne === pin);
    if (!slot) throw new Error("no record");
    slot.isTurboLong = true;
    slot.turboIntervalLong = 120;
    const back = decompile(two, profile.device, { actions: game.actions });
    expect(back.positions.middle_1?.turbo_interval).toBe(40);
    expect(back.positions.middle_1?.turbo_interval_long).toBe(120);
  });
});
