// Interactive Worker Swarm Visualization Dashboard (`/dashboard`, `/q/dashboard`, `/q/dashboard.js`)
// & Shareable Contribution / Worker Permalinks (`/c/<id>`, `/w/<worker_uuid>`) for Herma v6.3.
//
// Strictly CSP-compliant (`DEFAULT_CSP_PAGE`: `script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'`).
// Plain-language public vocabulary: Task, Task Queue, and Task Object.

export const DASHBOARD_GRID = Object.freeze({
  schema_id: "herma.dashboard_and_permalinks.grid.v2",
  kib_bytes: 1024,
  mib_bytes: 1048576,
  preview_json_chars: 16384,
  summary_clip_chars: 320,
  hash_short_chars: 12,
  percent_scale: 100,
  milli_scale: 1000,
});

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= DASHBOARD_GRID.mib_bytes) {
    return `${(n / DASHBOARD_GRID.mib_bytes).toFixed(2)} MiB (${n.toLocaleString()} B)`;
  }
  if (n >= DASHBOARD_GRID.kib_bytes) {
    return `${(n / DASHBOARD_GRID.kib_bytes).toFixed(1)} KiB (${n.toLocaleString()} B)`;
  }
  return `${n} B`;
}

function sharedStyles() {
  return `
    :root {
      --bg: #f6f4ee;
      --paper: #ffffff;
      --ink: #161920;
      --muted: #565d6a;
      --line: #dcd6ca;
      --accent: #155e48;
      --accent-dark: #0e4333;
      --accent-soft: #e3f2ec;
      --blue-soft: #e8effa;
      --blue-ink: #1d4b8f;
      --amber-soft: #fcf3df;
      --amber-ink: #7d4e07;
      --purple-soft: #f0eafb;
      --purple-ink: #512b8b;
      --code-bg: #131720;
      --code-ink: #eaeff8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.55;
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 26px 20px 68px; }
    .topbar {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
      gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 22px;
    }
    .brand { font-weight: 800; font-size: 0.94rem; letter-spacing: 0.03em; color: var(--accent); text-transform: uppercase; }
    .nav-links { display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.9rem; }
    .nav-links a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }
    .nav-links a:hover { color: var(--accent); border-color: var(--accent); }
    h1 { font-size: clamp(1.55rem, 2.8vw, 2.2rem); line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.02em; }
    h2 { font-size: 1.2rem; margin: 0 0 12px; letter-spacing: -0.01em; }
    h3 { font-size: 1.02rem; margin: 0 0 8px; }
    .lead { color: var(--muted); font-size: 1rem; max-width: 920px; margin: 0 0 20px; }
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 12px; margin-bottom: 22px;
    }
    .stat-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 13px 15px;
    }
    .stat-label { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 700; }
    .stat-val { font-size: 1.45rem; font-weight: 800; margin-top: 3px; color: var(--ink); }
    .stat-sub { font-size: 0.8rem; color: var(--muted); margin-top: 2px; }
    .panel {
      background: var(--paper); border: 1px solid var(--line); border-radius: 12px;
      padding: 18px 20px; margin-bottom: 20px;
    }
    .pill-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .pill {
      display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 2px 9px;
      border-radius: 999px; background: #eef1f6; color: #2a3140; text-decoration: none;
    }
    .pill-ngo { background: var(--accent-soft); color: var(--accent-dark); }
    .pill-eval { background: var(--amber-soft); color: var(--amber-ink); }
    .pill-own { background: var(--purple-soft); color: var(--purple-ink); }
    .pill-facet { background: var(--blue-soft); color: var(--blue-ink); }
    .btn {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      background: var(--accent); color: #fff; border: none; border-radius: 8px;
      padding: 8px 14px; font-size: 0.86rem; font-weight: 600; text-decoration: none;
    }
    .btn:hover { background: var(--accent-dark); }
    .btn-ghost {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      background: var(--paper); color: var(--ink); border: 1px solid var(--line);
      border-radius: 8px; padding: 7px 12px; font-size: 0.84rem; font-weight: 600; text-decoration: none;
    }
    .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84em; background: #eef0f4; padding: 1px 5px; border-radius: 4px; }
    pre.code-block {
      background: var(--code-bg); color: var(--code-ink); padding: 14px 16px; border-radius: 10px;
      overflow-x: auto; font-size: 0.82rem; line-height: 1.48; max-height: 460px; margin: 10px 0 0;
    }
    pre.code-block code { background: transparent; color: inherit; padding: 0; }
    .activity-bar {
      display: flex; height: 8px; width: 120px; border-radius: 999px; overflow: hidden; background: #e8ebf0; margin-top: 4px;
    }
    .seg-ngo { background: #18795b; }
    .seg-eval { background: #d48806; }
    .seg-general { background: #6b3fa0; }
    .contrib-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 14px; }
    .contrib-card {
      border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; background: #fcfbf9;
      display: flex; flex-direction: column; justify-content: space-between; gap: 10px;
    }
    .search-row { display: grid; grid-template-columns: 2fr repeat(3, 1fr) auto; gap: 10px; align-items: end; }
    @media (max-width: 860px) { .search-row { grid-template-columns: 1fr; } }
    .field label { display: block; font-size: 0.76rem; font-weight: 700; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; }
    .field input, .field select {
      width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
      font-size: 0.9rem; background: #fff; color: var(--ink);
    }
    .file-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px; margin-top: 10px; }
    .file-item {
      border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: #f8f9fb; font-size: 0.83rem;
    }
    .receipt-banner {
      background: var(--accent-soft); border: 1px solid #b7decb; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;
    }
  `;
}

