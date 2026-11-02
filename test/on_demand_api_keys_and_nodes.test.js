import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://herma.ta-amps.workers.dev";

async function callGateway(path, init = {}) {
  return exports.default.fetch(BASE + path, init);
}

describe("Universal On-Demand TaskObject API Runtime, Scoped Key Vault & Swappable Backend Nodes", () => {
  it("mints, verifies, rotates, and revokes SHA-256 scoped worker, endpoint, and infra keys while blocking plaintext secret leaks", async () => {
    const adminSecret = env.HERMA_ADMIN_TOKEN || env.BOOTSTRAP_SECRET || env.EDGE_SECRET || "";

    // 1. Onboard a worker via POST to receive initial worker_token
    const onboardRes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "key-vault-worker", mint_new: true }),
    });
    expect(onboardRes.status).toBe(200);
    const onboardDoc = await onboardRes.json();
    const workerUuid = onboardDoc.worker_profile.worker_uuid;
    const workerToken = onboardDoc.worker_token;
    expect(workerToken.startsWith("wt_")).toBe(true);

    // 2. Public worker CANNOT mint an infra key -> 403
    const forbidInfraRes = await callGateway("/q/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "key-vault-worker",
        worker_uuid: workerUuid,
        worker_token: workerToken,
        key_class: "infra",
      }),
    });
    expect(forbidInfraRes.status).toBe(403);

    // 3. Verified worker mints a scoped hk_wrk_* worker key
    const mintWrkRes = await callGateway("/q/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "key-vault-worker",
        worker_uuid: workerUuid,
        worker_token: workerToken,
        key_class: "worker",
        label: "ci-runner-worker-key",
        rate_limit_rpm: 180,
      }),
    });
    expect(mintWrkRes.status).toBe(201);
    const mintWrkDoc = await mintWrkRes.json();
    expect(mintWrkDoc.api_key.startsWith("hk_wrk_")).toBe(true);
    const wrkKeyId = mintWrkDoc.key.key_id;

    // 4. Verify raw D1 table stores ONLY non-reversible SHA-256 digest (ZERO plaintext secret!)
    const rawRow = await env.HERMA_DB.prepare("SELECT * FROM herma_scoped_keys WHERE key_id = ?")
      .bind(wrkKeyId)
      .first();
    expect(rawRow.key_sha256).toHaveLength(64);
    expect(JSON.stringify(rawRow)).not.toContain(mintWrkDoc.api_key);

    // 5. Reject accidental submission of plaintext capability token inside a public TaskObject
    const leakAttemptRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "key-vault-worker",
        worker_uuid: workerUuid,
        worker_token: mintWrkDoc.api_key,
        task_id: "self_seed",
        summary: "Attempt accidental secret leak",
        task_objects: [
          {
            object_key: "accidental_leak_obj_v1",
            category: "config",
            summary: "Bad config",
            payload: { leaked_token: mintWrkDoc.api_key },
          },
        ],
      }),
    });
    expect(leakAttemptRes.status).toBe(403);
    const leakDoc = await leakAttemptRes.json();
    expect(leakDoc.code).toBe("plaintext_secret_rejected");

    // 6. Rotate key -> old key fails immediately, new key verifies cleanly
    const rotateRes = await callGateway("/q/keys/rotate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-herma-api-key": mintWrkDoc.api_key,
      },
      body: JSON.stringify({ key_id: wrkKeyId }),
    });
    expect(rotateRes.status).toBe(200);
    const rotateDoc = await rotateRes.json();
    expect(rotateDoc.api_key.startsWith("hk_wrk_")).toBe(true);
    expect(rotateDoc.rotated_from_key_id).toBe(wrkKeyId);

    const oldVerifyRes = await callGateway("/q/keys/verify", {
      method: "POST",
      headers: { "x-herma-api-key": mintWrkDoc.api_key },
    });
    expect(oldVerifyRes.status).toBe(401);

    const newVerifyRes = await callGateway("/q/keys/verify", {
      method: "POST",
      headers: { "x-herma-api-key": rotateDoc.api_key },
    });
    expect(newVerifyRes.status).toBe(200);

    // 7. Admin mints an hk_inf_* infra key and uses it to view server_infra pulse
    if (adminSecret) {
      const mintInfRes = await callGateway("/q/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-herma-admin-token": adminSecret,
        },
        body: JSON.stringify({
          key_class: "infra",
          label: "scoped-telemetry-infra-key",
          scopes: ["infra:private_queue", "infra:manage_nodes"],
        }),
      });
      expect(mintInfRes.status).toBe(201);
      const mintInfDoc = await mintInfRes.json();
      expect(mintInfDoc.api_key.startsWith("hk_inf_")).toBe(true);

      const infPulseRes = await callGateway("/q/pulse", {
        headers: { "x-herma-api-key": mintInfDoc.api_key },
      });
      expect(infPulseRes.status).toBe(200);
      const infPulse = await infPulseRes.json();
      expect(infPulse.caller_role).toBe("server_infrastructure_worker");

      // Revoke infra key -> drops back to public_or_volunteer_worker
      const revRes = await callGateway("/q/keys/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-herma-admin-token": adminSecret,
        },
        body: JSON.stringify({ key_id: mintInfDoc.key.key_id }),
      });
      expect(revRes.status).toBe(200);

      const postRevPulse = await (
        await callGateway("/q/pulse", {
          headers: { "x-herma-api-key": mintInfDoc.api_key },
        })
      ).json();
      expect(postRevPulse.caller_role).toBe("public_or_volunteer_worker");
    }
  });

  it("spins up a live 7-Gate On-Demand TaskObject API (/q/api/<key>) with SC-0 sieve, SC-2 Lambda-Delta 0.62 crossover, SC-3 joins/formulas, SC-4 fuzzy margin, SC-6 async 202 bulkhead, and observe=shadow", async () => {
    // 1. Onboard owner worker
    const onb = await (
      await callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "endpoint-architect", mint_new: true }),
      })
    ).json();

    // 2. Publish a companion lookup TaskObject for cross-object join testing
    await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "endpoint-architect",
        worker_uuid: onb.worker_profile.worker_uuid,
        worker_token: onb.worker_token,
        task_id: "self_seed",
        summary: "Seed cohort metadata lookup table",
        task_objects: [
          {
            object_key: "cohort_tier_lookup_v1",
            category: "reference_table",
            summary: "Universal cohort SLA metadata",
            payload: {
              records: [
                { id: "coh_alpha", sla_tier: "mission_critical" },
                { id: "coh_beta", sla_tier: "standard_batch" },
              ],
            },
          },
        ],
      }),
    });

    // 3. Register a protected On-Demand TaskObject API endpoint (`auth_mode: "endpoint_key"`)
    const regRes = await callGateway("/q/endpoints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "endpoint-architect",
        worker_uuid: onb.worker_profile.worker_uuid,
        worker_token: onb.worker_token,
        object_key: "api_entity_obligations_v1",
        summary: "7-Gate Lambda-Delta Entity Envelope & Obligation API",
        api_endpoint: {
          title: "Entity Envelope Rollup & Fuzzy Clause API",
          auth_mode: "endpoint_key",
          primary_key: "id",
          id_prefix: "ent_",
          dirty_crossover_threshold: 0.62,
          tau_margin: 0.14,
          join_object_key: "cohort_tier_lookup_v1",
          join_local_field: "cohort_id",
          join_foreign_field: "id",
          computed_fields: {
            net_headroom: "round(limit_units - committed_units, 2)",
            utilization_ratio: "clamp(committed_units / limit_units, 0, 1)",
          },
          fuzzy_fields: ["title", "descriptor", "tags"],
          escalate_to_queue: true,
          records: [
            {
              id: "ent_101",
              cohort_id: "coh_alpha",
              title: "Ed25519 Signed Offline Queue Checkpoint Envelope",
              descriptor: "monotonic fencing lease replay with cryptographic signature",
              limit_units: 1000,
              committed_units: 250,
            },
            {
              id: "ent_102",
              cohort_id: "coh_beta",
              title: "Multilingual Civic Directory Normalization Pipeline",
              descriptor: "seven language unicode canonicalizer and hours parser",
              limit_units: 500,
              committed_units: 100,
            },
            {
              id: "ent_103",
              cohort_id: "coh_alpha",
              title: "Partitioned SimHash LSH Band Deduplicator",
              descriptor: "sublinear near duplicate blocking and trigram reranker",
              limit_units: 800,
              committed_units: 200,
            },
          ],
        },
      }),
    });
    expect(regRes.status).toBe(201);

    // 4. Unauthenticated invocation fails closed (`401 endpoint_key_required`)
    const unauthRes = await callGateway("/q/api/api_entity_obligations_v1?id=ent_101");
    expect(unauthRes.status).toBe(401);

    // 5. Mint a scoped `hk_ep_*` key bound strictly to `api_entity_obligations_v1` (with `api:write_delta`)
    const epKeyDoc = await (
      await callGateway("/q/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "endpoint-architect",
          worker_uuid: onb.worker_profile.worker_uuid,
          worker_token: onb.worker_token,
          key_class: "endpoint",
          allowed_endpoints: ["api_entity_obligations_v1"],
          scopes: ["api:invoke", "api:write_delta"],
        }),
      })
    ).json();
    expect(epKeyDoc.api_key.startsWith("hk_ep_")).toBe(true);
    const epHeaders = { "x-herma-api-key": epKeyDoc.api_key, "content-type": "application/json" };

    // 6. Gate SC-0: Definite negative prefix miss (`bad_999` lacks `ent_` prefix) -> 0 tokens, found=false
    const sc0Res = await callGateway("/q/api/api_entity_obligations_v1?id=bad_999", { headers: epHeaders });
    expect(sc0Res.status).toBe(200);
    const sc0Doc = await sc0Res.json();
    expect(sc0Doc.gate).toBe("SC-0_negative_sieve");
    expect(sc0Doc.short_circuited).toBe(true);
    expect(sc0Doc.found).toBe(false);

    // 7. Observe=shadow delta preview -> does NOT mutate state!
    const shadowDeltaRes = await callGateway("/q/api/api_entity_obligations_v1/_delta?observe=shadow", {
      method: "POST",
      headers: epHeaders,
      body: JSON.stringify({ entity_id: "ent_101", op_kind: "increment", delta: { committed_units: 150 } }),
    });
    expect(shadowDeltaRes.status).toBe(200);
    const shadowDeltaDoc = await shadowDeltaRes.json();
    expect(shadowDeltaDoc.mutations_suppressed).toBe(true);

    // 8. Real intraday delta mutation (`1 / 3 = 0.3333 < 0.62` -> Gate SC-2 Lambda-Delta Rollup, 100% fresh!)
    const realDeltaRes = await callGateway("/q/api/api_entity_obligations_v1/_delta", {
      method: "POST",
      headers: epHeaders,
      body: JSON.stringify({ entity_id: "ent_101", op_kind: "increment", delta: { committed_units: 150 } }),
    });
    expect(realDeltaRes.status).toBe(201);

    const sc2Res = await callGateway("/q/api/api_entity_obligations_v1?id=ent_101&bypass_cache=1", {
      headers: epHeaders,
    });
    expect(sc2Res.status).toBe(200);
    const sc2Doc = await sc2Res.json();
    expect(sc2Doc.gate).toBe("SC-2_lambda_delta_rollup");
    expect(sc2Doc.result.committed_units).toBe(400); // 250 + 150 intraday delta!
    expect(sc2Doc.result.net_headroom).toBe(600); // safe formula: 1000 - 400
    expect(sc2Doc.result.utilization_ratio).toBe(0.4);

    // 9. Mutate a 2nd entity (`2 / 3 = 0.6667 >= 0.62` crossover!) -> automatically crosses over to `SC-3_covering_scan_crossover` + joins `cohort_tier_lookup_v1`!
    await callGateway("/q/api/api_entity_obligations_v1/_delta", {
      method: "POST",
      headers: epHeaders,
      body: JSON.stringify({ entity_id: "ent_102", op_kind: "patch", delta: { committed_units: 200 } }),
    });
    const crossoverRes = await callGateway("/api/object/api_entity_obligations_v1?id=ent_102&bypass_cache=1", {
      headers: epHeaders,
    });
    expect(crossoverRes.status).toBe(200);
    const crossoverDoc = await crossoverRes.json();
    expect(crossoverDoc.gate).toBe("SC-3_covering_scan_crossover");
    expect(crossoverDoc.result.committed_units).toBe(200);
    expect(crossoverDoc.result.joined_record.sla_tier).toBe("standard_batch");

    // 10. Gate SC-4: Fuzzy typo query ("fencng signatur checkpont") -> 0 LLM tokens, decisive Top-2 margin!
    const sc4Res = await callGateway(
      "/q/api/api_entity_obligations_v1?q=fencng+signatur+checkpont&bypass_cache=1",
      { headers: epHeaders }
    );
    expect(sc4Res.status).toBe(200);
    const sc4Doc = await sc4Res.json();
    expect(sc4Doc.gate).toBe("SC-4_fuzzy_top2_margin");
    expect(sc4Doc.results[0].id).toBe("ent_101");

    // 11. Gate SC-6: Explicit complex async request -> HTTP 202 Accepted bulkhead task enqueued!
    const sc6Res = await callGateway("/q/api/api_entity_obligations_v1", {
      method: "POST",
      headers: epHeaders,
      body: JSON.stringify({
        mode: "async_task",
        q: "Cross-cohort counterfactual stress sweep across all envelopes",
      }),
    });
    expect(sc6Res.status).toBe(202);
    const sc6Doc = await sc6Res.json();
    expect(sc6Doc.gate).toBe("SC-6_async_bulkhead_task");
    expect(Boolean(sc6Doc.task_id)).toBe(true);

    // 12. Compact intraday deltas into version 2 snapshot (`POST /_compact`)
    const compactRes = await callGateway("/q/api/api_entity_obligations_v1/_compact", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-herma-worker-token": onb.worker_token,
      },
      body: JSON.stringify({}),
    });
    expect(compactRes.status).toBe(200);
    const compactDoc = await compactRes.json();
    expect(compactDoc.folded_deltas_count).toBe(2);
    expect(compactDoc.version).toBeGreaterThanOrEqual(2);
  });

  it("manages 7 swappable backend engine slots (/q/nodes) with GridLedger fail-closed promotion and auto-extracts nested muse-herma-worker follow-ups", async () => {
    const adminSecret = env.HERMA_ADMIN_TOKEN || env.BOOTSTRAP_SECRET || env.EDGE_SECRET || "";

    // 1. Inspect 7 seeded swappable backend slots
    const nodesRes = await callGateway("/q/nodes");
    expect(nodesRes.status).toBe(200);
    const nodesDoc = await nodesRes.json();
    expect(nodesDoc.slots_count).toBe(7);
    expect(nodesDoc.slots.ranking.active_node_id).toBe("rank_hybrid_bm25_lsh_wilson_v1");

    // 2. Public worker registers a candidate ranking node -> enters 'proposed' stage with clamped ParameterBounds
    const regNodeRes = await callGateway("/q/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "register",
        slot_id: "ranking",
        node_id: "rank_custom_experimental_v1",
        display_name: "Experimental Extreme Parameter Ranker",
        grid_params: {
          lexical_weight: 99.0, // clamped to 1.0!
          fuzzy_weight: -5.0, // clamped to 0.0!
          quality_weight: 0.3,
          freshness_weight: 0.2,
        },
      }),
    });
    expect(regNodeRes.status).toBe(201);
    const regNodeDoc = await regNodeRes.json();
    expect(regNodeDoc.ledger_stage).toBe("proposed");
    expect(regNodeDoc.clamped_grid_params.lexical_weight).toBe(1.0);
    expect(regNodeDoc.clamped_grid_params.fuzzy_weight).toBe(0.0);

    // 3. Even admin CANNOT promote an unverified ('proposed') node (`GridLedger` fail-closed invariant!)
    if (adminSecret) {
      const failPromoteRes = await callGateway("/q/nodes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-herma-admin-token": adminSecret,
        },
        body: JSON.stringify({
          op: "promote",
          slot_id: "ranking",
          node_id: "rank_custom_experimental_v1",
        }),
      });
      expect(failPromoteRes.status).toBe(409);

      // Admin CAN promote an already 'verified' candidate (`rank_rrf_reciprocal_fusion_v1`)
      const okPromoteRes = await callGateway("/q/nodes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-herma-admin-token": adminSecret,
        },
        body: JSON.stringify({
          op: "promote",
          slot_id: "ranking",
          node_id: "rank_rrf_reciprocal_fusion_v1",
        }),
      });
      expect(okPromoteRes.status).toBe(200);
    }

    // 4. Verify `muse-herma-worker` nested `payload.follow_ups` auto-enqueue when top-level `queued_tasks` is omitted!
    const nestedSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse-herma-worker",
        worker_uuid: "w_musehermawor_8ffbf268",
        task_id: "self_seed",
        summary: "Completed offline kit with nested follow_ups inside payload",
        task_objects: [
          {
            object_key: "muse_nested_followup_test_kit_v1",
            category: "runnable_cli_pipeline",
            summary: "Test kit with nested follow-up tasks",
            payload: {
              code: "print('ok')",
              follow_ups: [
                {
                  tier: "public_general",
                  title: "Nested Follow-up Verification Task",
                  prompt: "Verify nested follow_ups inside task_objects[0].payload enqueue automatically.",
                },
              ],
            },
          },
        ],
      }),
    });
    expect(nestedSubRes.status).toBe(200);
    const nestedSubDoc = await nestedSubRes.json();
    expect(nestedSubDoc.enqueued_followup_verbs.length).toBe(1);
    expect(nestedSubDoc.enqueued_followup_verbs[0].title).toContain("Nested Follow-up Verification Task");
  });

  it("isolates bare shared platform handles ('muse') into separate leases, salvages twin contenders without corrupting winner state, extracts nested payload.rankings, and serves scheduled_bounded_v6", async () => {
    // 1. Two concurrent bare `{"agent_id": "muse"}` claims without worker_uuid MUST lease TWO DISTINCT tasks with TWO DISTINCT worker_uuids!
    const claimA = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "muse" }),
      })
    ).json();
    const claimB = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "muse" }),
      })
    ).json();

    expect(claimA.ok).toBe(true);
    expect(claimB.ok).toBe(true);
    expect(claimA.reused_active_lease).toBe(false);
    expect(claimB.reused_active_lease).toBe(false);
    expect(Boolean(claimA.collision_warning)).toBe(true);
    expect(claimA.lease.task_id).not.toBe(claimB.lease.task_id);
    expect(claimA.lease.leased_worker_uuid).not.toBe(claimB.lease.leased_worker_uuid);
    expect(claimA.lease.leased_worker_uuid.startsWith("w_muse_")).toBe(true);
    expect(claimB.lease.leased_worker_uuid.startsWith("w_muse_")).toBe(true);

    // 2. Winner submits claimA cleanly with exact integer fencing_token + nested payload.rankings + verification_verdict
    const targetPublicTask = claimB.lease.task_id;
    const winRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse",
        worker_uuid: claimA.lease.leased_worker_uuid,
        task_id: claimA.lease.task_id,
        fencing_token: claimA.lease.fencing_token,
        summary: "Winner run with nested rankings and reproduced verdict",
        task_objects: [
          {
            object_key: "shared_muse_audit_v1",
            category: "eval_audit",
            verification_verdict: "REPRODUCED",
            summary: "Winner audit report",
            payload: {
              rankings: [
                {
                  target_kind: "task",
                  id: targetPublicTask,
                  actual_importance: 95,
                  potential_importance: 95,
                  estimated_priority: 99,
                  novelty_milli: 910,
                  verification_verdict: "REPRODUCED",
                  rationale: "Verified high-utility task",
                },
              ],
            },
          },
        ],
      }),
    });
    expect(winRes.status).toBe(200);
    const winDoc = await winRes.json();
    expect(winDoc.salvaged_concurrent_twin_attempt).toBe(false);
    expect(winDoc.stored_task_objects[0].verification_verdict).toBe("REPRODUCED");
    expect(winDoc.applied_evaluations.length).toBe(1);
    expect(winDoc.applied_evaluations[0].verification_verdict).toBe("REPRODUCED");

    // 3. Pre-existing in-flight bare `"muse"` twin submitting to the same task with matching fencing_token salvages its object under `__contender_<hash>` while leaving winner untouched!
    const twinRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse",
        task_id: claimA.lease.task_id,
        fencing_token: claimA.lease.fencing_token,
        summary: "Second concurrent bare muse run that started before claim isolation",
        task_objects: [
          {
            object_key: "shared_muse_audit_v1",
            category: "eval_audit",
            verification_verdict: "UNCONFIRMED_EXTRAORDINARY_CLAIM",
            summary: "Contender independent audit",
            payload: { independent_run: true },
          },
        ],
      }),
    });
    expect(twinRes.status).toBe(200);
    const twinDoc = await twinRes.json();
    expect(twinDoc.salvaged_concurrent_twin_attempt).toBe(true);
    expect(twinDoc.stored_task_objects[0].object_key).toContain("shared_muse_audit_v1__contender_");
    expect(twinDoc.stored_task_objects[0].verification_verdict).toBe("UNCONFIRMED_EXTRAORDINARY_CLAIM");

    // Winner's object and task receipt remain 100% untouched!
    const winnerObj = await (await callGateway("/q/object/shared_muse_audit_v1")).json();
    expect(winnerObj.summary).toBe("Winner audit report");
    expect(winnerObj.verification_verdict).toBe("REPRODUCED");
    const taskCheck = await (await callGateway(`/q/task/${claimA.lease.task_id}`)).json();
    expect(taskCheck.task.receipt_hash).toBe(winDoc.receipt_hash);
    expect(taskCheck.stored_task_objects.length).toBe(2); // both winner and contender objects linked for peer comparison!

    // Foreign handle or empty-object overwrite STILL fails closed with 409!
    const foreignLate = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "late-zombie",
        task_id: claimA.lease.task_id,
        fencing_token: claimA.lease.fencing_token,
        summary: "Foreign late overwrite attempt",
        task_objects: [{ object_key: "bad_overwrite", payload: { x: 1 } }],
      }),
    });
    expect(foreignLate.status).toBe(409);

    // 4. Verify `/prompts/raw/scheduled_bounded_v6` serves the collision-free strict bounded prompt
    const schedPromptRes = await callGateway("/prompts/raw/scheduled_bounded_v6?agent_id=muse-sched-alpha01");
    expect(schedPromptRes.status).toBe(200);
    const schedPromptTxt = await schedPromptRes.text();
    expect(schedPromptTxt).toContain("muse-sched-alpha01");
    expect(schedPromptTxt).toContain("NEVER hardcode `1`");
    expect(schedPromptTxt).toContain("Do NOT mine prior chat history");
    expect(schedPromptTxt).toContain("/q/compose");
  });

  it("supports v6.5 reuse graph (/q/graph), version propagation alerts, verified payload composer (/q/compose), adaptive demand/reach (/q/demand), legacy v4 sha256 verification, and targeted task_id + lease_seconds claim", async () => {
    // 1. Verify legacy v4 composite SHA-256 (`${object_key}:${rawStr}:${created_at}`) verifies cleanly!
    const v4Key = "legacy_v4_intake_spec_test";
    const v4Raw = JSON.stringify({
      schema: "intake.v4",
      fields: ["shelter_id", "wheelchair_accessible", "beds_open"],
      enum_coercion: { wheelchair_accessible: ["yes", "no", "partial"] },
    });
    const v4Created = "2026-11-01T06:44:09.613Z";
    const v4DigestBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${v4Key}:${v4Raw}:${v4Created}`)
    );
    const v4Sha = Array.from(new Uint8Array(v4DigestBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await env.HERMA_DB.prepare(
      `INSERT INTO herma_task_objects
       (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json,
        simhash64_hex, sha256_hash, created_at, content_sha256, total_payload_bytes, verification_verdict)
       VALUES (?, ?, 1, 'schema', 'public_ngo', 'muse-v4-worker', 'self_seed', 'Legacy v4 intake spec', ?, '0000000000000000', ?, ?, 'v4content', ?, 'REPRODUCED')`
    )
      .bind(v4Key, v4Key, v4Raw, v4Sha, v4Created, v4Raw.length)
      .run();

    const v4Lookup = await (await callGateway(`/q/object/${v4Key}`)).json();
    expect(v4Lookup.ok).toBe(true);
    expect(v4Lookup.payload_sha256_verified).toBe(true);
    expect(v4Lookup.payload_hash_mode).toBe("legacy_composite_v4_sha256");

    // 2. Record organic unmet demand via /q/search, then publish a high-reach Working-Dir Agent Kit + Muse Template built_on v4Key!
    await callGateway("/q/search?q=grokbot+muse+ocr+working+directory+kit");
    await callGateway("/q/search?q=grokbot+muse+ocr+working+directory+kit");

    const kitSubmitRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "kit-architect-01",
        task_id: "self_seed",
        summary: "Published working-dir OCR + shelter agent kit and Muse template built on legacy_v4_intake_spec_test",
        task_objects: [
          {
            object_key: "agent_kit_shelter_ocr_working_dir_v1",
            category: "portable_agent_kit",
            deliverable_kind: "portable_agent_kit",
            visibility: "public_ngo",
            verification_verdict: "REPRODUCED",
            built_on: [v4Key],
            summary: "Complete working-directory Agent Kit for NGO shelter intake & general document OCR",
            payload: {
              fields: ["shelter_id", "wheelchair_accessible", "ocr_confidence"],
              enum_coercion: { wheelchair_accessible: ["yes", "no", "partial"] },
              working_dir_files: {
                "AGENTS.md": "# Shelter & Document OCR Agent Kit",
                "skills/intake_ocr/SKILL.md": "---\nname: intake-ocr\n---",
                "tools/validate_intake.py": "def validate(row): return bool(row.get('shelter_id'))",
              },
              skills_and_tools: ["intake-ocr", "validate_intake"],
              tuned_use_cases: [
                "NGO disaster shelter paper/SMS intake normalization",
                "General enterprise & developer invoice/form OCR verification",
              ],
              runtime_tuning: {
                recommended_model: "muse-spark-open",
                min_model_params_b: 8,
                context_window_tokens: 32768,
                max_output_tokens: 4096,
                token_budget_config: { max_turn_tokens: 6144, cache_prefix: true },
              },
            },
          },
          {
            object_key: "muse_template_intake_verifier_v1",
            category: "muse_template",
            deliverable_kind: "muse_template",
            visibility: "public_commons",
            verification_verdict: "REPRODUCED",
            extends: ["agent_kit_shelter_ocr_working_dir_v1"],
            summary: "Reusable Muse.ai scheduled verifier template for NGO + general pipelines",
            payload: {
              fields: ["shelter_id", "verification_receipt"],
              working_dir_files: {
                "prompts/muse_schedule.md": "Claim 1 task, verify stdlib, submit with exact fencing_token.",
              },
              tuned_use_cases: ["NGO feed audit", "General CI queue triage"],
              runtime_tuning: {
                recommended_model: "muse-spark-1.3",
                min_model_params_b: 30,
                context_window_tokens: 65536,
                max_output_tokens: 8192,
              },
            },
          },
        ],
        queued_tasks: [
          {
            task_id: "task_prereq_alpha_v65",
            tier: "public_general",
            title: "Build GrokBot & Muse OCR working directory kit benchmark",
            prompt: "Run stdlib benchmark for grokbot muse ocr working directory kit.",
          },
          {
            task_id: "task_blocked_beta_v65",
            tier: "public_general",
            blocked_by_task_id: "task_prereq_alpha_v65",
            title: "Downstream Duet template after OCR benchmark",
            prompt: "Compose duet_template after task_prereq_alpha_v65 finishes.",
          },
        ],
      }),
    });
    expect(kitSubmitRes.status).toBe(200);
    const kitSubmit = await kitSubmitRes.json();
    expect(kitSubmit.stored_task_objects[0].audience_reach_milli).toBeGreaterThanOrEqual(850);
    expect(kitSubmit.stored_task_objects[0].built_on_edges.length).toBe(1);
    expect(kitSubmit.enqueued_followup_tasks[0].adaptive_priority_boost).toBeGreaterThan(0);
    expect(kitSubmit.enqueued_followup_tasks[0].priority).toBeGreaterThan(60);

    // 3. Verify `/q/compose` checks cryptographic SHA-256, shared bridge fields, working-dir file merge, and runtime_tuning rollup!
    const composeRes = await callGateway(
      `/q/compose?keys=${v4Key},agent_kit_shelter_ocr_working_dir_v1,muse_template_intake_verifier_v1`
    );
    expect(composeRes.status).toBe(200);
    const composeDoc = await composeRes.json();
    expect(composeDoc.composition_admissible).toBe(true);
    expect(composeDoc.integrity_gate.passed).toBe(true);
    expect(composeDoc.interface_compatibility.passed).toBe(true);
    expect(composeDoc.interface_compatibility.shared_bridge_fields.some((f) => f.field === "shelter_id")).toBe(true);
    expect(composeDoc.composed_runtime_envelope.min_model_params_b).toBe(30);
    expect(composeDoc.composed_runtime_envelope.required_context_window_tokens).toBe(65536);
    expect(composeDoc.composed_runtime_envelope.merged_working_dir_files.length).toBe(4);

    // 4. Advance upstream object to v2 and verify `/q/graph` + `/q/object` emit `upstream_newer_version_available: true`!
    const v2UpdRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "kit-architect-01",
        task_id: "self_seed",
        summary: "v2 update to agent_kit_shelter_ocr_working_dir_v1",
        task_objects: [
          {
            object_key: "agent_kit_shelter_ocr_working_dir_v1",
            category: "portable_agent_kit",
            summary: "v2 with multilingual CJK OCR support",
            payload: { version: "2.0.0", fields: ["shelter_id", "wheelchair_accessible", "cjk_furigana"] },
          },
        ],
      }),
    });
    expect(v2UpdRes.status).toBe(200);

    const graphRes = await callGateway(`/q/graph?root=${v4Key}`);
    expect(graphRes.status).toBe(200);
    const graphDoc = await graphRes.json();
    expect(graphDoc.edges_count).toBeGreaterThanOrEqual(2);
    expect(graphDoc.version_propagation_alerts.length).toBeGreaterThanOrEqual(1);
    expect(
      graphDoc.version_propagation_alerts.some(
        (a) =>
          a.source_object_key === "muse_template_intake_verifier_v1" &&
          a.target_object_key === "agent_kit_shelter_ocr_working_dir_v1" &&
          a.upstream_newer_version_available === true
      )
    ).toBe(true);

    // 5. Verify `/q/demand` surfaces live demand signals and high-reach Task Objects
    const demandRes = await callGateway("/q/demand");
    expect(demandRes.status).toBe(200);
    const demandDoc = await demandRes.json();
    expect(demandDoc.encouraged_high_reach_formats.length).toBe(6);
    expect(demandDoc.top_high_reach_task_objects.length).toBeGreaterThanOrEqual(1);

    // 6. Verify targeted `task_id` + `lease_seconds` in `/q/claim`: blocked prerequisite returns null, ready task leases with short TTL & expires cleanly!
    const blockedClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "dag-worker-1", task_id: "task_blocked_beta_v65" }),
      })
    ).json();
    expect(blockedClaim.lease).toBeNull();

    const shortClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "dag-worker-1", task_id: "task_prereq_alpha_v65", lease_seconds: 1 }),
      })
    ).json();
    expect(shortClaim.lease.task_id).toBe("task_prereq_alpha_v65");
    expect(shortClaim.lease.fencing_token).toBe(1);

    await new Promise((r) => setTimeout(r, 1150));

    const reclaimOut = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "dag-worker-2", task_id: "task_prereq_alpha_v65", lease_seconds: 60 }),
      })
    ).json();
    expect(reclaimOut.lease.task_id).toBe("task_prereq_alpha_v65");
    expect(reclaimOut.lease.fencing_token).toBe(2);

    // 7. Verify legacy cached `w_agent_muse` shared bucket auto-isolates onto unique `w_muse_<hex>` AND eval-only twin salvage succeeds!
    await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "seed-eval-maker",
        task_id: "self_seed",
        summary: "Seed two eval tasks for legacy w_agent_muse cron isolation test",
        queued_tasks: [
          { task_id: "verb_evl_legacy_muse_1", tier: "public_general", verb_kind: "eval_and_rank", title: "Audit 1", prompt: "Audit 1" },
          { task_id: "verb_evl_legacy_muse_2", tier: "public_general", verb_kind: "eval_and_rank", title: "Audit 2", prompt: "Audit 2" },
        ],
      }),
    });
    const legA = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "muse", worker_uuid: "w_agent_muse" }),
      })
    ).json();
    const legB = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "muse", worker_uuid: "w_agent_muse" }),
      })
    ).json();
    expect(legA.lease.leased_worker_uuid).not.toBe("w_agent_muse");
    expect(legB.lease.leased_worker_uuid).not.toBe("w_agent_muse");
    expect(legA.lease.leased_worker_uuid).not.toBe(legB.lease.leased_worker_uuid);
    expect(legA.lease.task_id).not.toBe(legB.lease.task_id);
    expect(legA.collision_warning.shared_handle_detected).toBe("muse");

    // Simulate twin eval-only contender submit against legA's completed task (`task_objects: []`, `evaluations: [...]`)
    const winEv = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse",
        worker_uuid: "w_agent_muse",
        task_id: legA.lease.task_id,
        fencing_token: legA.lease.fencing_token,
        summary: "Primary muse eval winner",
        evaluations: [{ target_id: v4Key, actual_importance: 91, potential_importance: 94, novelty_milli: 860 }],
      }),
    });
    expect(winEv.status).toBe(200);

    const twinEv = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse",
        worker_uuid: "w_agent_muse",
        task_id: legA.lease.task_id,
        fencing_token: legA.lease.fencing_token,
        summary: "Concurrent muse eval contender with 0 task_objects",
        evaluations: [{ target_id: "agent_kit_shelter_ocr_working_dir_v1", actual_importance: 88, potential_importance: 92, novelty_milli: 840 }],
      }),
    });
    expect(twinEv.status).toBe(200);
    const twinEvDoc = await twinEv.json();
    expect(twinEvDoc.salvaged_concurrent_twin_attempt).toBe(true);
    expect(twinEvDoc.applied_evaluations.length).toBe(1);
    expect(twinEvDoc.worker_uuid).not.toBe("w_agent_muse");
  });

  it("supports v6.6 self-resolving corner-case immunity: lease_epoch + [REDACTED] auto-heal, /q/release, family claim targeting, submit-time interface_compat (path/enum divergences), truncated foundation auto-repair verb, v1->v2 dependent auto-recheck, and graph-aware /q/search", async () => {
    await callGateway("/q/pulse");
    const db = env.HERMA_DB;

    // 1. Insert a legacy truncated foundation record (`canonical_shelter_truncated_v1`) to verify submit-time detection & auto-repair task
    await db
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary,
          payload_json, simhash64_hex, sha256_hash, created_at, partition_slot, labels_json, input_shape_hash,
          output_shape_hash, lsh_band_0, lsh_band_1, quality_milli, content_sha256, chunk_count, total_payload_bytes)
         VALUES ('canonical_shelter_truncated_v1', 'canonical_shelter_truncated_v1', 1, 'schema', 'public_ngo',
                 'legacy-v4', 'self_seed', 'Truncated legacy foundation schema', '{"shelter_id":"s1","cut_mid_f',
                 '0000000000000000', 'deadbeef', '2026-11-01T05:40:00Z', 0, '["ngo"]', 'aa', 'bb',
                 'sh0:0000', 'sh1:0000', 0, 'trunc_sha_v1', 0, 0)`
      )
      .run();

    // 2. Submit a verified canonical v1 schema (`canonical_shelter_nested_v1`) with nested dot-paths & strict backup_power enum
    const baseSub = await (
      await callGateway("/q/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "schema-author-01",
          task_id: "self_seed",
          summary: "Publish nested canonical shelter schema v1",
          task_objects: [
            {
              object_key: "canonical_shelter_nested_v1",
              category: "schema",
              summary: "Canonical nested shelter feed schema with accessibility and medical_power",
              payload: {
                properties: {
                  shelter_id: { type: "string" },
                  accessibility: { properties: { wheelchair_accessible: { type: "boolean" } } },
                  medical_power: {
                    properties: { backup_power: { type: "string", enum: ["full", "partial", "none", "unknown"] } },
                  },
                },
              },
            },
          ],
          queued_tasks: [
            {
              task_id: "verb_shelter_family_01",
              tier: "ngo_priority",
              category: "shelter-feed",
              labels: ["shelter-feed", "ngo"],
              title: "Shelter-feed SMS intake adapter check",
              prompt: "Build SMS adapter for shelter-feed family.",
            },
            {
              task_id: "verb_unrelated_audit_01",
              tier: "public_general",
              verb_kind: "eval_and_rank",
              title: "Unrelated research audit",
              prompt: "Audit unrelated brief candidates.",
            },
          ],
        }),
      })
    ).json();
    expect(baseSub.ok).toBe(true);

    // 3. Verify `family` claim targeting claims `verb_shelter_family_01` (not unrelated audit) AND non-matching family recommends self_seed
    const noMatchFam = await (
      await callGateway("/q/claim?agent_id=composer-worker-1&family=nonexistent-quantum-family&format=json")
    ).json();
    expect(noMatchFam.lease).toBeNull();
    expect(noMatchFam.family_filter_matched).toBe(false);
    expect(noMatchFam.self_seed_recommended).toBe(true);

    const famClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "composer-worker-1",
          worker_uuid: "w_composer_fixed01",
          family: "shelter-feed",
        }),
      })
    ).json();
    expect(famClaim.lease.task_id).toBe("verb_shelter_family_01");
    expect(famClaim.lease.lease_epoch).toBe(1);
    expect(famClaim.family_filter_matched).toBe(true);

    // 4. Test graceful `/q/release` -> returns task immediately to `ready`, then re-claim -> `lease_epoch` advances to 2!
    const relRes = await (
      await callGateway("/q/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "composer-worker-1",
          worker_uuid: "w_composer_fixed01",
          task_id: "verb_shelter_family_01",
          lease_epoch: 1,
          reason: "testing_instant_graceful_release",
        }),
      })
    ).json();
    expect(relRes.ok).toBe(true);
    expect(relRes.released).toBe(true);
    expect(relRes.state).toBe("ready");

    const reclaimFam = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "composer-worker-1",
          worker_uuid: "w_composer_fixed01",
          family: "shelter-feed",
        }),
      })
    ).json();
    expect(reclaimFam.lease.lease_epoch).toBe(2);

    // 5. Submit using `[REDACTED]` fencing_token (simulating client stdout secret-scrubber) + `builds_on` pointing to BOTH nested schema & truncated schema!
    const smsSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "composer-worker-1",
        worker_uuid: "w_composer_fixed01",
        task_id: "verb_shelter_family_01",
        fencing_token: "[REDACTED]",
        summary: "Submit SMS intake spec with builds_on edges to test submit-time interface_compat",
        task_objects: [
          {
            object_key: "sms_intake_divergent_v1",
            category: "composition",
            summary: "SMS parser with flat wheelchair_accessible and yes/no backup_power",
            payload: {
              builds_on: ["canonical_shelter_nested_v1", "canonical_shelter_truncated_v1"],
              fields: [
                { name: "shelter_id" },
                { name: "wheelchair_accessible" },
                { name: "backup_power", enum: ["yes", "no"] },
              ],
            },
          },
        ],
      }),
    });
    expect(smsSubRes.status).toBe(200);
    const smsSub = await smsSubRes.json();
    expect(smsSub.redacted_fencing_token_auto_healed).toBe(true);
    const compat = smsSub.stored_task_objects[0].interface_compat;
    expect(compat.certification_status).toBe("PROVISIONAL");
    expect(compat.path_divergences_count).toBeGreaterThanOrEqual(1);
    expect(compat.enum_divergences_count).toBeGreaterThanOrEqual(1);
    expect(compat.truncated_foundation_targets).toContain("canonical_shelter_truncated_v1");

    // Verify self-resolving foundation repair task was auto-enqueued for `canonical_shelter_truncated_v1`!
    const repairTask = await db
      .prepare("SELECT task_id, state, category FROM herma_durable_queue WHERE category = 'foundation_repair' LIMIT 1")
      .first();
    expect(repairTask?.state).toBe("ready");

    // 6. Mutate `canonical_shelter_nested_v1` from v1 -> v2 and verify automatic dependent re-check task (`auto_enqueued_dependent_recheck_task_id`)!
    const v2Bump = await (
      await callGateway("/q/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "schema-author-01",
          task_id: "self_seed",
          summary: "Advance canonical_shelter_nested_v1 to v2 with operational_status, food, water",
          task_objects: [
            {
              object_key: "canonical_shelter_nested_v1",
              category: "schema",
              summary: "v2 canonical shelter feed schema with operational_status, food_service, water_potable",
              payload: {
                properties: {
                  shelter_id: { type: "string" },
                  operational_status: { type: "string", enum: ["open", "full", "closed", "unknown"] },
                  food_service: { type: "string" },
                  water_potable: { type: "string" },
                },
              },
            },
          ],
        }),
      })
    ).json();
    expect(v2Bump.stored_task_objects[0].version_num).toBe(2);
    const vpropTaskId = v2Bump.stored_task_objects[0].auto_enqueued_dependent_recheck_task_id;
    expect(vpropTaskId).toMatch(/^verb_evl_/);

    // 7. Verify graph-aware `/q/search` returns `builds_on`, `used_by_count`, `reuse_weighted_quality_milli`, and backfilled `total_payload_bytes > 0`!
    const srch = await (await callGateway("/q/search?q=canonical+shelter+nested&scope=objects")).json();
    const nestedHit = srch.results.find((r) => r.id === "canonical_shelter_nested_v1");
    expect(nestedHit).toBeTruthy();
    expect(nestedHit.used_by_count).toBeGreaterThanOrEqual(1);
    expect(nestedHit.reuse_weighted_quality_milli).toBeGreaterThanOrEqual(45);

    const smsHit = (await (await callGateway("/q/search?q=sms+intake+divergent&scope=objects")).json()).results.find(
      (r) => r.id === "sms_intake_divergent_v1"
    );
    expect(smsHit.builds_on).toContain("canonical_shelter_nested_v1");
  });
});
