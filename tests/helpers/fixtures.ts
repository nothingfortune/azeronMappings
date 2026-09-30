/**
 * Which profiles the tests read.
 *
 * Two kinds, and a test should know which it wants. The golden profile is contractual: it
 * must rebuild its template byte for byte, so its bindings never change and it is the
 * right fixture for anything about rendering or compiling. The live pair is whatever
 * layout is being flown now, and changes with every revision -- so it is found, not named,
 * and a version bump costs no test edits.
 *
 * Plain `node:fs`, no imports from src/, so the Playwright suite can use it too.
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const GAME = "games/SpaceSims/everspace";
export const GOLDEN_SET = "single-v5";
export const GOLDEN = `${GAME}/profiles/${GOLDEN_SET}.yaml`;

function liveSet(): string {
  const dir = resolve(import.meta.dirname, "..", "..", GAME, "profiles");
  const versions = readdirSync(dir)
    .map((file) => /^(akimbo-v(\d+))-left\.yaml$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ set: match[1] ?? "", version: Number(match[2]) }))
    .sort((a, b) => b.version - a.version);
  const newest = versions[0];
  if (!newest) throw new Error(`no akimbo pair in ${dir}`);
  return newest.set;
}

/** The akimbo pair being flown now, e.g. "akimbo-v10". */
export const LIVE_SET = liveSet();

/** A unit of the live pair, as a repo-relative path. */
export function live(unit: "left" | "right"): string {
  return join(GAME, "profiles", `${LIVE_SET}-${unit}.yaml`);
}
