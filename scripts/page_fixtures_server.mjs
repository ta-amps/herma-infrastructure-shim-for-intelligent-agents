// Serves every public Herma page from small fixtures, with the real static assets, so a browser can check the look
// without D1, the network or a deploy. Used by scripts/light_check.mjs (`make light-check`); the pages are rendered by
// the Worker's own page modules, so what the browser sees is what the Worker serves for the same data.
//
//   node scripts/page_fixtures_server.mjs          (listens on 127.0.0.1:7788 and prints its routes)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureGenerated } from "./banned_list.mjs";

// The page modules import the git-ignored word-list module. Make sure it exists; with no shared list on this machine the made-up one stands in.
ensureGenerated({ fixtureOk: true });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests/fixtures/pages");
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
const BASE = "https://shim.teleionlabs.com";

export const PAGE_ROUTES = [
  "/",
  "/shim",
  "/connect",
  "/starter",
  "/prompts",
  "/get-started",
  "/trust",
  "/dashboard",
  "/discover",
  "/models",
  "/c/portable_autonomous_worker_agent_kit_v1",
  "/c/verb_evl_d900e706b470",
  "/c/nothing_here",
  "/w/w_agent_muse-worker-01",
  "/w/w_missing",
  "/c/agent/muse-worker-01",
  "/c/agent/nobody-here",
  "/c/task/verb_evl_d900e706b470",
  "/c/task/nothing_here",
  "/q/demo/demo_dual_side_hybrid_search_v1",
  "/kits",
];

// The same policy the Worker sends with every page (DEFAULT_CSP_PAGE in deploy/cloudflare/worker.js; a test keeps them equal),
// so a blocked script, style or font shows up as a console error in the browser checks.
export const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const MIME = { ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".txt": "text/plain", ".svg": "image/svg+xml" };

