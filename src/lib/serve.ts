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

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, normalize, resolve, sep } from "node:path";

import { parse } from "yaml";

import { normalizeProfileData } from "./normalize.js";
import { messageOf } from "./object.js";
import { parsePedalsDevice, parseSets } from "./pedals.js";
import { isPlainObject } from "./yaml.js";

export class SaveRejected extends Error {}

/** Paths the editor may write, relative to the repo root. */
const WRITABLE = [
  /^games\/[^/]+\/[^/]+\/profiles\/[^/]+\.ya?ml$/,
  /^games\/[^/]+\/[^/]+\/actions\.ya?ml$/,
  /^games\/[^/]+\/[^/]+\/sets\.ya?ml$/,
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
        "and sets.yaml, and device maps only.",
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

/**
 * Refuse content that does not parse as the kind of file the path names.
 *
 * `checkSaveContent` only asks whether the bytes look like text. A profile that is not a
 * profile, or a sets.yaml that is not a mapping, would be written and then break every
 * command that loads the repo, so the shape is checked before the file is touched. The
 * path is the repo-relative one `resolveSavePath` already accepted.
 */
export function validateSaveContent(path: string, content: string): void {
  const tidy = path.split(sep).join("/");
  let raw: unknown;
  try {
    raw = parse(content);
  } catch (error) {
    throw new SaveRejected(`${tidy} is not valid YAML: ${messageOf(error)}`);
  }
  try {
    if (/\/profiles\/[^/]+$/.test(tidy)) {
      normalizeProfileData(raw, tidy);
    } else if (/\/actions\.ya?ml$/.test(tidy)) {
      checkActionsShape(raw, tidy);
    } else if (/\/sets\.ya?ml$/.test(tidy)) {
      parseSets(raw, tidy);
    } else if (tidy.startsWith("devices/")) {
      if (isPlainObject(raw) && raw.kind === "pedals") parsePedalsDevice(raw, tidy);
      else checkKeypadDeviceShape(raw, tidy);
    }
  } catch (error) {
    if (error instanceof SaveRejected) throw error;
    throw new SaveRejected(`refusing to write ${tidy}: ${messageOf(error)}`);
  }
}

function checkActionsShape(raw: unknown, where: string): void {
  if (!isPlainObject(raw)) throw new SaveRejected(`${where}: expected a mapping`);
  if (raw.extends !== undefined && typeof raw.extends !== "string") {
    throw new SaveRejected(`${where}: extends must be a path`);
  }
  const actions = raw.actions ?? {};
  if (!isPlainObject(actions)) throw new SaveRejected(`${where}: 'actions:' must be a mapping`);
  for (const [id, spec] of Object.entries(actions)) {
    if (spec !== null && !isPlainObject(spec)) {
      throw new SaveRejected(`${where}: action '${id}' must be a mapping`);
    }
  }
}

function checkKeypadDeviceShape(raw: unknown, where: string): void {
  if (!isPlainObject(raw)) throw new SaveRejected(`${where}: expected a mapping`);
  if (typeof raw.device !== "string" || raw.device === "") {
    throw new SaveRejected(`${where}: 'device:' must name the unit`);
  }
  if (!isPlainObject(raw.positions)) {
    throw new SaveRejected(`${where}: 'positions:' must be a mapping`);
  }
  for (const [name, position] of Object.entries(raw.positions)) {
    if (!isPlainObject(position) || typeof position.pin !== "number") {
      throw new SaveRejected(`${where}: position '${name}' needs a numeric pin`);
    }
  }
}

/** What a request line and its headers say, for `checkRequest`. */
export interface RequestFacts {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  /** The port the server is listening on. */
  port: number;
  /**
   * Host names to accept besides the loopback ones. Empty unless the owner opted out of
   * the loopback binding with `--host`; `"*"` then means any name, the port still checked.
   */
  extraHosts?: readonly string[];
}

export type RequestVerdict = { ok: true } | { ok: false; status: number; error: string };

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Split a Host header into a lower-case name and a port, or null when it is not one. */
function splitHost(value: string): { name: string; port: number } | null {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(value.trim());
  if (!match) return null;
  const [, name = "", port] = match;
  return { name: name.toLowerCase(), port: port === undefined ? 80 : Number(port) };
}

/**
 * Decide whether a request may be answered, from its headers alone.
 *
 * The server writes into the repo and into the game's config, so it must only answer the
 * page it served. Three checks, each against a different attack:
 *
 * - the Host header must be a loopback name on the listening port, which stops DNS
 *   rebinding (a hostile name that resolves to 127.0.0.1 still arrives with its own name);
 * - a state-changing request must carry `content-type: application/json`, which a
 *   cross-site form cannot send, and which a cross-site script can send only after a CORS
 *   preflight the server never grants;
 * - when an Origin header is present on one, it must be this server's own origin.
 *
 * Pure, so it is tested without a socket.
 */
export function checkRequest(facts: RequestFacts): RequestVerdict {
  const refuse = (status: number, error: string): RequestVerdict => ({ ok: false, status, error });

  const host = facts.host === undefined ? null : splitHost(facts.host);
  if (host === null) return refuse(403, "missing or malformed Host header");
  const extra = facts.extraHosts ?? [];
  const nameOk = LOOPBACK_NAMES.has(host.name) || extra.includes("*") || extra.includes(host.name);
  if (!nameOk || host.port !== facts.port) {
    return refuse(403, `Host '${facts.host ?? ""}' is not this server`);
  }

  const method = facts.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true };

  const type = (facts.contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    return refuse(415, "state-changing requests must send content-type: application/json");
  }
  if (facts.origin !== undefined && facts.origin !== `http://${(facts.host ?? "").toLowerCase()}`) {
    return refuse(403, `Origin '${facts.origin}' is not this server`);
  }
  return { ok: true };
}

/** The last resort for a handler that threw: a JSON 500, unless a reply is already under way. */
export function replyFailure(response: ServerResponse, error: unknown): void {
  process.stderr.write(`error: ${messageOf(error)}\n`);
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ ok: false, error: messageOf(error) }));
}

/**
 * Wrap a router so that every request is checked first and no exception escapes it.
 *
 * `port` is a function because a server asked to listen on port 0 only knows its port
 * once it is listening.
 */
export function guardedListener(
  route: (request: IncomingMessage, response: ServerResponse) => void,
  port: () => number,
  extraHosts: readonly string[] = [],
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    try {
      const verdict = checkRequest({
        method: request.method ?? "GET",
        host: request.headers.host,
        origin: request.headers.origin,
        contentType: request.headers["content-type"],
        port: port(),
        extraHosts,
      });
      if (!verdict.ok) {
        response.writeHead(verdict.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: verdict.error }));
        return;
      }
      route(request, response);
    } catch (error) {
      replyFailure(response, error);
    }
  };
}

/** Read a request body, refusing one over `limit` with a reply rather than a dropped socket. */
export function readBody(
  request: IncomingMessage,
  response: ServerResponse,
  limit: number,
  handle: (body: string) => void,
): void {
  // Chunks are collected as bytes and decoded once: a multi-byte character can be split
  // across two chunks, and decoding each on its own turns both halves into U+FFFD.
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  request.on("data", (chunk: Buffer) => {
    if (refused) return;
    size += chunk.length;
    if (size > limit) {
      refused = true;
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: `request over ${String(limit)} bytes` }));
      request.resume();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (refused) return;
    try {
      handle(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      replyFailure(response, error);
    }
  });
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
