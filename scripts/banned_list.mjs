// Reads the ONE shared banned-word list (MUST-FOLLOW rule 16) from OUTSIDE this repository and turns it into the gitignored
// module the Worker's display filter imports. No banned word or pattern is ever written into a tracked file: the list lives in
// notes/coordination-2026-10-31/rules/banned-words.json, Herma's neutral descriptions live next to Herma's notes
// (notes/claude-work-2026-10-31/herma/herma-neutral-names.json), and the module this script writes is ignored by git, stays on
// the server and is never sent to a browser.
//
//   node scripts/banned_list.mjs            generate deploy/cloudflare/banned_words.generated.js
//   node scripts/banned_list.mjs --check    fail when that module is missing, stale, or built from the test fixtures
//   node scripts/banned_list.mjs --ensure   for tests and local work only: generate it if needed, and fall back to the made-up fixtures
//
// Other scripts import { ensureGenerated, readList, compileList, privateTokens }. BANNED_WORDS_LIST and BANNED_NEUTRAL_NAMES
// override the two paths (the tests point them at tests/fixtures/made-up-*.json). A missing list is a failure for every release
// check; only the unit tests (vitest, the page fixtures) may fall back to the made-up fixtures, and a module built from them
// says so, so the gate and the deploy hook refuse it.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GENERATED = path.join(ROOT, "deploy/cloudflare/banned_words.generated.js");
export const DEFAULT_LIST = "/home/username/meta_hacakthon/notes/coordination-2026-10-31/rules/banned-words.json";
export const DEFAULT_NEUTRAL = "/home/username/meta_hacakthon/notes/claude-work-2026-10-31/herma/herma-neutral-names.json";
export const FIXTURE_LIST = path.join(ROOT, "tests/fixtures/made-up-banned-words.json");
export const FIXTURE_NEUTRAL = path.join(ROOT, "tests/fixtures/made-up-neutral-names.json");
const ELLIPSIS = "…";

export const listPath = () => process.env.BANNED_WORDS_LIST || DEFAULT_LIST;
export const neutralPath = () => process.env.BANNED_NEUTRAL_NAMES || DEFAULT_NEUTRAL;
export const sha256Hex = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

function read(file, what) {
  if (!fs.existsSync(file)) throw new Error(`${what} is missing: ${file} (the release checks fail closed without it)`);
  const raw = fs.readFileSync(file, "utf8");
  return { raw, parsed: JSON.parse(raw) };
}

/**
 * The shared list and Herma's neutral rules, parsed, with a hash of their exact text so a changed list is noticed.
 * `fixtureOk` lets the unit tests fall back to the made-up fixtures when the real list is not on this machine.
 */
export function readList({ fixtureOk = false } = {}) {
  let list;
  let neutral;
  let source = "shared";
  try {
    list = read(listPath(), "the shared banned-word list");
    neutral = read(neutralPath(), "Herma's neutral-description rules");
  } catch (error) {
    if (!fixtureOk || process.env.BANNED_WORDS_LIST || process.env.BANNED_NEUTRAL_NAMES) throw error;
    list = read(FIXTURE_LIST, "the made-up banned-word list");
    neutral = read(FIXTURE_NEUTRAL, "the made-up neutral rules");
    source = "fixture";
  }
  if (process.env.BANNED_WORDS_LIST || process.env.BANNED_NEUTRAL_NAMES) source = "override";
  const inputsSha = crypto.createHash("sha256").update(source).update("\0").update(list.raw).update("\0").update(neutral.raw).digest("hex");
  return { list: list.parsed, neutral: neutral.parsed, inputsSha, source };
}

/** The pattern groups this guard reads. `fingerprints` is hex of 12 or more characters, checked in every element, code included (owner, Nov 2). */
const READ_GROUPS = new Set(["always", "visible_text", "agent_apps_outside_models_page", "fingerprints"]);

/** Names of groups in the list that hold patterns but that this guard does not read (so a new group is noticed, never silently skipped). */
export function unreadGroups(list) {
  return Object.keys(list || {}).filter((name) => !READ_GROUPS.has(name) && Array.isArray(list[name]?.patterns));
}

/** The list's pattern groups as plain arrays. */
export function groups(list) {
  const take = (g) => (Array.isArray(list?.[g]?.patterns) ? list[g].patterns.map(String) : []);
  return {
    always: take("always"),
    visible: take("visible_text"),
    apps: take("agent_apps_outside_models_page"),
    fingerprints: take("fingerprints"),
    privateSha256: Array.isArray(list?.private_names?.sha256) ? list.private_names.sha256.map((h) => String(h).toLowerCase()) : [],
    caseInsensitive: list?.case_insensitive !== false,
  };
}

