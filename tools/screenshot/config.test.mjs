// The visual suite's configuration (playwright.config.mjs): on CI a systemic break ends the run
// after CI_MAX_FAILURES failures instead of running out the job's time; locally every test runs.
import { describe, expect, it } from "vitest";
import config, { CI_MAX_FAILURES, maxFailuresFor } from "./playwright.config.mjs";

describe("the visual suite's failure limit", () => {
  it("stops a CI run after 25 failures", () => {
    expect(CI_MAX_FAILURES).toBe(25);
    expect(maxFailuresFor({ CI: "true" })).toBe(25);
  });

  it("runs every test outside CI", () => {
    expect(maxFailuresFor({})).toBe(0);
  });

  it("is what the configuration uses for this run", () => {
    expect(config.maxFailures).toBe(maxFailuresFor(process.env));
  });
});
