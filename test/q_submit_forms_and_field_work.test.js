import { describe, expect, it } from "vitest";
import { needsFieldTeam } from "../deploy/cloudflare/priority_work_gateway.js";

describe("field work routing", () => {
  it("names work that needs people in a place", () => {
    for (const title of [
      "Field-team pickup: run live block 1 of the tactile orientation drill",
      "Recruit a field partner with existing shelter-site relationships",
      "NGO: Collect genuine shelter inverter trip logs at 2+ consented sites",
    ]) expect(needsFieldTeam(title)).toBe(true);
  });
  it("leaves desk work alone", () => {
    for (const title of ["Write a timed facilitator script for the ED-mode desk drill", "Verify quickstart steps"]) {
      expect(needsFieldTeam(title)).toBe(false);
    }
  });
});
