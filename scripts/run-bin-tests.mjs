/**
 * Run tests/bin/run.sh through whichever bash is available.
 *
 * PowerShell does not usually have bash on PATH even when Git for Windows has shipped
 * one, so look in the usual places before giving up -- and give up loudly rather than
 * skipping, because a silently skipped gate is worse than a failing one.
 */
import { spawnSync } from "node:child_process";
import console from "node:console";
import { existsSync } from "node:fs";
import process from "node:process";

const candidates = [
  "bash",
  "C:/Program Files/Git/bin/bash.exe",
  "C:/Program Files (x86)/Git/bin/bash.exe",
];

for (const bash of candidates) {
  const probe = spawnSync(bash, ["--version"], { stdio: "ignore" });
  if (probe.error && !existsSync(bash)) continue;
  if (probe.status !== 0) continue;
  const result = spawnSync(bash, ["tests/bin/run.sh"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.error(
  "no bash found for tests/bin/run.sh. On Windows, install Git for Windows or run the\n" +
    "gate from WSL; on Linux and macOS bash should already be on PATH.",
);
process.exit(1);
