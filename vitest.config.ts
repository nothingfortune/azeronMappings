import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e is Playwright's; vitest would try to run its describes and fail.
    include: ["tests/unit/**/*.test.ts"],
  },
});
