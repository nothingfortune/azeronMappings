/**
 * Edit a layout's pedals in a game's sets.yaml without rewriting the file.
 *
 * The file is hand-written and explains itself at length: why the pedals live here, what
 * each field does, and why the toes are left unassigned. Regenerating it from parsed data
 * would lose every word of that, and with it the reason the next person must not assign
 * the toes. A save changes the lines it has to -- the device, one axis's entry -- and
 * leaves every comment, every other set and every untouched entry exactly as written.
 *
 * Node-free, because the editor imports it. The editor holds the file's text (it is in the
 * payload) and sends the patched text through the ordinary save.
 */

import { parse } from "yaml";

import type { PedalAssignment, SetPedals } from "../types/pedals.js";
import { parseSets } from "./pedals.js";

export class SetsFileError extends Error {}

const SET_INDENT = 2;
const PEDALS_INDENT = 4;
const FIELD_INDENT = 6;
const AXIS_INDENT = 8;

const spaces = (count: number): string => " ".repeat(count);
const indentOf = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;
const isData = (line: string): boolean => line.trim() !== "" && !line.trim().startsWith("#");

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A mapping key or value that may be written bare. */
const BARE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function scalar(value: string): string {
  return BARE.test(value) ? value : JSON.stringify(value);
}

/** The order fields are written in, matching the examples in the file's own comments. */
const FIELD_ORDER = [
  "drives",
  "end",
  "invert",
  "dead_zone",
  "scale",
  "sensitivity",
  "exponent",
  "shared",
  "note",
] as const;

/** One assignment as a one-line flow mapping, the way the file writes them. */
export function renderAssignment(assignment: PedalAssignment): string {
  const parts: string[] = [];
  for (const field of FIELD_ORDER) {
    const value = assignment[field];
    if (value === undefined) continue;
    if (field === "drives") parts.push(`drives: ${scalar(assignment.drives)}`);
    else if (field === "note") parts.push(`note: ${JSON.stringify(String(value))}`);
    else parts.push(`${field}: ${String(value)}`);
  }
  return `{${parts.join(", ")}}`;
}

/** JSON with sorted keys, so two mappings compare equal whatever order they were written in. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/**
 * One past the last data line of the block opened at `header`, whose children are indented
 * deeper than `indent`. Comments and blank lines after the last data line belong to
 * whatever follows, so a new entry goes in front of them.
 */
function blockEnd(lines: readonly string[], header: number, indent: number): number {
  let last = header;
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isData(line)) continue;
    if (indentOf(line) <= indent) break;
    last = index;
  }
  return last + 1;
}

function setLines(name: string, pedals: SetPedals): string[] {
  return [`${spaces(SET_INDENT)}${scalar(name)}:`, ...pedalsLines(pedals)];
}

function pedalsLines(pedals: SetPedals): string[] {
  const entries = Object.entries(pedals.assign);
  return [
    `${spaces(PEDALS_INDENT)}pedals:`,
    `${spaces(FIELD_INDENT)}device: ${scalar(pedals.device)}`,
    entries.length === 0 ? `${spaces(FIELD_INDENT)}assign: {}` : `${spaces(FIELD_INDENT)}assign:`,
    ...entries.map(
      ([axis, assignment]) =>
        `${spaces(AXIS_INDENT)}${scalar(axis)}: ${renderAssignment(assignment)}`,
    ),
  ];
}

