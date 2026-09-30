/**
 * The save endpoint is the one place the browser reaches into the repo, so what it will
 * accept is defined narrowly and checked on the resolved path, not the requested string.
 */

import { describe, expect, it } from "vitest";

import {
  leadingComments,
  parseSaveRequest,
  preserveHeader,
  resolveSavePath,
  SaveRejected,
} from "../../../src/lib/serve.js";

const ROOT = "/repo";

describe("resolveSavePath", () => {
  it("accepts the data the editor owns", () => {
    // A path, not a file: nothing here reads the disk, so no real profile is needed.
    expect(resolveSavePath(ROOT, "games/SpaceSims/everspace/profiles/example-left.yaml")).toBe(
      "/repo/games/SpaceSims/everspace/profiles/example-left.yaml",
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

describe("preserveHeader", () => {
  /**
   * The editor writes YAML regenerated from parsed data, which has no comments in it. A
   * save used to replace the file wholesale, taking the header with it -- and the header
   * is where a profile records what was press-tested, what is an experiment and what must
   * not be flashed. Guarded here rather than only in the Playwright suite, which the gate
   * does not run.
   */
  const HEADER = "# Everspace 2 -- akimbo, LEFT unit.\n#\n# Press-tested 2026-09-28.\n";
  const BODY = "profile:\n  id: abc\npositions: {}\n";

  it("keeps the header the file already had", () => {
    expect(preserveHeader(HEADER + BODY, BODY)).toBe(HEADER + BODY);
  });

  it("writes the incoming file unchanged when there is no file yet", () => {
    expect(preserveHeader(null, BODY)).toBe(BODY);
  });

  it("writes the incoming file unchanged when the old one had no header", () => {
    expect(preserveHeader(BODY, BODY)).toBe(BODY);
  });

  it("replaces a header the incoming file brought of its own", () => {
    // Otherwise a save would stack one header on top of the other, every time.
    expect(preserveHeader(HEADER + BODY, "# generated\n\n" + BODY)).toBe(HEADER + BODY);
  });

  it("does not carry the blank line after the header into the count", () => {
    expect(preserveHeader(`${HEADER}\n${BODY}`, BODY)).toBe(HEADER + BODY);
  });
});

describe("leadingComments", () => {
  it("stops at the first line that is not a comment", () => {
    expect(leadingComments("# one\n# two\nprofile:\n# not this\n")).toBe("# one\n# two\n");
  });

  it("keeps a blank line between comment blocks but not a trailing one", () => {
    expect(leadingComments("# one\n\n# two\n\nprofile:\n")).toBe("# one\n\n# two\n");
  });

  it("returns nothing when the file opens with content", () => {
    expect(leadingComments("profile:\n# later\n")).toBe("");
  });
});
