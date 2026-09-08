import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "app"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["app/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "build/**"],
  },
});
