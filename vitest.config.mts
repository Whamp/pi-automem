import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["extensions/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
    testTimeout: 10_000,
  },
});