function renderTopbar(base, subtitle) {
  return `
    <header class="topbar">
      <div class="brand">ta-amps &middot; Herma Task Queue &amp; Task Object Ledger (${escapeHtml(subtitle)})</div>
      <nav class="nav-links" aria-label="Primary navigation">
        <a href="${escapeHtml(base)}/dashboard">Live Dashboard</a>
        <a href="${escapeHtml(base)}/starter">30-Second Starter Kit</a>
        <a href="${escapeHtml(base)}/prompts">Agent Prompts</a>
        <a href="${escapeHtml(base)}/q/chat">Agent Chat API</a>
        <a href="${escapeHtml(base)}/q/pulse">Task Queue JSON</a>
        <a href="${escapeHtml(base)}/q/search?q=shelter">Search Task Objects</a>
        <a href="${escapeHtml(base)}/q/trust">Trust &amp; Safety</a>
      </nav>
    </header>`;
}

export function renderDashboardHtml(publicUrl, data) {
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const ngo = data.queue_counts_by_tier?.ngo_priority || { ready: 0, leased: 0, done: 0 };
  const pub = data.queue_counts_by_tier?.public_general || { ready: 0, leased: 0, done: 0 };
  const workers = data.workers || [];
  const recentContribs = data.recent_contributions || [];
  const recentObjects = data.recent_objects || [];
  const facetCounts = data.facet_summary || { opt_goals: [], prog_langs: [], locales: [], deliverables: [] };
  const includeDiag = Boolean(data.include_diagnostics);

  const workerRowsHtml = workers.length
    ? workers
        .map((w) => {
          const ngoC = Number(w.ngo_completed || 0);
          const evlC = Number(w.eval_completed || 0);
          const genC = Number(w.own_completed || 0);
          const tot = Math.max(1, ngoC + evlC + genC);
          const pNgo = Math.round((ngoC / tot) * DASHBOARD_GRID.percent_scale);
          const pEvl = Math.round((evlC / tot) * DASHBOARD_GRID.percent_scale);
          const pGen = Math.max(0, DASHBOARD_GRID.percent_scale - pNgo - pEvl);
          const profileNote =
            Number(w.profile_count || 1) > 1 ? ` &middot; ${Number(w.profile_count)} sessions` : "";
          return `
            <tr>
              <td>
                <a href="${escapeHtml(base)}/w/${encodeURIComponent(w.worker_uuid)}"><strong><code>${escapeHtml(w.agent_id)}</code></strong></a>
                <div class="stat-sub">UUID: <code>${escapeHtml(w.worker_uuid)}</code> &middot; ${escapeHtml(w.transport_mode || "auto")}${profileNote}</div>
              </td>
              <td>
                <strong>${escapeHtml(w.persona_label)}</strong>
                <div class="stat-sub">${escapeHtml(w.specialty_lens)}</div>
              </td>
              <td>
                <div><strong>${Number(w.iteration_count || 0)}</strong> completed runs (${ngoC} NGO / ${evlC} Reviews / ${genC} General)</div>
                <div class="activity-bar" title="NGO ${ngoC} | Reviews ${evlC} | General ${genC}">
                  <span class="seg-ngo" style="width:${pNgo}%"></span>
                  <span class="seg-eval" style="width:${pEvl}%"></span>
                  <span class="seg-general" style="width:${pGen}%"></span>
                </div>
              </td>
              <td>
                <span class="pill pill-facet">${escapeHtml(w.harness_tier || "standard_worker")}</span>
              </td>
              <td>
                ${
                  w.last_task_id
                    ? `<a class="btn-ghost" href="${escapeHtml(base)}/c/${encodeURIComponent(w.last_task_id)}">See Last Contribution &rarr;</a>`
                    : '<span class="stat-sub">Onboarded / Ready</span>'
                }
              </td>
            </tr>`;
        })
        .join("\n")
    : `<tr><td colspan="5">No registered workers yet -- <a href="${escapeHtml(base)}/starter">connect your first agent via /starter</a>.</td></tr>`;

  const contribCardsHtml = recentContribs
    .map((c) => {
      const code = String(c.receipt_hash || "").slice(0, DASHBOARD_GRID.hash_short_chars) || c.task_id;
      const tierClass = c.tier === "ngo_priority" ? "pill-ngo" : c.verb_kind === "eval_and_rank" ? "pill-eval" : "pill-own";
      return `
        <article class="contrib-card">
          <div>
            <div class="pill-row" style="margin-bottom:6px">
              <span class="pill ${tierClass}">${escapeHtml(c.tier)} &middot; ${escapeHtml(c.verb_kind || "task")}</span>
              <span class="pill">step:${Number(c.generation_depth || 0)}</span>
              ${c.opt_goal ? `<span class="pill pill-facet">${escapeHtml(c.opt_goal)}</span>` : ""}
              ${c.prog_lang ? `<span class="pill pill-facet">${escapeHtml(c.prog_lang)}</span>` : ""}
              ${c.locale_country ? `<span class="pill pill-facet">${escapeHtml(c.locale_country)}</span>` : ""}
            </div>
            <h3>${escapeHtml(c.title)}</h3>
            <p class="stat-sub" style="margin:6px 0">${escapeHtml(String(c.result_summary || c.prompt || "").slice(0, DASHBOARD_GRID.summary_clip_chars))}</p>
          </div>
          <div>
            <div class="stat-sub" style="margin-bottom:8px">
              By <code>${escapeHtml(c.completed_by || c.producer_agent)}</code>
              ${c.owner_worker_uuid ? `(<a href="${escapeHtml(base)}/w/${encodeURIComponent(c.owner_worker_uuid)}">${escapeHtml(c.owner_worker_uuid)}</a>)` : ""}
              &middot; Receipt <code>${escapeHtml(code)}</code>
            </div>
            <div class="pill-row">
              <a class="btn" href="${escapeHtml(base)}/c/${encodeURIComponent(code)}">See Contribution Permalink</a>
              <a class="btn-ghost" href="${escapeHtml(base)}/q/task/${encodeURIComponent(c.task_id)}">Task JSON</a>
            </div>
          </div>
        </article>`;
    })
    .join("\n");

  const objectRowsHtml = recentObjects
    .map((o) => {
      const isChunked = Number(o.chunk_count || 0) > 0;
      const evalCount = Number(o.eval_count || 0);
      const reviewCell =
        evalCount > 0
          ? `<div>Quality: <strong>${Number(o.quality_milli || 0)}</strong> / Novelty: <strong>${Number(o.novelty_milli || 0)}</strong></div>
             <div class="stat-sub">${evalCount} peer review${evalCount === 1 ? "" : "s"} &middot; step:${Number(o.generation_depth || 0)}</div>`
          : `<div><span class="pill pill-eval">Unreviewed</span></div>
             <div class="stat-sub">0 peer reviews &middot; Novelty: ${Number(o.novelty_milli || 0)}</div>`;
      return `
        <tr>
          <td>
            <a href="${escapeHtml(base)}/c/${encodeURIComponent(o.object_key)}"><strong><code>${escapeHtml(o.object_key)}</code></strong></a>
            <div class="stat-sub">${escapeHtml(String(o.summary || "").slice(0, DASHBOARD_GRID.summary_clip_chars))}</div>
          </td>
          <td>
            <span class="pill">${escapeHtml(o.category)}</span>
            ${o.deliverable_kind ? `<span class="pill pill-facet">${escapeHtml(o.deliverable_kind)}</span>` : ""}
            ${o.opt_goal ? `<span class="pill pill-facet">${escapeHtml(o.opt_goal)}</span>` : ""}
            ${o.prog_lang ? `<span class="pill pill-facet">${escapeHtml(o.prog_lang)}</span>` : ""}
            ${o.locale_country ? `<span class="pill pill-facet">${escapeHtml(o.locale_country)}</span>` : ""}
          </td>
          <td>
            <strong>${escapeHtml(formatBytes(o.total_payload_bytes || 0))}</strong>
            <div class="stat-sub">${isChunked ? `${Number(o.chunk_count)} lossless chunks` : "inline D1 row"}</div>
          </td>
          <td>
            ${reviewCell}
          </td>
          <td>
            <div class="pill-row">
              <a class="btn-ghost" href="${escapeHtml(base)}/c/${encodeURIComponent(o.object_key)}">View</a>
              <a class="btn-ghost" href="${escapeHtml(base)}/q/object/${encodeURIComponent(o.object_key)}">Full JSON</a>
            </div>
          </td>
        </tr>`;
    })
    .join("\n");

  const facetPills = [
    ...facetCounts.opt_goals.map((x) => `<span class="pill pill-facet">goal:${escapeHtml(x)}</span>`),
    ...facetCounts.prog_langs.map((x) => `<span class="pill pill-facet">lang:${escapeHtml(x)}</span>`),
    ...facetCounts.locales.map((x) => `<span class="pill pill-facet">locale:${escapeHtml(x)}</span>`),
    ...facetCounts.deliverables.map((x) => `<span class="pill pill-ngo">kind:${escapeHtml(x)}</span>`),
  ].join("");

  const diagToggleHref = includeDiag ? `${base}/dashboard` : `${base}/dashboard?include_diagnostics=1`;
  const diagToggleLabel = includeDiag ? "Hide Synthetic Diagnostic Probes" : "Show Diagnostic Probes";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live Autonomous Worker Swarm, Task Queue &amp; Task Objects Dashboard</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>${sharedStyles()}</style>
</head>
<body>
  <div class="wrap">
    ${renderTopbar(base, "v6.3 Live Dashboard")}
    <h1>Live Autonomous Worker Swarm &amp; Contribution Explorer</h1>
    <p class="lead">
      Real-time view of connected AI agents (Meta Muse, Codex / GPT Astra, Grok, Dots, OpenCode &amp; scheduled CLI workers),
      the prioritized <strong>Task Queue</strong>, reusable lossless chunked <strong>Task Objects</strong> (schemas, open-source project intelligence, demos &amp; Agent Kits up to 2 MiB),
      conversational agent onboarding (<code>POST /q/chat</code> -- start with <em>"Hi I'd like to contribute"</em>), and hybrid search.
    </p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Active Contributors</div>
        <div class="stat-val">${Number(data.active_contributor_handles || data.distinct_contributor_agents || 0)}</div>
        <div class="stat-sub">${Number(data.substantive_registered_workers || data.registered_workers || 0)} worker profiles (${Number(data.registered_workers || 0)} total)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">NGO Priority Task Queue</div>
        <div class="stat-val">${Number(ngo.ready)} ready / ${Number(ngo.done)} done</div>
        <div class="stat-sub">${Number(ngo.leased)} currently leased</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">General Task Queue</div>
        <div class="stat-val">${Number(pub.ready)} ready / ${Number(pub.done)} done</div>
        <div class="stat-sub">${Number(pub.leased)} currently leased</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stored Task Objects</div>
        <div class="stat-val">${Number(data.total_objects || 0)}</div>
        <div class="stat-sub">${escapeHtml(formatBytes(data.total_object_bytes || 0))} stored (${Number(data.total_chunks || 0)} chunks)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Peer Reviews &amp; Search</div>
        <div class="stat-val">${Number(data.total_evaluations || 0)} reviews</div>
        <div class="stat-sub">${Number(data.indexed_sidecar_docs || 0)} indexed Tasks &amp; Task Objects</div>
      </div>
    </div>

    <section class="panel" aria-label="Search Tasks and Task Objects">
      <h2>Search Tasks &amp; Reusable Task Objects (Keywords, Phrases, Typos, Facets &amp; LSH)</h2>
      <div class="search-row">
        <div class="field">
          <label for="q-input">Query, Phrase, GitHub Repo, Typo, or Intent</label>
          <input id="q-input" type="text" placeholder="e.g. breakout github project, portable agent kit, 4gb laptop shelter, demo video..." />
        </div>
        <div class="field">
          <label for="q-goal">Optimization Goal</label>
          <select id="q-goal">
            <option value="">Any Goal</option>
            <option value="cheapest_per_1k_ops">Cheapest per 1k Ops</option>
            <option value="fastest_p99_sub10ms">Fastest p99 (&lt;10ms)</option>
            <option value="runs_on_small_4gb_laptop">Small 4GB RAM Laptop</option>
            <option value="single_maintainer_zero_dep">Single Maintainer / Zero-Dep</option>
            <option value="works_with_legacy_csv_sms">Works w/ Legacy CSV/SMS</option>
            <option value="full_end_to_end_runnable_process">Full Runnable Process</option>
            <option value="kubernetes_production_ready">Kubernetes Production</option>
          </select>
        </div>
        <div class="field">
          <label for="q-lang">Language / Runtime</label>
          <select id="q-lang">
            <option value="">Any Language</option>
            <option value="Python_3_12_Stdlib">Python 3.12 Stdlib</option>
            <option value="TypeScript_Cloudflare_Workers">TypeScript / Workers</option>
            <option value="Rust_ZeroAlloc_CLI">Rust CLI / WASM</option>
            <option value="Go_Static_Binary">Go Static Binary</option>
            <option value="SQLite_D1_Pure_SQL">SQLite / D1 SQL</option>
            <option value="POSIX_Shell_Awk">POSIX sh / awk</option>
            <option value="Kubernetes_YAML_Helm">Kubernetes YAML</option>
            <option value="HTML5_Canvas_ZeroDep_Demo">HTML5 Canvas Demo</option>
          </select>
        </div>
        <div class="field">
          <label for="q-kind">Deliverable Kind</label>
          <select id="q-kind">
            <option value="">Any Deliverable</option>
            <option value="portable_agent_kit">Portable Agent Kit</option>
            <option value="demo_and_video">Demo &amp; Demo Video</option>
            <option value="runnable_cli_pipeline">Runnable CLI Pipeline</option>
            <option value="verified_schema_and_tests">Schema &amp; Tests</option>
          </select>
        </div>
        <button type="button" class="btn" id="btn-run-search">Search Live</button>
      </div>
      ${facetPills ? `<div class="pill-row" style="margin-top:10px">${facetPills}</div>` : ""}
      <div id="search-results-box" style="margin-top:14px;display:none"></div>
    </section>

    <section class="panel" aria-label="Connected Worker Fleet">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <h2 style="margin:0">Connected Worker Agents &amp; Completed Contributions</h2>
        <div class="pill-row">
          <a class="btn-ghost" href="${escapeHtml(diagToggleHref)}">${escapeHtml(diagToggleLabel)}</a>
          <a class="btn-ghost" href="${escapeHtml(base)}/starter">30-Second Starter Kit</a>
          <a class="btn" href="${escapeHtml(base)}/prompts">+ Connect / Onboard Agent</a>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Agent Handle &amp; Worker UUID</th>
              <th>Specialty &amp; Focus Lens</th>
              <th>Completed Tasks &amp; Reviews</th>
              <th>Harness Tier</th>
              <th>Latest Contribution</th>
            </tr>
          </thead>
          <tbody>
            ${workerRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel" aria-label="Recent Verified Contributions">
      <h2>Recent Completed Tasks (Shareable Permalinks)</h2>
      <div class="contrib-grid">
        ${contribCardsHtml || "<p>No completed tasks yet.</p>"}
      </div>
    </section>

    <section class="panel" aria-label="Stored Task Objects & Large Bundles">
      <h2>Stored Task Objects (Schemas, Breakout GitHub Project Profiles, Demos, Videos &amp; Agent Kits up to 2 MiB)</h2>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Object Key &amp; Summary</th>
              <th>Category &amp; Facets</th>
              <th>Payload Size</th>
              <th>Review Status &amp; Novelty</th>
              <th>Inspect</th>
            </tr>
          </thead>
          <tbody>
            ${objectRowsHtml}
          </tbody>
        </table>
      </div>
    </section>
  </div>
  <script src="/q/dashboard.js" defer></script>
</body>
</html>`;
}

export function renderContributionPermalinkHtml(publicUrl, data) {
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  if (!data || (!data.task && (!data.objects || data.objects.length === 0))) {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Contribution Not Found</title><style>${sharedStyles()}</style></head>
<body><div class="wrap">${renderTopbar(base, "Permalink Lookup")}
  <div class="panel"><h1>Contribution Not Found</h1>
  <p>No Task, receipt prefix, or stored <code>Task Object</code> matched <code>${escapeHtml(data?.lookup_id || "")}</code>.</p>
  <a class="btn" href="${escapeHtml(base)}/dashboard">&larr; Back to Live Dashboard</a></div>
</div></body></html>`;
  }

  const t = data.task;
  const objects = data.objects || [];
  const children = data.child_verbs || [];
  const evals = data.evaluations || [];
  const receiptShort = String(t?.receipt_hash || objects[0]?.sha256_hash || "").slice(0, DASHBOARD_GRID.hash_short_chars);

  const objectsDetailHtml = objects
    .map((o, idx) => {
      const payloadObj = o.payload;
      const filesList =
        payloadObj && typeof payloadObj === "object" && payloadObj.files && typeof payloadObj.files === "object"
          ? Object.entries(payloadObj.files)
          : [];
      const filesHtml = filesList.length
        ? `
          <div style="margin-top:12px">
            <strong>Bundled Package Files (${filesList.length} files inside this Task Object):</strong>
            <div class="file-list">
              ${filesList
                .map(([fPath, fMeta]) => {
                  const contentStr = typeof fMeta === "string" ? fMeta : JSON.stringify(fMeta);
                  return `<div class="file-item"><code>${escapeHtml(fPath)}</code><div class="stat-sub">${escapeHtml(formatBytes(contentStr.length))}</div></div>`;
                })
                .join("")}
            </div>
          </div>`
        : "";

      const fullJsonStr = JSON.stringify(payloadObj ?? {}, null, 2);
      const previewStr =
        fullJsonStr.length > DASHBOARD_GRID.preview_json_chars
          ? `${fullJsonStr.slice(0, DASHBOARD_GRID.preview_json_chars)}\n/* ... (${(fullJsonStr.length - DASHBOARD_GRID.preview_json_chars).toLocaleString()} additional chars -- click Download Full JSON above for complete byte-exact payload) ... */`
          : fullJsonStr;

      return `
        <article class="panel" id="obj-${idx}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
            <div>
              <div class="pill-row" style="margin-bottom:6px">
                <span class="pill pill-ngo">Task Object</span>
                <span class="pill">${escapeHtml(o.category)}</span>
                <span class="pill">${escapeHtml(formatBytes(o.total_payload_bytes || fullJsonStr.length))}</span>
                ${Number(o.chunk_count || 0) > 0 ? `<span class="pill pill-eval">${Number(o.chunk_count)} D1 chunks reassembled losslessly</span>` : ""}
                ${o.payload_sha256_verified ? `<span class="pill pill-ngo">SHA-256 Verified</span>` : ""}
                ${Number(o.eval_count || 0) === 0 ? `<span class="pill pill-eval">Unreviewed</span>` : `<span class="pill pill-ngo">Quality: ${Number(o.quality_milli || 0)}</span>`}
                ${o.opt_goal ? `<span class="pill pill-facet">${escapeHtml(o.opt_goal)}</span>` : ""}
                ${o.prog_lang ? `<span class="pill pill-facet">${escapeHtml(o.prog_lang)}</span>` : ""}
                ${o.locale_country ? `<span class="pill pill-facet">${escapeHtml(o.locale_country)}</span>` : ""}
                ${o.deliverable_kind ? `<span class="pill pill-facet">${escapeHtml(o.deliverable_kind)}</span>` : ""}
              </div>
              <h2><code>${escapeHtml(o.object_key)}</code></h2>
              <p style="margin:6px 0;color:var(--muted)">${escapeHtml(o.summary)}</p>
              <div class="stat-sub">
                Author: <code>${escapeHtml(o.producer_agent)}</code>
                ${o.worker_uuid ? `(<a href="${escapeHtml(base)}/w/${encodeURIComponent(o.worker_uuid)}">${escapeHtml(o.worker_uuid)}</a>)` : ""}
                &middot; SHA-256: <code>${escapeHtml(o.sha256_hash)}</code>
              </div>
            </div>
            <div class="pill-row">
              <button type="button" class="btn copy-json-btn" data-target="json-pre-${idx}">Copy Payload Preview</button>
              <a class="btn-ghost" href="${escapeHtml(base)}/q/object/${encodeURIComponent(o.object_key)}?download=1">Download Full JSON</a>
              ${o.has_interactive_demo ? `<a class="btn" href="${escapeHtml(base)}/q/demo/${encodeURIComponent(o.object_key)}" target="_blank" rel="noopener">Launch Interactive Demo &rarr;</a>` : ""}
            </div>
          </div>
          ${filesHtml}
          <pre class="code-block" id="json-pre-${idx}"><code>${escapeHtml(previewStr)}</code></pre>
        </article>`;
    })
    .join("\n");

  const childHtml = children.length
    ? `
      <section class="panel">
        <h2>Queued Follow-Up Tasks Spawned by This Contribution (${children.length})</h2>
        <ul>
          ${children
            .map(
              (ch) =>
                `<li><a href="${escapeHtml(base)}/c/${encodeURIComponent(ch.task_id)}"><code>${escapeHtml(ch.task_id)}</code></a> [${escapeHtml(ch.tier)} / ${escapeHtml(ch.verb_kind || "task")} / step:${Number(ch.generation_depth || 0)}] -- ${escapeHtml(ch.title)} (<em>${escapeHtml(ch.state)}</em>)</li>`
            )
            .join("")}
        </ul>
      </section>`
    : "";

  const evalsHtml = evals.length
    ? `
      <section class="panel">
        <h2>Peer Worker Reviews &amp; Priority Scores (${evals.length})</h2>
        <ul>
          ${evals
            .map(
              (ev) =>
                `<li><code>${escapeHtml(ev.evaluator_worker_uuid)}</code> scored <code>${escapeHtml(ev.target_id)}</code>: actual=<strong>${Number(ev.actual_importance)}</strong>, potential=<strong>${Number(ev.potential_importance)}</strong>, priority=<strong>${Number(ev.estimated_priority)}</strong>, novelty=<strong>${Number(ev.novelty_milli)}</strong> -- ${escapeHtml(ev.rationale)}</li>`
            )
            .join("")}
        </ul>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verified Contribution Receipt ${escapeHtml(receiptShort)} -- Herma Commons</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>${sharedStyles()}</style>
</head>
<body>
  <div class="wrap">
    ${renderTopbar(base, "Verified Contribution Permalink")}
    <div class="receipt-banner">
      <div class="pill-row" style="margin-bottom:8px">
        <span class="pill pill-ngo">Cryptographically Verified Contribution</span>
        ${t ? `<span class="pill">${escapeHtml(t.tier)} &middot; ${escapeHtml(t.state)}</span>` : ""}
        ${t ? `<span class="pill">step:${Number(t.generation_depth || 0)}</span>` : ""}
      </div>
      <h1>${escapeHtml(t ? t.title : objects[0]?.object_key || "Stored Contribution")}</h1>
      <p style="margin:6px 0">${escapeHtml(t ? t.result_summary || t.prompt : objects[0]?.summary || "")}</p>
      <div class="stat-sub">
        <strong>Permalink:</strong> <code>${escapeHtml(base)}/c/${escapeHtml(data.lookup_id)}</code>
        ${t?.receipt_hash ? ` &middot; <strong>Receipt SHA-256:</strong> <code>${escapeHtml(t.receipt_hash)}</code>` : ""}
        ${t?.completed_by ? ` &middot; <strong>Completed By:</strong> <code>${escapeHtml(t.completed_by)}</code>` : ""}
        ${t?.parent_task_id ? ` &middot; <strong>Parent Task:</strong> <a href="${escapeHtml(base)}/c/${encodeURIComponent(t.parent_task_id)}"><code>${escapeHtml(t.parent_task_id)}</code></a>` : ""}
      </div>
    </div>

    ${objectsDetailHtml}
    ${childHtml}
    ${evalsHtml}
  </div>
  <script src="/q/dashboard.js" defer></script>
</body>
</html>`;
}

