import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LOCAL_CELL_BOOTSTRAP_GRID } from "../deploy/cloudflare/local_cell_bootstrap.js";
import rawCellSource from "../deploy/cloudflare/local_cell_bootstrap.js?raw";
import { OPTIMIZATION_ENGINE_GRID } from "../deploy/cloudflare/rl_and_grid_optimizer.js";
import rawOptSource from "../deploy/cloudflare/rl_and_grid_optimizer.js?raw";
import worker from "../deploy/cloudflare/worker.js";

const BASE = "https://shim.teleionlabs.com";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const liveLikeEnv = { ...env, AGENT_NAME_CLAIMS: "on" };

function callWorker(routePath, init = {}, envOverrides = null) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("accept") && !routePath.endsWith(".txt")) {
    headers.set("accept", "application/json");
  }
  return worker.fetch(
    new Request(BASE + routePath, { ...init, headers }),
    envOverrides ? { ...liveLikeEnv, ...envOverrides } : liveLikeEnv,
    ctx
  );
}

async function callMcp(method, params = {}, headers = {}) {
  const res = await callWorker("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe("Parameterized Grid Search, RBF/UCB Optimization, Contextual RL Canary Loop & Macro-DAG (/q/optimize + MCP)", () => {
  it("enforces OPTIMIZATION_ENGINE_GRID governance, zero magic literals, and zero banned words", () => {
    expect(Object.isFrozen(OPTIMIZATION_ENGINE_GRID)).toBe(true);
    expect(Object.isFrozen(OPTIMIZATION_ENGINE_GRID.grid_axes)).toBe(true);
    expect(OPTIMIZATION_ENGINE_GRID.default_batch_proposals).toBeLessThanOrEqual(
      OPTIMIZATION_ENGINE_GRID.max_batch_proposals
    );
    expect(OPTIMIZATION_ENGINE_GRID.macro_dag_min_tasks).toBeLessThanOrEqual(
      OPTIMIZATION_ENGINE_GRID.macro_dag_max_tasks
    );

    expect(rawOptSource).not.toContain("\u2014");

    const bannedRoots = [
      /\bverif(?:y|ied|ies|ication|iable|ying)\b/i,
      /\breceipts?\b/i,
      /\bnouns?\b/i,
      /\bverbs?\b/i,
      /\bsha-?256\b/i,
      /\bhash(?:es|ed)?\b/i,
      /\bprove(?:[sd]|n)?\b/i,
      /\bconfirmed\b/i,
      /\bprovenance\b/i,
      /\bcryptographic\b/i,
      new RegExp("\\bsyn" + "thetic\\b", "i"),
    ];
    for (const re of bannedRoots) {
      expect(rawOptSource).not.toMatch(re);
    }

    const afterGrid = rawOptSource.slice(rawOptSource.indexOf("const readyOptTables"));
    const codeOnly = afterGrid
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/`(?:\\.|[^`\\])*`/g, '""')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, '""')
      .replace(/\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g, "REGEX");
    const numbers = [...codeOnly.matchAll(/(?<![a-zA-Z0-9_$])(\d+(?:\.\d+)?)(?![a-zA-Z0-9_$])/g)].map((m) =>
      Number(m[1])
    );
    const disallowed = numbers.filter((n) => n !== 0 && n !== 1);
    expect(disallowed).toEqual([]);
  });

  it("supports grid_search, latin_maximin, ucb_surrogate, successive_halving, Pareto frontiers, and multi-agent maker != checker boundary auto-expansion", async () => {
    const makerId = `opt-maker-${crypto.randomUUID().slice(0, 6)}`;
    const checkerId = `opt-checker-${crypto.randomUUID().slice(0, 6)}`;
    const campaign = `grid-camp-${crypto.randomUUID().slice(0, 6)}`;

    const axes = {
      rank_k: { type: "integer_range", low: 4, high: 32, resolution: 5, active: 16 },
      lexical_weight: { type: "float_range", low: 0.2, high: 0.8, resolution: 4, active: 0.5 },
      mode: { type: "choice", choices: ["compact", "balanced", "deep"], active: "balanced" },
      pruning: { type: "boolean", active: true },
    };

    // 1. Propose initial grid_search batch (issues maker worker_token on first write)
    const propRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerId,
        campaign,
        shared: true,
        operation: "propose",
        strategy: "grid_search",
        axes,
        constraints: ["rank_k >= 4"],
        batch_size: 4,
      }),
    });
    expect(propRes.status).toBe(200);
    const propJson = await propRes.json();
    expect(propJson.worker_token).toMatch(/^wt_[0-9a-f]{24,}$/);
    const makerToken = propJson.worker_token;
    expect(propJson.proposals.length).toBe(4);
    expect(propJson.proposals[0].acquisition_reason).toBe("deterministic_grid_sweep");

    // 2. Maker records boundary-saturating optimum (rank_k = 32, lexical_weight = 0.8) and tries apply_expansion=true alone -> stays gen 1!
    const selfExpandRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": makerToken },
      body: JSON.stringify({
        agent_id: makerId,
        campaign,
        shared: true,
        strategy: "ucb_surrogate",
        apply_expansion: true,
        observations: [
          { params: { rank_k: 8, lexical_weight: 0.3, mode: "compact", pruning: false }, reward: 0.62, cost_units: 12, rung: 0 },
          { params: { rank_k: 32, lexical_weight: 0.8, mode: "deep", pruning: true }, reward: 0.94, cost_units: 28, rung: 0 },
        ],
        batch_size: 3,
      }),
    });
    expect(selfExpandRes.status).toBe(200);
    const selfExpandJson = await selfExpandRes.json();
    expect(selfExpandJson.generation).toBe(1);
    expect(selfExpandJson.best_cell.independent_check).toBe(false);
    expect(selfExpandJson.boundary_expansions.length).toBeGreaterThanOrEqual(2);
    expect(selfExpandJson.pareto_frontier.length).toBe(2);
    expect(selfExpandJson.proposals[0].acquisition_reason).toBe("rbf_ucb_surrogate");

    // 3. Independent checker corroborates the top cell with apply_expansion=true -> advances to generation 2!
    const corrRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: checkerId,
        campaign,
        shared: true,
        strategy: "successive_halving",
        apply_expansion: true,
        observations: [
          { params: { rank_k: 32, lexical_weight: 0.8, mode: "deep", pruning: true }, reward: 0.95, cost_units: 27, rung: 0 },
        ],
        batch_size: 2,
      }),
    });
    expect(corrRes.status).toBe(200);
    const corrJson = await corrRes.json();
    expect(corrJson.generation).toBe(2);
    expect(corrJson.best_cell.independent_check).toBe(true);
    expect(corrJson.axes.rank_k.high).toBeGreaterThan(32);
    expect(corrJson.proposals[0].acquisition_reason).toBe("successive_halving_promotion");

    // 4. Read-only JSON and .txt inspection
    const txtRes = await callWorker(`/q/optimize/shared/${campaign}.txt`);
    expect(txtRes.status).toBe(200);
    const txtBody = await txtRes.text();
    expect(txtBody).toContain(`OPTIMIZATION_CAMPAIGN: ${campaign}`);
    expect(txtBody).toContain("GENERATION: 2");
  });

  it("drives contextual RL trajectory updates, canary challenger promotion, and automatic canary rollback", async () => {
    const agentId = `rl-tuner-${crypto.randomUUID().slice(0, 6)}`;
    const campaign = `rl-canary-${crypto.randomUUID().slice(0, 6)}`;

    // 1. Seed incumbent arm with moderate steady reward (0.60 across 4 pulls)
    const initRes = await callMcp("tools/call", {
      name: "rl_policy_step",
      arguments: {
        agent_id: agentId,
        campaign,
        arms: ["arm_baseline", "arm_fast_shim", "arm_faulty"],
        trajectory: [
          { arm_id: "arm_baseline", reward: 0.6, context_features: { complexity: 0.5 } },
          { arm_id: "arm_baseline", reward: 0.6, context_features: { complexity: 0.6 } },
          { arm_id: "arm_baseline", reward: 0.6, context_features: { complexity: 0.4 } },
          { arm_id: "arm_baseline", reward: 0.6, context_features: { complexity: 0.5 } },
        ],
        discount_gamma_milli: 500,
      },
    });
    expect(initRes.result.isError).toBe(false);
    const workerToken = initRes.result.structuredContent.worker_token;
    expect(workerToken).toMatch(/^wt_[0-9a-f]{24,}$/);
    expect(initRes.result.structuredContent.canary_gate.incumbent_arm).toBe("arm_baseline");

    // 2. Bad challenger ("arm_faulty") drops well below baseline across 4 trials -> automatically rolled_back!
    for (let i = 0; i < 4; i += 1) {
      await callMcp("tools/call", {
        name: "rl_policy_step",
        arguments: {
          agent_id: agentId,
          worker_token: workerToken,
          campaign,
          arm_id: "arm_faulty",
          reward: 0.15,
          context_features: { complexity: 0.5 },
        },
      });
    }
    const afterFaulty = await callMcp("tools/call", {
      name: "rl_policy_step",
      arguments: {
        agent_id: agentId,
        worker_token: workerToken,
        campaign,
        operation: "rl_select",
        context_features: { complexity: 0.5 },
      },
    });
    const faultyArm = afterFaulty.result.structuredContent.arms.find((a) => a.arm_id === "arm_faulty");
    expect(faultyArm.role_state).toBe("rolled_back");
    expect(afterFaulty.result.structuredContent.probabilities.arm_faulty).toBeUndefined();

    // 3. Strong challenger ("arm_fast_shim") consistently beats baseline -> automatically promoted to incumbent!
    let lastStep = null;
    for (let i = 0; i < 5; i += 1) {
      lastStep = await callMcp("tools/call", {
        name: "rl_policy_step",
        arguments: {
          agent_id: agentId,
          worker_token: workerToken,
          campaign,
          arm_id: "arm_fast_shim",
          reward: 0.95,
          context_features: { complexity: 0.8 },
        },
      });
    }
    expect(lastStep.result.structuredContent.canary_gate.incumbent_arm).toBe("arm_fast_shim");
  });

  it("compiles 240-task parameterized Macro-DAGs over MCP, enforces worker_token isolation, and strips WT_ secrets", async () => {
    const dagRpc = await callMcp("tools/call", {
      name: "compile_macro_dag",
      arguments: {
        goal: "Launch autonomous interactive studio portal and browser simulation engine",
        campaign: "studio-240",
        target_task_count: 240,
        phases: [
          "Studio Charter & Operations",
          "Brand System & Paper-Ink Web Portal",
          "Deterministic Physics & Audio Core",
          "Parameter Grid Level Balancing",
          "Adversarial QA & Live Release",
        ],
        human_gate_phases: ["studio_charter_operations", "adversarial_qa_live_release"],
      },
    });
    expect(dagRpc.result.isError).toBe(false);
    const dag = dagRpc.result.structuredContent;
    expect(dag.total_tasks).toBe(240);
    expect(dag.critical_path_depth).toBe(5);
    expect(dag.max_parallel_width).toBe(48);
    expect(dag.tasks.filter((t) => t.requires_human_one_use_link).length).toBe(2);

    // Tenant auth & PII stripping check
    const ownerId = `iso-opt-${crypto.randomUUID().slice(0, 6)}`;
    const firstWrite = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: ownerId,
        campaign: "sec-camp",
        params: {
          note: "WT_11223344556677889900AABBCCDDEEFF",
          refresh_token: "AbcdefghijklmnopSecretOnlyLetters",
          dob: "1990-05-12",
          k: 8,
        },
        reward: 0.88,
      }),
    });
    expect(firstWrite.status).toBe(200);
    const pubView = await callWorker(`/q/optimize/${ownerId}?campaign=sec-camp`);
    const pubText = await pubView.text();
    expect(pubText.toLowerCase()).not.toContain("11223344556677889900aabbccddeeff");
    expect(pubText).not.toContain("AbcdefghijklmnopSecretOnlyLetters");
    expect(pubText).not.toContain("1990-05-12");

    const pubTxtRes = await callWorker(`/q/optimize/${ownerId}.txt?campaign=sec-camp`);
    expect(pubTxtRes.status).toBe(200);
    const pubPlain = await pubTxtRes.text();
    expect(pubPlain).not.toContain("AbcdefghijklmnopSecretOnlyLetters");
    expect(pubPlain).not.toContain("1990-05-12");

    // Wrong worker_token on claimed agent_id must return 409 on mutating POST /q/optimize
    const spoofWrite = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": "wt_00000000000000000000000000000000" },
      body: JSON.stringify({
        agent_id: ownerId,
        campaign: "sec-camp",
        params: { k: 16 },
        reward: 0.99,
      }),
    });
    expect(spoofWrite.status).toBe(409);

    // POST /q/optimize.txt must return 405 and NEVER bypass agentNameGate
    const dotTxtPost = await callWorker("/q/optimize.txt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: ownerId,
        campaign: "sec-camp",
        params: { k: 16 },
        reward: 0.99,
      }),
    });
    expect(dotTxtPost.status).toBe(405);

    // Read-only POST /q/optimize {"operation":"inspect"} neither 409s on claimed IDs nor claims unclaimed IDs
    const unclaimedInspectId = `unclaimed-ro-${crypto.randomUUID().slice(0, 6)}`;
    const roClaimed = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "inspect", agent_id: ownerId, campaign: "sec-camp" }),
    });
    expect(roClaimed.status).toBe(200);
    const roUnclaimed = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "inspect", agent_id: unclaimedInspectId, campaign: "sec-camp" }),
    });
    expect(roUnclaimed.status).toBe(200);
    const roUnclaimedJson = await roUnclaimed.json();
    expect(roUnclaimedJson.worker_token).toBeUndefined();
  });

  it("blocks checker refutations, shared axis clobbering, shared-prefix scope collisions, and extreme float/NaN inputs", async () => {
    const makerId = `ref-maker-${crypto.randomUUID().slice(0, 6)}`;
    const checkerId = `ref-checker-${crypto.randomUUID().slice(0, 6)}`;
    const rogueId = `ref-rogue-${crypto.randomUUID().slice(0, 6)}`;
    const camp = `ref-camp-${crypto.randomUUID().slice(0, 6)}`;

    // 1. Maker defines shared grid and submits boundary-saturating claim (0.95 at depth=16)
    const mRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerId,
        campaign: camp,
        shared: true,
        axes: { depth: { type: "integer_range", low: 2, high: 16, resolution: 4, active: 8 } },
        observations: [{ params: { depth: 16 }, reward: 0.95, cost_units: 10 }],
      }),
    });
    expect(mRes.status).toBe(200);

    // 2. Checker refutes the cell with low reward (0.05) and passes apply_expansion=true -> must NOT expand or bump generation!
    const cRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: checkerId,
        campaign: camp,
        shared: true,
        apply_expansion: true,
        observations: [{ params: { depth: 16 }, reward: 0.05, cost_units: 10 }],
      }),
    });
    expect(cRes.status).toBe(200);
    const cJson = await cRes.json();
    expect(cJson.generation).toBe(1);
    expect(cJson.best_cell.independent_check).toBe(false);
    expect(cJson.axes.depth.high).toBe(16);

    // 3. Rogue participant attempts to overwrite existing shared axis bounds -> preserved at high=16!
    const rRes = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: rogueId,
        campaign: camp,
        shared: true,
        axes: { depth: { type: "integer_range", low: 1, high: 9999, resolution: 4, active: 500 } },
      }),
    });
    expect(rRes.status).toBe(200);
    const rJson = await rRes.json();
    expect(rJson.axes.depth.high).toBe(16);

    // 4. Extreme finite floats (1e305) and malformed RL hyperparameters clamp cleanly without NaN or Infinity
    const rlExtreme = await callWorker("/q/optimize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: `rl-ext-${crypto.randomUUID().slice(0, 6)}`,
        campaign: "extreme-bounds",
        operation: "rl_update",
        arms: Array.from({ length: 40 }, (_, idx) => `arm_${idx}`),
        trajectory: [{ arm_id: "arm_0", reward: 1e305 }, { arm_id: "arm_overflow_99", reward: 0.5 }],
        temperature_milli: "not-a-number",
        kl_trust_clip_milli: 1e305,
        learning_rate_milli: -500,
      }),
    });
    expect(rlExtreme.status).toBe(200);
    const rlJson = await rlExtreme.json();
    expect(rlJson.arms.length).toBeLessThanOrEqual(OPTIMIZATION_ENGINE_GRID.rl_max_arms);
    expect(Number.isFinite(rlJson.baseline_reward)).toBe(true);
    expect(Number.isFinite(rlJson.action_probability)).toBe(true);
  });

  it("enforces LOCAL_CELL_BOOTSTRAP_GRID governance, zero magic literals, and zero banned words", () => {
    expect(Object.isFrozen(LOCAL_CELL_BOOTSTRAP_GRID)).toBe(true);
    expect(Object.isFrozen(LOCAL_CELL_BOOTSTRAP_GRID.grid_axes)).toBe(true);
    expect(LOCAL_CELL_BOOTSTRAP_GRID.min_subagent_slots).toBeLessThanOrEqual(
      LOCAL_CELL_BOOTSTRAP_GRID.max_subagent_slots
    );

    expect(rawCellSource).not.toContain("\u2014");

    const bannedRoots = [
      /\bverif(?:y|ied|ies|ication|iable|ying)\b/i,
      /\breceipts?\b/i,
      /\bnouns?\b/i,
      /\bverbs?\b/i,
      /\bsha-?256\b/i,
      /\bhash(?:es|ed)?\b/i,
      /\bprove(?:[sd]|n)?\b/i,
      /\bconfirmed\b/i,
      /\bprovenance\b/i,
      /\bcryptographic\b/i,
      new RegExp("\\bsyn" + "thetic\\b", "i"),
    ];
    for (const re of bannedRoots) {
      expect(rawCellSource).not.toMatch(re);
    }

    const afterGrid = rawCellSource.slice(rawCellSource.indexOf("const SUBAGENT_ROLE_SPECS"));
    const codeOnly = afterGrid.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g,
      '""'
    );
    const numbers = [...codeOnly.matchAll(/(?<![a-zA-Z0-9_$])(\d+(?:\.\d+)?)(?![a-zA-Z0-9_$])/g)].map((m) =>
      Number(m[1])
    );
    const disallowed = numbers.filter((n) => n !== 0 && n !== 1);
    expect(disallowed).toEqual([]);
  });

  it("serves /q/cell manifest, .txt, /q/cell/local_fabric_cell.py, MCP bootstrap_local_cell, and worker touchpoint hints safely", async () => {
    // 1. Read-only GET /q/cell with query clamping, PII scrubbing, and immunity to untrusted upstream_url injection
    const cellRes = await callWorker(
      "/q/cell?agent_id=alice@example.com&subagent_slots=4&port=9091&upstream_url=https://evil.example"
    );
    expect(cellRes.status).toBe(200);
    const manifest = await cellRes.json();
    expect(manifest.schema).toBe("teleion.local_cell_manifest.v1");
    expect(manifest.upstream_fabric_url).toBe("https://shim.teleionlabs.com");
    expect(JSON.stringify(manifest)).not.toContain("evil.example");
    expect(JSON.stringify(manifest)).not.toContain("alice@example.com");
    expect(manifest.configured_cell.subagent_slots).toBe(4);
    expect(manifest.configured_cell.loopback_port).toBe(9091);
    expect(manifest.subagent_topology.length).toBe(4);

    // 2. Plain text summary and inspectable stdlib Python replica script
    const txtRes = await callWorker("/q/cell.txt?agent_id=cell-worker-01");
    expect(txtRes.status).toBe(200);
    const txtBody = await txtRes.text();
    expect(txtBody).toContain("TELEION FABRIC - OPT-IN LOCAL CELL REPLICA (127.0.0.1)");
    expect(txtBody).toContain("INSPECT-FIRST SETUP");

    const pyRes = await callWorker("/q/cell/local_fabric_cell.py?upstream_url=https://evil.example");
    expect(pyRes.status).toBe(200);
    expect(pyRes.headers.get("content-type")).toContain("text/x-python");
    const pyBody = await pyRes.text();
    expect(pyBody).toContain("class LocalFabricCell:");
    expect(pyBody).toContain('"upstream_url": "https://shim.teleionlabs.com"');
    expect(pyBody).not.toContain("evil.example");

    // 3. POST /q/cell and POST /q/cell.txt fail closed with 405
    const postCell = await callWorker("/q/cell", { method: "POST", body: "{}" });
    expect(postCell.status).toBe(405);
    const postCellTxt = await callWorker("/q/cell.txt", { method: "POST", body: "{}" });
    expect(postCellTxt.status).toBe(405);

    // 4. Stateless MCP bootstrap_local_cell
    const mcpCell = await callMcp("tools/call", {
      name: "bootstrap_local_cell",
      arguments: { agent_id: "mcp-cell-lead", sync_policy: "airgapped_local", subagent_slots: 3 },
    });
    expect(mcpCell.result.isError).toBe(false);
    expect(mcpCell.result.structuredContent.configured_cell.sync_policy).toBe("airgapped_local");
    expect(mcpCell.result.structuredContent.subagent_topology.length).toBe(3);

    // 5. Worker touchpoints (/q/onboard, non-compact /q/resume, /q/optimize) advertise opt-in local_cell while compact /q/resume stays lean
    const agentId = `cell-touch-${crypto.randomUUID().slice(0, 6)}`;
    const onb = await (await callWorker(`/q/onboard/${agentId}?on_purpose=1`)).json();
    expect(onb.local_cell?.mcp_tool).toBe("bootstrap_local_cell");
    expect(onb.local_cell?.script_url).toBe("https://shim.teleionlabs.com/q/cell/local_fabric_cell.py");

    const resFull = await (await callWorker(`/q/resume/${agentId}`)).json();
    expect(resFull.local_cell?.mode).toBe("opt_in_local_replica");
    const resCompact = await (await callWorker(`/q/resume/${agentId}?compact=1`)).json();
    expect(resCompact.local_cell).toBeUndefined();

    const optRoot = await (await callWorker("/q/optimize")).json();
    expect(optRoot.local_cell?.mcp_tool).toBe("bootstrap_local_cell");
  });
});
