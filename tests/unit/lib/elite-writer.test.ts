/**
 * Writing a vocabulary into Elite's bindings file. The big fixture is the preset the game
 * ships; the small ones are written here so each case has exactly the slots it is about.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import { applyBinds, compareBinds, EliteError, parseBinds } from "../../../src/lib/elite.js";
import type { ActionSpec } from "../../../src/types/profile.js";

const PRESET = readFileSync(repoPath("tests/fixtures/elite-KeyboardMouseOnly.binds"), "utf8");

const NONE = '<Secondary Device="{NoDevice}" Key="" />';

/** A small file in the game's own layout: CRLF, tabs, a byte-order mark. */
function file(...controls: string[]): string {
  return [
    '﻿<?xml version="1.0" encoding="utf-8"?>',
    '<Root PresetName="KeyboardMouseOnly" SortOrder="0">',
    ...controls,
    "</Root>",
    "",
  ].join("\r\n");
}

const button = (tag: string, primary: string[], secondary: string[] = [`\t\t${NONE}`]): string =>
  [`\t<${tag}>`, ...primary, ...secondary, `\t</${tag}>`].join("\r\n");

const slot = (name: string, device: string, key: string, ...children: string[]): string[] =>
  children.length === 0
    ? [`\t\t<${name} Device="${device}" Key="${key}" />`]
    : [
        `\t\t<${name} Device="${device}" Key="${key}">`,
        ...children.map((child) => `\t\t\t${child}`),
        `\t\t</${name}>`,
      ];

const none = (name: string): string[] => slot(name, "{NoDevice}", "");

const vocab = (spec: Record<string, ActionSpec>): Record<string, ActionSpec> => spec;

const controlOf = (text: string, tag: string) => {
  const found = parseBinds(text).controls.find((entry) => entry.tag === tag);
  if (!found) throw new Error(`no ${tag}`);
  return found;
};

describe("applyBinds on the preset the game ships", () => {
  const actions = vocab({
    boost: { ingame: "UseBoostJuice", key: "KeyB" },
    jump: { ingame: "HumanoidJumpButton", key: "KeyJ", meta: "ShiftLeft" },
  });
  const written = applyBinds(PRESET, actions);

  it("is a Custom preset 4.1, and says so on the root", () => {
    const binds = parseBinds(written.text);
    expect([binds.preset, binds.major, binds.minor]).toEqual(["Custom", "4", "1"]);
    expect(PRESET).not.toContain('PresetName="Custom"');
  });

  it("keeps every other line byte for byte, and the CRLF and byte-order mark", () => {
    expect(written.text.startsWith("﻿")).toBe(true);
    expect(parseBinds(written.text).eol).toBe("\r\n");
    const before = PRESET.split("\r\n");
    const after = written.text.split("\r\n");
    // The slot of the jump gains two lines for its modifier; nothing else moves. (Lines are compared as a set, so the Key_B slot, which
    // the preset has elsewhere, shows in the next test.)
    expect(after.length - before.length).toBe(2);
    const only = (lines: string[], other: string[]): string[] =>
      lines.filter((line) => !other.includes(line));
    expect(only(after, before)).toEqual([
      '<Root PresetName="Custom" MajorVersion="4" MinorVersion="1">',
      '\t\t<Primary Device="Keyboard" Key="Key_J">',
      '\t\t\t<Modifier Device="Keyboard" Key="Key_LeftShift" />',
    ]);
  });

  it("writes a key into a slot, and a held modifier as a child of the slot", () => {
    expect(controlOf(written.text, "UseBoostJuice").slots.map((s) => [s.slot, s.key])).toEqual([
      ["Primary", "Key_B"],
      ["Secondary", ""],
    ]);
    const jump = controlOf(written.text, "HumanoidJumpButton").slots[0];
    expect(jump?.key).toBe("Key_J");
    expect(jump?.modifiers).toEqual([{ device: "Keyboard", key: "Key_LeftShift" }]);
    expect(jump?.endLine).toBe((jump?.line ?? 0) + 2);
  });

  it("is a fixed point, and a second apply reports nothing to change", () => {
    const again = applyBinds(written.text, actions);
    expect(again.text).toBe(written.text);
    expect(again.changes).toEqual([]);
  });

  it("reports what changed, per slot", () => {
    expect(written.changes).toEqual([
      { action: "boost", control: "UseBoostJuice", slot: "Primary", from: "Tab", to: "KeyB" },
      {
        action: "jump",
        control: "HumanoidJumpButton",
        slot: "Primary",
        from: "Space",
        to: "ShiftLeft+KeyJ",
      },
    ]);
  });

  it("rewrites every button control of a large vocabulary without losing a line it did not own", () => {
    const binds = parseBinds(PRESET);
    const all: Record<string, ActionSpec> = {};
    for (const control of binds.controls) {
      if (control.kind === "button") all[control.tag] = { ingame: control.tag };
    }
    const cleared = applyBinds(PRESET, all);
    expect(applyBinds(cleared.text, all).text).toBe(cleared.text);
    const after = parseBinds(cleared.text);
    expect(after.controls.length).toBe(binds.controls.length);
    expect(after.controls.filter((c) => c.kind === "button").flatMap((c) => c.slots)).toSatisfy(
      (slots: { device: string }[]) => slots.every((s) => s.device === "{NoDevice}"),
    );
    // Axes and settings were not named, and are untouched.
    const axis = controlOf(PRESET, "YawAxisRaw");
    const same = controlOf(cleared.text, "YawAxisRaw");
    expect(cleared.text.split("\r\n").slice(same.line, same.endLine + 1)).toEqual(
      PRESET.split("\r\n").slice(axis.line, axis.endLine + 1),
    );
  });
});

