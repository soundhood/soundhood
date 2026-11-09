// Unit tests for the lint helpers, the screenshot fixture and the design system's pure helpers in
// app/src (`npm test`). The Playwright suite (*.spec.mjs) runs separately through
// `npm run test:visual`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lint/**/*.test.mjs", "screenshot/**/*.test.mjs", "netlog/**/*.test.mjs", "../app/src/**/*.test.ts"],
    environment: "node",
  },
});
