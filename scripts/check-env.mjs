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

/** Platform packages, and the platform-arch token each name implies. */
function installedPlatforms() {
  const found = new Map();
  const scan = (scope, prefix) => {
    const dir = join(modules, scope);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      const parts = rest.split("-");
      if (parts.length < 2) continue;
      found.set(`${scope}/${name}`, `${parts[0]}-${parts[1]}`);
    }
  };
  scan("@esbuild", "");
  scan("@rolldown", "binding-");
  return found;
}

const wanted = `${process.platform}-${process.arch}`;
const installed = installedPlatforms();
const mismatched = [...installed].filter(([, platform]) => platform !== wanted);

if (installed.size > 0 && mismatched.length === installed.size) {
  const names = [...new Set(mismatched.map(([, platform]) => platform))].join(", ");
  console.error(
    [
      `node_modules holds binaries for ${names}, but this shell is ${wanted}.`,
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
