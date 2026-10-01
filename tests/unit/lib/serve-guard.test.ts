/**
 * What the editor's server will answer, and what it will write.
 *
 * The request checks are pure and tested on headers alone. The guard and the body reader
 * are tested over a real socket on an ephemeral loopback port, because what they promise
 * is about what a client sees.
 */

import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { repoPath } from "../../../src/config/paths.js";
import {
  checkRequest,
  guardedListener,
  readBody,
  SaveRejected,
  validateSaveContent,
} from "../../../src/lib/serve.js";
import type { RequestFacts } from "../../../src/lib/serve.js";

const PORT = 4187;
const post: RequestFacts = {
  method: "POST",
  host: `localhost:${String(PORT)}`,
  origin: undefined,
  contentType: "application/json",
  port: PORT,
};

describe("checkRequest", () => {
  it("answers the loopback names on the listening port", () => {
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]) {
      expect(checkRequest({ ...post, method: "GET", host, contentType: undefined }).ok).toBe(true);
      expect(checkRequest({ ...post, host }).ok).toBe(true);
    }
  });

  it("refuses a Host that is not loopback, which is DNS rebinding", () => {
    for (const host of [
      `evil.example:${PORT}`,
      `localhost.evil.example:${PORT}`,
      `192.168.1.20:${PORT}`,
      undefined,
      "",
    ]) {
      const verdict = checkRequest({ ...post, method: "GET", host });
      expect(verdict.ok, String(host)).toBe(false);
      if (!verdict.ok) expect(verdict.status).toBe(403);
    }
  });

  it("refuses a loopback name on the wrong port", () => {
    expect(checkRequest({ ...post, host: "localhost:9999" }).ok).toBe(false);
    expect(checkRequest({ ...post, host: "localhost" }).ok).toBe(false);
  });

  it("requires JSON for a state-changing request", () => {
    for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
      const verdict = checkRequest({ ...post, contentType });
      expect(verdict.ok, String(contentType)).toBe(false);
      if (!verdict.ok) expect(verdict.status).toBe(415);
    }
    expect(checkRequest({ ...post, contentType: "application/json; charset=utf-8" }).ok).toBe(true);
  });

  it("refuses a foreign Origin on a state-changing request, and accepts its own", () => {
    expect(checkRequest({ ...post, origin: "https://evil.example" }).ok).toBe(false);
    expect(checkRequest({ ...post, origin: "null" }).ok).toBe(false);
    expect(checkRequest({ ...post, origin: `http://localhost:${PORT}` }).ok).toBe(true);
    // The Origin must be the one the Host names: the page opened on 127.0.0.1 is its own origin.
    expect(
      checkRequest({ ...post, host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` }).ok,
    ).toBe(true);
    expect(
      checkRequest({ ...post, host: `127.0.0.1:${PORT}`, origin: `http://localhost:${PORT}` }).ok,
    ).toBe(false);
  });

  it("lets a deliberate --host through, and only that name", () => {
    const lan = { ...post, host: `desk.lan:${PORT}`, extraHosts: ["desk.lan"] };
    expect(checkRequest(lan).ok).toBe(true);
    expect(checkRequest({ ...lan, host: `other.lan:${PORT}` }).ok).toBe(false);
    expect(checkRequest({ ...lan, host: "desk.lan:1" }).ok).toBe(false);
    expect(checkRequest({ ...lan, host: `10.0.0.5:${PORT}`, extraHosts: ["*"] }).ok).toBe(true);
  });
});

