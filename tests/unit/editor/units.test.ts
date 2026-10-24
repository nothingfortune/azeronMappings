// @vitest-environment happy-dom
/**
 * The page asks the Azeron app's own copy of the layout which controls it has otherwise,
 * and says so on the keys and in the header -- not from a list of this page's saves, which
 * a reload forgot while the units went on with an old layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import type { UnitsReport } from "../../../src/lib/units.js";
import type { EditorPayload } from "../../../src/types/editor.js";
import { LIVE_SET } from "../../helpers/fixtures.js";

const PAYLOAD = buildPayload();

const BEHIND: UnitsReport = {
  store: "C:\\Users\\owner\\AppData\\Roaming\\Azeron Software\\Storage\\DevicesStorage",
  units: [
    {
      set: LIVE_SET,
      unit: "left",
      name: "Everspace 2 akimbo v10 (left)",
      file: "dist/SpaceSims/everspace/everspace_akimbo_v10_left.json",
      importPath: "C:\\repo\\dist\\SpaceSims\\everspace\\everspace_akimbo_v10_left.json",
      status: "matches",
      copies: 1,
      differences: [],
    },
    {
      set: LIVE_SET,
      unit: "right",
      name: "Everspace 2 akimbo v10 (right)",
      file: "dist/SpaceSims/everspace/everspace_akimbo_v10_right.json",
      importPath: "C:\\repo\\dist\\SpaceSims\\everspace\\everspace_akimbo_v10_right.json",
      status: "differs",
      copies: 1,
      differences: [
        {
          position: "ring_4",
          where: "Ring 4",
          app: 'Inventory (I) -- labelled "Inventory"',
          layout: "nothing",
          labelOnly: false,
        },
        {
          position: "middle_5",
          where: "Middle 5",
          app: "Bag (I)",
          layout: "Inventory (I)",
          labelOnly: true,
        },
      ],
    },
  ],
};

const UP_TO_DATE: UnitsReport = {
  store: BEHIND.store,
  units: BEHIND.units.map((unit) => ({ ...unit, status: "matches", differences: [] })),
};

let answer: UnitsReport = BEHIND;
let asked: string[] = [];

function serve(): void {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = true;
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      asked.push(path);
      const body = path.startsWith("/api/units") ? { ok: true, report: answer } : { ok: true };
      return Promise.resolve({ status: 200, json: () => Promise.resolve(body) });
    }),
  );
}

/** Let the page's request and its redraw finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function mount(payload: EditorPayload): void {
  document.body.innerHTML = '<div id="app"></div>';
  start(payload);
  const select = document.querySelectorAll<HTMLSelectElement>("header select")[1];
  if (select && select.value !== LIVE_SET) {
    select.value = LIVE_SET;
    select.dispatchEvent(new Event("change"));
  }
}

const withApp = (): EditorPayload => ({ ...structuredClone(PAYLOAD), appStore: true });

function key(unit: 0 | 1, position: string): HTMLElement {
  const found = document
    .querySelectorAll(".hand")
    [unit]?.querySelector<HTMLElement>(`.key[data-position="${position}"]`);
  if (!found) throw new Error(`no key ${position}`);
  return found;
}

const pill = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('header [data-todo="import"]');

beforeEach(() => {
  answer = BEHIND;
  serve();
});

afterEach(() => {
  (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
  vi.unstubAllGlobals();
});

describe("what the Azeron app has, against the layout", () => {
  it("is asked for the layout on screen", async () => {
    mount(withApp());
    await settle();
    expect(asked).toContain(`/api/units?game=everspace&set=${LIVE_SET}`);
  });

  it("puts the units that are behind in the header, from the app rather than from saves", async () => {
    mount(withApp());
    await settle();
    expect(pill()?.textContent).toBe("Re-import 1");
    expect(pill()?.title).toContain("Azeron app's copy");
  });

  it("marks a key the unit does something else on, and says what", async () => {
    mount(withApp());
    await settle();
    const ring4 = key(1, "ring_4");
    expect(ring4.classList.contains("unit-stale")).toBe(true);
    expect(ring4.title).toContain("Not on the unit yet: it has Inventory (I)");
    // A name that differs is not a key that does something else.
    expect(key(1, "middle_5").classList.contains("unit-stale")).toBe(false);
    // The left unit is up to date.
    expect(key(0, "ring_4").classList.contains("unit-stale")).toBe(false);
  });

  it("lists every control that differs and the file to import, and checks again", async () => {
    mount(withApp());
    await settle();
    pill()?.click();
    const report = document.querySelector(".units-report");
    const text = report?.textContent ?? "";
    expect(text).toContain("Right unit -- 2 controls differ");
    expect(text).toContain("everspace_akimbo_v10_right.json");
    expect(text).toContain('Ring 4: the unit has Inventory (I) -- labelled "Inventory"');
    expect(text).toContain('Middle 5: the same key, named "Bag (I)" in the app');
    expect(text).not.toContain("Left unit");

    // Imported in the app: Check again finds it up to date, and the reminder goes.
    answer = UP_TO_DATE;
    const again = [...document.querySelectorAll<HTMLButtonElement>(".units-report button")].find(
      (button) => button.textContent === "Check again",
    );
    again?.click();
    await settle();
    expect(pill()).toBeNull();
    expect(document.querySelector(".units-report")?.textContent).toContain(
      "has this layout on both units as it is now",
    );
    expect(key(1, "ring_4").classList.contains("unit-stale")).toBe(false);
  });

  it("asks again when the page is come back to from the app", async () => {
    mount(withApp());
    await settle();
    const before = asked.filter((path) => path.startsWith("/api/units")).length;
    answer = UP_TO_DATE;
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(asked.filter((path) => path.startsWith("/api/units")).length).toBe(before + 1);
    expect(pill()).toBeNull();
  });

  it("is never asked when the app is not on this computer, or the page cannot save", async () => {
    mount(structuredClone(PAYLOAD));
    await settle();
    expect(asked.filter((path) => path.startsWith("/api/units"))).toEqual([]);

    (window as unknown as { AZERON_SERVED?: boolean }).AZERON_SERVED = false;
    mount(withApp());
    await settle();
    expect(asked.filter((path) => path.startsWith("/api/units"))).toEqual([]);
  });
});
