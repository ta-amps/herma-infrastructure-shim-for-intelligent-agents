import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://herma.ta-amps.workers.dev";

async function callGateway(path, init = {}) {
  return exports.default.fetch(BASE + path, init);
}

describe("prioritized durable task queue gateway (/q/*)", () => {
  it("hides infra_private tasks from public workers while prioritizing ngo_priority first", async () => {
    const pulseRes = await callGateway("/q/pulse");
    expect(pulseRes.status).toBe(200);
    const pulse = await pulseRes.json();
    expect(pulse.caller_role).toBe("public_or_volunteer_worker");
    expect(pulse.queue_counts_by_tier.ngo_priority.ready).toBeGreaterThanOrEqual(1);
    expect(pulse.queue_counts_by_tier.public_general.ready).toBeGreaterThanOrEqual(1);
    expect(pulse.queue_counts_by_tier.infra_private).toBeUndefined();
    for (const preview of pulse.ready_tasks_preview) {
      expect(preview.tier).not.toBe("infra_private");
    }

    // Public worker explicitly asking for infra_private receives 403 Forbidden
    const forbidRes = await callGateway("/q/claim/muse?tier=infra_private&format=json");
    expect(forbidRes.status).toBe(403);

    // Public worker claiming default receives highest-priority NGO task first
    const claimRes = await callGateway("/q/claim/muse?format=json");
    expect(claimRes.status).toBe(200);
    const claimJson = await claimRes.json();
    expect(claimJson.lease.tier).toBe("ngo_priority");
    expect(claimJson.lease.visibility).toBe("public_ngo");
  });

  it("persists task_objects and enqueues deferred branch verbs over both GET and POST while blocking public infra writes", async () => {
    const getSub = await callGateway(
      "/q/submit/muse/ngo_seed_990n_directory_audit/summary-verified-990n-eligibility-rubric--object-rubric_990n:primary-irs-epostcard-check--ngo-verb-audit-multilingual-hotline-hours--verb-normalize-zip-service-radius?format=json"
    );
    expect(getSub.status).toBe(200);
    const subJson = await getSub.json();
    expect(subJson.ok).toBe(true);
    expect(subJson.stored_task_objects.length).toBe(1);
    expect(subJson.enqueued_followup_verbs.length).toBe(2);
    expect(subJson.enqueued_followup_verbs[0].tier).toBe("ngo_priority");

    // Public caller trying to enqueue an infra_private verb via POST is rejected with 403
    const badPost = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "public-caller",
        task_id: "self_seed",
        summary: "attempted infra write",
        queued_verbs: [{ tier: "infra_private", prompt: "unauthorized server task" }],
      }),
    });
    expect(badPost.status).toBe(403);
  });

  it("allows authenticated server-side infrastructure workers to inspect and claim infra_private, ngo_priority, and public_general", async () => {
    const adminSecret = env.HERMA_ADMIN_TOKEN || env.BOOTSTRAP_SECRET || env.EDGE_SECRET || "";
    if (!adminSecret) {
      return;
    }
    const infraPulseRes = await callGateway("/q/pulse", {
      headers: { "x-herma-admin-token": adminSecret },
    });
    expect(infraPulseRes.status).toBe(200);
    const infraPulse = await infraPulseRes.json();
    expect(infraPulse.caller_role).toBe("server_infrastructure_worker");
    expect(infraPulse.queue_counts_by_tier.infra_private).toBeDefined();

    const infraClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-herma-admin-token": adminSecret,
      },
      body: JSON.stringify({ agent_id: "server-frontier-worker", tier: "infra_private" }),
    });
    expect(infraClaimRes.status).toBe(200);
    const infraClaim = await infraClaimRes.json();
    expect(infraClaim.lease.tier).toBe("infra_private");
  });

  it("supports typo-tolerant SymSpell + semantic alias + LSH RRF search on /q/search while hiding infra_private from public", async () => {
    const trustRes = await callGateway("/q/trust");
    expect(trustRes.status).toBe(200);
    const trustJson = await trustRes.json();
    expect(trustJson.schema).toBe("herma.priority_work_gateway.trust.v1");
    expect(trustJson.tier_isolation.infra_private_hidden_from_public).toBe(true);

    // 1. Severe multi-typo search ("shlter accesibility harmnizer") recovers canonical terms & ranks shelter seed #1
    const typoRes = await callGateway("/q/search?q=shlter+accesibility+harmnizer");
    expect(typoRes.status).toBe(200);
    const typoJson = await typoRes.json();
    expect(typoJson.ok).toBe(true);
    expect(typoJson.query_analysis.typo_corrections.shlter).toBe("shelter");
    expect(typoJson.results.length).toBeGreaterThanOrEqual(1);
    expect(typoJson.results[0].id).toBe("ngo_seed_disaster_shelter_schema");
    for (const item of typoJson.results) {
      expect(item.tier).not.toBe("infra_private");
    }

    // 2. Semantic alias expansion + stored task_objects retrieval
    const semRes = await callGateway("/q/search?q=990n+epostcard+rubric");
    expect(semRes.status).toBe(200);
    const semJson = await semRes.json();
    const ids = semJson.results.map((r) => r.id);
    expect(ids).toContain("ngo_seed_990n_directory_audit");
    expect(ids).toContain("rubric_990n");

    // 3. Public caller explicitly querying tier=infra_private is blocked with 403 Forbidden
    const forbidSearch = await callGateway("/q/search?q=coalescing&tier=infra_private");
    expect(forbidSearch.status).toBe(403);

    // 4. Affinity band claim coalescing prefers matching lsh_band_0 within equal priority tier
    const pulseRes = await callGateway("/q/pulse");
    const pulse = await pulseRes.json();
    const pubReady = pulse.ready_tasks_preview.filter((t) => t.tier === "public_general");
    if (pubReady.length >= 1 && pubReady[pubReady.length - 1].lsh_band_0) {
      const targetBand = pubReady[pubReady.length - 1].lsh_band_0;
      const affClaimRes = await callGateway(
        `/q/claim/affinity-worker?tier=public_general&affinity_band=${encodeURIComponent(targetBand)}&format=json`
      );
      expect(affClaimRes.status).toBe(200);
      const affClaim = await affClaimRes.json();
      expect(affClaim.lease.lsh_band_0).toBe(targetBand);
    }
  });

  it("drives bilateral /q/onboard, 3-beat worker_uuid rotation (NGO -> Eval/Rank -> Own Task), runtime mutations, and /prompts hub", async () => {
    // 1. Onboard Worker A & Worker B -> distinct worker_uuid + persona/entropy kits
    const obARes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "cron-client-a", capabilities: ["post", "cron"] }),
    });
    expect(obARes.status).toBe(200);
    const obA = await obARes.json();
    const uuidA = obA.worker_profile.worker_uuid;
    expect(uuidA.startsWith("w_")).toBe(true);
    expect(obA.calibration_questions.length).toBe(3);

    const obBRes = await callGateway("/q/onboard/cron-client-b?format=json");
    expect(obBRes.status).toBe(200);
    const obB = await obBRes.json();
    const uuidB = obB.worker_profile.worker_uuid;
    expect(uuidB).not.toBe(uuidA);

    // 2. Beat 0 (iteration 0 -> ngo): claims ngo_priority task & enqueues an own-UUID tagged continuation verb for Beat 2
    const beat0ClaimRes = await callGateway(`/q/claim/cron-client-a?worker_uuid=${encodeURIComponent(uuidA)}&slot=auto&format=json`);
    expect(beat0ClaimRes.status).toBe(200);
    const beat0Claim = await beat0ClaimRes.json();
    expect(beat0Claim.bilateral_guidance.current_beat_slot).toBe("ngo");
    expect(beat0Claim.lease.tier).toBe("ngo_priority");

    const beat0SubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "cron-client-a",
        worker_uuid: uuidA,
        task_id: beat0Claim.lease.task_id,
        fencing_token: beat0Claim.lease.fencing_token,
        summary: "Solved 1 atomic NGO shelter intake field mapping",
        task_objects: [
          {
            object_key: "atomic_shelter_intake_v1",
            category: "canonical_schema",
            summary: "Atomic intake schema tagged to worker A",
            payload: { version: "1.0.0", fields: ["facility_id", "wheelchair_ramp"] },
          },
        ],
        queued_verbs: [
          {
            tier: "public_general",
            verb_kind: "worker_self_directed",
            owner_worker_uuid: uuidA,
            title: "Worker A Personal Thread Step 2: Backup-Battery Telemetry",
            prompt: "Narrow wheelchair ramp power-backup telemetry for sub-freezing shelters.",
          },
        ],
      }),
    });
    expect(beat0SubRes.status).toBe(200);
    const beat0Sub = await beat0SubRes.json();
    expect(beat0Sub.worker_iteration_state.next_honor_beat_slot).toBe("eval");
    const ownVerbId = beat0Sub.enqueued_followup_verbs[0].task_id;

    // Verify Worker B on Beat 0 does NOT steal Worker A's private owner_worker_uuid task
    const bClaimRes = await callGateway(`/q/claim/cron-client-b?worker_uuid=${encodeURIComponent(uuidB)}&slot=own&format=json`);
    const bClaim = await bClaimRes.json();
    if (bClaim.lease) {
      expect(bClaim.lease.task_id).not.toBe(ownVerbId);
    }

    // 3. Beat 1 (iteration 1 -> eval): Worker A claims evaluation task & ranks both a task and a task_object
    const beat1ClaimRes = await callGateway(`/q/claim/cron-client-a?worker_uuid=${encodeURIComponent(uuidA)}&slot=auto&format=json`);
    expect(beat1ClaimRes.status).toBe(200);
    const beat1Claim = await beat1ClaimRes.json();
    expect(beat1Claim.bilateral_guidance.current_beat_slot).toBe("eval");
    expect(beat1Claim.lease.verb_kind).toBe("eval_and_rank");
    expect(beat1Claim.bilateral_guidance.evaluation_candidates.tasks_to_evaluate.length).toBeGreaterThanOrEqual(1);

    const beat1SubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "cron-client-a",
        worker_uuid: uuidA,
        task_id: beat1Claim.lease.task_id,
        fencing_token: beat1Claim.lease.fencing_token,
        summary: "Evaluated & ranked own verb and shelter intake object",
        evaluations: [
          {
            target_kind: "task",
            target_id: ownVerbId,
            actual_importance: 90,
            potential_importance: 96,
            estimated_priority: 92,
            novelty_milli: 910,
            convergence_flag: false,
            rationale: "High-novelty cold-weather battery telemetry continuation",
          },
          {
            target_kind: "object",
            target_id: "atomic_shelter_intake_v1",
            actual_importance: 88,
            potential_importance: 90,
            estimated_priority: 89,
            novelty_milli: 840,
            convergence_flag: false,
            rationale: "Reusable canonical intake fields",
          },
        ],
      }),
    });
    expect(beat1SubRes.status).toBe(200);
    const beat1Sub = await beat1SubRes.json();
    expect(beat1Sub.applied_evaluations.length).toBe(2);
    expect(beat1Sub.worker_iteration_state.next_honor_beat_slot).toBe("own");

    // 4. Beat 2 (iteration 2 -> own): Worker A automatically claims its own UUID-tagged continuation verb!
    const beat2ClaimRes = await callGateway(`/q/claim/cron-client-a?worker_uuid=${encodeURIComponent(uuidA)}&slot=auto&format=json`);
    expect(beat2ClaimRes.status).toBe(200);
    const beat2Claim = await beat2ClaimRes.json();
    expect(beat2Claim.bilateral_guidance.current_beat_slot).toBe("own");
    expect(beat2Claim.lease.task_id).toBe(ownVerbId);
    expect(beat2Claim.lease.owner_worker_uuid).toBe(uuidA);

    // 5. Verify /q/seeds, /q/runtimes, and CSP-compliant /prompts + /q/prompts.js + /prompts/raw/master_v3
    const seedsRes = await callGateway(`/q/seeds?worker_uuid=${encodeURIComponent(uuidA)}`);
    expect(seedsRes.status).toBe(200);
    const seedsJson = await seedsRes.json();
    expect(seedsJson.anti_convergence_kit.atomic_remix_operator.operator_id).toBeTruthy();

    const runtimesRes = await callGateway("/q/runtimes?limit=5");
    expect(runtimesRes.status).toBe(200);
    const runtimesJson = await runtimesRes.json();
    expect(runtimesJson.runtimes.length).toBeGreaterThanOrEqual(1);

    const promptsPageRes = await callGateway("/prompts");
    expect(promptsPageRes.status).toBe(200);
    expect(promptsPageRes.headers.get("content-security-policy")).toContain("script-src 'self'");
    const promptsHtml = await promptsPageRes.text();
    expect(promptsHtml).toContain("Copy &amp; Paste Agent Worker Prompts");
    expect(promptsHtml).toContain('<script src="/q/prompts.js" defer></script>');

    const promptsJsRes = await callGateway("/q/prompts.js");
    expect(promptsJsRes.status).toBe(200);
    expect(promptsJsRes.headers.get("content-type")).toContain("application/javascript");

    const rawPromptRes = await callGateway(`/prompts/raw/master_v3?agent_id=muse-cron&worker_uuid=${encodeURIComponent(uuidA)}`);
    expect(rawPromptRes.status).toBe(200);
    const rawPromptTxt = await rawPromptRes.text();
    expect(rawPromptTxt).toContain("muse-cron");
    expect(rawPromptTxt).toContain(uuidA);
  });
});
