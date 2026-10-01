/**
 * Edit the keys in a game's actions.yaml without rewriting the file.
 *
 * The file is hand-authored: it `extends:` a genre, carries a duplicate-key allowlist, and
 * explains itself in comments beside the lines they are about. Regenerating it from parsed
 * data lost all three -- the allowlist going meant the next lint failed -- and flattened
 * every inherited label into it. The editor only changes which key an action is on, so a
 * save changes that token on that line and nothing else.
 *
 * Node-free, because the editor imports it.
 */

import { parse } from "yaml";

export class ActionFileError extends Error {}

/** A binding field to set, or null to remove it. Absent fields are left alone. */
export interface BindingChange {
  key?: string | null;
  meta?: string | null;
  mouse?: string | null;
}

const FIELDS = ["key", "meta", "mouse"] as const;

/** A key name as it may appear unquoted in a flow mapping. */
const TOKEN = /^[A-Za-z][A-Za-z0-9]*$/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Set, replace or remove one `name: value` pair inside a flow mapping's text. */
function patchField(inner: string, name: string, value: string | null): string {
  const existing = new RegExp(`(^|,)(\\s*)${name}:(\\s*)([^,]*?)(\\s*)(?=,|$)`);
  const match = existing.exec(inner);
  if (match) {
    if (value === null) {
      // Take the field and its separator, whichever side the separator is on.
      const start = match.index;
      const end = start + match[0].length;
      if (match[1] === ",") return inner.slice(0, start) + inner.slice(end);
      return inner.slice(end).replace(/^,\s*/, "");
    }
    const [whole, comma = "", lead = "", gap = " ", old = "", trail = ""] = match;
    const next = `${comma}${lead}${name}:${gap}${value}${trail}`;
    // The table's padding sits after the comma, in front of the next field. Give back or
    // take away what the value's length changed, so the next column stays where it was.
    let rest = inner.slice(match.index + whole.length);
    const spaces = /^,(\s*)/.exec(rest)?.[1];
    if (spaces !== undefined) {
      const width = Math.max(1, spaces.length + old.length - value.length);
      rest = `,${" ".repeat(width)}${rest.slice(1 + spaces.length)}`;
    }
    return inner.slice(0, match.index) + next + rest;
  }
  if (value === null) return inner;
  return inner.trim() === "" ? `${name}: ${value}` : `${name}: ${value}, ${inner.trimStart()}`;
}

/**
 * Apply binding changes to the text of an actions.yaml, line by line.
 *
 * Each changed action must be a one-line flow mapping (`  id: {key: KeyW, ...}`), which
 * is how game files are written; one that spans several lines is refused rather than
 * reflowed. An action with no line of its own -- inherited from the genre with no key --
 * gets one appended to the `actions:` block. Every patched line is parsed back and checked
 * against what was asked for, so a patch that would have meant something else is refused.
 */
export function patchActionBindings(
  text: string,
  changes: Readonly<Record<string, BindingChange>>,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^actions:\s*(#.*)?$/.test(line));
  if (start === -1) throw new ActionFileError("no top-level `actions:` block");
  let end = lines.findIndex(
    (line, index) => index > start && /^\S/.test(line) && !line.startsWith("#"),
  );
  if (end === -1) end = lines.length;

  const appended: string[] = [];
  for (const [id, change] of Object.entries(changes)) {
    for (const field of FIELDS) {
      const value = change[field];
      if (typeof value === "string" && !TOKEN.test(value)) {
        throw new ActionFileError(`${id}: '${value}' is not a key name`);
      }
    }

    const opener = new RegExp(`^(\\s+)${escape(id)}:(\\s*)(.*)$`);
    const index = lines.findIndex((line, i) => i > start && i < end && opener.test(line));
    if (index === -1) {
      const fields = FIELDS.flatMap((field) => {
        const value = change[field];
        return typeof value === "string" ? [`${field}: ${value}`] : [];
      });
      if (fields.length > 0) appended.push(`  ${id}: {${fields.join(", ")}}`);
      continue;
    }

    const line = lines[index] ?? "";
    const flow = /^(\s+[^:]+:\s*)\{(.*)\}(\s*(?:#.*)?)$/.exec(line);
    if (!flow) {
      throw new ActionFileError(
        `${id} spans more than one line in actions.yaml; change its key by hand`,
      );
    }
    const [, head = "", inner = "", tail = ""] = flow;
    const before = parse(`{${inner}}`) as Record<string, unknown>;
    let patched = inner;
    for (const field of FIELDS) {
      const value = change[field];
      if (value !== undefined) patched = patchField(patched, field, value);
    }

    const after = parse(`{${patched}}`) as Record<string, unknown>;
    const expected: Record<string, unknown> = { ...before };
    for (const field of FIELDS) {
      const value = change[field];
      if (value === null) Reflect.deleteProperty(expected, field);
      else if (value !== undefined) expected[field] = value;
    }
    const sorted = (object: Record<string, unknown>): string =>
      JSON.stringify(
        Object.keys(object)
          .sort()
          .map((key) => [key, object[key]]),
      );
    if (sorted(after) !== sorted(expected)) {
      throw new ActionFileError(`${id}: could not change its key without changing more`);
    }
    lines[index] = `${head}{${patched}}${tail}`;
  }

  if (appended.length > 0) {
    // After the last entry, before any blank lines or comments that close the block.
    let at = end;
    while (at - 1 > start && /^\s*(#.*)?$/.test(lines[at - 1] ?? "")) at -= 1;
    lines.splice(at, 0, ...appended);
  }
  return lines.join(eol);
}
