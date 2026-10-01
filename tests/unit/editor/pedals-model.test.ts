/**
 * The words and the arithmetic behind the pedals panel, without a page.
 */

import { describe, expect, it } from "vitest";

import {
  changedSets,
  defaultPedals,
  layoutContext,
  pedalAxisLabel,
  pedalsCarry,
  readSticks,
  restsOnCentred,
  statusWords,
} from "../../../src/editor/pedals-model.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { applyMode } from "../../../src/lib/stickmodes.js";
import type { NameStatus } from "../../../src/types/pedals.js";

const payload = buildPayload();
const everspace = payload.games.find((game) => game.slug === "everspace");
const modes = payload.genres.find((genre) => genre.name === "SpaceSims")?.stickModes;
const device = payload.pedals["logitech-pro-flight-pedals"];

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture missing");
  return value;
}

describe("labels", () => {
  it("calls the axes what a person would", () => {
    const axes = need(device).axes;
    expect(Object.entries(axes).map(([id, spec]) => pedalAxisLabel(id, spec))).toEqual([
      "Rudder",
      "Left toe",
      "Right toe",
    ]);
  });

  it("says every trust level in words of its own, and never 'verified'", () => {
    const all: (NameStatus | null)[] = [
      "confirmed",
      "inferred",
      "unconfirmed",
      "bound",
      "candidate",
      null,
    ];
    const shorts = all.map((status) => statusWords(status).short);
    expect(new Set(shorts).size).toBe(all.length);
    for (const status of all) {
      const words = statusWords(status);
      expect(`${words.short} ${words.long}`).not.toMatch(/verified/i);
    }
    expect(statusWords("inferred").short).toBe("Inferred, not flown");
  });
});

describe("the toe-brake question", () => {
  it("is only a question for an axis that rests at an end, on a centred game axis", () => {
    const axes = need(device).axes;
    expect(restsOnCentred(axes.left_toe, modes, "thrust")).toBe(true);
    expect(restsOnCentred(axes.rudder, modes, "yaw")).toBe(false);
    expect(restsOnCentred(axes.left_toe, modes, "not-an-axis")).toBe(false);
  });
});

describe("what the sticks read as", () => {
  const set = need(modes);
  const left = (id: string, carry: boolean) =>
    applyMode(undefined, set, need(set.modes[id]), "left", carry);
  const right = (id: string, carry: boolean) =>
    applyMode(undefined, set, need(set.modes[id]), "right", carry);

  it("follows whether the pedals carry what the sticks give up", () => {
    const pedals = everspace?.sets.sets["akimbo-v10"]?.pedals;
    expect(pedalsCarry(set, pedals)).toBe(true);
    expect(pedalsCarry(set, undefined)).toBe(false);
    expect(pedalsCarry(set, { device: "x", assign: { left_toe: { drives: "thrust" } } })).toBe(
      false,
    );
  });

  it("calls the same eight directions two things, depending on the layout", () => {
    const l = left("mode2", true);
    const r = right("mode2", true);
    const withPedals = readSticks(set, l, r, true);
    expect(withPedals).toEqual({
      mode: "mode2",
      pedals: true,
      text: "Mode 2 (RC default), with pedals",
    });
    const without = readSticks(set, l, r, false);
    expect(without.text).toBe("Mode 2, roll for yaw");
    expect(without.mode).toBe("mode2_roll");
  });

  it("says when a layout with pedals still has yaw on a stick", () => {
    const reading = readSticks(set, left("mode2", false), right("mode2", false), true);
    expect(reading.pedals).toBe(false);
    expect(reading.text).toContain("Mode 2 (RC default), plain");
    expect(reading.text).toContain("yaw");
  });

  it("says when the sticks gave up yaw and nothing carries it", () => {
    const reading = readSticks(set, left("mode1", true), right("mode1", true), false);
    expect(reading.text).toContain("Mode 1, with-pedals variant");
    expect(reading.text).toContain("nothing carries");
  });

  it("calls sticks that match no mode custom", () => {
    expect(readSticks(set, undefined, undefined, true)).toEqual({
      mode: null,
      pedals: false,
      text: "custom",
    });
  });
});

describe("adding pedals", () => {
  it("puts the spring-centred axis on what the pedals take, and no toe on anything", () => {
    const added = defaultPedals("logitech-pro-flight-pedals", need(device), modes);
    expect(added).toEqual({
      device: "logitech-pro-flight-pedals",
      assign: { rudder: { drives: "yaw" } },
    });
  });

  it("assigns nothing when the genre says the pedals take nothing", () => {
    const added = defaultPedals("p", need(device), undefined);
    expect(added.assign).toEqual({});
  });
});

describe("unsaved pedals", () => {
  const loaded = need(everspace).sets;

  it("compares what the layouts' pedals do, not the order they were written in", () => {
    const same = structuredClone(loaded);
    expect(changedSets(loaded, same)).toEqual([]);
    const pedals = same.sets["akimbo-v10"]?.pedals;
    if (pedals) pedals.assign.rudder = { ...pedals.assign.rudder, drives: "yaw" };
    expect(changedSets(loaded, same)).toEqual([]);
    if (pedals) pedals.assign.rudder = { drives: "roll" };
    expect(changedSets(loaded, same)).toEqual(["akimbo-v10"]);
    if (pedals) pedals.assign.rudder = { drives: "yaw" };
    expect(changedSets(loaded, same)).toEqual([]);
  });

  it("sees pedals added and removed", () => {
    const removed = structuredClone(loaded);
    Reflect.deleteProperty(removed.sets["akimbo-v10"] ?? {}, "pedals");
    expect(changedSets(loaded, removed)).toEqual(["akimbo-v10"]);
  });
});

describe("the context the pedal rules are given", () => {
  it("carries the working sets and only the devices they use", () => {
    const context = layoutContext("everspace", need(everspace).sets, payload.pedals, modes);
    expect(Object.keys(context.devices)).toEqual(["logitech-pro-flight-pedals"]);
    expect(context.sets).toBe(everspace?.sets);
    expect(context.complete).toBeUndefined();
  });
});
