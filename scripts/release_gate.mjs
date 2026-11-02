// The banned-word gate for a release (MUST-FOLLOW rule 16): what Herma serves must pass the ONE shared banned-word list, even
// when the worker-written text its pages show holds all of it. It runs before every deploy (scripts/check_release.py calls it,
// and wrangler runs that from build.command) and fails closed: a missing list, or a route that cannot be fetched, is a failure.
//
//   node scripts/release_gate.mjs        exit 0 when every surface is clean, 1 otherwise
//
// It reads the list from outside this repository (scripts/banned_list.mjs; nothing here spells a banned word) and checks:
//   1. the real Worker, run with an in-memory database, answering every public route (pages, JSON, text, scripts);
//   2. every page rendered from the fixtures in tests/fixtures/pages;
//   3. the same pages rendered from worker-written text that is full of banned words, ids and hashes (the display-time
//      filter must clean them; stored records are never touched). The text comes from the samples kept next to the list, and
//      every sample must itself trip the list, so this check can never pass for lack of anything to find;
//   4. every tracked source file, for the words that are banned everywhere and for private names.
// Anything served: the `always` patterns, the agent-app patterns, and private names (each word token hashed and compared).
// A page, in addition: the `visible_text` patterns, on its prose (text shown as code is an identifier and is left out, as the live watchdog does).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileList, ensureGenerated, privateTokens } from "./banned_list.mjs";
import { inMemoryD1 } from "./memory_d1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://herma.ta-amps.workers.dev";
const EM_DASH = String.fromCharCode(0x2014);

let INPUTS;
let RULES;
try {
  INPUTS = ensureGenerated();
  RULES = compileList(INPUTS.list);
} catch (error) {
  console.error(`release gate FAILED: ${error.message}`);
  process.exit(1);
}

const mask = (text) => {
  const word = String(text).trim().slice(0, 24);
  return word ? `${word[0]}${"*".repeat(Math.max(word.length - 1, 0))}` : "";
};
const BLOCK_TAGS = "address|article|aside|blockquote|br|caption|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|option|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul";