describe("applyBinds, slot by slot", () => {
  it("renders a plain key self-closing in the file's own indentation", () => {
    const base = file(button("Fire", slot("Primary", "Keyboard", "Key_X")));
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    expect(text).toContain('\r\n\t\t<Primary Device="Keyboard" Key="Key_F" />\r\n');
  });

  it("writes a mouse button, with Mouse_1 the left, 2 the right and 3 the middle", () => {
    const base = file(button("Fire", none("Primary")));
    for (const [name, key] of [
      ["left", "Mouse_1"],
      ["right", "Mouse_2"],
      ["middle", "Mouse_3"],
    ] as const) {
      const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", mouse: name } }));
      expect(text).toContain(`<Primary Device="Mouse" Key="${key}" />`);
    }
  });

  it("writes a modifier alone as the key itself", () => {
    const base = file(button("Fire", none("Primary")));
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", meta: "ShiftLeft" } }));
    expect(text).toContain('<Primary Device="Keyboard" Key="Key_LeftShift" />');
    expect(text).not.toContain("<Modifier");
  });

  it("keeps a <Hold> child on the slot it rewrites", () => {
    const base = file(
      button("Wheel", slot("Primary", "Keyboard", "Key_LeftAlt", '<Hold Value="1" />')),
    );
    const { text } = applyBinds(base, vocab({ wheel: { ingame: "Wheel", key: "KeyQ" } }));
    expect(controlOf(text, "Wheel").slots[0]).toMatchObject({ key: "Key_Q", hold: true });
    expect(applyBinds(text, vocab({ wheel: { ingame: "Wheel", key: "KeyQ" } })).text).toBe(text);
  });

  it("removes a modifier child that the new binding does not have", () => {
    const base = file(
      button(
        "Photo",
        slot(
          "Primary",
          "Keyboard",
          "Key_Space",
          '<Modifier Device="Keyboard" Key="Key_LeftControl" />',
        ),
      ),
    );
    const { text } = applyBinds(base, vocab({ photo: { ingame: "Photo", key: "KeyP" } }));
    expect(controlOf(text, "Photo").slots[0]).toMatchObject({ key: "Key_P", modifiers: [] });
  });

  it("leaves another device alone and writes into the other slot", () => {
    const stick = slot("Primary", "28DE11FF", "Joy_1");
    const base = file(button("Fire", stick, slot("Secondary", "Keyboard", "Key_X")));
    const { text, changes } = applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    const fire = controlOf(text, "Fire");
    expect(fire.slots.map((s) => [s.device, s.key])).toEqual([
      ["28DE11FF", "Joy_1"],
      ["Keyboard", "Key_F"],
    ]);
    expect(changes.map((c) => c.slot)).toEqual(["Secondary"]);
  });

  it("puts the key in the first slot when a joystick holds the second", () => {
    const base = file(button("Fire", none("Primary"), slot("Secondary", "28DE11FF", "Joy_2")));
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    expect(controlOf(text, "Fire").slots.map((s) => s.key)).toEqual(["Key_F", "Joy_2"]);
  });

  it("clears the keyboard and mouse slots of an action that sends nothing, and only those", () => {
    const base = file(
      button("Fire", slot("Primary", "Mouse", "Mouse_1"), slot("Secondary", "Keyboard", "Key_X")),
    );
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire" } }));
    expect(controlOf(text, "Fire").slots.map((s) => s.device)).toEqual([
      "{NoDevice}",
      "{NoDevice}",
    ]);
    const kept = file(
      button("Fire", slot("Primary", "28DE11FF", "Joy_1"), slot("Secondary", "Keyboard", "Key_X")),
    );
    expect(
      controlOf(applyBinds(kept, vocab({ fire: { ingame: "Fire" } })).text, "Fire").slots[0]?.key,
    ).toBe("Joy_1");
  });

  it("collapses two keyboard bindings onto the first slot", () => {
    const base = file(
      button("Fire", slot("Primary", "Keyboard", "Key_A"), slot("Secondary", "Keyboard", "Key_B")),
    );
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    expect(controlOf(text, "Fire").slots.map((s) => s.key)).toEqual(["Key_F", ""]);
  });

  it("reads a file with comments between controls, and writes it back with them", () => {
    const base = file(
      "\t<!-- one line -->",
      button("Fire", none("Primary")),
      "\t<!-- a comment",
      "\t     that runs over lines -->",
      button("Jump", none("Primary")),
    );
    const { text } = applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    expect(text).toContain("\t<!-- a comment\r\n\t     that runs over lines -->\r\n");
    expect(controlOf(text, "Jump").slots).toHaveLength(2);
    expect(parseBinds(text).controls.map((c) => c.tag)).toEqual(["Fire", "Jump"]);
  });
});

