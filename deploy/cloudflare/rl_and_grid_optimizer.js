// Parameterized Multi-Axis Grid Search, RBF/UCB Surrogate Grid Optimization,
// Contextual Policy-Gradient & Trajectory Reinforcement Learning with Canary Auto-Rollback,
// and Topological Macro-DAG Decomposition (/q/optimize and stateless MCP tools).
// All numeric bounds, learning rates, exploration scales, and caps resolve from OPTIMIZATION_ENGINE_GRID.

import { stripPii, stripPiiDeep } from "./pii_strip.js";

export const OPTIMIZATION_ENGINE_GRID = Object.freeze({
  schema: "teleion.optimization_engine_grid.v1",
  generation: 1,
  grid_axes: Object.freeze({
    max_grid_axes: Object.freeze({ type: "integer_range", low: 1, high: 24, active: 12 }),
    max_choices_per_axis: Object.freeze({ type: "integer_range", low: 2, high: 64, active: 32 }),
    default_axis_resolution: Object.freeze({ type: "integer_range", low: 2, high: 16, active: 5 }),
    max_batch_proposals: Object.freeze({ type: "integer_range", low: 1, high: 64, active: 16 }),
    default_batch_proposals: Object.freeze({ type: "integer_range", low: 1, high: 16, active: 4 }),
    candidate_pool_size: Object.freeze({ type: "integer_range", low: 8, high: 256, active: 64 }),
    ucb_exploration_milli: Object.freeze({ type: "integer_range", low: 100, high: 5000, active: 1400 }),
    rbf_length_scale_milli: Object.freeze({ type: "integer_range", low: 50, high: 2000, active: 350 }),
    rbf_prior_sigma_milli: Object.freeze({ type: "integer_range", low: 50, high: 2000, active: 500 }),
    rbf_ridge_micro: Object.freeze({ type: "integer_range", low: 10, high: 50000, active: 1000 }),
    halving_keep_ratio_milli: Object.freeze({ type: "integer_range", low: 200, high: 800, active: 500 }),
    boundary_saturation_margin_milli: Object.freeze({ type: "integer_range", low: 10, high: 200, active: 50 }),
    boundary_expansion_factor_milli: Object.freeze({ type: "integer_range", low: 1100, high: 3000, active: 1500 }),
    rl_discount_gamma_milli: Object.freeze({ type: "integer_range", low: 500, high: 999, active: 950 }),
    rl_learning_rate_milli: Object.freeze({ type: "integer_range", low: 10, high: 800, active: 180 }),
    rl_baseline_ema_milli: Object.freeze({ type: "integer_range", low: 10, high: 500, active: 150 }),
    rl_temperature_milli: Object.freeze({ type: "integer_range", low: 100, high: 3000, active: 650 }),
    rl_kl_trust_clip_milli: Object.freeze({ type: "integer_range", low: 20, high: 1000, active: 250 }),
    rl_max_arms: Object.freeze({ type: "integer_range", low: 2, high: 128, active: 32 }),
    rl_max_features: Object.freeze({ type: "integer_range", low: 1, high: 64, active: 24 }),
    rl_max_trajectory_steps: Object.freeze({ type: "integer_range", low: 1, high: 256, active: 64 }),
    canary_min_trials: Object.freeze({ type: "integer_range", low: 2, high: 50, active: 4 }),
    canary_traffic_share_milli: Object.freeze({ type: "integer_range", low: 20, high: 500, active: 100 }),
    canary_promotion_margin_milli: Object.freeze({ type: "integer_range", low: 5, high: 250, active: 25 }),
    canary_rollback_drop_milli: Object.freeze({ type: "integer_range", low: 10, high: 300, active: 50 }),
    macro_dag_min_tasks: Object.freeze({ type: "integer_range", low: 2, high: 32, active: 3 }),
    macro_dag_default_tasks: Object.freeze({ type: "integer_range", low: 3, high: 64, active: 12 }),
    macro_dag_max_tasks: Object.freeze({ type: "integer_range", low: 12, high: 500, active: 250 }),
    macro_dag_max_phases: Object.freeze({ type: "integer_range", low: 2, high: 24, active: 12 }),
    strategy: Object.freeze({
      type: "choice",
      choices: Object.freeze(["ucb_surrogate", "grid_search", "latin_maximin", "successive_halving"]),
      active: "ucb_surrogate",
    }),
  }),
  constraints: Object.freeze([
    "default_batch_proposals <= max_batch_proposals",
    "max_batch_proposals <= candidate_pool_size",
    "macro_dag_min_tasks <= macro_dag_default_tasks",
    "macro_dag_default_tasks <= macro_dag_max_tasks",
  ]),
  max_grid_axes: 12,
  max_choices_per_axis: 32,
  default_axis_resolution: 5,
  max_batch_proposals: 16,
  default_batch_proposals: 4,
  candidate_pool_size: 64,
  ucb_exploration_milli: 1400,
  rbf_length_scale_milli: 350,
  rbf_prior_sigma_milli: 500,
  rbf_ridge_micro: 1000,
  halving_keep_ratio_milli: 500,
  boundary_saturation_margin_milli: 50,
  boundary_expansion_factor_milli: 1500,
  rl_discount_gamma_milli: 950,
  rl_learning_rate_milli: 180,
  rl_baseline_ema_milli: 150,
  rl_temperature_milli: 650,
  rl_kl_trust_clip_milli: 250,
  rl_max_arms: 32,
  rl_max_features: 24,
  rl_max_trajectory_steps: 64,
  rl_feature_clip_abs: 10,
  rl_logit_clip_abs: 12,
  canary_min_trials: 4,
  canary_traffic_share_milli: 100,
  canary_promotion_margin_milli: 25,
  canary_rollback_drop_milli: 50,
  canary_lcb_z_milli: 1280,
  corroboration_max_gap_milli: 250,
  abs_metric_clip: 1000000,
  macro_dag_min_tasks: 3,
  macro_dag_default_tasks: 12,
  macro_dag_max_tasks: 250,
  macro_dag_max_phases: 12,
  milli_scale: 1000,
  micro_scale: 1000000,
  float_round_scale: 10000,
  two_scalar: 2,
  half_milli: 500,
  short_id_chars: 8,
  agent_id_max_chars: 96,
  campaign_max_chars: 80,
  identifier_max_chars: 96,
  goal_max_chars: 600,
  request_max_bytes: 131072,
  max_observations_loaded: 256,
  top_leaderboard_limit: 12,
  seed_init: 2166136261,
  seed_mult: 16777619,
  uint_mod: 4294967296,
  lcg_mult: 1664525,
  lcg_inc: 1013904223,
  http_ok: 200,
  http_bad_request: 400,
  http_method_not_allowed: 405,
  http_payload_too_large: 413,
  http_unprocessable: 422,
});

const DEFAULT_UNIVERSAL_PHASES = Object.freeze([
  Object.freeze({
    phase_id: "charter_and_contracts",
    title: "Architecture Charter & Interface Contracts",
    output_fields: Object.freeze(["scope_manifest", "interface_contracts", "acceptance_gates"]),
  }),
  Object.freeze({
    phase_id: "substrate_and_schemas",
    title: "Durable State Schemas & Storage Indexes",
    output_fields: Object.freeze(["table_definitions", "index_plan", "migration_steps"]),
  }),
  Object.freeze({
    phase_id: "core_execution_modules",
    title: "Core Parameterized Execution Primitives",
    output_fields: Object.freeze(["module_entrypoints", "grid_bindings", "error_paths"]),
  }),
  Object.freeze({
    phase_id: "parameter_grid_tuning",
    title: "Multi-Axis Parameter Sweep & Policy Calibration",
    output_fields: Object.freeze(["pareto_cells", "selected_parameters", "latency_budget"]),
  }),
  Object.freeze({
    phase_id: "independent_check_and_release",
    title: "Independent Evaluation, Canary Gate & Surface Release",
    output_fields: Object.freeze(["test_summary", "canary_status", "live_endpoints"]),
  }),
]);

const readyOptTables = new WeakSet();

