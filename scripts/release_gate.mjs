// The banned-word gate for a release: what Herma serves must not name the retired model family, the banned word or an
// agent app, and its pages must use Tasks and Task Objects in prose and carry no receipt or hash wording, even when the
// worker-written text they show holds all of that. It runs before every deploy (scripts/check_release.py calls it, and
// wrangler runs that from build.command) and fails closed: a route that cannot be fetched is a failure.
//
//   node scripts/release_gate.mjs        exit 0 when every surface is clean, 1 otherwise
//
// It checks four things:
//   1. the real Worker, run with an in-memory database, answering every public route (pages, JSON, text, scripts);
//   2. every page rendered from the fixtures in tests/fixtures/pages;
//   3. the same pages rendered from worker-written text that is full of banned words, ids and hashes (the display-time
//      word rules must clean them; stored records are never touched);
//   4. every tracked source file, for the retired family, the banned word and the third-party agent app.
// Banned words are written in pieces, so this file never contains them itself.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://herma.ta-amps.workers.dev";

const RETIRED = new RegExp("l" + "lama", "i");
const BANNED_WORD = new RegExp("syn" + "thetic", "i");
const THIRD_PARTY_APP = new RegExp("nano" + "muse", "i");
// Prose words are whole words. A field name or a path that holds one (verb_kind, --verb-, noun.*, nouns-and-verbs) is an
// identifier the wire or a file format needs, not prose.
const AFTER_IDENTIFIER = "(?![\\w/-]|\\.\\*|:\\w)";
const PROSE_WORDS = new RegExp(`(?<![\\w/-])(?:nouns?|verbs?)${AFTER_IDENTIFIER}`, "i");
const RECEIPT_WORDS = new RegExp(`(?<![\\w/-])(?:receipts?|sha-?256)${AFTER_IDENTIFIER}`, "i");
const LONG_HEX = /(?<![0-9a-f])[0-9a-f]{12,}(?![0-9a-f])/i;
const STAMPS = [/PLANNED/, /Not yet/, /Layout preview/, /COMING SOON/, /Not ready yet/, /\bIdea\b/];
const CLOUD_NEXT_TO_DEDICATED = /cloud\W+(?:\w+\W+){0,2}dedicated|dedicated\W+(?:\w+\W+){0,2}cloud/i;
// The one wire example a page keeps: the API's own field value, inside a command people copy.
const WIRE_EXAMPLES = ["noun:custom.lease_contract", '"kind":"noun"'];

/** What a reader sees and a grep over the page finds: no scripts, styles or the banner's data. */
export function visibleText(html, { identifiers = true } = {}) {
  let text = String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ta-agent-banner[\s\S]*?<\/ta-agent-banner>/gi, " ");
  // Inline code is an identifier (a field, an id, a path), not prose.
  if (!identifiers) text = text.replace(/<code>[\s\S]*?<\/code>/gi, " ");
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/** A link's address names a record by its id, so it may hold what the record is called; the words people read may not. */
function withoutAddresses(html) {
  return String(html).replace(/\s(?:href|src|action|data-[a-z-]+)="[^"]*"/gi, " ");
}

/** Rules for anything served: pages, JSON, text and scripts. */
export function dataProblems(name, text) {
  const problems = [];
  if (RETIRED.test(text)) problems.push(`${name}: names the retired model family`);
  if (BANNED_WORD.test(text)) problems.push(`${name}: uses the banned word`);
  if (THIRD_PARTY_APP.test(text)) problems.push(`${name}: names an agent app (agent apps appear only on Models used)`);
  return problems;
}

/** Rules for a page: the data rules, plus plain words in prose and no receipt or hash wording. */
export function pageProblems(name, html) {
  const problems = dataProblems(name, withoutAddresses(html));
  let prose = visibleText(html, { identifiers: false });
  let text = visibleText(html);
  for (const example of WIRE_EXAMPLES) { prose = prose.split(example).join(" "); text = text.split(example).join(" "); }
  if (PROSE_WORDS.test(prose)) problems.push(`${name}: says nouns or verbs in prose (say Tasks and Task Objects)`);
  if (RECEIPT_WORDS.test(prose)) problems.push(`${name}: has receipt or hash wording`);
  if (LONG_HEX.test(text)) problems.push(`${name}: shows a long id or hash`);
  if (CLOUD_NEXT_TO_DEDICATED.test(text)) problems.push(`${name}: puts "cloud" next to "dedicated"`);
  for (const stamp of STAMPS) if (stamp.test(text)) problems.push(`${name}: carries the stamp ${stamp}`);
  if (html.includes(String.fromCharCode(0x2014))) problems.push(`${name}: has an em dash`);
  return problems;
}

const piece = (...parts) => parts.join("");

