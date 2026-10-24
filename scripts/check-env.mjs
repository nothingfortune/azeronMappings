// @ts-check
/**
 * Fail early and clearly when node_modules was installed for a different platform.
 *
 * The repo sits on a Windows drive that WSL also mounts, so `npm install` in one shell and
 * `npm run` in the other is easy to do by accident. npm writes .cmd shims only when it
 * installs on Windows, and esbuild and rolldown each ship a per-platform binary, so the
 * mismatch surfaces as "'tsc' is not recognized" or "vitest failed to start" rather than
 * anything that names the cause.
 */
import console from "node:console";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const modules = join(root, "node_modules");

if (!existsSync(modules)) {
  console.error("node_modules is missing. Run: npm install");
  process.exit(1);
}

/**
 * Platform packages, and the platform-arch token each name implies.
 *
 * This file stays JavaScript because it runs before anything is compiled -- it is the
 * guard that explains a node_modules built for the wrong platform, and a guard that
 * needs a build to run is no guard. `checkJs` type-checks it all the same.
 *
 * @returns {Map<string, string>}
 */
function installedPlatforms() {
  /** @type {Map<string, string>} */
  const found = new Map();
  /**
   * @param {string} scope
   * @param {string} prefix
   */
  const scan = (scope, prefix) => {
    const dir = join(modules, scope);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      const [platform, arch] = rest.split("-");
      if (platform === undefined || arch === undefined) continue;
      found.set(`${scope}/${name}`, `${platform}-${arch}`);
    }
  };
  scan("@esbuild", "");
  scan("@rolldown", "binding-");
  return found;
}

const wanted = `${process.platform}-${process.arch}`;
const installed = installedPlatforms();
const mismatched = [...installed].filter(([, platform]) => platform !== wanted);

// Half a reinstall -- binaries for both platforms side by side -- works until it does not.
// Worth saying, not worth stopping for.
if (mismatched.length > 0 && mismatched.length < installed.size) {
  console.warn(
    `node_modules also holds binaries for another platform: ${mismatched
      .map(([name, platform]) => `${name} (${platform})`)
      .join(", ")}. If something fails to start, reinstall in this shell.`,
  );
}

// On Windows the failure people actually see is "'tsc' is not recognized": npm wrote no
// .cmd shims because it installed from WSL. Check for the shim itself, not a proxy for it.
const missingShim = process.platform === "win32" && !existsSync(join(modules, ".bin", "tsc.cmd"));

if (missingShim || (installed.size > 0 && mismatched.length === installed.size)) {
  const names = [...new Set(mismatched.map(([, platform]) => platform))].join(", ");
  console.error(
    [
      missingShim && mismatched.length === 0
        ? "node_modules has no .cmd shims, so it was installed from WSL, not this shell."
        : `node_modules holds binaries for ${names}, but this shell is ${wanted}.`,
      "",
      ...mismatched.map(([name, platform]) => `  ${name}  (${platform})`),
      "",
      "One node_modules cannot serve both Windows and WSL: npm writes .cmd shims only on",
      "Windows, and esbuild and rolldown ship per-platform binaries. Reinstall in the shell",
      "you mean to work in:",
      "",
      "  rm -rf node_modules && npm install       (WSL / bash)",
      "  rmdir /s /q node_modules && npm install  (PowerShell / cmd)",
      "",
      "Both shells work. `azeron install` finds the Azeron app's store natively on Windows",
      "and through /mnt/c from WSL.",
    ].join("\n"),
  );
  process.exit(1);
}