export async function ensureOptimizationSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (typeof db === "object" && readyOptTables.has(db)) return;
  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_opt_campaigns (
        scope_key TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        campaign TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1,
        strategy TEXT NOT NULL DEFAULT 'ucb_surrogate',
        axes_json TEXT NOT NULL DEFAULT '{}',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        canary_json TEXT NOT NULL DEFAULT '{}',
        baseline_reward REAL NOT NULL DEFAULT 0,
        total_trials INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_opt_observations (
        obs_id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        cell_key TEXT NOT NULL,
        params_json TEXT NOT NULL,
        reward REAL NOT NULL,
        cost_units REAL NOT NULL DEFAULT 0,
        latency_ms REAL NOT NULL DEFAULT 0,
        rung INTEGER NOT NULL DEFAULT 0,
        checker_agent_id TEXT NOT NULL DEFAULT '',
        independent_check INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_opt_obs_scope
       ON herma_opt_observations(scope_key, reward DESC, created_at DESC)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_rl_policy_state (
        scope_key TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        pulls INTEGER NOT NULL DEFAULT 0,
        mean_reward REAL NOT NULL DEFAULT 0,
        sum_sq_reward REAL NOT NULL DEFAULT 0,
        preference_logit REAL NOT NULL DEFAULT 0,
        weights_json TEXT NOT NULL DEFAULT '{}',
        role_state TEXT NOT NULL DEFAULT 'candidate',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, arm_id)
      )`
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const stmt of statements) await stmt.run();
  }
  if (typeof db === "object") readyOptTables.add(db);
}

function clampNum(val, low, high) {
  const n = Number(val);
  if (!Number.isFinite(n)) return low;
  if (n < low) return low;
  if (n > high) return high;
  return n;
}

function clipMetric(val, fallback = 0) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return clampNum(n, -OPTIMIZATION_ENGINE_GRID.abs_metric_clip, OPTIMIZATION_ENGINE_GRID.abs_metric_clip);
}

function roundNum(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  const clipped = clampNum(n, -OPTIMIZATION_ENGINE_GRID.abs_metric_clip, OPTIMIZATION_ENGINE_GRID.abs_metric_clip);
  return Math.round(clipped * OPTIMIZATION_ENGINE_GRID.float_round_scale) / OPTIMIZATION_ENGINE_GRID.float_round_scale;
}

function cleanText(raw, maxLen) {
  return stripPii(String(raw ?? "").replace(/[\u0000-\u001f]+/g, " ").trim()).slice(0, maxLen);
}

function cleanScopeSlug(raw) {
  const cleaned = cleanText(raw || "default", OPTIMIZATION_ENGINE_GRID.campaign_max_chars)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

function cleanAgentScopeKey(raw) {
  const cleaned = cleanText(raw || "public", OPTIMIZATION_ENGINE_GRID.agent_id_max_chars)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "public";
}

export function buildOptimizationScopeKey(agentId, campaign = "default", shared = false) {
  const camp = cleanScopeSlug(campaign);
  if (shared === true || shared === "1" || shared === 1) {
    return `shared::${camp}`;
  }
  return `agent::${cleanAgentScopeKey(agentId)}::${camp}`;
}

function cleanIdent(raw, fallback = "") {
  const cleaned = cleanText(raw || fallback, OPTIMIZATION_ENGINE_GRID.identifier_max_chars)
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function deterministicSeed(text) {
  let acc = OPTIMIZATION_ENGINE_GRID.seed_init;
  const str = String(text ?? "");
  for (let i = 0; i < str.length; i += 1) {
    acc ^= str.charCodeAt(i);
    acc = Math.imul(acc, OPTIMIZATION_ENGINE_GRID.seed_mult) >>> 0;
  }
  return acc >>> 0;
}

function makeRng(seedText) {
  let state = deterministicSeed(seedText) || 1;
  return () => {
    state = (Math.imul(state, OPTIMIZATION_ENGINE_GRID.lcg_mult) + OPTIMIZATION_ENGINE_GRID.lcg_inc) >>> 0;
    return state / OPTIMIZATION_ENGINE_GRID.uint_mod;
  };
}

function parseJsonObject(raw, fallback = {}) {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeGridAxes(rawAxes) {
  if (!rawAxes || typeof rawAxes !== "object" || Array.isArray(rawAxes)) return {};
  const out = {};
  const entries = Object.entries(rawAxes).slice(0, OPTIMIZATION_ENGINE_GRID.max_grid_axes);
  for (const [rawName, spec] of entries) {
    const axisName = cleanIdent(rawName);
    if (!axisName || !spec || typeof spec !== "object") continue;
    const rawType = String(spec.type || "").toLowerCase();
    if (rawType === "boolean" || typeof spec.active === "boolean") {
      out[axisName] = {
        type: "boolean",
        choices: [false, true],
        active: Boolean(spec.active),
      };
      continue;
    }
    if (rawType === "choice" || Array.isArray(spec.choices) || Array.isArray(spec.values)) {
      const src = Array.isArray(spec.choices) ? spec.choices : Array.isArray(spec.values) ? spec.values : [];
      const choices = [];
      for (const item of src) {
        if (choices.length >= OPTIMIZATION_ENGINE_GRID.max_choices_per_axis) break;
        if (typeof item === "number" && Number.isFinite(item)) {
          const v = roundNum(item);
          if (!choices.includes(v)) choices.push(v);
        } else if (typeof item === "boolean") {
          if (!choices.includes(item)) choices.push(item);
        } else {
          const s = cleanText(item, OPTIMIZATION_ENGINE_GRID.identifier_max_chars);
          if (s && !choices.includes(s)) choices.push(s);
        }
      }
      if (choices.length > 0) {
        const active = choices.includes(spec.active) ? spec.active : choices[0];
        out[axisName] = { type: "choice", choices, active };
      }
      continue;
    }
    const rawLow = clipMetric(spec.low ?? spec.min ?? 0, 0);
    const low = rawLow >= OPTIMIZATION_ENGINE_GRID.abs_metric_clip
      ? OPTIMIZATION_ENGINE_GRID.abs_metric_clip - 1
      : rawLow;
    const rawHigh = clipMetric(spec.high ?? spec.max ?? low + 1, low + 1);
    const high = rawHigh >= low ? rawHigh : Math.min(OPTIMIZATION_ENGINE_GRID.abs_metric_clip, low + 1);
    const isInt =
      rawType === "integer_range" ||
      rawType === "int" ||
      rawType === "integer" ||
      (rawType !== "float_range" && rawType !== "float" && Number.isInteger(low) && Number.isInteger(high));
    const resolution = Math.round(
      clampNum(
        spec.resolution ?? OPTIMIZATION_ENGINE_GRID.default_axis_resolution,
        OPTIMIZATION_ENGINE_GRID.two_scalar,
        OPTIMIZATION_ENGINE_GRID.max_choices_per_axis
      )
    );
    const activeVal = clampNum(
      spec.active ?? (low + high) / OPTIMIZATION_ENGINE_GRID.two_scalar,
      low,
      high
    );
    out[axisName] = {
      type: isInt ? "integer_range" : "float_range",
      low: isInt ? Math.round(low) : roundNum(low),
      high: isInt ? Math.round(high) : roundNum(high),
      resolution,
      active: isInt ? Math.round(activeVal) : roundNum(activeVal),
    };
  }
  return stripPiiDeep(out);
}

function normalizeConstraints(rawConstraints) {
  if (!Array.isArray(rawConstraints)) return [];
  const out = [];
  for (const item of rawConstraints.slice(0, OPTIMIZATION_ENGINE_GRID.max_grid_axes)) {
    const text = cleanText(item, OPTIMIZATION_ENGINE_GRID.identifier_max_chars);
    if (/^[a-zA-Z0-9_.-]+\s*(<=|>=|<|>|==|!=)\s*[a-zA-Z0-9_.-]+$/.test(text)) {
      out.push(text);
    }
  }
  return out;
}

function satisfiesConstraints(cell, constraints) {
  for (const rule of constraints) {
    const m = rule.match(/^([a-zA-Z0-9_.-]+)\s*(<=|>=|<|>|==|!=)\s*([a-zA-Z0-9_.-]+)$/);
    if (!m) continue;
    const [, lhsKey, op, rhsToken] = m;
    if (!Object.hasOwn(cell, lhsKey)) continue;
    const lhs = cell[lhsKey];
    const rhs = Object.hasOwn(cell, rhsToken)
      ? cell[rhsToken]
      : Number.isFinite(Number(rhsToken))
        ? Number(rhsToken)
        : rhsToken;
    if (op === "<=" && !(lhs <= rhs)) return false;
    if (op === ">=" && !(lhs >= rhs)) return false;
    if (op === "<" && !(lhs < rhs)) return false;
    if (op === ">" && !(lhs > rhs)) return false;
    if (op === "==" && !(lhs === rhs)) return false;
    if (op === "!=" && !(lhs !== rhs)) return false;
  }
  return true;
}

export function buildCellKey(params, axisNames) {
  const keys = Array.isArray(axisNames) && axisNames.length > 0 ? axisNames : Object.keys(params || {}).sort();
  return keys
    .map((k) => {
      const v = params?.[k];
      return `${k}=${typeof v === "number" ? roundNum(v) : String(v)}`;
    })
    .join("|");
}

function axisValueToUnit(spec, value) {
  if (spec.type === "boolean") return value ? 1 : 0;
  if (spec.type === "choice") {
    const idx = spec.choices.indexOf(value);
    if (spec.choices.length <= 1) return 0;
    return idx < 0 ? 0 : idx / (spec.choices.length - 1);
  }
  const span = spec.high - spec.low;
  if (span <= 0) return 0;
  return clampNum((Number(value) - spec.low) / span, 0, 1);
}

function unitToAxisValue(spec, u) {
  const clamped = clampNum(u, 0, 1);
  if (spec.type === "boolean") {
    return clamped >= OPTIMIZATION_ENGINE_GRID.half_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  }
  if (spec.type === "choice") {
    const idx = Math.min(spec.choices.length - 1, Math.floor(clamped * spec.choices.length));
    return spec.choices[Math.max(0, idx)];
  }
  const raw = spec.low + clamped * (spec.high - spec.low);
  return spec.type === "integer_range" ? Math.round(raw) : roundNum(raw);
}

function enumerateAxisLevels(spec) {
  if (spec.type === "boolean") return [false, true];
  if (spec.type === "choice") return [...spec.choices];
  const steps = Math.max(OPTIMIZATION_ENGINE_GRID.two_scalar, spec.resolution || OPTIMIZATION_ENGINE_GRID.default_axis_resolution);
  const vals = [];
  for (let i = 0; i < steps; i += 1) {
    const u = steps === 1 ? 0 : i / (steps - 1);
    const v = unitToAxisValue(spec, u);
    if (!vals.includes(v)) vals.push(v);
  }
  return vals;
}

function generateGridCandidates(axes, constraints, strategy, poolSize, rng) {
  const axisNames = Object.keys(axes);
  if (axisNames.length === 0) return [];

  if (strategy === "grid_search") {
    const levelLists = axisNames.map((k) => enumerateAxisLevels(axes[k]));
    let totalCombos = 1;
    for (const lv of levelLists) {
      totalCombos = Math.min(OPTIMIZATION_ENGINE_GRID.micro_scale, totalCombos * Math.max(1, lv.length));
    }
    const stride = Math.max(1, Math.floor(totalCombos / poolSize));
    const candidates = [];
    const seen = new Set();
    for (let idx = 0; idx < totalCombos && candidates.length < poolSize; idx += stride) {
      let rem = idx;
      const cell = {};
      for (let a = axisNames.length - 1; a >= 0; a -= 1) {
        const lv = levelLists[a];
        cell[axisNames[a]] = lv[rem % lv.length];
        rem = Math.floor(rem / lv.length);
      }
      if (!satisfiesConstraints(cell, constraints)) continue;
      const key = buildCellKey(cell, axisNames);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ cell_key: key, params: cell });
      }
    }
    return candidates;
  }

  // Latin-hypercube stratified sampling across unit cube for latin_maximin, ucb_surrogate, and successive_halving
  const count = Math.max(OPTIMIZATION_ENGINE_GRID.default_batch_proposals, poolSize);
  const perAxisPerm = {};
  for (const name of axisNames) {
    const slots = Array.from({ length: count }, (_, idx) => (idx + rng()) / count);
    for (let i = slots.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }
    perAxisPerm[name] = slots;
  }
  const candidates = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    const cell = {};
    for (const name of axisNames) {
      cell[name] = unitToAxisValue(axes[name], perAxisPerm[name][i]);
    }
    if (!satisfiesConstraints(cell, constraints)) continue;
    const key = buildCellKey(cell, axisNames);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ cell_key: key, params: cell });
    }
  }
  return candidates;
}

function unitDistanceSq(axes, axisNames, paramsA, paramsB) {
  if (axisNames.length === 0) return 0;
  let sumSq = 0;
  for (const name of axisNames) {
    const d = axisValueToUnit(axes[name], paramsA[name]) - axisValueToUnit(axes[name], paramsB[name]);
    sumSq += d * d;
  }
  return sumSq / axisNames.length;
}

function predictRbfSurrogate(axes, axisNames, candidateParams, observations, explorationMilli) {
  const priorSigma = OPTIMIZATION_ENGINE_GRID.rbf_prior_sigma_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const beta = explorationMilli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  if (observations.length === 0) {
    return {
      predicted_mean: 0,
      predicted_sigma: roundNum(priorSigma),
      ucb_score: roundNum(beta * priorSigma),
    };
  }
  const ell = OPTIMIZATION_ENGINE_GRID.rbf_length_scale_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const twoEllSq = OPTIMIZATION_ENGINE_GRID.two_scalar * ell * ell;
  const ridge = OPTIMIZATION_ENGINE_GRID.rbf_ridge_micro / OPTIMIZATION_ENGINE_GRID.micro_scale;
  let weightSum = 0;
  let weightedReward = 0;
  let maxKernel = 0;
  for (const obs of observations) {
    const distSq = unitDistanceSq(axes, axisNames, candidateParams, obs.params);
    const k = Math.exp(-distSq / Math.max(ridge, twoEllSq));
    weightSum += k;
    weightedReward += k * obs.reward;
    if (k > maxKernel) maxKernel = k;
  }
  const mean = weightedReward / (weightSum + ridge);
  const sigma = priorSigma * Math.sqrt(Math.max(0, 1 - maxKernel));
  return {
    predicted_mean: roundNum(mean),
    predicted_sigma: roundNum(sigma),
    ucb_score: roundNum(mean + beta * sigma),
  };
}

export function computeParetoFrontier(observations) {
  const byCell = new Map();
  for (const obs of observations) {
    const prev = byCell.get(obs.cell_key);
    if (!prev || obs.reward > prev.reward) {
      byCell.set(obs.cell_key, obs);
    }
  }
  const unique = [...byCell.values()];
  const pareto = [];
  for (const cand of unique) {
    const dominated = unique.some(
      (other) =>
        other.cell_key !== cand.cell_key &&
        other.reward >= cand.reward &&
        other.cost_units <= cand.cost_units &&
        (other.reward > cand.reward || other.cost_units < cand.cost_units)
    );
    if (!dominated) {
      pareto.push({
        cell_key: cand.cell_key,
        params: cand.params,
        reward: roundNum(cand.reward),
        cost_units: roundNum(cand.cost_units),
        latency_ms: roundNum(cand.latency_ms),
        independent_check: Boolean(cand.independent_check),
      });
    }
  }
  pareto.sort((a, b) => b.reward - a.reward || a.cost_units - b.cost_units);
  return pareto.slice(0, OPTIMIZATION_ENGINE_GRID.top_leaderboard_limit);
}

export function detectBoundarySaturation(axes, bestObs) {
  if (!bestObs || !bestObs.params) return [];
  const margin = OPTIMIZATION_ENGINE_GRID.boundary_saturation_margin_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const factor = OPTIMIZATION_ENGINE_GRID.boundary_expansion_factor_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const expansions = [];
  for (const [name, spec] of Object.entries(axes)) {
    if (spec.type !== "integer_range" && spec.type !== "float_range") continue;
    const span = spec.high - spec.low;
    if (span <= 0 || !Object.hasOwn(bestObs.params, name)) continue;
    const u = axisValueToUnit(spec, bestObs.params[name]);
    const delta = span * (factor - 1);
    if (u <= margin) {
      const nextLow = spec.type === "integer_range" ? Math.floor(spec.low - Math.max(1, delta)) : roundNum(spec.low - delta);
      expansions.push({
        axis: name,
        saturated_bound: "low",
        observed_value: bestObs.params[name],
        previous_low: spec.low,
        proposed_low: nextLow,
        proposed_high: spec.high,
      });
    } else if (u >= 1 - margin) {
      const nextHigh = spec.type === "integer_range" ? Math.ceil(spec.high + Math.max(1, delta)) : roundNum(spec.high + delta);
      expansions.push({
        axis: name,
        saturated_bound: "high",
        observed_value: bestObs.params[name],
        previous_high: spec.high,
        proposed_low: spec.low,
        proposed_high: nextHigh,
      });
    }
  }
  return expansions;
}

function cleanFeatureBag(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, OPTIMIZATION_ENGINE_GRID.rl_max_features)) {
    const feat = cleanIdent(k);
    const num = Number(v);
    if (feat && Number.isFinite(num)) {
      out[feat] = roundNum(
        clampNum(num, -OPTIMIZATION_ENGINE_GRID.rl_feature_clip_abs, OPTIMIZATION_ENGINE_GRID.rl_feature_clip_abs)
      );
    }
  }
  return stripPiiDeep(out);
}

function dotFeatures(weights, features) {
  let sum = 0;
  for (const [k, x] of Object.entries(features)) {
    const w = Number(weights?.[k] ?? 0);
    if (Number.isFinite(w)) sum += w * x;
  }
  return sum;
}

function armLowerConfidenceBound(arm) {
  if (!arm || arm.pulls <= 0) return 0;
  const variance = Math.max(0, arm.sum_sq_reward / arm.pulls - arm.mean_reward * arm.mean_reward);
  const stdErr = Math.sqrt(variance / Math.max(1, arm.pulls));
  const z = OPTIMIZATION_ENGINE_GRID.canary_lcb_z_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  return roundNum(arm.mean_reward - z * stdErr);
}

function annotateObservationsAndSelectBest(rawObservations) {
  const cellAgentMax = new Map();
  for (const o of rawObservations) {
    const aKey = String(o.agent_id || "").trim().toLowerCase();
    if (!aKey || aKey === "public") continue;
    if (!cellAgentMax.has(o.cell_key)) cellAgentMax.set(o.cell_key, new Map());
    const agentMap = cellAgentMax.get(o.cell_key);
    const prevMax = agentMap.get(aKey);
    if (prevMax === undefined || o.reward > prevMax) {
      agentMap.set(aKey, o.reward);
    }
  }

  const gapScale =
    OPTIMIZATION_ENGINE_GRID.corroboration_max_gap_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const cellSummary = new Map();
  for (const o of rawObservations) {
    if (cellSummary.has(o.cell_key)) continue;
    const agentRewards = [...(cellAgentMax.get(o.cell_key)?.values() || [])].sort((a, b) => b - a);
    const hasMultiAgent = agentRewards.length >= OPTIMIZATION_ENGINE_GRID.two_scalar;
    const topReward = agentRewards.length > 0 ? agentRewards[0] : o.reward;
    const secondReward = hasMultiAgent ? agentRewards[1] : topReward;
    const corroborated =
      hasMultiAgent &&
      secondReward > 0 &&
      topReward - secondReward <= gapScale * Math.max(1, Math.abs(topReward));
    const consensusReward = hasMultiAgent ? secondReward : topReward;
    cellSummary.set(o.cell_key, {
      corroborated,
      consensusReward,
    });
  }

  const observations = rawObservations.map((o) => {
    const summary = cellSummary.get(o.cell_key);
    return {
      ...o,
      independent_check: Boolean(summary?.corroborated),
      consensus_reward: summary ? summary.consensusReward : o.reward,
    };
  });

  const byCellBest = new Map();
  for (const o of observations) {
    const prev = byCellBest.get(o.cell_key);
    if (!prev || o.consensus_reward > prev.consensus_reward || (o.consensus_reward === prev.consensus_reward && o.reward > prev.reward)) {
      byCellBest.set(o.cell_key, o);
    }
  }
  const rankedCells = [...byCellBest.values()].sort(
    (a, b) => b.consensus_reward - a.consensus_reward || a.cost_units - b.cost_units
  );
  const bestCell = rankedCells[0] || null;
  const bestCorroboratedCell = rankedCells.find((c) => c.independent_check) || null;
  return { observations, bestCell, bestCorroboratedCell };
}

async function loadCampaignState(db, scopeKey, agentId, campaign) {
  await ensureOptimizationSchema(db);
  const row = await db
    .prepare("SELECT * FROM herma_opt_campaigns WHERE scope_key = ?")
    .bind(scopeKey)
    .first()
    .catch(() => null);
  const obsRows = await db
    .prepare("SELECT * FROM herma_opt_observations WHERE scope_key = ? ORDER BY created_at DESC LIMIT ?")
    .bind(scopeKey, OPTIMIZATION_ENGINE_GRID.max_observations_loaded)
    .all()
    .catch(() => ({ results: [] }));
  const armRows = await db
    .prepare("SELECT * FROM herma_rl_policy_state WHERE scope_key = ? ORDER BY pulls DESC, arm_id ASC LIMIT ?")
    .bind(scopeKey, OPTIMIZATION_ENGINE_GRID.rl_max_arms)
    .all()
    .catch(() => ({ results: [] }));

  const rawObservations = (obsRows?.results || []).map((r) => ({
    obs_id: r.obs_id,
    agent_id: r.agent_id,
    cell_key: r.cell_key,
    params: stripPiiDeep(parseJsonObject(r.params_json)),
    reward: clipMetric(r.reward, 0),
    cost_units: clampNum(clipMetric(r.cost_units, 0), 0, OPTIMIZATION_ENGINE_GRID.abs_metric_clip),
    latency_ms: clampNum(clipMetric(r.latency_ms, 0), 0, OPTIMIZATION_ENGINE_GRID.abs_metric_clip),
    rung: Math.max(0, Math.round(Number(r.rung) || 0)),
    checker_agent_id: r.checker_agent_id || "",
    independent_check: false,
    created_at: r.created_at,
  }));
  const { observations } = annotateObservationsAndSelectBest(rawObservations);

  const arms = (armRows?.results || []).map((r) => ({
    arm_id: r.arm_id,
    pulls: Number(r.pulls) || 0,
    mean_reward: Number(r.mean_reward) || 0,
    sum_sq_reward: Number(r.sum_sq_reward) || 0,
    preference_logit: Number(r.preference_logit) || 0,
    weights: parseJsonObject(r.weights_json),
    role_state: r.role_state || "candidate",
    updated_at: r.updated_at,
  }));

  return {
    scope_key: scopeKey,
    agent_id: row?.agent_id || agentId || "public",
    campaign,
    generation: Number(row?.generation) || 1,
    strategy: row?.strategy || OPTIMIZATION_ENGINE_GRID.grid_axes.strategy.active,
    axes: parseJsonObject(row?.axes_json),
    constraints: parseJsonArray(row?.constraints_json),
    canary: parseJsonObject(row?.canary_json),
    baseline_reward: Number(row?.baseline_reward) || 0,
    total_trials: Number(row?.total_trials) || 0,
    observations,
    arms,
  };
}

async function saveCampaignMeta(db, state, nowIso) {
  await db
    .prepare(
      `INSERT INTO herma_opt_campaigns
        (scope_key, agent_id, campaign, generation, strategy, axes_json, constraints_json, canary_json, baseline_reward, total_trials, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
        generation = excluded.generation,
        strategy = excluded.strategy,
        axes_json = excluded.axes_json,
        constraints_json = excluded.constraints_json,
        canary_json = excluded.canary_json,
        baseline_reward = excluded.baseline_reward,
        total_trials = excluded.total_trials,
        updated_at = excluded.updated_at`
    )
    .bind(
      state.scope_key,
      state.agent_id,
      state.campaign,
      state.generation,
      state.strategy,
      JSON.stringify(state.axes),
      JSON.stringify(state.constraints),
      JSON.stringify(state.canary),
      roundNum(state.baseline_reward),
      state.total_trials,
      nowIso
    )
    .run();
}

export async function runGridOptimizationOperation(db, publicUrl, input = {}) {
  const campaign = cleanScopeSlug(input.campaign || "default");
  const agentId = cleanText(input.agentId || input.agent_id || "public", OPTIMIZATION_ENGINE_GRID.agent_id_max_chars) || "public";
  const shared = Boolean(input.shared === true || input.shared === "1" || input.shared === 1);
  const scopeKey = buildOptimizationScopeKey(agentId, campaign, shared);
  const nowIso = new Date().toISOString();
  const state = await loadCampaignState(db, scopeKey, agentId, campaign);

  const incomingAxes = normalizeGridAxes(input.axes);
  if (Object.keys(incomingAxes).length > 0) {
    if (Object.keys(state.axes).length === 0 || (!shared && String(input.operation || "").toLowerCase() === "define_grid")) {
      state.axes = incomingAxes;
    } else {
      for (const [k, v] of Object.entries(incomingAxes)) {
        if (!Object.hasOwn(state.axes, k) && Object.keys(state.axes).length < OPTIMIZATION_ENGINE_GRID.max_grid_axes) {
          state.axes[k] = v;
        }
      }
    }
  }
  const incomingConstraints = normalizeConstraints(input.constraints);
  if (incomingConstraints.length > 0 && (state.constraints.length === 0 || (!shared && String(input.operation || "").toLowerCase() === "define_grid"))) {
    state.constraints = incomingConstraints;
  }
  const allowedStrategies = OPTIMIZATION_ENGINE_GRID.grid_axes.strategy.choices;
  if (typeof input.strategy === "string" && allowedStrategies.includes(input.strategy)) {
    state.strategy = input.strategy;
  }

  const axisNames = Object.keys(state.axes);
  const rawObservations = Array.isArray(input.observations)
    ? input.observations
    : input.params && input.reward !== undefined
      ? [
          {
            params: input.params,
            reward: input.reward,
            cost_units: input.cost_units,
            latency_ms: input.latency_ms,
            rung: input.rung,
            checker_agent_id: input.checker_agent_id,
          },
        ]
      : [];

  let recordedCount = 0;
  const obsStatements = [];
  for (const item of rawObservations.slice(0, OPTIMIZATION_ENGINE_GRID.max_batch_proposals)) {
    if (!item || typeof item !== "object" || !item.params || typeof item.params !== "object") continue;
    const rawReward = Number(item.reward);
    if (!Number.isFinite(rawReward)) continue;
    const reward = clipMetric(rawReward, 0);
    const cleanedParams = {};
    for (const [k, v] of Object.entries(item.params).slice(0, OPTIMIZATION_ENGINE_GRID.max_grid_axes)) {
      const key = cleanIdent(k);
      if (!key) continue;
      if (typeof v === "number" && Number.isFinite(v)) cleanedParams[key] = roundNum(v);
      else if (typeof v === "boolean") cleanedParams[key] = v;
      else cleanedParams[key] = cleanText(v, OPTIMIZATION_ENGINE_GRID.identifier_max_chars);
    }
    const safeParams = stripPiiDeep(cleanedParams);
    const cellKey = buildCellKey(safeParams, axisNames.length > 0 ? axisNames : Object.keys(safeParams).sort());
    const priorDistinctOther = state.observations.some(
      (o) =>
        o.cell_key === cellKey &&
        o.agent_id &&
        o.agent_id !== "public" &&
        agentId !== "public" &&
        o.agent_id.toLowerCase() !== agentId.toLowerCase()
    );
    const obsId = `obs_${crypto.randomUUID().slice(0, OPTIMIZATION_ENGINE_GRID.short_id_chars)}`;
    const costUnits = clampNum(roundNum(item.cost_units ?? 0), 0, OPTIMIZATION_ENGINE_GRID.abs_metric_clip);
    const latencyMs = clampNum(roundNum(item.latency_ms ?? 0), 0, OPTIMIZATION_ENGINE_GRID.abs_metric_clip);
    const rung = clampNum(Math.round(Number(item.rung ?? 0) || 0), 0, OPTIMIZATION_ENGINE_GRID.max_observations_loaded);

    obsStatements.push(
      db
        .prepare(
          `INSERT INTO herma_opt_observations
            (obs_id, scope_key, agent_id, cell_key, params_json, reward, cost_units, latency_ms, rung, checker_agent_id, independent_check, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          obsId,
          scopeKey,
          agentId,
          cellKey,
          JSON.stringify(safeParams),
          roundNum(reward),
          costUnits,
          latencyMs,
          rung,
          priorDistinctOther ? agentId : "",
          0,
          nowIso
        )
    );

    const emaAlpha = OPTIMIZATION_ENGINE_GRID.rl_baseline_ema_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
    state.baseline_reward =
      state.total_trials === 0 ? reward : (1 - emaAlpha) * state.baseline_reward + emaAlpha * reward;
    state.total_trials += 1;
    state.observations.unshift({
      obs_id: obsId,
      agent_id: agentId,
      cell_key: cellKey,
      params: safeParams,
      reward: roundNum(reward),
      cost_units: costUnits,
      latency_ms: latencyMs,
      rung,
      checker_agent_id: priorDistinctOther ? agentId : "",
      independent_check: false,
      created_at: nowIso,
    });
    recordedCount += 1;
  }

  if (obsStatements.length > 0) {
    if (typeof db.batch === "function") {
      await db.batch(obsStatements);
    } else {
      for (const stmt of obsStatements) await stmt.run();
    }
  }

  const annotated = annotateObservationsAndSelectBest(state.observations);
  state.observations = annotated.observations;
  const bestObservation = annotated.bestCell;
  const boundaryExpansions = detectBoundarySaturation(state.axes, bestObservation);

  if (
    input.apply_expansion === true &&
    boundaryExpansions.length > 0 &&
    bestObservation &&
    bestObservation.independent_check &&
    annotated.bestCorroboratedCell &&
    annotated.bestCorroboratedCell.cell_key === bestObservation.cell_key
  ) {
    for (const exp of boundaryExpansions) {
      if (state.axes[exp.axis]) {
        state.axes[exp.axis].low = exp.proposed_low;
        state.axes[exp.axis].high = exp.proposed_high;
      }
    }
    state.generation += 1;
  }

  const op = String(input.operation || (recordedCount > 0 && !input.batch_size ? "observe" : "propose")).toLowerCase();
  const batchSize = Math.round(
    clampNum(
      input.batch_size ?? OPTIMIZATION_ENGINE_GRID.default_batch_proposals,
      1,
      OPTIMIZATION_ENGINE_GRID.max_batch_proposals
    )
  );
  const explorationMilli = clampNum(
    input.exploration_milli ?? OPTIMIZATION_ENGINE_GRID.ucb_exploration_milli,
    OPTIMIZATION_ENGINE_GRID.grid_axes.ucb_exploration_milli.low,
    OPTIMIZATION_ENGINE_GRID.grid_axes.ucb_exploration_milli.high
  );

  let proposals = [];
  if (op !== "inspect" && Object.keys(state.axes).length > 0) {
    const rng = makeRng(`${scopeKey}:${state.generation}:${state.total_trials}:${state.strategy}`);
    const seenCells = new Set(state.observations.map((o) => o.cell_key));

    if (state.strategy === "successive_halving" && state.observations.length >= OPTIMIZATION_ENGINE_GRID.two_scalar) {
      const maxRung = Math.max(...state.observations.map((o) => o.rung));
      const rungObs = state.observations
        .filter((o) => o.rung === maxRung)
        .sort((a, b) => b.reward - a.reward);
      const keepRatio = OPTIMIZATION_ENGINE_GRID.halving_keep_ratio_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
      const keepCount = Math.max(1, Math.ceil(rungObs.length * keepRatio));
      proposals = rungObs.slice(0, Math.min(batchSize, keepCount)).map((o) => ({
        cell_key: o.cell_key,
        params: o.params,
        target_rung: maxRung + 1,
        acquisition_reason: "successive_halving_promotion",
        prior_reward: roundNum(o.reward),
      }));
    }

    if (proposals.length < batchSize) {
      const pool = generateGridCandidates(
        state.axes,
        state.constraints,
        state.strategy,
        OPTIMIZATION_ENGINE_GRID.candidate_pool_size,
        rng
      );
      const unseenPool = pool.filter((c) => !seenCells.has(c.cell_key));
      const evalPool = unseenPool.length > 0 ? unseenPool : pool;

      if (state.strategy === "latin_maximin" && state.observations.length > 0) {
        const scored = evalPool.map((cand) => {
          let minDist = 1;
          for (const obs of state.observations) {
            const d = Math.sqrt(unitDistanceSq(state.axes, axisNames, cand.params, obs.params));
            if (d < minDist) minDist = d;
          }
          return {
            cell_key: cand.cell_key,
            params: cand.params,
            space_filling_distance: roundNum(minDist),
            acquisition_reason: "latin_maximin_coverage",
          };
        });
        scored.sort((a, b) => b.space_filling_distance - a.space_filling_distance);
        proposals.push(...scored.slice(0, batchSize - proposals.length));
      } else if (state.strategy === "grid_search") {
        proposals.push(
          ...evalPool.slice(0, batchSize - proposals.length).map((cand) => ({
            cell_key: cand.cell_key,
            params: cand.params,
            acquisition_reason: "deterministic_grid_sweep",
          }))
        );
      } else {
        const scored = evalPool.map((cand) => {
          const pred = predictRbfSurrogate(state.axes, axisNames, cand.params, state.observations, explorationMilli);
          return {
            cell_key: cand.cell_key,
            params: cand.params,
            ...pred,
            acquisition_reason: "rbf_ucb_surrogate",
          };
        });
        scored.sort((a, b) => b.ucb_score - a.ucb_score);
        proposals.push(...scored.slice(0, batchSize - proposals.length));
      }
    }
  }

  if (op !== "inspect" || recordedCount > 0 || Object.keys(incomingAxes).length > 0) {
    await saveCampaignMeta(db, state, nowIso);
  }

  const paretoFrontier = computeParetoFrontier(state.observations);
  return stripPiiDeep({
    ok: true,
    schema: "teleion.grid_optimization.v1",
    campaign,
    generation: state.generation,
    strategy: state.strategy,
    total_trials: state.total_trials,
    recorded_observations: recordedCount,
    baseline_reward: roundNum(state.baseline_reward),
    axes: state.axes,
    constraints: state.constraints,
    best_cell: bestObservation
      ? {
          cell_key: bestObservation.cell_key,
          params: bestObservation.params,
          reward: roundNum(bestObservation.reward),
          cost_units: roundNum(bestObservation.cost_units),
          independent_check: bestObservation.independent_check,
        }
      : null,
    pareto_frontier: paretoFrontier,
    boundary_expansions: boundaryExpansions,
    proposals,
    inspect_url: shared
      ? `${publicUrl}/q/optimize?shared=1&campaign=${encodeURIComponent(campaign)}`
      : `${publicUrl}/q/optimize/${encodeURIComponent(agentId)}?campaign=${encodeURIComponent(campaign)}`,
  });
}

