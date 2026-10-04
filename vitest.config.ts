import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e is Playwright's; vitest would try to run its describes and fail.
    include: ["tests/unit/**/*.test.ts"],
    // The tests run against a frozen copy of the data, not the layouts the owner is editing:
    // see tests/fixtures/repo/README.md.
    // AZERON_STORE names an Azeron app profile folder that is not there, so nothing reads
    // the owner's real one; a test that wants one makes its own.
    env: { AZERON_DATA: "tests/fixtures/repo", AZERON_STORE: "tests/fixtures/no-azeron-app" },
    // The repo sits on a Windows drive read through WSL, and a test that builds the editor's
    // data reads a few hundred files from it. On a busy machine that alone has passed the
    // five-second default and failed tests that had nothing wrong with them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Half the cores. With every core taken and the machine busy with something else, test
    // files failed to start at all, and the run failed with every test that ran passing.
    maxWorkers: "50%",
  },
});