describe("validateSaveContent", () => {
  const read = (path: string): string => readFileSync(repoPath(path), "utf8");

  it("accepts the files the repo already has", () => {
    for (const path of [
      "games/SpaceSims/everspace/profiles/single-v5.yaml",
      "games/SpaceSims/everspace/actions.yaml",
      "games/SpaceSims/everspace/sets.yaml",
      "devices/cyborg2-left.yaml",
      "devices/logitech-pro-flight-pedals.yaml",
    ]) {
      expect(() => validateSaveContent(path, read(path)), path).not.toThrow();
    }
  });

  it("refuses YAML that does not parse", () => {
    expect(() => validateSaveContent("devices/x.yaml", "a: [unclosed")).toThrow(SaveRejected);
  });

  it("refuses a profile that is not a profile", () => {
    const path = "games/SpaceSims/everspace/profiles/x.yaml";
    expect(() => validateSaveContent(path, "just a string\n")).toThrow(SaveRejected);
    expect(() => validateSaveContent(path, "positions: {}\n")).toThrow(/profile/);
    expect(() => validateSaveContent(path, "profile: {device: d}\npositions: [1]\n")).toThrow(
      SaveRejected,
    );
  });

  it("refuses an actions.yaml, a sets.yaml and a device map of the wrong shape", () => {
    expect(() => validateSaveContent("games/G/g/actions.yaml", "- a\n- b\n")).toThrow(SaveRejected);
    expect(() => validateSaveContent("games/G/g/actions.yaml", "actions: [a]\n")).toThrow(
      SaveRejected,
    );
    expect(() => validateSaveContent("games/G/g/sets.yaml", "- a\n")).toThrow(SaveRejected);
    expect(() => validateSaveContent("devices/x.yaml", "positions: {}\n")).toThrow(SaveRejected);
    expect(() => validateSaveContent("devices/x.yaml", "kind: pedals\ndevice: p\n")).toThrow(
      SaveRejected,
    );
    expect(() =>
      validateSaveContent("devices/x.yaml", "device: d\npositions:\n  a: {pin: x}\n"),
    ).toThrow(SaveRejected);
  });
});

describe("over a socket", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server?.closeAllConnections();
    server = undefined;
  });

  /** A server on an ephemeral port running `route` behind the guard. */
  async function start(
    route: Parameters<typeof guardedListener>[0],
  ): Promise<{ port: number; send: typeof send }> {
    const created = createServer();
    created.on(
      "request",
      guardedListener(route, () => (created.address() as AddressInfo).port),
    );
    server = created;
    await new Promise<void>((done) => created.listen(0, "127.0.0.1", done));
    const port = (created.address() as AddressInfo).port;

    function send(
      options: { method?: string; headers?: Record<string, string> },
      chunks: Array<string | Buffer> = [],
    ): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path: "/", method: options.method ?? "GET", ...options },
          (res) => {
            const parts: Buffer[] = [];
            res.on("data", (part: Buffer) => parts.push(part));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString("utf8") }),
            );
          },
        );
        req.on("error", reject);
        void (async () => {
          for (const chunk of chunks) {
            req.write(chunk);
            await new Promise((later) => setTimeout(later, 30));
          }
          req.end();
        })();
      });
    }
    return { port, send };
  }

  it("turns a handler's exception into a JSON 500 and keeps serving", async () => {
    let calls = 0;
    const { send } = await start((_request, response) => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      response.end("fine");
    });
    const failed = await send({});
    expect(failed.status).toBe(500);
    expect(JSON.parse(failed.body)).toEqual({ ok: false, error: "boom" });
    // The process is still up: a second request reaches the route.
    expect((await send({})).body).toBe("fine");
  });

  it("answers a foreign Host with 403 before the route runs", async () => {
    let reached = false;
    const { send } = await start((_request, response) => {
      reached = true;
      response.end("hi");
    });
    const refused = await send({ headers: { host: "evil.example" } });
    expect(refused.status).toBe(403);
    expect(reached).toBe(false);
  });

  it("decodes a multi-byte character that is split across chunks", async () => {
    let seen = "";
    const { send } = await start((request, response) => {
      readBody(request, response, 1000, (body) => {
        seen = body;
        response.end("ok");
      });
    });
    const bytes = Buffer.from('{"t":"é€\u{1f3ae}"}', "utf8");
    // Cut inside the three-byte euro sign and the four-byte emoji.
    const euro = bytes.indexOf(Buffer.from("€"));
    const emoji = bytes.indexOf(Buffer.from("\u{1f3ae}"));
    await send({ method: "POST", headers: { "content-type": "application/json" } }, [
      bytes.subarray(0, euro + 1),
      bytes.subarray(euro + 1, emoji + 2),
      bytes.subarray(emoji + 2),
    ]);
    expect(seen).toBe('{"t":"é€\u{1f3ae}"}');
  });

  it("still refuses a body over the limit with 413", async () => {
    const { send } = await start((request, response) => {
      readBody(request, response, 10, () => response.end("ok"));
    });
    const refused = await send(
      { method: "POST", headers: { "content-type": "application/json" } },
      ["x".repeat(50)],
    );
    expect(refused.status).toBe(413);
  });

  it("answers 500 when the body handler throws", async () => {
    const { send } = await start((request, response) => {
      readBody(request, response, 100, () => {
        throw new Error("handler broke");
      });
    });
    const failed = await send({ method: "POST", headers: { "content-type": "application/json" } }, [
      "{}",
    ]);
    expect(failed.status).toBe(500);
  });
});