export async function runReinforcementPolicyStep(db, publicUrl, input = {}) {
  const campaign = cleanScopeSlug(input.campaign || "default");
  const agentId = cleanText(input.agentId || input.agent_id || "public", OPTIMIZATION_ENGINE_GRID.agent_id_max_chars) || "public";
  const shared = Boolean(input.shared === true || input.shared === "1" || input.shared === 1);
  const scopeKey = buildOptimizationScopeKey(agentId, campaign, shared);
  const nowIso = new Date().toISOString();
  const state = await loadCampaignState(db, scopeKey, agentId, campaign);

  const armMap = new Map(state.arms.map((a) => [a.arm_id, a]));
  const rawCandidateArms = Array.isArray(input.arms) ? input.arms : [];
  for (const rawArm of rawCandidateArms.slice(0, OPTIMIZATION_ENGINE_GRID.rl_max_arms)) {
    const id = cleanIdent(rawArm);
    if (id && !armMap.has(id) && armMap.size < OPTIMIZATION_ENGINE_GRID.rl_max_arms) {
      armMap.set(id, {
        arm_id: id,
        pulls: 0,
        mean_reward: 0,
        sum_sq_reward: 0,
        preference_logit: 0,
        weights: {},
        role_state: armMap.size === 0 ? "incumbent" : "candidate",
        updated_at: nowIso,
      });
    }
  }

  const op = String(
    input.operation ||
      (Array.isArray(input.trajectory) || input.reward !== undefined ? "rl_update" : "rl_select")
  ).toLowerCase();

  const gamma =
    clampNum(
      input.discount_gamma_milli ?? OPTIMIZATION_ENGINE_GRID.rl_discount_gamma_milli,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_discount_gamma_milli.low,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_discount_gamma_milli.high
    ) / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const lr =
    clampNum(
      input.learning_rate_milli ?? OPTIMIZATION_ENGINE_GRID.rl_learning_rate_milli,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_learning_rate_milli.low,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_learning_rate_milli.high
    ) / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const trustClip =
    clampNum(
      input.kl_trust_clip_milli ?? OPTIMIZATION_ENGINE_GRID.rl_kl_trust_clip_milli,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_kl_trust_clip_milli.low,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_kl_trust_clip_milli.high
    ) / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const emaAlpha = OPTIMIZATION_ENGINE_GRID.rl_baseline_ema_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;

  let updatedSteps = 0;
  let trajectoryReturns = [];

  if (op === "rl_update") {
    const rawSteps = Array.isArray(input.trajectory) && input.trajectory.length > 0
      ? input.trajectory.slice(0, OPTIMIZATION_ENGINE_GRID.rl_max_trajectory_steps)
      : input.arm_id && input.reward !== undefined
        ? [{ arm_id: input.arm_id, reward: input.reward, context_features: input.context_features }]
        : [];

    const terminalBonus = clipMetric(input.terminal_reward, 0);
    const returns = Array.from({ length: rawSteps.length }, () => 0);
    let runningG = terminalBonus;
    for (let t = rawSteps.length - 1; t >= 0; t -= 1) {
      const stepReward = clipMetric(rawSteps[t]?.reward ?? 0, 0);
      runningG = clipMetric(stepReward + gamma * runningG, 0);
      returns[t] = runningG;
    }

    for (let t = 0; t < rawSteps.length; t += 1) {
      const step = rawSteps[t];
      const armId = cleanIdent(step?.arm_id);
      if (!armId) continue;
      if (!armMap.has(armId)) {
        if (armMap.size >= OPTIMIZATION_ENGINE_GRID.rl_max_arms) continue;
        armMap.set(armId, {
          arm_id: armId,
          pulls: 0,
          mean_reward: 0,
          sum_sq_reward: 0,
          preference_logit: 0,
          weights: {},
          role_state: armMap.size === 0 ? "incumbent" : "candidate",
          updated_at: nowIso,
        });
      }
      const arm = armMap.get(armId);
      const retG = returns[t];
      const advantage = retG - state.baseline_reward;
      const clippedDelta = clampNum(lr * advantage, -trustClip, trustClip);

      const maxSq = OPTIMIZATION_ENGINE_GRID.abs_metric_clip * OPTIMIZATION_ENGINE_GRID.abs_metric_clip;
      arm.pulls += 1;
      arm.mean_reward += (retG - arm.mean_reward) / arm.pulls;
      arm.sum_sq_reward = clampNum(arm.sum_sq_reward + retG * retG, 0, maxSq);
      arm.preference_logit = clampNum(
        arm.preference_logit + clippedDelta,
        -OPTIMIZATION_ENGINE_GRID.rl_logit_clip_abs,
        OPTIMIZATION_ENGINE_GRID.rl_logit_clip_abs
      );

      const feats = cleanFeatureBag(step?.context_features ?? input.context_features);
      for (const [fk, fv] of Object.entries(feats)) {
        const prevW = Number(arm.weights[fk] ?? 0);
        arm.weights[fk] = roundNum(
          clampNum(
            prevW + clampNum(lr * advantage * fv, -trustClip, trustClip),
            -OPTIMIZATION_ENGINE_GRID.rl_logit_clip_abs,
            OPTIMIZATION_ENGINE_GRID.rl_logit_clip_abs
          )
        );
      }
      arm.updated_at = nowIso;

      state.baseline_reward =
        state.total_trials === 0 && updatedSteps === 0
          ? retG
          : (1 - emaAlpha) * state.baseline_reward + emaAlpha * retG;
      state.total_trials += 1;
      updatedSteps += 1;
      trajectoryReturns.push({
        step: t,
        arm_id: armId,
        discounted_return: roundNum(retG),
        advantage: roundNum(advantage),
        clipped_step: roundNum(clippedDelta),
      });
    }
  }

  // Evaluate Continuous Improvement Canary Gate (incumbent vs challenger promotion & auto-rollback)
  const allArms = [...armMap.values()];
  let incumbent = allArms.find((a) => a.role_state === "incumbent") || allArms[0] || null;
  if (incumbent && incumbent.role_state !== "incumbent") {
    incumbent.role_state = "incumbent";
  }

  let canaryEvent = "steady";
  if (incumbent) {
    const minTrials = OPTIMIZATION_ENGINE_GRID.canary_min_trials;
    const promoMargin = OPTIMIZATION_ENGINE_GRID.canary_promotion_margin_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
    const rollbackDrop = OPTIMIZATION_ENGINE_GRID.canary_rollback_drop_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;

    for (const arm of allArms) {
      if (arm.arm_id === incumbent.arm_id) continue;
      if (arm.pulls >= minTrials && arm.mean_reward < incumbent.mean_reward - rollbackDrop) {
        if (arm.role_state === "challenger" || arm.role_state === "candidate") {
          arm.role_state = "rolled_back";
          canaryEvent = `rolled_back:${arm.arm_id}`;
        }
      } else if (
        arm.pulls >= minTrials &&
        incumbent.pulls >= minTrials &&
        armLowerConfidenceBound(arm) >= incumbent.mean_reward + promoMargin
      ) {
        incumbent.role_state = "previous_incumbent";
        arm.role_state = "incumbent";
        canaryEvent = `promoted:${arm.arm_id}`;
        incumbent = arm;
      } else if (arm.role_state !== "rolled_back" && arm.mean_reward > incumbent.mean_reward) {
        arm.role_state = "challenger";
      }
    }
  }

  const activeChallenger = allArms.find((a) => a.role_state === "challenger") || null;
  state.canary = {
    incumbent_arm: incumbent ? incumbent.arm_id : null,
    challenger_arm: activeChallenger ? activeChallenger.arm_id : null,
    canary_share: roundNum(
      OPTIMIZATION_ENGINE_GRID.canary_traffic_share_milli / OPTIMIZATION_ENGINE_GRID.milli_scale
    ),
    last_event: canaryEvent,
  };

  if (updatedSteps > 0 || rawCandidateArms.length > 0) {
    const maxSqStore = OPTIMIZATION_ENGINE_GRID.abs_metric_clip * OPTIMIZATION_ENGINE_GRID.abs_metric_clip;
    const armStatements = allArms.map((arm) =>
      db
        .prepare(
          `INSERT INTO herma_rl_policy_state
            (scope_key, arm_id, pulls, mean_reward, sum_sq_reward, preference_logit, weights_json, role_state, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(scope_key, arm_id) DO UPDATE SET
            pulls = excluded.pulls,
            mean_reward = excluded.mean_reward,
            sum_sq_reward = excluded.sum_sq_reward,
            preference_logit = excluded.preference_logit,
            weights_json = excluded.weights_json,
            role_state = excluded.role_state,
            updated_at = excluded.updated_at`
        )
        .bind(
          scopeKey,
          arm.arm_id,
          arm.pulls,
          roundNum(arm.mean_reward),
          clampNum(arm.sum_sq_reward, 0, maxSqStore),
          roundNum(arm.preference_logit),
          JSON.stringify(stripPiiDeep(arm.weights)),
          arm.role_state,
          nowIso
        )
    );
    if (armStatements.length > 0) {
      if (typeof db.batch === "function") {
        await db.batch(armStatements);
      } else {
        for (const stmt of armStatements) await stmt.run();
      }
    }
    await saveCampaignMeta(db, state, nowIso);
  }

  // Contextual Softmax + UCB exploration action selection over eligible arms
  const contextFeatures = cleanFeatureBag(input.context_features);
  const eligibleArms = allArms.filter((a) => a.role_state !== "rolled_back");
  const poolArms = eligibleArms.length > 0 ? eligibleArms : allArms;
  const temperature =
    clampNum(
      input.temperature_milli ?? OPTIMIZATION_ENGINE_GRID.rl_temperature_milli,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_temperature_milli.low,
      OPTIMIZATION_ENGINE_GRID.grid_axes.rl_temperature_milli.high
    ) / OPTIMIZATION_ENGINE_GRID.milli_scale;
  const totalPulls = Math.max(1, poolArms.reduce((acc, a) => acc + a.pulls, 0));
  const ucbScale = OPTIMIZATION_ENGINE_GRID.ucb_exploration_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;

  let selectedArm = null;
  let selectedProb = 0;
  let canaryRouted = false;
  const probabilities = {};

  if (poolArms.length > 0) {
    const logits = poolArms.map((a) => {
      const ctxScore = dotFeatures(a.weights, contextFeatures);
      const ucbBonus = ucbScale * Math.sqrt(Math.log(totalPulls + 1) / (a.pulls + 1));
      return (a.preference_logit + ctxScore + ucbBonus) / temperature;
    });
    const maxLogit = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - maxLogit));
    const sumExp = exps.reduce((acc, v) => acc + v, 0) || 1;
    poolArms.forEach((a, idx) => {
      probabilities[a.arm_id] = roundNum(exps[idx] / sumExp);
    });

    const rng = makeRng(`${scopeKey}:${state.total_trials}:${JSON.stringify(contextFeatures)}`);
    const canaryShare = OPTIMIZATION_ENGINE_GRID.canary_traffic_share_milli / OPTIMIZATION_ENGINE_GRID.milli_scale;
    if (activeChallenger && rng() < canaryShare) {
      selectedArm = activeChallenger.arm_id;
      selectedProb = probabilities[selectedArm] ?? roundNum(canaryShare);
      canaryRouted = true;
    } else {
      let draw = rng();
      selectedArm = poolArms[poolArms.length - 1].arm_id;
      for (let i = 0; i < poolArms.length; i += 1) {
        const p = exps[i] / sumExp;
        if (draw <= p) {
          selectedArm = poolArms[i].arm_id;
          break;
        }
        draw -= p;
      }
      selectedProb = probabilities[selectedArm] ?? 1;
    }
  }

  return stripPiiDeep({
    ok: true,
    schema: "teleion.rl_policy_step.v1",
    campaign,
    operation: op,
    updated_steps: updatedSteps,
    baseline_reward: roundNum(state.baseline_reward),
    selected_arm: selectedArm,
    action_probability: roundNum(selectedProb),
    canary_routed: canaryRouted,
    canary_gate: state.canary,
    probabilities,
    trajectory_updates: trajectoryReturns,
    arms: allArms.map((a) => ({
      arm_id: a.arm_id,
      pulls: a.pulls,
      mean_reward: roundNum(a.mean_reward),
      lcb_reward: armLowerConfidenceBound(a),
      preference_logit: roundNum(a.preference_logit),
      role_state: a.role_state,
      weights: a.weights,
    })),
    inspect_url: shared
      ? `${publicUrl}/q/optimize?shared=1&campaign=${encodeURIComponent(campaign)}`
      : `${publicUrl}/q/optimize/${encodeURIComponent(agentId)}?campaign=${encodeURIComponent(campaign)}`,
  });
}