/** Every page and script, rendered from the fixtures: `{ pages: {route: html}, scripts: {route: text}, dashboard }`. */
export async function renderSite() {
  const dash = await load("deploy/cloudflare/dashboard_and_permalinks.js");
  const discover = await load("deploy/cloudflare/discover_gallery.js");
  const modelsHub = await load("deploy/cloudflare/weight_space_model_hub.js");
  const prompts = await load("deploy/cloudflare/prompts_page.js");
  const demo = await load("deploy/cloudflare/demo_page.js");
  const help = await load("deploy/cloudflare/worker_help_and_starter.js");
  const kits = await load("deploy/cloudflare/worker_kits_and_mutation_grid.js");
  const site = await load("deploy/cloudflare/site_pages.js");
  const kitBundle = await kits.buildWorkerKitArtifacts(BASE);
  const kitsDoc = { kits: kitBundle.catalogItems, recommended_pitch: kits.HERMA_PROMPT_KIT_MUTATION_GRID.pitch_templates.recommended_infra_leverage };
  const engine = await load("deploy/cloudflare/herma_engine.js");
  const shell = await load("deploy/cloudflare/page_shell.js");

  const dashboard = read("dashboard.json");
  const kit = read("contribution_kit.json");
  const worker = { ...read("worker.json"), reputation: { total_cred_points: 39, unblock_bonus_points: 24, badge_details: [{ label: "Unblocker", rule: "Cracked a blocked Task for another worker" }] } };
  const pulse = {
    queue_counts_by_tier: dashboard.queue_counts_by_tier,
    worker_fleet: { registered_workers: dashboard.registered_workers, total_evaluations: dashboard.total_evaluations },
    queue_embodiments: { hybrid_search_sidecar: { indexed_unique_contents: dashboard.indexed_sidecar_docs } },
  };
  const taskContribution = {
    ...kit,
    lookup_id: "verb_evl_d900e706b470",
    task: { ...dashboard.recent_contributions[0], parent_task_id: "verb_own_b4e012efd371", created_at: "2026-11-01T13:40:00.000Z", producer_worker_uuid: "w_agent_muse-worker-01" },
    child_verbs: dashboard.recent_contributions.slice(1, 3),
  };

  const agentPages = await load("deploy/cloudflare/agent_pages.js");
  const agentData = {
    found: true, agent_id: "muse-worker-01", page: 1, per_page: 20,
    counts: { task_objects: 2, tasks_submitted: 1, tasks_claimed: 1, tasks_started: 1, tasks_given_back: 1, evaluations_given: 1, hub_turns: 1, worker_sessions: 1 },
    task_objects: dashboard.recent_objects.slice(0, 2).map((o) => ({ object_key: o.object_key, version_num: 1, title: o.object_key, type: o.category, summary: o.summary, created_at: o.created_at, review_state: "unreviewed" })),
    tasks: dashboard.recent_contributions.slice(0, 2).map((t, i) => ({ task_id: t.task_id, title: t.title, kind: "Shared Task", state: t.state, updated_at: t.updated_at, label: i ? "Claimed it" : "Submitted it" })),
    tasks_given_back: [{ task_id: "verb_ngo_447e62c516e9", title: "A note that needs an archive copy", kind: "Nonprofit Task", state: "ready", reason: "Source blocked", detail: "The Task needs a page outside the allowed hosts.", given_back_at: "2026-11-06T12:00:00.000Z" }],
    evaluations_given: [{ target_kind: "object", target_id: dashboard.recent_objects[0].object_key, target_title: "A schema", worth_now: 80, worth_later: 90, priority: 70, novelty_milli: 700, rationale: "Clear and reusable.", created_at: "2026-11-06T12:00:00.000Z" }],
    hub_turns: [{ channel_id: "warm-agent-hub", direction: "Reply", summary: "Measured the hello time three times.", created_at: "2026-11-06T12:00:00.000Z" }],
    worker_sessions: [{ worker_uuid: "w_agent_muse-worker-01", label: "Worker", runs: 3, updated_at: "2026-11-06T12:00:00.000Z" }],
    next_page: 2,
  };
  const taskData = {
    found: true,
    task: { task_id: "verb_evl_d900e706b470", title: dashboard.recent_contributions[0].title, kind: "Review", state: "done", prompt: "Check the schema and say what is missing.", result_summary: dashboard.recent_contributions[0].result_summary, started_by: "muse-worker-02", submitted_by: "muse-worker-01", created_at: "2026-11-01T13:40:00.000Z", updated_at: "2026-11-01T13:49:37.068Z" },
    follows: { task_id: "verb_own_b4e012efd371", title: "The Task before" },
    task_objects: dashboard.recent_objects.slice(0, 1).map((o) => ({ object_key: o.object_key, version_num: 1, title: o.object_key, type: o.category, summary: o.summary, created_at: o.created_at, review_state: "reviewed", made_by: "muse-worker-01" })),
    follow_up_tasks: dashboard.recent_contributions.slice(1, 3).map((t) => ({ task_id: t.task_id, title: t.title, kind: "Shared Task", state: t.state, updated_at: t.updated_at })),
    attempts: [{ agent_id: "muse-worker-03", outcome_label: "Released blocked", reason: "Source blocked", detail: "Gave it back.", created_at: "2026-11-01T13:30:00.000Z" }],
    reviews: [{ evaluator_agent_id: "muse-worker-02", worth_now: 80, worth_later: 85, priority: 70, novelty_milli: 600, rationale: "Good.", created_at: "2026-11-01T14:00:00.000Z" }],
  };

  const discoverState = await discover.queryDiscoverCatalog(null, BASE, {});
  const modelsCatalog = await modelsHub.queryWeightModelCatalog(null, BASE, {});
  const pages = {
    "/": () => site.renderHomeHtml(read("home_totals.json")),
    "/shim": () => engine.renderOverviewHtml([], [], BASE, [], null),
    "/connect": () => engine.renderConnectHtml(BASE),
    "/starter": () => help.renderStarterHubHtml(BASE, read("starter.json")),
    "/prompts": () => prompts.renderPromptsPageHtml(BASE, pulse, {}),
    "/get-started": () => site.renderGetStartedHtml(),
    "/trust": () => site.renderTrustHtml(),
    "/dashboard": () => dash.renderDashboardHtml(BASE, dashboard),
    "/discover": () => discover.renderDiscoverHtml(BASE, discoverState),
    "/models": () => modelsHub.renderModelsHubHtml(BASE, modelsCatalog),
    "/c/portable_autonomous_worker_agent_kit_v1": () => dash.renderContributionPermalinkHtml(BASE, kit),
    "/c/verb_evl_d900e706b470": () => dash.renderContributionPermalinkHtml(BASE, taskContribution),
    "/c/nothing_here": () => dash.renderContributionPermalinkHtml(BASE, { lookup_id: "nothing_here", task: null, objects: [] }),
    "/w/w_agent_muse-worker-01": () => dash.renderWorkerProfileHtml(BASE, worker),
    "/w/w_missing": () => dash.renderWorkerProfileHtml(BASE, { worker_uuid: "w_missing", worker: null, tasks: [], objects: [] }),
    "/c/agent/muse-worker-01": () => agentPages.renderAgentPageHtml(BASE, agentData),
    "/c/agent/nobody-here": () => agentPages.renderAgentPageHtml(BASE, { found: false, agent_id: "nobody-here" }, "nobody-here"),
    "/c/task/verb_evl_d900e706b470": () => agentPages.renderTaskPageHtml(BASE, taskData),
    "/c/task/nothing_here": () => agentPages.renderTaskPageHtml(BASE, { found: false, task_id: "nothing_here" }, "nothing_here"),
    "/q/demo/demo_dual_side_hybrid_search_v1": () => demo.renderInteractiveDemoPageHtml(BASE, read("demo_object.json")),
    "/kits": () => kits.renderKitsCatalogHtml(BASE, kitsDoc),
  };
  const scripts = {
    "/q/dashboard.js": () => dash.renderDashboardJs(),
    "/q/prompts.js": () => prompts.renderPromptsPageJs(),
    "/q/demo-runner.js": () => demo.renderInteractiveDemoRunnerJs(),
    "/discover.js": () => discover.renderDiscoverJs(),
    "/kits.js": () => kits.renderKitsClientJs(),
    "/preview.js": () => engine.PREVIEW_JS,
    "/favicon.svg": () => shell.FAVICON_SVG,
    "/llms.txt": () => "llms",
  };

  const rendered = {};
  for (const [route, make] of Object.entries(pages)) rendered[route] = make();
  const renderedScripts = {};
  for (const [route, make] of Object.entries(scripts)) renderedScripts[route] = make();
  return { pages: rendered, scripts: renderedScripts, makers: { pages, scripts }, dashboard, dash };
}

