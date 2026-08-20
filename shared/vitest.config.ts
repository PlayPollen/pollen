import { defineConfig } from "vitest/config";

// The game rules live here now, so this is where the rule tests run.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