/**
 * Ready-to-use regular expressions for the gate (nothing here is written to a tracked file). They are exactly the shared list:
 * Herma's own extra rules only change how a match is shown, they never add a banned word (rule 16: add a word to the list, not to one guard).
 */
export function compileList(list) {
  const g = groups(list);
  const flags = g.caseInsensitive ? "i" : "";
  const make = (patterns, group) => patterns.map((source, index) => ({ source, group, index, re: new RegExp(source, flags) }));
  return {
    always: make(g.always, "always"),
    visible: make(g.visible, "visible_text"),
    apps: make(g.apps, "agent_apps"),
    fingerprints: make(g.fingerprints, "fingerprints"),
    privateSha256: new Set(g.privateSha256),
  };
}

/** Word tokens (letters and digits only, lowercased) whose sha256 is a private name's hash. */
export function privateTokens(text, hashes) {
  if (!hashes.size) return [];
  const found = new Set();
  for (const token of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (hashes.has(sha256Hex(token))) found.add(token);
  }
  return [...found];
}

/** Herma's display rules in the order they run: its own extra rules, the list's patterns with their hints, then an ellipsis for any pattern without one. */
export function displayRules(list, neutral) {
  const g = groups(list);
  const flags = g.caseInsensitive ? "i" : "";
  const listed = [...g.always, ...g.visible, ...g.apps, ...g.fingerprints];
  const rules = [];
  const used = new Set();
  const rule = (pattern, to) => {
    new RegExp(pattern, flags); // fail the build on a pattern that does not compile
    return { re: String(pattern), flags, to };
  };
  for (const r of neutral.rules || []) if (r.extra) rules.push(rule(r.pattern, r.to));
  for (const r of neutral.rules || []) {
    if (r.extra || !listed.includes(String(r.pattern))) continue;
    rules.push(rule(r.pattern, r.to));
    used.add(String(r.pattern));
  }
  for (const pattern of listed) if (!used.has(pattern)) rules.push(rule(pattern, ELLIPSIS));
  return rules;
}

export function moduleText({ list, neutral, inputsSha, source }) {
  const body = {
    inputs_sha256: inputsSha,
    source,
    version: list.version ?? null,
    updated: list.updated ?? null,
    displayRules: displayRules(list, neutral),
    privateSha256: groups(list).privateSha256,
  };
  return (
    "// GENERATED by scripts/banned_list.mjs from the shared banned-word list (MUST-FOLLOW rule 16).\n" +
    "// Gitignored: never commit it, never send it to a browser. Server side only.\n" +
    `export default Object.freeze(${JSON.stringify(body, null, 1)});\n`
  );
}

/** True when the generated module exists and was built from exactly these inputs. */
export function isCurrent(inputsSha) {
  if (!fs.existsSync(GENERATED)) return false;
  return fs.readFileSync(GENERATED, "utf8").includes(`"inputs_sha256": "${inputsSha}"`);
}

export function generate(options = {}) {
  const inputs = readList(options);
  fs.writeFileSync(GENERATED, moduleText(inputs), "utf8");
  return inputs;
}

/**
 * Write the module unless it is already current; every script that imports the Worker's page modules calls this first.
 * A process that was given a list through BANNED_WORDS_LIST (the tests) puts the module back as it found it when it exits,
 * so a test can never leave a made-up list in the file that the next build bundles.
 */
export function ensureGenerated(options = {}) {
  const inputs = readList(options);
  if (!isCurrent(inputs.inputsSha)) {
    if (inputs.source === "override") {
      const before = fs.existsSync(GENERATED) ? fs.readFileSync(GENERATED, "utf8") : null;
      process.once("exit", () => {
        try {
          if (before === null) fs.rmSync(GENERATED, { force: true });
          else fs.writeFileSync(GENERATED, before, "utf8");
        } catch {
          /* the next build regenerates it anyway */
        }
      });
    }
    fs.writeFileSync(GENERATED, moduleText(inputs), "utf8");
  }
  return inputs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--ensure")) {
      const { source } = ensureGenerated({ fixtureOk: true });
      console.log(`banned words: the generated module is ready (${source})`);
    } else if (process.argv.includes("--check")) {
      const { inputsSha, list, source } = readList();
      if (source === "fixture" || !isCurrent(inputsSha)) {
        console.error("deploy/cloudflare/banned_words.generated.js is missing, stale or built from the test fixtures: run node scripts/banned_list.mjs");
        process.exit(1);
      }
      console.log(`banned words: the generated module matches the shared list (version ${list.version}, ${list.updated})`);
    } else {
      const { list } = generate();
      console.log(`generated ${path.relative(ROOT, GENERATED)} from the shared list (version ${list.version}, ${list.updated})`);
    }
  } catch (error) {
    console.error(`banned words FAILED: ${error.message}`);
    process.exit(1);
  }
}
