/**
 * Drag and drop on the Edit tab: an action from the list onto a key or a stick direction,
 * a key onto another key, and a key back onto the list to clear it.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(structuredClone(PAYLOAD));
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

/** A key on one unit's board: 0 is the left unit, 1 the right. */
function key(unit: 0 | 1, position: string): HTMLElement {
  const found = document
    .querySelectorAll(".hand")
    [unit]?.querySelector<HTMLElement>(`.key[data-position="${position}"]`);
  if (!found) throw new Error(`no key ${position}`);
  return found;
}

function action(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(".action")].find(
    (node) => node.querySelector("b")?.textContent === label,
  );
  if (!found) throw new Error(`no action ${label}`);
  return found;
}

const name = (node: HTMLElement): string | undefined => node.querySelector(".name")?.textContent;

function fire(node: Element, type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

/** Pick `source` up and let it go on whatever `target` returns once the drag has begun. */
function drag(source: Element, target: () => Element): void {
  fire(source, "dragstart");
  const onto = target();
  fire(onto, "dragover");
  fire(onto, "drop");
}

beforeEach(() => {
  mount();
});

describe("dragging an action", () => {
  it("puts it on the key it is dropped on, names the key after it, and selects the key", () => {
    // Left pinky 5 is empty in the live layout, and nothing sends the headlight.
    expect(key(0, "pinky_5").classList.contains("empty")).toBe(true);
    expect(action("Headlight").classList.contains("bound")).toBe(false);

    drag(action("Headlight"), () => key(0, "pinky_5"));

    expect(name(key(0, "pinky_5"))).toBe("Headlight");
    expect(key(0, "pinky_5").classList.contains("selected")).toBe(true);
    expect(action("Headlight").classList.contains("bound")).toBe(true);
    expect(document.querySelector(".palette-target")?.textContent).toBe("Put on Left Pinky 5:");
  });

  it("replaces what a key held, as clicking the key and then the action does", () => {
    drag(action("Headlight"), () => key(0, "pinky_1"));
    expect(name(key(0, "pinky_1"))).toBe("Headlight");
  });

  it("goes on a stick's direction when dropped on one", () => {
    const up = (): HTMLElement => {
      const cell = document
        .querySelectorAll(".hand")[0]
        ?.querySelector<HTMLElement>(".stick-dial .dir.up");
      if (!cell) throw new Error("no stick");
      return cell;
    };
    expect(name(up())).toBe("Hover up");
    drag(action("Headlight"), up);
    expect(name(up())).toBe("Headlight");
  });

  it("works with no key selected, which is when the list used to be switched off", () => {
    expect(document.querySelector(".hand .key.selected")).toBeNull();
    expect(action("Headlight").getAttribute("draggable")).toBe("true");
  });

  it("cannot pick up what the sensor supplies, since no key can send it", () => {
    expect(action("Pointer left/right").getAttribute("draggable")).toBeNull();
  });
});

describe("dragging a key", () => {
  it("swaps two keys, so dropping on one in use loses nothing", () => {
    const first = name(key(0, "pinky_1"));
    const second = name(key(0, "pinky_2"));
    expect(first).not.toBe(second);

    drag(key(0, "pinky_1"), () => key(0, "pinky_2"));

    expect(name(key(0, "pinky_2"))).toBe(first);
    expect(name(key(0, "pinky_1"))).toBe(second);
    expect(key(0, "pinky_2").classList.contains("selected")).toBe(true);
  });

  it("moves to an empty key and leaves the one it came from empty", () => {
    const moved = name(key(0, "pinky_1"));
    drag(key(0, "pinky_1"), () => key(0, "pinky_5"));
    expect(name(key(0, "pinky_5"))).toBe(moved);
    expect(key(0, "pinky_1").classList.contains("empty")).toBe(true);
  });

  it("crosses from one unit to the other", () => {
    const moved = name(key(0, "pinky_1"));
    const displaced = name(key(1, "pinky_1"));
    drag(key(0, "pinky_1"), () => key(1, "pinky_1"));
    expect(name(key(1, "pinky_1"))).toBe(moved);
    expect(name(key(0, "pinky_1"))).toBe(displaced);
  });

  it("is cleared by dropping it on the action list", () => {
    const palette = (): HTMLElement => {
      const panel = document.querySelector<HTMLElement>(".palette");
      if (!panel) throw new Error("no palette");
      return panel;
    };
    expect(document.querySelector(".clear-hint")?.textContent).toContain("clear");
    drag(key(0, "pinky_1"), palette);
    expect(key(0, "pinky_1").classList.contains("empty")).toBe(true);
  });

  it("does nothing when dropped on itself, and an empty key cannot be picked up", () => {
    const before = name(key(0, "pinky_1"));
    drag(key(0, "pinky_1"), () => key(0, "pinky_1"));
    expect(name(key(0, "pinky_1"))).toBe(before);
    expect(key(0, "pinky_5").getAttribute("draggable")).toBeNull();
  });
});

describe("where a drop is allowed", () => {
  it("accepts a drag it can use, and refuses a drop when nothing is being dragged", () => {
    expect(fire(key(0, "pinky_2"), "dragover").defaultPrevented).toBe(false);
    fire(action("Headlight"), "dragstart");
    expect(document.body.classList.contains("dragging-action")).toBe(true);
    expect(fire(key(0, "pinky_2"), "dragover").defaultPrevented).toBe(true);
    // An action has nowhere to go on the list it came from.
    const palette = document.querySelector(".palette");
    if (!palette) throw new Error("no palette");
    expect(fire(palette, "dragover").defaultPrevented).toBe(false);
    fire(action("Headlight"), "dragend");
    expect(document.body.classList.contains("dragging-action")).toBe(false);
    expect(document.querySelector(".drop-over")).toBeNull();
  });
});

describe("what is on a key", () => {
  it("is one name and at most one line of everything else, with the whole of it in the tooltip", () => {
    for (const card of document.querySelectorAll<HTMLElement>(".hand .key:not(.empty)")) {
      expect(card.querySelectorAll(".name").length).toBe(1);
      expect(card.querySelectorAll(".sub").length).toBeLessThanOrEqual(1);
      expect(card.title).toContain(name(card) ?? "?");
    }
    // The pulsed-thrust key carries more than its name: the rest shares the one line.
    const pulsed = key(1, "middle_1");
    expect(pulsed.classList.contains("has-extra")).toBe(true);
    expect(pulsed.title.split("\n").length).toBeGreaterThan(1);
  });
});
