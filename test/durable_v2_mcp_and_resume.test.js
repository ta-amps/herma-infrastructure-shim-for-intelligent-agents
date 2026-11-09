import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { DURABLE_SESSION_GRID } from "../deploy/cloudflare/durable_session_and_dag.js";
import rawDurableSource from "../deploy/cloudflare/durable_session_and_dag.js?raw";
import worker from "../deploy/cloudflare/worker.js";

const BASE = "https://shim.teleionlabs.com";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const liveLikeEnv = { ...env, AGENT_NAME_CLAIMS: "on" };

let taskSeq = 0;
async function seedReadyTask(title = "Validate structured dataset schema") {
  taskSeq += 1;
  const id = `verb_dv2_${Date.now().toString(36)}_${taskSeq}`;
  const now = new Date().toISOString();
  await callWorker("/q/pulse");
  await env.HERMA_DB.prepare(
    `INSERT INTO herma_durable_queue
       (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, blocked_by_task_id, min_capability_milli)
     VALUES (?, 'ngo_priority', 'public_ngo', 95, ?, ?, '0', 'seed-maker-01', ?, ?, 'ready', '', 0)`
  )
    .bind(id, title, `Complete desk task: ${title} and report structured Task Objects.`, now, now)
    .run();
  return id;
}

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

