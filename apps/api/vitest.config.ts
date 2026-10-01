import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./test/setup-env.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
