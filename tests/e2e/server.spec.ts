/**
 * The served editor's refusals, at the HTTP level.
 *
 * A browser cannot be made to send a forged Host or Origin, so these use Node's own client.
 * Every request here is one the server must refuse before it does anything, so none of them
 * can write into the repo or the game's config: the apply route is only ever called with
 * a header that gets it refused.
 */

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";

import { expect, test } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? "4179");
const PROFILE = "games/SpaceSims/everspace/profiles/single-v5.yaml";

function send(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: { host: `127.0.0.1:${String(PORT)}`, ...headers },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => {
          const text = Buffer.concat(parts).toString("utf8");
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // A page, not JSON.
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const JSON_HEADERS = { "content-type": "application/json" };
const SAVE = JSON.stringify({ path: PROFILE, content: "profile: {}\n" });

test.describe("the server's request checks", () => {
  test("answers its own names, including localhost", async () => {
    expect((await send("GET", "/api/payload", {})).status).toBe(200);
    expect((await send("GET", "/api/payload", { host: `localhost:${String(PORT)}` })).status).toBe(
      200,
    );
  });

  test("refuses a Host that is not loopback", async () => {
    const refused = await send("GET", "/api/payload", { host: `rebind.example:${String(PORT)}` });
    expect(refused.status).toBe(403);
  });

  test("refuses a state-changing request that is not JSON", async () => {
    const refused = await send("POST", "/api/save", { "content-type": "text/plain" }, SAVE);
    expect(refused.status).toBe(415);
  });

  test("refuses a state-changing request from another origin", async () => {
    for (const path of ["/api/save", "/api/build", "/api/ingame/apply"]) {
      const refused = await send(
        "POST",
        path,
        { ...JSON_HEADERS, origin: "https://evil.example" },
        SAVE,
      );
      expect(refused.status, path).toBe(403);
    }
  });

  test("refuses a save that is not a profile and leaves the file alone", async () => {
    const before = readFileSync(PROFILE, "utf8");
    const refused = await send("POST", "/api/save", JSON_HEADERS, SAVE);
    expect(refused.status).toBe(400);
    expect(String(refused.json.error)).toContain("profile");
    expect(readFileSync(PROFILE, "utf8")).toBe(before);
  });

  test("answers a malformed body with JSON, and keeps serving", async () => {
    const refused = await send("POST", "/api/save", JSON_HEADERS, "{not json");
    expect(refused.status).toBe(400);
    expect((await send("GET", "/api/payload", {})).status).toBe(200);
  });
});