describe("applyBinds refusals", () => {
  const base = file(
    button("Fire", slot("Primary", "28DE11FF", "Joy_1"), slot("Secondary", "28DE11FF", "Joy_2")),
    button("Jump", none("Primary")),
    "\t<YawAxisRaw>",
    '\t\t<Binding Device="{NoDevice}" Key="" />',
    "\t</YawAxisRaw>",
  );

  it("refuses when other devices hold both slots, naming the control", () => {
    const run = () => applyBinds(base, vocab({ fire: { ingame: "Fire", key: "KeyF" } }));
    expect(run).toThrow(EliteError);
    expect(run).toThrow(/Fire/);
  });

  it("does not refuse an action that sends nothing on such a control", () => {
    expect(applyBinds(base, vocab({ fire: { ingame: "Fire" } })).changes).toEqual([]);
  });

  it("refuses a control the file does not have", () => {
    expect(() => applyBinds(base, vocab({ x: { ingame: "NoSuchControl", key: "KeyF" } }))).toThrow(
      /NoSuchControl/,
    );
  });

  it("refuses two actions naming one control", () => {
    const run = () =>
      applyBinds(
        base,
        vocab({ a: { ingame: "Jump", key: "KeyA" }, b: { ingame: "Jump", key: "KeyB" } }),
      );
    expect(run).toThrow(/a and b both name the control Jump/);
  });

  it("refuses a key Elite has no name for, naming the action and the key", () => {
    const run = () => applyBinds(base, vocab({ jump: { ingame: "Jump", key: "Fn" } }));
    expect(run).toThrow(/jump.*Fn/);
    expect(() =>
      applyBinds(base, vocab({ jump: { ingame: "Jump", key: "KeyA", meta: "Fn" } })),
    ).toThrow(/jump.*Fn/);
  });

  it("refuses an axis, which is never written", () => {
    expect(() => applyBinds(base, vocab({ yaw: { ingame: "YawAxisRaw", key: "KeyA" } }))).toThrow(
      /not a button/,
    );
  });

  it("refuses a bad mouse button and a key together with a mouse button", () => {
    expect(() => applyBinds(base, vocab({ j: { ingame: "Jump", mouse: "back" } }))).toThrow(/back/);
    expect(() =>
      applyBinds(base, vocab({ j: { ingame: "Jump", mouse: "left", key: "KeyA" } })),
    ).toThrow(/both/);
  });

  it("leaves a control the vocabulary does not name untouched", () => {
    const { text } = applyBinds(base, vocab({ jump: { ingame: "Jump", key: "KeyJ" } }));
    const fire = controlOf(base, "Fire");
    expect(text.split("\r\n").slice(fire.line, fire.endLine + 1)).toEqual(
      base.split("\r\n").slice(fire.line, fire.endLine + 1),
    );
  });
});

