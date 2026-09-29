/**
 * YAML shaping with no filesystem in it, so the browser pages can emit YAML too.
 *
 * Anything that reads a file belongs in `yaml-io.ts`; keep this importable from
 * `src/editor/`.
 */

import { stringify } from "yaml";

import { removeKey } from "./object.js";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Overlay wins; nested mappings merge; an explicit null deletes the key. */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    if (value === null && key in out) {
      removeKey(out, key);
    } else if (isPlainObject(value) && isPlainObject(existing)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function dumpYaml(data: unknown, header = ""): string {
  const body = stringify(data, {
    lineWidth: 100,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  return header ? header + body : body;
}
