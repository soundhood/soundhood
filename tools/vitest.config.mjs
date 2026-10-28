// Unit tests for the lint helpers and the screenshot fixture (`npm test`). The Playwright
// suite (*.spec.mjs) runs separately through `npm run test:visual`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lint/**/*.test.mjs", "screenshot/**/*.test.mjs"],
    environment: "node",
  },
});