export function compileParameterizedMacroDag(publicUrl, input = {}) {
  const goal = cleanText(
    input.goal || input.title || "Build and validate parameterized multi-stage system",
    OPTIMIZATION_ENGINE_GRID.goal_max_chars
  );
  const campaign = cleanScopeSlug(input.campaign || goal.slice(0, OPTIMIZATION_ENGINE_GRID.short_id_chars));
  const targetCount = Math.round(
    clampNum(
      input.target_task_count ?? OPTIMIZATION_ENGINE_GRID.macro_dag_default_tasks,
      OPTIMIZATION_ENGINE_GRID.macro_dag_min_tasks,
      OPTIMIZATION_ENGINE_GRID.macro_dag_max_tasks
    )
  );

  const customPhases = Array.isArray(input.phases) && input.phases.length >= OPTIMIZATION_ENGINE_GRID.two_scalar
    ? input.phases.slice(0, OPTIMIZATION_ENGINE_GRID.macro_dag_max_phases).map((p, idx) => {
        if (typeof p === "string") {
          const slug = cleanIdent(p, `phase_${idx + 1}`).toLowerCase();
          return {
            phase_id: slug,
            title: cleanText(p, OPTIMIZATION_ENGINE_GRID.identifier_max_chars),
            output_fields: ["deliverable_summary", "artifact_keys", "check_status"],
          };
        }
        const slug = cleanIdent(p?.phase_id || p?.id || p?.title, `phase_${idx + 1}`).toLowerCase();
        return {
          phase_id: slug,
          title: cleanText(p?.title || slug, OPTIMIZATION_ENGINE_GRID.identifier_max_chars),
          output_fields: Array.isArray(p?.output_fields) && p.output_fields.length > 0
            ? p.output_fields.slice(0, OPTIMIZATION_ENGINE_GRID.default_axis_resolution).map((f) => cleanIdent(f)).filter(Boolean)
            : ["deliverable_summary", "artifact_keys", "check_status"],
        };
      })
    : DEFAULT_UNIVERSAL_PHASES;

  const humanGatePhases = new Set(
    Array.isArray(input.human_gate_phases)
      ? input.human_gate_phases
          .slice(0, OPTIMIZATION_ENGINE_GRID.macro_dag_max_phases)
          .map((p) => cleanIdent(p).toLowerCase())
      : []
  );

  const phaseCount = Math.min(customPhases.length, targetCount);
  const activePhases = customPhases.slice(0, phaseCount);
  const basePerPhase = Math.floor(targetCount / phaseCount);
  const remainder = targetCount % phaseCount;

  const stages = [];
  const tasks = [];
  let maxParallelWidth = 0;
  let globalIndex = 0;
  let previousStageAnchorIds = [];

  for (let pIdx = 0; pIdx < activePhases.length; pIdx += 1) {
    const phase = activePhases[pIdx];
    const countInPhase = basePerPhase + (pIdx < remainder ? 1 : 0);
    if (countInPhase > maxParallelWidth) maxParallelWidth = countInPhase;

    const stageTaskIds = [];
    const needsHumanLink = humanGatePhases.has(phase.phase_id);

    for (let slot = 0; slot < countInPhase; slot += 1) {
      globalIndex += 1;
      const stepId = `dag_${campaign}_s${pIdx + 1}_t${slot + 1}`;
      stageTaskIds.push(stepId);
      const dependsOn =
        pIdx === 0
          ? []
          : [previousStageAnchorIds[slot % previousStageAnchorIds.length]];

      tasks.push({
        step_id: stepId,
        sequence_number: globalIndex,
        stage_index: pIdx + 1,
        phase_id: phase.phase_id,
        title: `[Stage ${pIdx + 1}/${activePhases.length}] ${phase.title} (Unit ${slot + 1}/${countInPhase})`,
        depends_on: dependsOn,
        requires_human_one_use_link: needsHumanLink && slot === countInPhase - 1,
        tier: input.tier === "ngo_priority" ? "ngo_priority" : "public_general",
        output_contract: {
          strict: true,
          require_run_record: true,
          required_fields: phase.output_fields,
        },
        prompt: `Goal: ${goal}. Complete Stage ${pIdx + 1} (${phase.title}), Unit ${slot + 1} of ${countInPhase}. Emit a reusable Task Object satisfying required_fields (${phase.output_fields.join(", ")}) and attach a clean run_record.`,
      });
    }

    stages.push({
      stage_index: pIdx + 1,
      phase_id: phase.phase_id,
      title: phase.title,
      unit_count: countInPhase,
      step_ids: stageTaskIds,
    });
    previousStageAnchorIds = stageTaskIds;
  }

  return stripPiiDeep({
    ok: true,
    schema: "teleion.macro_dag_plan.v1",
    campaign,
    goal,
    total_tasks: tasks.length,
    critical_path_depth: stages.length,
    max_parallel_width: maxParallelWidth,
    root_ready_step_ids: stages[0] ? stages[0].step_ids : [],
    stages,
    tasks,
    enqueue_endpoint: `${publicUrl}/q/enqueue`,
  });
}