/** An empty-set header (`name:`, `name: {}`, `name: null`) made plain, keeping its comment. */
const EMPTY_VALUE = /^(\s*[^:\s][^:]*:)\s*(?:\{\s*\}|null|~)?\s*(#.*)?$/;

function plainHeader(line: string): string {
  const match = EMPTY_VALUE.exec(line);
  if (!match) throw new SetsFileError("a set's header is not in a form that can be edited here");
  const [, head = "", comment] = match;
  return comment === undefined ? head : `${head} ${comment}`;
}

interface Entry {
  axis: string;
  start: number;
  end: number;
}

/** The axis entries of an `assign:` block, with the lines each one spans. */
function entriesOf(lines: readonly string[], header: number, end: number): Entry[] {
  const found: Entry[] = [];
  for (let index = header + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (!isData(line)) continue;
    if (indentOf(line) !== AXIS_INDENT) {
      if (indentOf(line) < AXIS_INDENT) {
        throw new SetsFileError("an assign entry is indented oddly; edit sets.yaml by hand");
      }
      continue;
    }
    const axis = /^ {8}("?)([A-Za-z0-9_-]+)\1:/.exec(line)?.[2];
    if (axis === undefined) {
      throw new SetsFileError("an assign entry is not a plain `axis:` key; edit sets.yaml by hand");
    }
    const previous = found[found.length - 1];
    if (previous !== undefined) previous.end = index;
    found.push({ axis, start: index, end: end });
  }
  // An entry runs to its last deeper line, not to the next entry's first comment.
  for (const entry of found) {
    let last = entry.start;
    for (let index = entry.start + 1; index < entry.end; index += 1) {
      if (isData(lines[index] ?? "")) last = index;
    }
    entry.end = last + 1;
  }
  return found;
}

/**
 * Write one set's pedals into the text of a sets.yaml, a line at a time.
 *
 * `null` removes the set's pedals: the data lines go and any comments stay, because a
 * comment on why a toe is not assigned is still true with no pedals. An entry whose value
 * has not changed is not rewritten, so its spacing and its trailing comment survive. The
 * result is parsed back and checked -- the set must read as asked and every other set must
 * read as it did -- so a patch that would have meant something else is refused.
 */
export function patchSetPedals(text: string, setName: string, pedals: SetPedals | null): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const before = parseSets(parse(text) as unknown, "sets.yaml");

  const setsAt = lines.findIndex((line) => line.startsWith("sets:"));
  if (setsAt === -1) {
    if (pedals === null) return text;
    if ((lines[lines.length - 1] ?? "") === "") lines.pop();
    // Apart from whatever is above it, unless it is the only thing in the file.
    if (lines.length > 0) lines.push("");
    lines.push("sets:", ...setLines(setName, pedals), "");
  } else {
    const header = lines[setsAt] ?? "";
    if (/^sets:\s*(\{\s*\})?\s*(#.*)?$/.test(header)) {
      const comment = /(#.*)$/.exec(header)?.[1];
      lines[setsAt] = comment === undefined ? "sets:" : `sets: ${comment}`;
    } else if (!/^sets:\s*(#.*)?$/.test(header)) {
      throw new SetsFileError("`sets:` is not a block mapping; edit sets.yaml by hand");
    }
    patchSet(lines, setsAt, setName, pedals);
  }

  const patched = lines.join(eol);
  const after = parseSets(parse(patched) as unknown, "the patched sets.yaml");
  const want = pedals === null ? undefined : canonical(pedals);
  const got = after.sets[setName]?.pedals;
  if ((got === undefined ? undefined : canonical(got)) !== want) {
    throw new SetsFileError(`changing ${setName}'s pedals did not take; edit sets.yaml by hand`);
  }
  for (const [name, layout] of Object.entries(before.sets)) {
    if (name === setName) continue;
    if (canonical(layout) !== canonical(after.sets[name])) {
      throw new SetsFileError(`changing ${setName}'s pedals would have changed ${name}`);
    }
  }
  for (const name of Object.keys(after.sets)) {
    if (name !== setName && !(name in before.sets)) {
      throw new SetsFileError(`changing ${setName}'s pedals would have added ${name}`);
    }
  }
  return patched;
}

function patchSet(
  lines: string[],
  setsAt: number,
  setName: string,
  pedals: SetPedals | null,
): void {
  const sectionEnd = blockEnd(lines, setsAt, 0);
  const opener = new RegExp(`^ {${String(SET_INDENT)}}("?)${escape(setName)}\\1:`);
  const setAt = lines.findIndex(
    (line, index) => index > setsAt && index < sectionEnd && opener.test(line),
  );

  if (setAt === -1) {
    if (pedals === null) return;
    const add = setLines(setName, pedals);
    // A blank line between sets, as the file keeps them apart when it has more than one.
    if (isData(lines[sectionEnd - 1] ?? "") && sectionEnd - 1 !== setsAt) add.unshift("");
    lines.splice(sectionEnd, 0, ...add);
    return;
  }

  const setEnd = blockEnd(lines, setAt, SET_INDENT);
  const pedalsAt = lines.findIndex(
    (line, index) => index > setAt && index < setEnd && /^ {4}pedals:/.test(line),
  );

  if (pedalsAt === -1) {
    if (pedals === null) return;
    lines[setAt] = plainHeader(lines[setAt] ?? "");
    lines.splice(blockEnd(lines, setAt, SET_INDENT), 0, ...pedalsLines(pedals));
    return;
  }
  if (!/^ {4}pedals:\s*(#.*)?$/.test(lines[pedalsAt] ?? "")) {
    throw new SetsFileError(`${setName}'s pedals are not a block mapping; edit sets.yaml by hand`);
  }
  const pedalsEnd = blockEnd(lines, pedalsAt, PEDALS_INDENT);

  if (pedals === null) {
    // Data lines only: comments in the block are advice that outlives the block.
    for (let index = pedalsEnd - 1; index >= pedalsAt; index -= 1) {
      if (isData(lines[index] ?? "")) lines.splice(index, 1);
    }
    return;
  }
  patchPedals(lines, pedalsAt, pedalsEnd, pedals);
}

function patchPedals(
  lines: string[],
  pedalsAt: number,
  pedalsEnd: number,
  pedals: SetPedals,
): void {
  const deviceAt = lines.findIndex(
    (line, index) => index > pedalsAt && index < pedalsEnd && /^ {6}device:/.test(line),
  );
  if (deviceAt === -1) throw new SetsFileError("a set's pedals have no `device:` line");
  const device = /^( {6}device:\s*)("?)([^"#]*?)\2(\s*(?:#.*)?)$/.exec(lines[deviceAt] ?? "");
  if (!device) throw new SetsFileError("the pedals' device is not a plain value; edit by hand");
  if (device[3] !== pedals.device) {
    lines[deviceAt] = `${device[1] ?? ""}${scalar(pedals.device)}${device[4] ?? ""}`;
  }

  const assignAt = lines.findIndex(
    (line, index) => index > pedalsAt && index < pedalsEnd && /^ {6}assign:/.test(line),
  );
  if (assignAt === -1) throw new SetsFileError("a set's pedals have no `assign:` block");
  const assignHeader = /^( {6}assign:)\s*(\{\s*\})?\s*(#.*)?$/.exec(lines[assignAt] ?? "");
  if (!assignHeader) throw new SetsFileError("`assign:` is not a block mapping; edit by hand");
  const comment = assignHeader[3];
  const withComment = (head: string): string =>
    comment === undefined ? head : `${head} ${comment}`;

  const current = readAssign(lines, assignAt);
  const end = blockEnd(lines, assignAt, FIELD_INDENT);
  const entries = entriesOf(lines, assignAt, end);

  // Bottom to top, so the indexes of the entries still to do do not move.
  for (const entry of [...entries].reverse()) {
    const wanted = pedals.assign[entry.axis];
    if (wanted === undefined) {
      for (let index = entry.end - 1; index >= entry.start; index -= 1) {
        if (isData(lines[index] ?? "")) lines.splice(index, 1);
      }
      continue;
    }
    const was = current[entry.axis];
    if (was !== undefined && canonical(was) === canonical(wanted)) continue;
    const first = lines[entry.start] ?? "";
    const tail = /^ {8}[^:]+:\s*\{.*\}(\s*#.*)$/.exec(first)?.[1] ?? "";
    lines.splice(
      entry.start,
      entry.end - entry.start,
      `${spaces(AXIS_INDENT)}${scalar(entry.axis)}: ${renderAssignment(wanted)}${tail}`,
    );
  }

  const known = new Set(entries.map((entry) => entry.axis));
  const added = Object.entries(pedals.assign)
    .filter(([axis]) => !known.has(axis))
    .map(
      ([axis, assignment]) =>
        `${spaces(AXIS_INDENT)}${scalar(axis)}: ${renderAssignment(assignment)}`,
    );
  if (added.length > 0) lines.splice(blockEnd(lines, assignAt, FIELD_INDENT), 0, ...added);

  const empty = Object.keys(pedals.assign).length === 0;
  lines[assignAt] = withComment(`${assignHeader[1] ?? ""}${empty ? " {}" : ""}`);
}

/** The assignments in the block at `assignAt`, as the file says them. */
function readAssign(lines: readonly string[], assignAt: number): Record<string, unknown> {
  const end = blockEnd(lines, assignAt, FIELD_INDENT);
  const body = lines
    .slice(assignAt, end)
    .map((line) => line.slice(FIELD_INDENT))
    .join("\n");
  const parsed = parse(body) as unknown;
  const assign =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).assign
      : undefined;
  return assign !== null && typeof assign === "object" ? (assign as Record<string, unknown>) : {};
}
