import assert from "node:assert/strict";
import { test } from "node:test";
import { compileList, displayRules, groups, unreadGroups } from "../../scripts/banned_list.mjs";

// The guard reads every pattern group it knows, the planned `fingerprints` group among them, and reports any group it does not read.
// Everything here is made up; no real list is read.

const HEX = "(?<![0-9a-f])[0-9a-f]{12,}(?![0-9a-f])";
const list = {
  case_insensitive: true,
  always: { patterns: ["zorptest"] },
  visible_text: { patterns: ["plorps"] },
  agent_apps_outside_models_page: { patterns: ["wumpusapp"] },
  fingerprints: { patterns: [HEX] },
  private_names: { sha256: [] },
  third_party_names: "a description, not a group",
};

test("the fingerprints group is read, compiled and used by the display filter", () => {
  assert.deepEqual(groups(list).fingerprints, [HEX]);
  const compiled = compileList(list);
  assert.equal(compiled.fingerprints.length, 1);
  assert.equal(compiled.fingerprints[0].group, "fingerprints");
  assert.ok(compiled.fingerprints[0].re.test("seen as 0123456789abcdef in a code element"));
  assert.ok(!compiled.fingerprints[0].re.test("an id 0a1b2c3d"));
  const rules = displayRules(list, { rules: [] });
  assert.ok(rules.some((rule) => rule.re === HEX), "the display filter hides what the group matches");
});

test("a list without the group still compiles to nothing for it", () => {
  const { fingerprints, ...rest } = list;
  assert.equal(fingerprints.patterns.length, 1);
  assert.deepEqual(compileList(rest).fingerprints, []);
});

test("a pattern group this guard does not read is reported, and plain entries are not groups", () => {
  assert.deepEqual(unreadGroups(list), []);
  assert.deepEqual(unreadGroups({ ...list, newly_added: { why: "made up", patterns: ["x"] } }), ["newly_added"]);
  assert.deepEqual(unreadGroups({ ...list, also_a_string: "text", an_object: { why: "no patterns" } }), []);
});

test("the word rule is for our own jargon: a tax term stays, including the shared list's own rule", async () => {
  const { default: list } = await import("../../deploy/cloudflare/banned_words.generated.js");
  if (list.source === "fixture") return;
  const { scrubBannedWords } = await import("../../deploy/cloudflare/page_shell.js");
  assert.equal(scrubBannedWords("Gross receipts under $50,000 a year"), "Gross receipts under $50,000 a year");
  assert.equal(scrubBannedWords("Keep donation receipts on file"), "Keep donation receipts on file");
  assert.equal(scrubBannedWords("Every worker keeps receipts"), "Every worker keeps records");
});
