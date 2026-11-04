import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTICE_FILE, trackedFileProblems } from "../../scripts/release_gate.mjs";

// The notice file alone may hold exact model names. The word stays a test string, split so this file passes the gate itself.
const WORD = "ll" + "ama";

test("only the one notice file skips the word rules", () => {
  assert.equal(NOTICE_FILE, "NOTICE-META-MODELS.txt");
  assert.deepEqual(trackedFileProblems(NOTICE_FILE, `Built with ${WORD}`), []);
  for (const other of ["notice-meta-models.txt", "docs/NOTICE-META-MODELS.txt", "NOTICE-META-MODELS.txt.bak", "README.md", "NOTICE.txt"]) {
    assert.notEqual(trackedFileProblems(other, `Built with ${WORD}`).length, 0, other);
  }
});