describe("Teleion Fabric v2 Durable Session Hydrator, Checkpoints, Frontier Dedup, Contracts & 17-Tool MCP", () => {
  beforeEach(async () => {
    await seedReadyTask("Audit structured Task Object counts");
    await seedReadyTask("Verify reusable schema card");
  });

  it("enforces DURABLE_SESSION_GRID configuration governance, zero magic literals, and zero banned words", () => {
    expect(Object.isFrozen(DURABLE_SESSION_GRID)).toBe(true);
    expect(Object.isFrozen(DURABLE_SESSION_GRID.grid_axes)).toBe(true);
    expect(DURABLE_SESSION_GRID.resume_compact_target_bytes).toBeLessThanOrEqual(
      DURABLE_SESSION_GRID.resume_default_max_bytes
    );
    expect(DURABLE_SESSION_GRID.frontier_query_chunk_size).toBeLessThanOrEqual(
      DURABLE_SESSION_GRID.frontier_max_items_per_call
    );

    expect(rawDurableSource).not.toContain("\u2014");

    const bannedRoots = [
      /\bverif(?:y|ied|ies|ication|iable|ying)\b/i,
      /\breceipts?\b/i,
      /\bsha-?256\b/i,
      /\bhash(?:es|ed)?\b/i,
      /\bprove(?:[sd]|n)?\b/i,
      /\bconfirmed\b/i,
      /\bprovenance\b/i,
      /\bcryptographic\b/i,
      new RegExp("\\bsyn" + "thetic\\b", "i"),
    ];
    for (const re of bannedRoots) {
      expect(rawDurableSource).not.toMatch(re);
    }

    // Strip the frozen DURABLE_SESSION_GRID declaration, comments, regex literals, and string/template literals,
    // then confirm only canonical 0 / 1 numeric identities appear in operational logic.
    const afterGrid = rawDurableSource.slice(rawDurableSource.indexOf("const readyDurableTables"));
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

  it("blocks bare copy-paste placeholder IDs (your-agent-01, my-bot-01) and auto-mints unique IDs when auto_suffix=1", async () => {
    const blocked1 = await callWorker("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "your-agent-01" }),
    });
    expect(blocked1.status).toBe(409);
    const b1 = await blocked1.json();
    expect(b1.code).toBe("agent_id_too_common");
    expect(b1.next?.suggested_agent_id || b1.suggested_agent_id).toMatch(/^your-agent-01-[0-9a-f]{6}$/);

    const blocked2 = await callWorker("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "my-bot-01" }),
    });
    expect(blocked2.status).toBe(409);
    const b2 = await blocked2.json();
    expect(b2.code).toBe("agent_id_too_common");

    // GET /q/claim/your-agent-01?auto_suffix=1 passes guardGetWrite and mints a fresh ID + worker_token
    const autoGet = await callWorker("/q/claim/your-agent-01?auto_suffix=1");
    expect(autoGet.status).toBe(200);
    const gBody = await autoGet.json();
    expect(gBody.ok).toBe(true);
    expect(gBody.auto_assigned_agent_id).toBe(true);
    expect(gBody.resolved_agent_id).toMatch(/^your-agent-01-[0-9a-f]{6}$/);
    expect(gBody.worker_token).toMatch(/^wt_[0-9a-f]{24,}$/);
    expect(gBody.lease?.task_id).toBeTruthy();

    // Release the GET-claimed lease using X-Worker-Token header so the ready pool stays clean
    const relGet = await callWorker("/q/release", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-token": gBody.worker_token,
      },
      body: JSON.stringify({
        agent_id: gBody.resolved_agent_id,
        task_id: gBody.lease.task_id,
        fencing_token: gBody.lease.fencing_token,
        reason: "test_cleanup",
      }),
    });
    expect(relGet.status).toBe(200);
  });

  it("saves step checkpoints, extends active leases, strips PII, and gates fencing_token on /q/resume token_matched", async () => {
    const schemaRes = await callWorker("/q/checkpoint");
    expect(schemaRes.status).toBe(200);
    const schemaDoc = await schemaRes.json();
    expect(schemaDoc.schema).toBe("shim.session_checkpoint.v1");

    const claimRes = await callWorker("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "my-bot-01", auto_suffix: true }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    const agentId = claimed.resolved_agent_id;
    const workerToken = claimed.worker_token;
    const taskId = claimed.lease.task_id;
    const fence = claimed.lease.fencing_token;

    const cpRes = await callWorker("/q/checkpoint", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-token": workerToken,
      },
      body: JSON.stringify({
        agent_id: agentId,
        task_id: taskId,
        fencing_token: fence,
        step_index: 2,
        total_steps: 4,
        completed_steps: ["Read task instructions", "Queried catalog"],
        pending_steps: ["Run validation checks", "Submit Task Object"],
        notes: "Contacted jane.doe@private-mailbox.test during step 2.",
        artifact_keys: ["obj:checkpoint-draft-v1"],
        seen_items: ["alpha/repo-one", "beta/repo-two"],
        campaign: "nightly-sweep",
      }),
    });
    expect(cpRes.status).toBe(200);
    const cpBody = await cpRes.json();
    expect(cpBody.ok).toBe(true);
    expect(cpBody.lease_extended).toBe(true);
    expect(cpBody.checkpoint.step_index).toBe(2);
    expect(cpBody.checkpoint.total_steps).toBe(4);
    expect(cpBody.checkpoint.notes).not.toContain("jane.doe@private-mailbox.test");
    expect(cpBody.checkpoint.notes).toContain("[email]");
    expect(cpBody.frontier?.newly_recorded).toBe(2);

    // URL-mode GET /q/checkpoint works with ?wt= while link-preview bots are stopped by guardGetWrite
    const previewRes = await callWorker(
      `/q/checkpoint/${encodeURIComponent(agentId)}/${encodeURIComponent(taskId)}/step-3-of-4--done-ran-checks`,
      { headers: { "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" } }
    );
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.code).toBe("nothing_done_for_link_preview");

    const urlCpRes = await callWorker(
      `/q/checkpoint/${encodeURIComponent(agentId)}/${encodeURIComponent(taskId)}/step-3-of-4--done-read--done-queried--done-checked--pending-submit?wt=${encodeURIComponent(workerToken)}`
    );
    expect(urlCpRes.status).toBe(200);
    const urlCp = await urlCpRes.json();
    expect(urlCp.checkpoint.step_index).toBe(3);

    // SECURITY INVARIANT: Unauthenticated /q/resume/<id> MUST NOT leak fencing_token
    const unauthRes = await callWorker(`/q/resume/${encodeURIComponent(agentId)}?campaign=nightly-sweep`);
    expect(unauthRes.status).toBe(200);
    const unauthRaw = await unauthRes.text();
    const unauthJson = JSON.parse(unauthRaw);
    expect(unauthJson.token_matched).toBe(false);
    expect(unauthJson.active_leases.length).toBeGreaterThanOrEqual(1);
    expect(unauthJson.active_leases[0].task_id).toBe(taskId);
    expect(unauthJson.active_leases[0].fencing_token).toBeUndefined();
    expect(unauthJson.active_leases[0].heartbeat_url).toBeUndefined();
    expect(unauthJson.active_leases[0].give_back_url).toBeUndefined();
    expect(unauthRaw).not.toContain(`"fencing_token":`);

    // Wrong token also gets token_matched: false and zero fencing_token disclosure
    const wrongTokRes = await callWorker(`/q/resume/${encodeURIComponent(agentId)}`, {
      headers: { "x-worker-token": "wt_00000000000000000000000000000000" },
    });
    const wrongTokJson = await wrongTokRes.json();
    expect(wrongTokJson.token_matched).toBe(false);
    expect(wrongTokJson.active_leases[0].fencing_token).toBeUndefined();

    // Authenticated /q/resume/<id> with X-Worker-Token returns fencing_token + checkpoint + frontier count
    const authRes = await callWorker(`/q/resume/${encodeURIComponent(agentId)}?campaign=nightly-sweep`, {
      headers: { "x-worker-token": workerToken },
    });
    expect(authRes.status).toBe(200);
    const authJson = await authRes.json();
    expect(authJson.token_matched).toBe(true);
    expect(authJson.active_leases[0].fencing_token).toBe(fence);
    expect(authJson.checkpoints[0].step_index).toBe(3);
    expect(authJson.frontier.seen_count).toBe(2);
    expect(authJson.next.action).toBe("finish_active_lease");

    // Plain-text .txt hydrator stays < 1.5 KB and respects token_matched gating
    const unauthTxtRes = await callWorker(`/q/resume/${encodeURIComponent(agentId)}.txt`);
    const unauthTxt = await unauthTxtRes.text();
    expect(unauthTxt).toContain("TOKEN_MATCHED: no");
    expect(unauthTxt).toContain("FENCING_TOKEN: (send header X-Worker-Token or ?wt= to show)");
    expect(unauthTxt).not.toContain(`FENCING_TOKEN: ${fence}`);

    const authTxtRes = await callWorker(`/q/resume/${encodeURIComponent(agentId)}.txt?campaign=nightly-sweep`, {
      headers: { "x-worker-token": workerToken },
    });
    expect(authTxtRes.headers.get("content-type")).toContain("text/plain");
    const authTxt = await authTxtRes.text();
    expect(new TextEncoder().encode(authTxt).byteLength).toBeLessThan(1500);
    expect(authTxt).toContain("TOKEN_MATCHED: yes");
    expect(authTxt).toContain(`FENCING_TOKEN: ${fence}`);
    expect(authTxt).toContain("FRONTIER_SEEN: 2");

    // Release active lease
    const rel = await callWorker("/q/release", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, task_id: taskId, fencing_token: fence, reason: "test_done" }),
    });
    expect(rel.status).toBe(200);
  });

  it("deduplicates sweep items via /q/frontier and filters /q/next?unseen_only=1 and /q/discover?unseen_by=", async () => {
    const agentId = `frontier-sweeper-${crypto.randomUUID().slice(0, 6)}`;
    const onboardRes = await callWorker(`/q/onboard/${agentId}?format=json`);
    expect(onboardRes.status).toBe(200);
    const onboard = await onboardRes.json();
    const workerToken = onboard.worker_token;

    // Read-only GET check does not record
    const checkOnly = await callWorker(
      `/q/frontier?agent_id=${agentId}&campaign=cv-sweep&items=org/one,org/two`
    );
    expect(checkOnly.status).toBe(200);
    const c1 = await checkOnly.json();
    expect(c1.unseen).toEqual(["org/one", "org/two"]);
    expect(c1.newly_recorded).toBe(0);
    expect(c1.total_seen_in_scope).toBe(0);

    // POST records unseen items, then partitions seen vs unseen on subsequent sweeps
    const rec1 = await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, campaign: "cv-sweep", items: ["org/one", "org/two"] }),
    });
    expect(rec1.status).toBe(200);
    const r1 = await rec1.json();
    expect(r1.newly_recorded).toBe(2);
    expect(r1.total_seen_in_scope).toBe(2);

    const rec2 = await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, campaign: "cv-sweep", items: ["org/two", "org/three"] }),
    });
    const r2 = await rec2.json();
    expect(r2.already_seen).toEqual(["org/two"]);
    expect(r2.unseen).toEqual(["org/three"]);
    expect(r2.newly_recorded).toBe(1);
    expect(r2.total_seen_in_scope).toBe(3);

    // Filter /q/next?unseen_only=1
    const baseNext = await callWorker(`/q/next?agent_id=${agentId}&limit=5`);
    const baseNextBody = await baseNext.json();
    expect(baseNextBody.tasks.length).toBeGreaterThan(0);
    const firstReadyTaskId = baseNextBody.tasks[0].task_id;

    await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, campaign: "default", items: [firstReadyTaskId] }),
    });

    const filteredNext = await callWorker(`/q/next?agent_id=${agentId}&limit=5&unseen_only=1`);
    const filteredNextBody = await filteredNext.json();
    expect(filteredNextBody.tasks.some((t) => t.task_id === firstReadyTaskId)).toBe(false);
    expect(filteredNextBody.left_out.seen_in_frontier).toBeGreaterThanOrEqual(1);

    // Filter /q/discover?unseen_by=
    const catBase = await callWorker("/q/discover?category=video_as_code&limit=5");
    const catBaseBody = await catBase.json();
    const firstEntry = catBaseBody.entries[0];
    expect(firstEntry?.id).toBeTruthy();

    await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, campaign: "discover-pass", items: [firstEntry.id] }),
    });

    const catUnseen = await callWorker(
      `/q/discover?category=video_as_code&limit=5&unseen_by=${agentId}&campaign=discover-pass`
    );
    const catUnseenBody = await catUnseen.json();
    expect(catUnseenBody.entries.some((e) => e.id === firstEntry.id)).toBe(false);
    expect(catUnseenBody.filters.unseen_by).toBe(agentId);
  });

  it("warns by default on declared-count vs array-length drift (24 vs 23) and refuses with 422 when strict_contract=true", async () => {
    // 1. /q/schema/validate catches 24 vs 23 in advisory mode and error mode
    const twentyThree = Array.from({ length: 23 }, (_, i) => ({ id: `item-${i + 1}` }));
    const valAdvisory = await callWorker("/q/schema/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "contract-tester-77b1",
        task_id: "self_seed",
        summary: "Sweep report: 24 qualifying items while summary lists 23.",
        task_objects: [
          {
            object_key: "obj:sweep-pack-01",
            kind: "dataset",
            title: "Sweep curation batch",
            payload: { qualifying_count: 24, qualifying: twentyThree },
          },
        ],
      }),
    });
    expect(valAdvisory.status).toBe(200);
    const advDoc = await valAdvisory.json();
    expect(advDoc.valid).toBe(true);
    expect(advDoc.contract_clean).toBe(false);
    expect(advDoc.contract_issues.some((i) => i.code === "cardinality_mismatch")).toBe(true);

    // Paginated slices (limit/has_more) do NOT trigger false-positive cardinality mismatches
    const valPaged = await callWorker("/q/schema/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "contract-tester-77b1",
        task_id: "self_seed",
        summary: "Paginated slice of 5 items out of 24.",
        task_objects: [
          {
            object_key: "obj:sweep-page-01",
            kind: "dataset",
            title: "Sweep page 1",
            payload: { qualifying_count: 24, qualifying: twentyThree.slice(0, 5), limit: 5, has_more: true },
          },
        ],
      }),
    });
    const pagedDoc = await valPaged.json();
    expect(pagedDoc.valid).toBe(true);
    expect(pagedDoc.contract_clean).toBe(true);

    // 2. Backwards-compatible default POST /q/submit succeeds 200 with contract_warnings
    const compatAgent = `contract-compat-${crypto.randomUUID().slice(0, 6)}`;
    const defaultSub = await callWorker("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: compatAgent,
        task_id: "self_seed",
        summary: "Completed sweep curation batch with one dropped row.",
        task_objects: [
          {
            object_key: `obj:compat-sweep-${compatAgent}`,
            kind: "dataset",
            title: "Compat sweep batch",
            payload: { qualifying_count: 24, qualifying: twentyThree },
          },
        ],
      }),
    });
    expect(defaultSub.status).toBe(200);
    const defaultSubBody = await defaultSub.json();
    expect(defaultSubBody.ok).toBe(true);
    expect(defaultSubBody.contract_clean).toBe(false);
    expect(Array.isArray(defaultSubBody.contract_warnings)).toBe(true);
    expect(defaultSubBody.contract_warnings.length).toBeGreaterThanOrEqual(1);

    // 3. Strict contract refuses 422 on count mismatch, missing required_fields, or nonzero run_record.exit_code
    const strictFail = await callWorker("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": defaultSubBody.worker_token },
      body: JSON.stringify({
        agent_id: compatAgent,
        task_id: "self_seed",
        strict_contract: true,
        summary: "Strict submission check.",
        output_contract: { required_fields: ["qualifying", "domain_summary"], strict: true },
        run_record: { exit_code: 1, tests_passed: 9, tests_total: 10 },
        task_objects: [
          {
            object_key: `obj:strict-sweep-${compatAgent}`,
            kind: "dataset",
            title: "Strict sweep batch",
            payload: { qualifying_count: 24, qualifying: twentyThree },
          },
        ],
      }),
    });
    expect(strictFail.status).toBe(422);
    const strictFailBody = await strictFail.json();
    expect(strictFailBody.ok).toBe(false);
    const codes = strictFailBody.contract_issues.map((i) => i.code);
    expect(codes).toContain("cardinality_mismatch");
    expect(codes).toContain("missing_contract_fields");
    expect(codes).toContain("nonzero_run_record_exit");

    // Fixing count, required_fields, and run_record passes strict_contract=true with 200
    const strictPass = await callWorker("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": defaultSubBody.worker_token },
      body: JSON.stringify({
        agent_id: compatAgent,
        task_id: "self_seed",
        strict_contract: true,
        summary: "Strict submission repaired and complete.",
        output_contract: { required_fields: ["qualifying", "domain_summary"], strict: true },
        run_record: { exit_code: 0, tests_passed: 10, tests_total: 10, output_digest: "clean-pass-v1" },
        task_objects: [
          {
            object_key: `obj:strict-sweep-${compatAgent}`,
            kind: "dataset",
            title: "Strict sweep batch",
            payload: {
              qualifying_count: 23,
              qualifying: twentyThree,
              domain_summary: "All 23 items accounted for.",
            },
          },
        ],
      }),
    });
    expect(strictPass.status).toBe(200);
    const strictPassBody = await strictPass.json();
    expect(strictPassBody.ok).toBe(true);
    expect(strictPassBody.contract_clean).toBe(true);
  });

  it("drives the full 24-tool stateless MCP lifecycle without shell quoting or masked worker_tokens", async () => {
    const listRpc = await callMcp("tools/list");
    const tools = listRpc.result.tools;
    expect(tools.length).toBe(24);
    const names = new Set(tools.map((t) => t.name));
    for (const expected of [
      "search",
      "list_task_objects",
      "read_task_object",
      "list_tasks",
      "read_task",
      "find",
      "list_builtin_provisions",
      "preview_shim",
      "extract_entities",
      "next_tasks",
      "resume_session",
      "claim_task",
      "heartbeat_task",
      "checkpoint_task",
      "submit_task",
      "release_task",
      "frontier_dedup",
      "grid_optimize",
      "rl_policy_step",
      "compile_macro_dag",
      "bootstrap_local_cell",
      "list_weight_models",
      "run_weight_model",
      "register_weight_model",
    ]) {
      expect(names.has(expected)).toBe(true);
    }

    // 1. claim_task with auto_suffix=true on placeholder ID returns unmasked wt_... token
    const claimRpc = await callMcp("tools/call", {
      name: "claim_task",
      arguments: { agent_id: "your-agent-01", auto_suffix: true },
    });
    expect(claimRpc.result.isError).toBe(false);
    const claimData = claimRpc.result.structuredContent;
    expect(claimData.auto_assigned_agent_id).toBe(true);
    expect(claimData.worker_token).toMatch(/^wt_[0-9a-f]{24,}$/);
    expect(claimData.agent_claim?.worker_token).toBe(claimData.worker_token);

    const agentId = claimData.resolved_agent_id;
    const workerToken = claimData.worker_token;
    const taskId = claimData.lease.task_id;
    const fence = claimData.lease.fencing_token;

    // 2. checkpoint_task over MCP
    const cpRpc = await callMcp("tools/call", {
      name: "checkpoint_task",
      arguments: {
        agent_id: agentId,
        worker_token: workerToken,
        task_id: taskId,
        fencing_token: fence,
        step_index: 1,
        total_steps: 2,
        completed_steps: ["Drafted structured analysis"],
        pending_steps: ["Submit typed JSON via submit_task"],
      },
    });
    expect(cpRpc.result.isError).toBe(false);
    expect(cpRpc.result.structuredContent.lease_extended).toBe(true);

    // 3. heartbeat_task over MCP
    const hbRpc = await callMcp("tools/call", {
      name: "heartbeat_task",
      arguments: {
        agent_id: agentId,
        worker_token: workerToken,
        task_id: taskId,
        fencing_token: fence,
        progress_note: "Halfway through validation",
      },
    });
    expect(hbRpc.result.isError).toBe(false);

    // 4. resume_session over MCP: gated without worker_token, full fence with worker_token
    const resNoTok = await callMcp("tools/call", {
      name: "resume_session",
      arguments: { agent_id: agentId, compact: true },
    });
    expect(resNoTok.result.isError).toBe(false);
    expect(resNoTok.result.structuredContent.token_matched).toBe(false);
    expect(resNoTok.result.structuredContent.active_leases[0].fencing_token).toBeUndefined();

    const resWithTok = await callMcp("tools/call", {
      name: "resume_session",
      arguments: { agent_id: agentId, worker_token: workerToken, compact: true },
    });
    expect(resWithTok.result.isError).toBe(false);
    expect(resWithTok.result.structuredContent.token_matched).toBe(true);
    expect(resWithTok.result.structuredContent.active_leases[0].fencing_token).toBe(fence);

    // 5. frontier_dedup + next_tasks over MCP
    const dedupRpc = await callMcp("tools/call", {
      name: "frontier_dedup",
      arguments: {
        agent_id: agentId,
        worker_token: workerToken,
        items: ["mcp/item-1", "mcp/item-2"],
        record: true,
      },
    });
    expect(dedupRpc.result.isError).toBe(false);
    expect(dedupRpc.result.structuredContent.newly_recorded).toBe(2);

    const nextRpc = await callMcp("tools/call", {
      name: "next_tasks",
      arguments: { agent_id: agentId, limit: 3, unseen_only: true },
    });
    expect(nextRpc.result.isError).toBe(false);
    expect(Array.isArray(nextRpc.result.structuredContent.tasks)).toBe(true);

    // 6. submit_task over MCP with quotes, newlines, and nested JSON (zero bash quoting!)
    const subRpc = await callMcp("tools/call", {
      name: "submit_task",
      arguments: {
        agent_id: agentId,
        worker_token: workerToken,
        task_id: taskId,
        fencing_token: fence,
        strict_contract: true,
        summary: 'Completed typed MCP submission with "double quotes", \'single quotes\', and zero truncation.',
        run_record: { exit_code: 0, tests_passed: 5, tests_total: 5, output_digest: "mcp-typed-v1" },
        task_objects: [
          {
            object_key: `obj:mcp-lifecycle-${agentId}`,
            kind: "record",
            title: "Typed MCP Lifecycle Output",
            payload: {
              items_count: 2,
              items: ["alpha", "beta"],
              quoted_note: 'Safe JSON-RPC transport: no $VAR or `backtick` mangling.',
            },
          },
        ],
      },
    });
    expect(subRpc.result.isError).toBe(false);
    expect(subRpc.result.structuredContent.ok).toBe(true);
    expect(subRpc.result.structuredContent.contract_clean).toBe(true);

    // 7. Claim a second Task and give it back cleanly via release_task
    const claim2Rpc = await callMcp("tools/call", {
      name: "claim_task",
      arguments: { agent_id: agentId, worker_token: workerToken },
    });
    expect(claim2Rpc.result.isError).toBe(false);
    const task2 = claim2Rpc.result.structuredContent.lease;
    if (task2?.task_id) {
      const relRpc = await callMcp("tools/call", {
        name: "release_task",
        arguments: {
          agent_id: agentId,
          worker_token: workerToken,
          task_id: task2.task_id,
          fencing_token: task2.fencing_token,
          reason: "mcp_release_smoke_done",
        },
      });
      expect(relRpc.result.isError).toBe(false);
      expect(relRpc.result.structuredContent.ok).toBe(true);
    }
  });

  it("blocks uppercase WT_ credential leaks, handles >200 discover catalog items, protects MCP resume_session on .txt/.., and never shortens longer leases", async () => {
    const agentId = `sec-reg-${crypto.randomUUID().slice(0, 6)}`;
    const claimRes = await callWorker("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, lease_seconds: 3600 }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    const workerToken = claimed.worker_token;
    const taskId = claimed.lease.task_id;
    const fence = claimed.lease.fencing_token;
    const initialExpiryMs = Date.parse(claimed.lease.lease_expires_at);

    // 1. Uppercase WT_<32hex> posted to /q/frontier is stripped and never leaked on unauthenticated GET /q/frontier
    const fakeUpperSecret = "WT_ABCDEF0123456789ABCDEF0123456789";
    const postFrontier = await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, items: [fakeUpperSecret, "safe/item-alpha"] }),
    });
    expect(postFrontier.status).toBe(200);
    const pubFrontier = await callWorker(`/q/frontier?agent_id=${agentId}`);
    const pubFrontierText = await pubFrontier.text();
    expect(pubFrontierText.toLowerCase()).not.toContain("abcdef0123456789abcdef0123456789");

    // 2. /q/discover?unseen_by=<agent> filters late-alphabetical catalog entries well past item #67 (>200 candidate keys)
    const latePageRes = await callWorker("/q/discover?offset=200&limit=5");
    const latePage = await latePageRes.json();
    expect(latePage.entries.length).toBeGreaterThan(0);
    const lateTarget = latePage.entries[0];
    const markLate = await callWorker("/q/frontier", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, items: [lateTarget.id] }),
    });
    expect(markLate.status).toBe(200);
    const filteredLateRes = await callWorker(`/q/discover?unseen_by=${agentId}&q=${encodeURIComponent(lateTarget.name)}`);
    const filteredLate = await filteredLateRes.json();
    expect(filteredLate.entries.map((e) => e.id)).not.toContain(lateTarget.id);

    // 3. MCP resume_session handles agent_id ending in .txt and ".." without 500 or path traversal
    for (const trickyAgent of ["agent-dot.txt", ".."]) {
      const rpc = await callMcp("tools/call", {
        name: "resume_session",
        arguments: { agent_id: trickyAgent },
      });
      expect(rpc.error).toBeUndefined();
      expect(rpc.result).toBeTruthy();
      expect(rpc.result.structuredContent).toBeTruthy();
    }

    // 4. Checkpoint never shortens an active 3600s lease down to 900s
    const cpRes = await callWorker("/q/checkpoint", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({
        agent_id: agentId,
        task_id: taskId,
        fencing_token: fence,
        step_index: 1,
        total_steps: 2,
        completed_steps: ["step1"],
      }),
    });
    expect(cpRes.status).toBe(200);
    const cpJson = await cpRes.json();
    expect(cpJson.lease_extended).toBe(true);
    expect(Date.parse(cpJson.lease_expires_at)).toBeGreaterThanOrEqual(initialExpiryMs);

    // Release lease cleanly
    await callWorker("/q/release", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": workerToken },
      body: JSON.stringify({ agent_id: agentId, task_id: taskId, fencing_token: fence, reason: "sec_reg_done" }),
    });
  });
});
