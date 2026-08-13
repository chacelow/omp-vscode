import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Adapter tests are pure functions (`domain/*`) — no React, no DOM. We keep
 * `environment: "node"` so happy-dom is only spun up if a later suite needs
 * it (add `// @vitest-environment happy-dom` at the top of that file).
 *
 * The `@` alias mirrors `tsconfig.json`'s `paths` so tests can `import "@/…"`
 * exactly like production code.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/ui/omp"),
    },
  },
});