/** Worker-written text that breaks every rule on purpose. */
function dirty(label) {
  return [
    `${label} of the ${piece("no", "uns")} and ${piece("ver", "bs")} for a ${piece("syn", "thetic")} ${piece("Ll", "ama")} 3.2 run`,
    `receipt ${piece("SHA", "-256")} 9699abcdef0123456789abcd`,
    `see verb_evl_${"d900e706b470"} and w_musehermawor_${"8ffbf268"}`,
    `built in ${piece("nano", "Muse")} and ${piece("Muse", " Code")}`,
    `one${String.fromCharCode(0x2014)}two`,
  ].join(". ");
}

function dirtyDashboard() {
  const worker = (i) => ({
    worker_uuid: `w_dirty_${i}_8ffbf268`, agent_id: `dirty-${i}`, persona_label: dirty("Persona"), specialty_lens: dirty("Lens"),
    iteration_count: 3, ngo_completed: 1, eval_completed: 1, own_completed: 1, last_task_id: `verb_evl_${"d900e706b470"}`, profile_count: 2, harness_tier: "tier_2_sandboxed_chat_worker",
  });
  const contribution = (i) => ({
    task_id: `verb_own_${"b4e012efd371"}`, tier: "public_general", verb_kind: "worker_self_directed", state: "done", title: dirty("Title"), prompt: dirty("Prompt"),
    result_summary: dirty("Summary"), producer_agent: `dirty-${i}`, completed_by: `dirty-${i}`, generation_depth: 1, opt_goal: piece("syn", "thetic_goal"), receipt_hash: "f5b0937dcf4490189cd0df3e37f927396496c7055e3cd0ec1dd250de0a7bbb67", updated_at: "2026-11-01T13:49:37.068Z",
  });
  const object = (i) => ({
    object_key: `dirty_object_${i}_${"9f3a2b1c4d5e6f7a"}`, category: piece("syn", "thetic_kit"), summary: dirty("Object"), producer_agent: `dirty-${i}`, worker_uuid: `w_dirty_${i}_8ffbf268`,
    quality_milli: 900, novelty_milli: 700, eval_count: 2, chunk_count: 3, total_payload_bytes: 4096, sha256_hash: "28ceb44925f59693b7144e05c852eccccc849de01bdd9120ae800d6ba7e80e61", deliverable_kind: "portable_agent_kit",
  });
  return {
    registered_workers: 12, distinct_contributor_agents: 3, total_evaluations: 4, indexed_sidecar_docs: 5, total_objects: 6, total_object_bytes: 7000, total_chunks: 3,
    queue_counts_by_tier: { ngo_priority: { ready: 1, leased: 0, done: 2 }, public_general: { ready: 3, leased: 1, done: 4 } },
    workers: [worker(1), worker(2)], recent_contributions: [contribution(1), contribution(2)], recent_objects: [object(1), object(2)],
    facet_summary: { opt_goals: [], prog_langs: [], locales: [], deliverables: [] },
  };
}

async function load(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

async function fixturePages() {
  const { renderSite } = await load("scripts/page_fixtures_server.mjs");
  const site = await renderSite();
  return { pages: site.pages, scripts: site.scripts };
}

async function dirtyPages() {
  const dash = await load("deploy/cloudflare/dashboard_and_permalinks.js");
  const help = await load("deploy/cloudflare/worker_help_and_starter.js");
  const demo = await load("deploy/cloudflare/demo_page.js");
  const data = dirtyDashboard();
  const object = { ...data.recent_objects[0], payload: { files: { [`${piece("syn", "thetic")}_${"a1b2c3d4e5f6a7b8"}.py`]: "x" }, note: dirty("Payload") }, payload_sha256_verified: true, has_interactive_demo: true };
  const catalog = {
    quick_start_workflow: [{ step: 1, title: dirty("Step"), detail: dirty("Detail") }],
    starter_frameworks: { python_zero_dep_client: "print(1)", curl_and_js_fetch: "curl x", local_verification_harness: "echo y", help_query_example: { payload: { a: 1 } } },
    reusable_object_catalog: { schemas_and_contracts: [{ object_key: object.object_key, summary: dirty("Catalog"), review_status: "peer_reviewed", quality_milli: 900, permalink_url: "/c/x", pinned_url: "/q/object/x", object_url: "/q/object/x" }] },
  };
  return {
    "dirty /dashboard": dash.renderDashboardHtml(BASE, data),
    "dirty /c/<task>": dash.renderContributionPermalinkHtml(BASE, {
      lookup_id: "x", task: { ...data.recent_contributions[0], parent_task_id: "verb_x_9f3a2b1c4d5e", created_at: "2026-11-01T13:40:00.000Z" }, objects: [object],
      child_verbs: [data.recent_contributions[1]], evaluations: [{ evaluator_agent_id: "dirty-3", actual_importance: 80, potential_importance: 90, estimated_priority: 85, novelty_milli: 800, convergence_flag: 0, rationale: dirty("Rationale") }],
    }),
    "dirty /w/<worker>": dash.renderWorkerProfileHtml(BASE, { worker_uuid: "w_dirty_1_8ffbf268", worker: data.workers[0], tasks: [data.recent_contributions[0]], objects: [data.recent_objects[0]], reputation: { total_cred_points: 3, unblock_bonus_points: 1, badge_details: [{ label: dirty("Badge"), rule: dirty("Rule") }] } }),
    "dirty /starter": help.renderStarterHubHtml(BASE, catalog),
    "dirty /q/demo/<key>": demo.renderInteractiveDemoPageHtml(BASE, { ...object, summary: dirty("Demo"), payload: { interactive_demo: { title: dirty("Demo title"), steps: [{ title: "a", caption: "b" }] } } }),
  };
}

// The real Worker, with an in-memory database, answering the public routes.
class SqliteStmt {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new SqliteStmt(this.sqlite, this.sql, args); }
  async run() { const res = this.sqlite.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(res.changes ?? 0) } }; }
  async first() { const row = this.sqlite.prepare(this.sql).get(...this.args); return row ? { ...row } : null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
}
function inMemoryD1(DatabaseSync) {
  const sqlite = new DatabaseSync(":memory:");
  return {
    sqlite,
    prepare: (sql) => new SqliteStmt(sqlite, sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    hasTable(name) { return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)); },
  };
}