function stripNonText(html) {
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ta-agent-banner[\s\S]*?<\/ta-agent-banner>/gi, " ");
}
function decode(text) {
  return text.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Text shown as code is an identifier (a path, a field, a command), which the list allows; the live watchdog leaves these elements out too.
const CODE_LIKE = /<(code|pre|kbd|samp|tt|var)\b[^>]*>[\s\S]*?<\/\1>/gi;
const withoutCode = (html) => String(html).replace(CODE_LIKE, " ");

/** What a reader sees and a grep over the page finds: no scripts, styles or the banner's data. `prose` also leaves out text shown as code. */
export function visibleText(html, { prose = false } = {}) {
  const kept = prose ? withoutCode(stripNonText(html)) : stripNonText(html);
  return decode(kept.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}
/** The prose in lines, broken where a block element starts or ends (what a reader sees as separate lines). */
export function visibleLines(html) {
  const marked = withoutCode(stripNonText(html)).replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  return decode(marked.replace(/<[^>]+>/g, " ")).split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** A link's address names a record by its id, so it may hold what the record is called; the words people read may not. */
function withoutAddresses(html) {
  return String(html).replace(/\s(?:href|src|action|data-[a-z-]+)="[^"]*"/gi, " ");
}

function matchProblems(name, text, rules, what) {
  const problems = [];
  for (const rule of rules) {
    const hit = rule.re.exec(text);
    if (hit) problems.push(`${name}: ${what} (${rule.group} #${rule.index}, near "${mask(hit[0])}")`);
  }
  return problems;
}

/** Rules for anything served: pages, JSON, text and scripts. */
export function dataProblems(name, text) {
  const problems = [
    ...matchProblems(name, text, RULES.always, "uses a word that is banned everywhere"),
    ...matchProblems(name, text, RULES.apps, "names an agent app (agent apps appear only on Models used)"),
  ];
  if (privateTokens(text, RULES.privateSha256).length) problems.push(`${name}: contains a private name`);
  return problems;
}

/** Rules for a page: the data rules, plus the visible-text patterns on what a reader sees, and no em dash. */
export function pageProblems(name, html) {
  const problems = dataProblems(name, withoutAddresses(html));
  const text = visibleText(html, { prose: true });
  const lines = visibleLines(html);
  for (const rule of RULES.visible) {
    const wholeLine = rule.source.startsWith("^") && rule.source.endsWith("$");
    if (wholeLine) {
      if (lines.some((line) => rule.re.test(line))) problems.push(`${name}: a line is only a banned label (${rule.group} #${rule.index})`);
    } else {
      problems.push(...matchProblems(name, text, [rule], "shows banned wording"));
    }
  }
  if (html.includes(EM_DASH)) problems.push(`${name}: has an em dash`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Worker-written text that breaks every rule on purpose, built from the samples that sit next to the list.
// ---------------------------------------------------------------------------------------------------------------

function samples() {
  const list = Array.isArray(INPUTS.neutral.samples) ? INPUTS.neutral.samples.map(String).filter(Boolean) : [];
  if (!list.length) throw new Error("the neutral rules hold no samples of banned worker text (the dirty-page check would find nothing)");
  return list;
}

/** Every sample must itself be caught by the list when it is put on a page as it is; otherwise the check below proves nothing. */
function sampleProblems() {
  const problems = [];
  for (const [i, sample] of samples().entries()) {
    const page = `<main><p>${sample}</p></main>`;
    if (!pageProblems(`sample ${i}`, page).length) problems.push(`sample ${i} of banned worker text is not caught by the list (it would make the dirty-page check vacuous)`);
  }
  return problems;
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Worker-written text: every sample, then ids, a hash and an em dash, under a label. */
function dirty(label) {
  return [`${label}: ${samples().join(". ")}`, "see verb_evl_d900e706b470 and w_musehermawor_8ffbf268 and 9699abcdef0123456789abcd", `one${EM_DASH}two`].join(". ");
}

function dirtyDashboard() {
  const all = samples();
  const worker = (i) => ({
    worker_uuid: `w_dirty_${i}_8ffbf268`, agent_id: `dirty-${i}`, persona_label: all[i % all.length], specialty_lens: dirty("Lens"),
    iteration_count: 3, ngo_completed: 1, eval_completed: 1, own_completed: 1, last_task_id: "verb_evl_d900e706b470", profile_count: 2, harness_tier: "tier_2_sandboxed_chat_worker",
  });
  const contribution = (i) => ({
    task_id: `verb_own_${"b4e012efd371"}`, tier: "public_general", verb_kind: "worker_self_directed", state: "done", title: all[i % all.length], prompt: dirty("Prompt"),
    result_summary: dirty("Summary"), producer_agent: `dirty-${i}`, completed_by: `dirty-${i}`, generation_depth: 1, opt_goal: slug(all[0]), receipt_hash: "f5b0937dcf4490189cd0df3e37f927396496c7055e3cd0ec1dd250de0a7bbb67", updated_at: "2026-11-01T13:49:37.068Z",
  });
  const object = (i) => ({
    object_key: `dirty_object_${i}_${"9f3a2b1c4d5e6f7a"}`, category: slug(all[i % all.length]), summary: all[i % all.length], producer_agent: `dirty-${i}`, worker_uuid: `w_dirty_${i}_8ffbf268`,
    quality_milli: 900, novelty_milli: 700, eval_count: 2, chunk_count: 3, total_payload_bytes: 4096, sha256_hash: "28ceb44925f59693b7144e05c852eccccc849de01bdd9120ae800d6ba7e80e61", deliverable_kind: "portable_agent_kit",
  });
  const each = (make) => all.map((_, i) => make(i));
  return {
    registered_workers: 12, distinct_contributor_agents: 3, total_evaluations: 4, indexed_sidecar_docs: 5, total_objects: 6, total_object_bytes: 7000, total_chunks: 3,
    queue_counts_by_tier: { ngo_priority: { ready: 1, leased: 0, done: 2 }, public_general: { ready: 3, leased: 1, done: 4 } },
    workers: each(worker), recent_contributions: each(contribution), recent_objects: each(object),
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
  const engine = await load("deploy/cloudflare/herma_engine.js");
  const data = dirtyDashboard();
  const all = samples();
  const object = { ...data.recent_objects[0], payload: { files: { [`${slug(all[0])}_${"a1b2c3d4e5f6a7b8"}.py`]: "x" }, note: dirty("Payload") }, payload_sha256_verified: true, has_interactive_demo: true };
  const catalog = {
    quick_start_workflow: [{ step: 1, title: dirty("Step"), detail: dirty("Detail") }],
    starter_frameworks: { python_zero_dep_client: "print(1)", curl_and_js_fetch: "curl x", local_verification_harness: "echo y", help_query_example: { payload: { a: 1 } } },
    reusable_object_catalog: { schemas_and_contracts: data.recent_objects.map((o) => ({ object_key: o.object_key, summary: o.summary, review_status: "peer_reviewed", quality_milli: 900, permalink_url: "/c/x", pinned_url: "/q/object/x", object_url: "/q/object/x" })) },
  };
  const searchAnswer = {
    total_matches: all.length,
    results: all.map((sample, i) => ({ id: `dirty_object_${i}_9f3a2b1c4d5e6f7a`, artifact_kind: i % 2 ? "task_object" : "task", title: sample, summary: dirty("Result"), opt_goal: slug(sample), prog_lang: "Python_3_12_Stdlib", deliverable_kind: "portable_agent_kit" })),
  };
  // The starter provisions and context entries on the home page come from stored records too.
  const provisions = all.map((sample, i) => ({
    version: 1, source_store: "system_builtin",
    provision: { prov_id: `PROV-DIRTY-${i}`, title: sample, action: "shim_context", context_refs: [], triggers: { mode: "any", keyword: { terms: ["x"] } }, uris: [], priority: 5 },
  }));
  const entries = all.map((sample, i) => ({ entry_id: `detail:dirty.${i}`, kind: "detail", title: sample, summary: dirty("Summary"), source_uri: null }));
  return {
    "dirty /": engine.renderOverviewHtml(provisions, [], BASE, entries, null),
    "dirty /dashboard": dash.renderDashboardHtml(BASE, data),
    "dirty /dashboard?q=": dash.renderDashboardHtml(BASE, data, { params: { q: "a search" }, answer: searchAnswer }),
    "dirty /dashboard?fragment=results": dash.renderSearchResultsHtml(searchAnswer),
    "dirty /c/<task>": dash.renderContributionPermalinkHtml(BASE, {
      lookup_id: "x", task: { ...data.recent_contributions[0], parent_task_id: "verb_x_9f3a2b1c4d5e", created_at: "2026-11-01T13:40:00.000Z" }, objects: [object],
      child_verbs: data.recent_contributions.slice(1), evaluations: [{ evaluator_agent_id: "dirty-3", actual_importance: 80, potential_importance: 90, estimated_priority: 85, novelty_milli: 800, convergence_flag: 0, rationale: dirty("Rationale") }],
    }),
    "dirty /w/<worker>": dash.renderWorkerProfileHtml(BASE, { worker_uuid: "w_dirty_1_8ffbf268", worker: data.workers[0], tasks: data.recent_contributions, objects: data.recent_objects, reputation: { total_cred_points: 3, unblock_bonus_points: 1, badge_details: [{ label: all[0], rule: dirty("Rule") }] } }),
    "dirty /starter": help.renderStarterHubHtml(BASE, catalog),
    // The name an ASCII mesh carries (first and last line) is contributed text too: it must come out of the page's data island clean.
    "dirty /q/demo/<key>": demo.renderInteractiveDemoPageHtml(BASE, {
      ...object, summary: dirty("Demo"),
      payload: {
        interactive_demo: { title: dirty("Demo title"), steps: [{ title: "a", caption: "b" }] },
        stl_ascii: `solid ${all[0]}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid ${all[0]}\n`,
        files: { "mesh.stl": `solid ${all[0]}\nendsolid ${all[0]}\n` },
      },
    }),
  };
}

// The real Worker, with an in-memory database, answering the public routes.

function publicRoutes() {
  const gateway = fs.readFileSync(path.join(ROOT, "deploy/cloudflare/priority_work_gateway.js"), "utf8");
  const actions = new Set([...gateway.matchAll(/action === "([a-z][a-z0-9_.\-]*)"/g)].map((m) => m[1]));
  const routes = new Set([
    "/", "/connect", "/connect.json", "/healthz", "/llms.txt", "/llms-full.txt", "/.well-known/agent-card.json", "/api/conversation-schema",
    "/preview.js", "/robots.txt", "/favicon.svg", "/agent-start.json", "/agent-start.css", "/agent-start.js", "/starter", "/starter?format=json",
    "/prompts", "/prompts?format=json", "/get-started", "/dashboard", "/dashboard?format=json", "/dashboard.js", "/prompts.js", "/help", "/chat", "/status", "/health",
    "/dashboard?q=shelter&fragment=results", "/dashboard?q=shelter", "/dashboard?fragment=results",
    "/feedback", "/q", "/c/nothing_here", "/w/w_nothing_here", "/q/demo/nothing_here",
    "/kits", "/kits?format=json", "/kits.js", "/kits/package.json", "/kits/mcp-manifest.json", "/kits/SKILL.md", "/kits/bootstrap.sh",
    "/kits/herma_shim.py", "/kits/worker_distributed_indexer.py", "/kits/pretool_guard.py", "/kits/herma-agent-kit.tgz", "/kits/herma-worker-kit.zip",
    "/experiments", "/reprioritize",
  ]);
  for (const action of actions) routes.add(`/q/${action}`);
  return [...routes].sort();
}

async function workerRoutes(problems) {
  const { default: worker } = await load("deploy/cloudflare/worker.js");
  const prompts = await load("deploy/cloudflare/prompts_page.js");
  const env = { STORAGE_MODE: "cloud", HERMA_DB: await inMemoryD1(), PUBLIC_URL: BASE };
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
  const problems = [...sampleProblems()];
  if (problems.length) return { problems, fetched: 0, pages: 0, dirty: 0, files: 0 };
  const fetched = await workerRoutes(problems);
  const site = await fixturePages();
  for (const [route, html] of Object.entries(site.pages)) problems.push(...pageProblems(`fixture ${route}`, html));
  for (const [route, text] of Object.entries(site.scripts)) problems.push(...dataProblems(`fixture ${route}`, text));
  const dirtyRendered = await dirtyPages();
  for (const [name, html] of Object.entries(dirtyRendered)) problems.push(...pageProblems(name, html));
  let files = 0;
  for (const file of trackedFiles()) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    files += 1;
    problems.push(...dataProblems(`file ${file}`, text));
  }
  return { problems: [...new Set(problems)], fetched, pages: Object.keys(site.pages).length, dirty: Object.keys(dirtyRendered).length, files };
}

const asPages = process.argv.includes("--pages");
const asData = process.argv.includes("--data");

if (process.argv[1] === fileURLToPath(import.meta.url) && !asPages && !asData) {
  const { problems, fetched, pages, dirty: dirtyCount, files } = await runGate();
  if (problems.length) {
    console.error(`release gate FAILED (${problems.length}):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `release gate passed (list version ${INPUTS.list.version}, ${INPUTS.source}): ${fetched} Worker routes, ${pages} fixture pages, ${dirtyCount} renderings of worker text full of banned items, ${files} files`
  );
}

/**
 * For tests and the live scan: `--pages` reads {name: html} from stdin and `--data` reads {name: text} (JSON, plain text, scripts),
 * and each prints the problems as JSON, {name: [problem]}. The words themselves are never printed.
 */
if (process.argv[1] === fileURLToPath(import.meta.url) && (asPages || asData)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const items = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const check = asPages ? pageProblems : dataProblems;
  console.log(JSON.stringify(Object.fromEntries(Object.entries(items).map(([name, text]) => [name, check(name, text)]))));
  process.exit(0);
}
