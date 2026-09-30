/**
 * Closing the loop between the editor and the repo.
 *
 * Opened from `file://`, the editor can only hand back downloads: edit, save to
 * Downloads, copy into the repo, rebuild. That is a workflow with a manual seam in the
 * middle, and the seam is where edits get lost. Served over HTTP the same page can write
 * straight into the repo and get the linter's verdict back.
 *
 * Writes are restricted to the data the editor is allowed to own -- profile and device
 * YAML, and a game's actions.yaml. Nothing else, and nothing outside the repo.
 */

import { isAbsolute, normalize, resolve, sep } from "node:path";

export class SaveRejected extends Error {}

/** Paths the editor may write, relative to the repo root. */
const WRITABLE = [
  /^games\/[^/]+\/[^/]+\/profiles\/[^/]+\.ya?ml$/,
  /^games\/[^/]+\/[^/]+\/actions\.ya?ml$/,
  /^devices\/[^/]+\.ya?ml$/,
];

/**
 * Resolve a request path to a real one inside the repo, or refuse.
 *
 * The check is on the resolved path, not the requested string, so `..` and absolute
 * paths cannot escape by any spelling.
 */
export function resolveSavePath(repoRoot: string, requested: string): string {
  if (requested.length === 0) throw new SaveRejected("no path given");
  if (isAbsolute(requested)) throw new SaveRejected("path must be relative to the repo");

  const tidy = normalize(requested).split(sep).join("/");
  if (tidy.startsWith("../")) throw new SaveRejected(`${requested} is outside the repo`);
  if (!WRITABLE.some((pattern) => pattern.test(tidy))) {
    throw new SaveRejected(
      `${tidy} is not something the editor may write. Profiles, a game's actions.yaml ` +
        "and device maps only.",
    );
  }

  const full = resolve(repoRoot, tidy);
  const root = resolve(repoRoot);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new SaveRejected(`${requested} resolves outside the repo`);
  }
  return full;
}

/** Content has to look like the YAML the editor produces, not arbitrary bytes. */
export function checkSaveContent(content: string): void {
  if (content.trim().length === 0) throw new SaveRejected("refusing to write an empty file");
  if (content.length > 1_000_000) throw new SaveRejected("refusing to write more than 1 MB");
  if (content.includes("\0")) throw new SaveRejected("refusing to write binary content");
}

export interface SaveRequest {
  path: string;
  content: string;
}

export function parseSaveRequest(body: string): SaveRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SaveRejected("body is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new SaveRejected("body is not an object");
  const { path, content } = parsed as Record<string, unknown>;
  if (typeof path !== "string") throw new SaveRejected("path must be a string");
  if (typeof content !== "string") throw new SaveRejected("content must be a string");
  checkSaveContent(content);
  return { path, content };
}

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

/** The comment block at the top of a file, up to the first line that is not one. */
export function leadingComments(text: string): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) kept.push(line);
    else if (line.trim() === "" && kept.length > 0) kept.push(line);
    else break;
  }
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") kept.pop();
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

/**
 * Keep the header the file already had.
 *
 * The editor writes YAML regenerated from parsed data, which has no comments in it. The
 * header is where a profile says why it is the way it is -- what was press-tested, what
 * is an experiment, what must not be flashed -- so it is carried across rather than
 * being replaced by whatever the serialiser emits.
 */
export function preserveHeader(existing: string | null, incoming: string): string {
  if (existing === null) return incoming;
  const header = leadingComments(existing);
  if (header === "") return incoming;
  const body = incoming.replace(/^(?:#[^\n]*\n|\s*\n)*/, "");
  return header + body;
}
