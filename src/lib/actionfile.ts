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

/**
 * A field to set, or null to remove it. Absent fields are left alone.
 *
 * Despite the name this is no longer only about keys: an action's label and role tags are
 * edited the same way, by changing that token on that line and nothing else.
 */
export interface BindingChange {
  key?: string | null;
  meta?: string | null;
  mouse?: string | null;
  label?: string | null;
  tags?: string[] | null;
}

const KEY_FIELDS = ["key", "meta", "mouse"] as const;
const FIELDS = [...KEY_FIELDS, "label", "tags"] as const;
type Field = (typeof FIELDS)[number];

/** A key name as it may appear unquoted in a flow mapping. */
const TOKEN = /^[A-Za-z][A-Za-z0-9]*$/;

/** An action id and a role tag: the spellings every vocabulary in the repo uses. */
const ACTION_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TAG = /^[a-z][a-z0-9_]*$/;

const MAX_LABEL = 120;

/**
 * A label as it is written into a flow mapping: plain when that reads back as the same
 * string, double-quoted otherwise.
 *
 * Plain is what the hand-written files use, so `Interact / fling` stays as it is. A label
 * with a comma, a bracket, a colon followed by a space or a `#` after a space would end the
 * field early or change its meaning; so would one a YAML reader takes for a number or
 * `true`. JSON's string escapes are valid inside YAML double quotes, so those are quoted
 * with `JSON.stringify`.
 */
export function yamlScalar(text: string): string {
  const plain = /^[A-Za-z0-9][A-Za-z0-9 /_.+()'-]*$/.test(text) && !text.endsWith(" ");
  if (plain) {
    try {
      const back = parse(`{label: ${text}}`) as { label?: unknown } | null;
      if (back?.label === text) return text;
    } catch {
      // Fall through to quoting.
    }
  }
  return JSON.stringify(text);
}

/** The text a field's value is written as. Null never reaches here. */
function written(field: Field, value: string | readonly string[]): string {
  if (field === "label") return yamlScalar(String(value));
  if (field === "tags") return `[${(value as readonly string[]).join(", ")}]`;
  return String(value);
}

/**
 * Refuse a change that is not what its type says. The route hands this whatever JSON the
 * page sent, so the types are a hope here: a number for a key used to be written as `key: 5`.
 */
function checkChange(id: string, change: unknown): BindingChange {
  if (!ACTION_ID.test(id)) throw new ActionFileError(`'${id}' is not an action id`);
  if (typeof change !== "object" || change === null || Array.isArray(change)) {
    throw new ActionFileError(`${id}: the change is not an object`);
  }
  const given = change as Record<string, unknown>;
  for (const name of Object.keys(given)) {
    if (!(FIELDS as readonly string[]).includes(name)) {
      throw new ActionFileError(`${id}: '${name}' is not a field this can change`);
    }
  }
  for (const field of KEY_FIELDS) {
    const value = given[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new ActionFileError(`${id}: ${field} must be a key name or null`);
    }
    if (!TOKEN.test(value)) throw new ActionFileError(`${id}: '${value}' is not a key name`);
  }
  const label = given.label;
  if (label !== undefined && label !== null) {
    if (typeof label !== "string" || label.trim() === "") {
      throw new ActionFileError(`${id}: a label is text, and cannot be empty`);
    }
    // eslint-disable-next-line no-control-regex
    if (label.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(label)) {
      throw new ActionFileError(
        `${id}: a label is one line of at most ${String(MAX_LABEL)} characters`,
      );
    }
  }
  const tags = given.tags;
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string" && TAG.test(tag))) {
      throw new ActionFileError(`${id}: tags are a list of lower-case words`);
    }
    if (new Set(tags).size !== tags.length) {
      throw new ActionFileError(`${id}: a tag is listed twice`);
    }
  }
  return given;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Set, replace or remove one `name: value` pair inside a flow mapping's text. */
function patchField(inner: string, name: string, value: string | null): string {
  // A value is a quoted string, a one-line sequence, or plain text up to the next comma.
  const scalar = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|\[[^\]]*\]|[^,]*?)`;
  const existing = new RegExp(`(^|,)(\\s*)${name}:(\\s*)(${scalar})(\\s*)(?=,|$)`);
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

  if (typeof changes !== "object" || Array.isArray(changes)) {
    throw new ActionFileError("the changes are not a table of action ids");
  }
  const appended: string[] = [];
  for (const [id, given] of Object.entries(changes)) {
    const change = checkChange(id, given);

    const opener = new RegExp(`^(\\s+)${escape(id)}:(\\s*)(.*)$`);
    const index = lines.findIndex((line, i) => i > start && i < end && opener.test(line));
    if (index === -1) {
      const fields = FIELDS.flatMap((field) => {
        const value = change[field];
        return value === undefined || value === null ? [] : [`${field}: ${written(field, value)}`];
      });
      if (fields.length > 0) appended.push(`  ${id}: {${fields.join(", ")}}`);
      continue;
    }

    const line = lines[index] ?? "";
    const flow = /^(\s+[^:]+:\s*)\{(.*)\}(\s*(?:#.*)?)$/.exec(line);
    if (!flow) {
      throw new ActionFileError(
        `${id} spans more than one line in actions.yaml; change it by hand`,
      );
    }
    const [, head = "", inner = "", tail = ""] = flow;
    const before = parse(`{${inner}}`) as Record<string, unknown>;
    let patched = inner;
    for (const field of FIELDS) {
      const value = change[field];
      if (value !== undefined) {
        patched = patchField(patched, field, value === null ? null : written(field, value));
      }
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
      throw new ActionFileError(`${id}: could not change it without changing more`);
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