describe("compareBinds", () => {
  const binds = parseBinds(
    file(
      button("Fire", slot("Primary", "Keyboard", "Key_F")),
      button(
        "Jump",
        slot("Primary", "Keyboard", "Key_Space"),
        slot("Secondary", "Keyboard", "Key_J"),
      ),
      button("Idle", none("Primary")),
      button("Click", slot("Primary", "Mouse", "Mouse_1")),
      button("Joy", slot("Primary", "28DE11FF", "Joy_1")),
    ),
  );
  const rows = compareBinds(
    binds,
    vocab({
      fire: { ingame: "Fire", key: "KeyF" },
      jump: { ingame: "Jump", key: "Space" },
      idle: { ingame: "Idle" },
      click: { ingame: "Click", mouse: "right" },
      joy: { ingame: "Joy" },
      gone: { ingame: "Gone", key: "KeyG" },
      plain: {},
    }),
  );
  const by = (action: string) => rows.find((row) => row.action === action);

  it("calls a matching binding agreement, and an extra or different one a difference", () => {
    expect(by("fire")?.status).toBe("agrees");
    expect(by("jump")).toMatchObject({ status: "differs", theirs: ["Space", "KeyJ"] });
    expect(by("click")).toMatchObject({
      status: "differs",
      ours: "mouse right",
      theirs: ["mouse left"],
    });
  });

  it("agrees when neither side has a keyboard or mouse binding, other devices aside", () => {
    expect(by("idle")?.status).toBe("agrees");
    expect(by("joy")?.status).toBe("agrees");
  });

  it("reports a control the file lacks, and skips an action with no game name", () => {
    expect(by("gone")?.status).toBe("missing");
    expect(by("plain")).toBeUndefined();
  });

  it("agrees with what the writer wrote", () => {
    const actions = vocab({ fire: { ingame: "UseBoostJuice", key: "KeyB", meta: "ShiftLeft" } });
    const { text } = applyBinds(PRESET, actions);
    expect(compareBinds(parseBinds(text), actions).map((row) => row.status)).toEqual(["agrees"]);
    expect(compareBinds(parseBinds(PRESET), actions).map((row) => row.status)).toEqual(["differs"]);
  });
});

describe("reading comments", () => {
  it("reads the whole shipped preset, comments and all", () => {
    expect(PRESET).toContain("<!--");
    const binds = parseBinds(PRESET);
    expect(binds.lines.join(binds.eol)).toBe(PRESET);
    expect(binds.controls.length).toBeGreaterThan(300);
    expect(binds.major).toBe("");
  });

  it("does not read a control out of a comment, nor close a control early", () => {
    const binds = parseBinds(
      file(
        "\t<!-- an old control:",
        "\t<Ghost>",
        '\t\t<Primary Device="Keyboard" Key="Key_G" />',
        "\t</Ghost> -->",
        "\t<Fire>",
        "\t\t<!-- </Fire> -->",
        '\t\t<Primary Device="Keyboard" Key="Key_F" />',
        `\t\t${NONE}`,
        "\t</Fire>",
      ),
    );
    expect(binds.controls.map((c) => c.tag)).toEqual(["Fire"]);
    expect(binds.controls[0]?.slots).toHaveLength(2);
  });

  it("keeps and skips a line it does not understand between controls", () => {
    const binds = parseBinds(file("\tsomething odd", button("Fire", none("Primary"))));
    expect(binds.controls.map((c) => c.tag)).toEqual(["Fire"]);
  });
});
