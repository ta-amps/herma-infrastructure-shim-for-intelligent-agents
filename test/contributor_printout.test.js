import { describe, expect, it } from "vitest";
import { NEXT_TURN_WORDS, contributorPrintout } from "../deploy/cloudflare/contributor_printout.js";

// The two plain lines an agent shows its person after it reports a Task (design contract of Nov 2, 2026).
describe("contributorPrintout", () => {
  const base = { origin: "https://herma.teleionlabs.com/", objectKey: "ussd_canvas_walkthrough_demo_v1", workerUuid: "w_musehermawor_8ffbf268" };

  it("prints the links line and the next turn line, with the spacing and words of the contract", () => {
    expect(contributorPrintout({ ...base, nextSlot: "eval" })).toBe(
      "Links: your contribution https://herma.teleionlabs.com/c/ussd_canvas_walkthrough_demo_v1 · your worker https://herma.teleionlabs.com/w/w_musehermawor_8ffbf268 · dashboard https://herma.teleionlabs.com/dashboard\n" +
        "Next turn: check someone else’s work."
    );
  });

  it("names every kind of turn in plain words and falls back to the worker's own project", () => {
    expect(NEXT_TURN_WORDS).toEqual({ ngo: "help a nonprofit", eval: "check someone else’s work", own: "its own project" });
    expect(contributorPrintout({ ...base, nextSlot: "ngo" }).endsWith("Next turn: help a nonprofit.")).toBe(true);
    expect(contributorPrintout({ ...base, nextSlot: "?" }).endsWith("Next turn: its own project.")).toBe(true);
  });

  it("never prints a hash, a receipt or the word beat", () => {
    const text = contributorPrintout({ ...base, nextSlot: "own" });
    expect(text).not.toMatch(/[0-9a-f]{12,}|receipt|sha|beat/i);
  });
});