export async function inspectOptimizationCampaign(db, publicUrl, { agentId = "public", campaign = "default", shared = false } = {}) {
  const camp = cleanScopeSlug(campaign || "default");
  const scopeKey = buildOptimizationScopeKey(agentId, camp, shared);
  const state = await loadCampaignState(db, scopeKey, agentId, camp);
  const { bestCell: best } = annotateObservationsAndSelectBest(state.observations);
  return stripPiiDeep({
    ok: true,
    schema: "teleion.optimization_campaign_view.v1",
    scope_key: scopeKey,
    shared: Boolean(shared),
    campaign: camp,
    generation: state.generation,
    strategy: state.strategy,
    total_trials: state.total_trials,
    baseline_reward: roundNum(state.baseline_reward),
    axes: state.axes,
    constraints: state.constraints,
    best_cell: best
      ? {
          cell_key: best.cell_key,
          params: best.params,
          reward: roundNum(best.reward),
          cost_units: roundNum(best.cost_units),
          independent_check: best.independent_check,
        }
      : null,
    pareto_frontier: computeParetoFrontier(state.observations),
    boundary_expansions: detectBoundarySaturation(state.axes, best),
    canary_gate: state.canary,
    rl_arms: state.arms.map((a) => ({
      arm_id: a.arm_id,
      pulls: a.pulls,
      mean_reward: roundNum(a.mean_reward),
      lcb_reward: armLowerConfidenceBound(a),
      preference_logit: roundNum(a.preference_logit),
      role_state: a.role_state,
    })),
    post_endpoint: `${publicUrl}/q/optimize`,
  });
}

export function renderOptimizationCampaignText(view) {
  const lines = [
    "# Agent instructions: https://shim.teleionlabs.com/llms.txt",
    `OPTIMIZATION_CAMPAIGN: ${view.campaign}`,
    `GENERATION: ${view.generation}  STRATEGY: ${view.strategy}  TOTAL_TRIALS: ${view.total_trials}  BASELINE_REWARD: ${view.baseline_reward}`,
  ];
  if (view.best_cell) {
    lines.push(
      `BEST_CELL: ${view.best_cell.cell_key}  reward=${view.best_cell.reward}  cost=${view.best_cell.cost_units}`
    );
  }
  lines.push(`PARETO_COUNT: ${(view.pareto_frontier || []).length}`);
  for (const p of view.pareto_frontier || []) {
    lines.push(`  - ${p.cell_key} (reward=${p.reward}, cost=${p.cost_units})`);
  }
  lines.push(`RL_ARMS: ${(view.rl_arms || []).length}`);
  for (const a of view.rl_arms || []) {
    lines.push(`  - ${a.arm_id}: role=${a.role_state} pulls=${a.pulls} mean=${a.mean_reward} lcb=${a.lcb_reward}`);
  }
  return stripPii(lines.join("\n") + "\n");
}
