// @vitest-environment happy-dom
/**
 * A game just started from an export has a required action on no key for most of the
 * vocabulary. The linter says so once per action, which is right for the CLI and a wall on
 * the page: the page shows them as one entry that opens to the list.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { start } from "../../../src/editor/app.js";
import { buildPayload } from "../../../src/lib/editor/payload.js";
import { showWiring } from "../../helpers/editor.js";

const PAYLOAD = buildPayload();

function header(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("header button")].find(
    (button) => button.textContent === label,
  );
  if (!found) throw new Error(`no header button ${label}`);
  return found;
}

/** Mark the first `count` actions that no unit sends, and that have a key, as required. */
function requireUnbound(count: number): string[] {
  const names: string[] = [];
  const rows = [...document.querySelectorAll(".ingame-row.unbound")].filter((row) =>
    row.querySelector(".key-chip"),
  );
  for (const row of rows.slice(0, count)) {
    names.push(row.querySelector(".who b")?.textContent ?? "");
    const chip = [...row.querySelectorAll<HTMLButtonElement>(".tag-chip")].find(
      (candidate) => candidate.textContent === "required",
    );
    if (!chip) throw new Error("no required switch");
    chip.click();
  }
  return names;
}

const lintChip = (): string => document.querySelector("header .pill.lint")?.textContent ?? "";

describe("required actions that are on no key", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    start(structuredClone(PAYLOAD));
    header("In-game").click();
    showWiring();
  });

  it("starts clean, so what follows is the group's doing", () => {
    expect(lintChip()).toBe("✓ Clean");
  });

  it("shows them as one finding in the Checks panel, opening to the list", () => {
    const names = requireUnbound(4);
    expect(names).toHaveLength(4);
    const entries = document.querySelectorAll(".checks .finding");
    expect(entries).toHaveLength(1);
    const group = entries[0];
    expect(group?.tagName).toBe("DETAILS");
    expect(group?.querySelector("summary")?.textContent).toContain(
      "4 required actions are not on any key yet",
    );
    const listed = [...(group?.querySelectorAll("li") ?? [])].map((item) => item.textContent);
    expect(listed.sort()).toEqual([...names].sort());
    // Said once, in words the owner can act on.
    expect(group?.textContent).toContain("Edit tab");
  });

  it("counts them once in the header chip, and says what they are", () => {
    requireUnbound(4);
    // One entry, not four; the tooltip says what it is.
    expect(lintChip()).toBe("1 to look at");
    expect(document.querySelector("header .pill.lint")?.getAttribute("title")).toContain(
      "4 required action(s) are not on any key yet",
    );
    expect(document.querySelector("header .pill.lint")?.classList.contains("bad")).toBe(true);
  });

  it("says it in the singular for one", () => {
    requireUnbound(1);
    expect(document.querySelector(".checks summary")?.textContent).toContain(
      "1 required action is not on any key yet",
    );
  });
});