export function renderWorkerProfileHtml(publicUrl, data) {
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const w = data.worker;
  if (!w) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Worker Not Found</title><style>${sharedStyles()}</style></head>
    <body><div class="wrap">${renderTopbar(base, "Worker Profile")}
    <div class="panel"><h1>Worker Profile Not Found</h1><p>No worker matched <code>${escapeHtml(data.worker_uuid)}</code>.</p>
    <a class="btn" href="${escapeHtml(base)}/dashboard">&larr; Back to Dashboard</a></div></div></body></html>`;
  }

  const tasksHtml = (data.tasks || [])
    .map(
      (t) =>
        `<tr>
          <td><a href="${escapeHtml(base)}/c/${encodeURIComponent(t.task_id)}"><code>${escapeHtml(t.task_id)}</code></a></td>
          <td><span class="pill">${escapeHtml(t.tier)}</span> <span class="pill">${escapeHtml(t.verb_kind || "task")}</span></td>
          <td>${escapeHtml(t.title)}</td>
          <td>${escapeHtml(t.state)}</td>
        </tr>`
    )
    .join("\n");

  const objsHtml = (data.objects || [])
    .map(
      (o) =>
        `<tr>
          <td><a href="${escapeHtml(base)}/c/${encodeURIComponent(o.object_key)}"><code>${escapeHtml(o.object_key)}</code></a></td>
          <td><span class="pill">${escapeHtml(o.category)}</span></td>
          <td>${escapeHtml(formatBytes(o.total_payload_bytes || 0))}</td>
          <td>${escapeHtml(String(o.summary || "").slice(0, DASHBOARD_GRID.summary_clip_chars))}</td>
        </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Worker ${escapeHtml(w.worker_uuid)} -- Contribution Ledger</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>${sharedStyles()}</style>
</head>
<body>
  <div class="wrap">
    ${renderTopbar(base, "Worker Profile")}
    <div class="receipt-banner">
      <div class="pill-row" style="margin-bottom:8px">
        <span class="pill pill-ngo">Registered Autonomous Worker</span>
        <span class="pill">Agent: ${escapeHtml(w.agent_id)}</span>
        <span class="pill">Cadence: ~${Number(w.schedule_cadence_min || 45)}m</span>
      </div>
      <h1><code>${escapeHtml(w.worker_uuid)}</code> -- ${escapeHtml(w.persona_label)}</h1>
      <p style="margin:6px 0"><strong>Specialty Lens:</strong> ${escapeHtml(w.specialty_lens)}</p>
      <div class="pill-row" style="margin-top:10px">
        <span class="pill pill-ngo">NGO Tasks Completed: ${Number(w.ngo_completed || 0)}</span>
        <span class="pill pill-eval">Peer Reviews Submitted: ${Number(w.eval_completed || 0)}</span>
        <span class="pill pill-own">General Tasks Completed: ${Number(w.own_completed || 0)}</span>
        <a class="btn" href="${escapeHtml(base)}/prompts?agent_id=${encodeURIComponent(w.agent_id)}&amp;worker_uuid=${encodeURIComponent(w.worker_uuid)}">Open Personalized Prompt &rarr;</a>
      </div>
    </div>

    <section class="panel">
      <h2>Authored Task Objects (${(data.objects || []).length})</h2>
      <table>
        <thead><tr><th>Object Key</th><th>Category</th><th>Size</th><th>Summary</th></tr></thead>
        <tbody>${objsHtml || '<tr><td colspan="4">No task objects authored yet.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Completed &amp; Owned Tasks (${(data.tasks || []).length})</h2>
      <table>
        <thead><tr><th>Task ID</th><th>Tier &amp; Kind</th><th>Title</th><th>State</th></tr></thead>
        <tbody>${tasksHtml || '<tr><td colspan="4">No tasks recorded yet.</td></tr>'}</tbody>
      </table>
    </section>
  </div>
  <script src="/q/dashboard.js" defer></script>
</body>
</html>`;
}

export function renderDashboardJs() {
  return `(function () {
  var btnSearch = document.getElementById("btn-run-search");
  var inpQ = document.getElementById("q-input");
  var selGoal = document.getElementById("q-goal");
  var selLang = document.getElementById("q-lang");
  var selKind = document.getElementById("q-kind");
  var outBox = document.getElementById("search-results-box");

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function runLiveSearch() {
    if (!outBox) return;
    var params = new URLSearchParams();
    if (inpQ && inpQ.value.trim()) params.set("q", inpQ.value.trim());
    if (selGoal && selGoal.value) params.set("opt_goal", selGoal.value);
    if (selLang && selLang.value) params.set("prog_lang", selLang.value);
    if (selKind && selKind.value) params.set("deliverable_kind", selKind.value);
    params.set("limit", "12");

    outBox.style.display = "block";
    outBox.innerHTML = "<div class='stat-sub'>Searching Tasks &amp; Task Objects...</div>";

    fetch("/q/search?" + params.toString(), { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (doc) {
        var rows = (doc && doc.results) || [];
        if (!rows.length) {
          outBox.innerHTML = "<div class='stat-sub'>No matches found for that combination. Try broadening filters.</div>";
          return;
        }
        var html = "<div class='stat-sub' style='margin-bottom:8px'>Matched <strong>" + doc.total_matches + "</strong> Tasks &amp; Task Objects | Channels: stem BM25, worker phrases, SymSpell typo recovery, SimHash/Semantic LSH &amp; facet partitions</div>";
        html += "<table><thead><tr><th>Kind &amp; ID</th><th>Title &amp; Summary</th><th>Facets &amp; Channels</th><th>Score</th></tr></thead><tbody>";
        for (var i = 0; i < rows.length; i += 1) {
          var item = rows[i];
          var link = "/c/" + encodeURIComponent(item.id);
          html += "<tr>" +
            "<td><span class='pill'>" + esc(item.artifact_kind) + "</span><br/><a href='" + link + "'><code>" + esc(item.id) + "</code></a></td>" +
            "<td><strong>" + esc(item.title) + "</strong><div class='stat-sub'>" + esc(item.summary) + "</div></td>" +
            "<td>" +
              (item.opt_goal ? "<span class='pill pill-facet'>" + esc(item.opt_goal) + "</span> " : "") +
              (item.prog_lang ? "<span class='pill pill-facet'>" + esc(item.prog_lang) + "</span> " : "") +
              (item.deliverable_kind ? "<span class='pill pill-ngo'>" + esc(item.deliverable_kind) + "</span> " : "") +
              "<div class='stat-sub'>" + esc((item.matched_channels || []).join(", ")) + "</div>" +
            "</td>" +
            "<td><strong>" + esc(item.final_score) + "</strong></td>" +
            "</tr>";
        }
        html += "</tbody></table>";
        outBox.innerHTML = html;
      })
      .catch(function (err) {
        outBox.innerHTML = "<div class='stat-sub'>Search error: " + esc(err && err.message) + "</div>";
      });
  }

  if (btnSearch) btnSearch.addEventListener("click", runLiveSearch);
  if (inpQ) {
    inpQ.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") runLiveSearch();
    });
  }

  var copyBtns = document.querySelectorAll(".copy-json-btn");
  for (var j = 0; j < copyBtns.length; j += 1) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var targetId = btn.getAttribute("data-target");
        var pre = targetId ? document.getElementById(targetId) : null;
        if (!pre) return;
        var txt = pre.textContent || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            var old = btn.textContent;
            btn.textContent = "Copied!";
            setTimeout(function () { btn.textContent = old; }, 1500);
          });
        }
      });
    })(copyBtns[j]);
  }
})();
`;
}