export async function start(port = 7788) {
  const { makers, dashboard, dash } = await renderSite();
  const pages = makers.pages;
  const scripts = makers.scripts;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixtures");
    const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
    if (url.pathname.startsWith("/assets/")) {
      const file = path.join(ROOT, "herma/static", url.pathname);
      if (file.startsWith(path.join(ROOT, "herma/static")) && fs.existsSync(file)) {
        return send(200, MIME[path.extname(file)] || "application/octet-stream", fs.readFileSync(file));
      }
      return send(404, "text/plain", "missing asset");
    }
    // The Worker runs the search on the server and renders the results there: /dashboard?q=...&fragment=results returns just the
    // results, /dashboard?q=... the whole page with them in place.
    if (url.pathname === "/dashboard" && (url.searchParams.get("q") || url.searchParams.get("fragment"))) {
      const results = dashboard.recent_objects.slice(0, 5).map((o, i) => ({ id: o.object_key, artifact_kind: i % 2 ? "task_object" : "task", title: o.object_key, summary: o.summary, opt_goal: o.opt_goal, prog_lang: o.prog_lang, deliverable_kind: o.deliverable_kind }));
      const answer = url.searchParams.get("q") ? { total_matches: 31, results } : null;
      if (url.searchParams.get("fragment") === "results") return send(200, "text/html; charset=utf-8", dash.renderSearchResultsHtml(answer));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP });
      return res.end(dash.renderDashboardHtml(BASE, dashboard, { params: { q: url.searchParams.get("q") }, answer }));
    }
    const script = scripts[url.pathname];
    if (script) return send(200, `${MIME[path.extname(url.pathname)] || "text/javascript"}; charset=utf-8`, script());
    const make = pages[decodeURIComponent(url.pathname)];
    if (make) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP });
      return res.end(make());
    }
    return send(404, "text/plain", "not routed in the fixtures server");
  });
  // The wanted port, or a free one when another run (another session, another check) already holds it: the checks must not fail closed on a busy port.
  const listen = (wanted) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(wanted, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  try {
    await listen(port);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    await listen(0);
  }
  return { server, port: server.address().port, routes: PAGE_ROUTES };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { routes, port } = await start(Number(process.env.PORT || 7788));
  console.log(`http://127.0.0.1:${port}\n  ${routes.join("\n  ")}`);
}
