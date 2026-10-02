import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e is Playwright's; vitest would try to run its describes and fail.
    include: ["tests/unit/**/*.test.ts"],
    // The tests run against a frozen copy of the data, not the layouts the owner is editing:
    // see tests/fixtures/repo/README.md.
    env: { AZERON_DATA: "tests/fixtures/repo" },
  },
});
