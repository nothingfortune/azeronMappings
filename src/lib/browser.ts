/**
 * Opening the editor in a browser that can talk to the units.
 *
 * Write to units and the press test use WebHID, which only Chromium browsers have, so
 * `npm start` opens Chrome or Edge rather than whatever the default browser is. From WSL
 * the Windows browser is started through `/mnt/c`, and it reaches the server on localhost
 * as usual.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface BrowserContext {
  platform: NodeJS.Platform;
  wsl: boolean;
  env: Readonly<Record<string, string | undefined>>;
}

/** Where Chrome and Edge are installed, in the order to try them. Pure, for the tests. */
export function browserCandidates(ctx: BrowserContext): string[] {
  const windows = (roots: (string | undefined)[]): string[] =>
    roots
      .filter((root): root is string => root !== undefined && root !== "")
      .flatMap((root) => [
        `${root}/Google/Chrome/Application/chrome.exe`,
        `${root}/Microsoft/Edge/Application/msedge.exe`,
      ]);
  if (ctx.platform === "win32") {
    return windows([ctx.env.PROGRAMFILES, ctx.env["PROGRAMFILES(X86)"], ctx.env.LOCALAPPDATA]).map(
      (path) => path.replaceAll("/", "\\"),
    );
  }
  if (ctx.wsl) return windows(["/mnt/c/Program Files", "/mnt/c/Program Files (x86)"]);
  if (ctx.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ].flatMap((name) => ["/usr/bin/", "/usr/local/bin/", "/snap/bin/"].map((dir) => dir + name));
}

/**
 * Open `url` in the first Chrome or Edge found. Returns the browser's path, or null when
 * none is installed, so the caller can say where to go instead.
 */
export function openInChromium(
  url: string,
  ctx: BrowserContext,
  exists: (path: string) => boolean = existsSync,
  start: (path: string, args: string[]) => void = (path, args) => {
    spawn(path, args, { detached: true, stdio: "ignore" }).unref();
  },
): string | null {
  const found = browserCandidates(ctx).find((path) => exists(path));
  if (found === undefined) return null;
  start(found, ["--new-window", url]);
  return found;
}
