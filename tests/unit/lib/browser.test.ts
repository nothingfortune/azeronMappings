import { describe, expect, it } from "vitest";

import { browserCandidates, openInChromium } from "../../../src/lib/browser.js";

const WINDOWS = {
  platform: "win32" as const,
  wsl: false,
  env: {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  },
};

describe("opening the editor in a browser that has WebHID", () => {
  it("looks for Chrome, then Edge, in each place Windows installs them", () => {
    const found = browserCandidates(WINDOWS);
    expect(found[0]).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    expect(found[1]).toBe("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(found).toContain(
      "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    );
  });

  it("starts the Windows browser from WSL", () => {
    const found = browserCandidates({ platform: "linux", wsl: true, env: {} });
    expect(found[0]).toBe("/mnt/c/Program Files/Google/Chrome/Application/chrome.exe");
  });

  it("opens the first one installed, in a new window on the page", () => {
    const started: [string, string[]][] = [];
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const opened = openInChromium(
      "http://localhost:4173",
      WINDOWS,
      (path) => path === edge,
      (path, args) => started.push([path, args]),
    );
    expect(opened).toBe(edge);
    expect(started).toEqual([[edge, ["--new-window", "http://localhost:4173"]]]);
  });

  it("opens nothing, and says so, when neither is installed", () => {
    const started: unknown[] = [];
    expect(
      openInChromium(
        "http://localhost:4173",
        WINDOWS,
        () => false,
        (...args) => started.push(args),
      ),
    ).toBeNull();
    expect(started).toEqual([]);
  });
});
