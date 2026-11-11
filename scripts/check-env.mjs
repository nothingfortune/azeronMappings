// @ts-check
/**
 * Make node_modules fit the shell that is running.
 *
 * The repo sits on a Windows drive that WSL also mounts, so it may be run from either. npm
 * writes .cmd shims only when it installs on Windows, and esbuild and rolldown each ship a
 * per-platform binary, so a tree installed by one shell fails in the other with errors that
 * name nothing ("'tsc' is not recognized"). This reinstalls instead.
 */
import console from "node:console";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
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

// On Windows a tree installed from WSL has no .cmd shims ("'tsc' is not recognized"), so
// check for the shim itself, not a proxy for it.
const missingShim = process.platform === "win32" && !existsSync(join(modules, ".bin", "tsc.cmd"));

if (missingShim || mismatched.length > 0) {
  // node_modules was installed by the other shell (WSL or Windows). It is only a copy of
  // what package-lock.json names, so put back the one this shell needs and carry on.
  console.warn("node_modules was installed for another platform; installing for this one...");
  try {
    rmSync(modules, { recursive: true, force: true });
  } catch {
    // Windows will not delete a file something has open: a running editor, say.
    console.error("node_modules is in use. Stop anything running from it, then: npm install");
    process.exit(1);
  }
  const npm = spawnSync("npm install --no-audit --no-fund", {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (npm.status !== 0) {
    console.error("npm install failed; run it yourself to see why.");
    process.exit(1);
  }
}