function publicRoutes() {
  const gateway = fs.readFileSync(path.join(ROOT, "deploy/cloudflare/priority_work_gateway.js"), "utf8");
  const actions = new Set([...gateway.matchAll(/action === "([a-z][a-z0-9_.\-]*)"/g)].map((m) => m[1]));
  const routes = new Set([
    "/", "/connect", "/connect.json", "/healthz", "/llms.txt", "/llms-full.txt", "/.well-known/agent-card.json", "/api/conversation-schema",
    "/preview.js", "/robots.txt", "/favicon.svg", "/agent-start.json", "/agent-start.css", "/agent-start.js", "/starter", "/starter?format=json",
    "/prompts", "/prompts?format=json", "/get-started", "/dashboard", "/dashboard?format=json", "/dashboard.js", "/prompts.js", "/help", "/chat", "/status", "/health",
    "/feedback", "/q", "/c/nothing_here", "/w/w_nothing_here", "/q/demo/nothing_here",
  ]);
  for (const action of actions) routes.add(`/q/${action}`);
  return [...routes].sort();
}

async function workerRoutes(problems) {
  const { DatabaseSync } = await import("node:sqlite");
  const { default: worker } = await load("deploy/cloudflare/worker.js");
  const prompts = await load("deploy/cloudflare/prompts_page.js");
  const env = { STORAGE_MODE: "cloud", HERMA_DB: inMemoryD1(DatabaseSync), PUBLIC_URL: BASE };
  const routes = publicRoutes();
  for (const p of prompts.buildPromptCatalog(BASE)) {
    routes.push(`/prompts/raw/${p.id}`);
    if (p.alias) routes.push(`/prompts/raw/${p.alias}`);
  }
  let fetched = 0;
  for (const route of routes) {
    try {
      const response = await Promise.race([
        worker.fetch(new Request(BASE + route, { headers: { accept: "text/html,application/json" } }), env, { waitUntil() {} }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 15 s")), 15000)),
      ]);
      const body = await response.text();
      fetched += 1;
      const type = response.headers.get("content-type") || "";
      problems.push(...(type.includes("text/html") ? pageProblems(`worker ${route}`, body) : dataProblems(`worker ${route}`, body)));
    } catch (error) {
      problems.push(`worker ${route}: could not be fetched (${String(error.message).split("\n")[0]})`);
    }
  }
  return fetched;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean).filter((f) => !/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf)$/i.test(f) && !f.startsWith("node_modules/") && f !== "package-lock.json" && f !== "uv.lock");
}

export async function runGate() {
  const problems = [];
  const fetched = await workerRoutes(problems);
  const site = await fixturePages();
  for (const [route, html] of Object.entries(site.pages)) problems.push(...pageProblems(`fixture ${route}`, html));
  for (const [route, text] of Object.entries(site.scripts)) problems.push(...dataProblems(`fixture ${route}`, text));
  for (const [name, html] of Object.entries(await dirtyPages())) problems.push(...pageProblems(name, html));
  let files = 0;
  for (const file of trackedFiles()) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    files += 1;
    problems.push(...dataProblems(`file ${file}`, text));
  }
  return { problems: [...new Set(problems)], fetched, pages: Object.keys(site.pages).length, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && !process.argv.includes("--pages")) {
  const { problems, fetched, pages, files } = await runGate();
  if (problems.length) {
    console.error(`release gate FAILED (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`release gate passed: ${fetched} Worker routes, ${pages} fixture pages, 5 pages rendered from dirty worker text, ${files} files`);
}

/** For tests: `node scripts/release_gate.mjs --pages` reads {name: html} from stdin and prints the problems as JSON. */
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--pages")) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const pages = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(pages).map(([name, html]) => [name, pageProblems(name, html)]))));
  process.exit(0);
}
