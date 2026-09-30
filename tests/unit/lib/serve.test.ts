/**
 * The save endpoint is the one place the browser reaches into the repo, so what it will
 * accept is defined narrowly and checked on the resolved path, not the requested string.
 */

import { describe, expect, it } from "vitest";

import { parseSaveRequest, resolveSavePath, SaveRejected } from "../../../src/lib/serve.js";

const ROOT = "/repo";

describe("resolveSavePath", () => {
  it("accepts the data the editor owns", () => {
    expect(resolveSavePath(ROOT, "games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml")).toBe(
      "/repo/games/SpaceSims/everspace/profiles/akimbo-v9-left.yaml",
    );
    expect(resolveSavePath(ROOT, "games/SpaceSims/everspace/actions.yaml")).toBe(
      "/repo/games/SpaceSims/everspace/actions.yaml",
    );
    expect(resolveSavePath(ROOT, "devices/cyborg2-left.yaml")).toBe(
      "/repo/devices/cyborg2-left.yaml",
    );
  });

  it("refuses anything else in the repo", () => {
    for (const path of ["package.json", "src/index.ts", "dist/editor.html", "CLAUDE.md"]) {
      expect(() => resolveSavePath(ROOT, path), path).toThrow(SaveRejected);
    }
  });

  it("refuses to escape the repo, however it is spelled", () => {
    for (const path of [
      "../outside.yaml",
      "devices/../../outside.yaml",
      "games/a/b/profiles/../../../../../etc/passwd.yaml",
      "/etc/passwd",
      "/repo/devices/x.yaml",
    ]) {
      expect(() => resolveSavePath(ROOT, path), path).toThrow(SaveRejected);
    }
  });

  it("refuses an empty path", () => {
    expect(() => resolveSavePath(ROOT, "")).toThrow(SaveRejected);
  });
});

describe("parseSaveRequest", () => {
  const body = (value: unknown) => JSON.stringify(value);

  it("takes a path and content", () => {
    expect(parseSaveRequest(body({ path: "devices/x.yaml", content: "device: x\n" }))).toEqual({
      path: "devices/x.yaml",
      content: "device: x\n",
    });
  });

  it("refuses anything that is not a save request", () => {
    expect(() => parseSaveRequest("not json")).toThrow(SaveRejected);
    expect(() => parseSaveRequest(body({ path: 1, content: "x" }))).toThrow(SaveRejected);
    expect(() => parseSaveRequest(body({ path: "a", content: null }))).toThrow(SaveRejected);
  });

  it("refuses an empty or binary file", () => {
    expect(() => parseSaveRequest(body({ path: "a", content: "   " }))).toThrow(/empty/);
    expect(() => parseSaveRequest(body({ path: "a", content: "a\0b" }))).toThrow(/binary/);
  });
});
