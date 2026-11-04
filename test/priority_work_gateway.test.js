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
    const claimFirstRes = await callGateway("/q/claim/muse?format=json");
    expect(claimFirstRes.status).toBe(200);
    const claimFirst = await claimFirstRes.json();
    const claimedId = claimFirst.lease.task_id;
    const claimedFence = claimFirst.lease.fencing_token;

    const getSub = await callGateway(
      `/q/submit/muse/${encodeURIComponent(claimedId)}/fence-${claimedFence}--summary-verified-990n-eligibility-rubric--object-rubric_990n:primary-irs-epostcard-check--ngo-verb-audit-multilingual-hotline-hours--verb-normalize-zip-service-radius?format=json`
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
    expect(trustJson.schema).toBe("herma.priority_work_gateway.trust.v2");
    expect(trustJson.authorized_chat_context_generalization).toBeDefined();
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
    expect(beat1Sub.applied_evaluations.length).toBe(0); // a maker's scores on its own work are dropped
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
    expect(promptsHtml).toContain("<h1>Prompts for your agent</h1>");
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

  it("losslessly chunks and reassembles >320 KiB Portable Agent Kit nouns, indexes worker search_hints/facets, and renders /dashboard + /c/<permalink> + /w/<uuid>", async () => {
    const bigSkillDoc = "# Portable Offline Triage Skill\n" + "deterministic_rule_row_check();\n".repeat(7000);
    const bigK8sManifest = "apiVersion: batch/v1\nkind: CronJob\n" + "# zone-spread-ha-spec\n".repeat(7000);
    const agentKitPayload = {
      kit_version: "1.0.0",
      harness: { name: "portable-4gb-k8s-worker", beat_rotation: ["ngo", "eval", "own"] },
      files: {
        "skills/offline_triage/SKILL.md": bigSkillDoc,
        "deploy/k8s/worker-cronjob.yaml": bigK8sManifest,
        "hooks/pre_submit_ast_gate.py": "def verify_zero_magic(tree): return True\n",
        "runners/run_4gb_laptop.py": "if __name__ == '__main__': print('OK')\n",
      },
      interactive_demo: {
        title: "Portable Agent Kit 3-Beat Walkthrough",
        steps: [
          { title: "1. Onboard Worker", caption: "Mints worker_uuid & persona" },
          { title: "2. Execute Bounded Step", caption: "Runs offline on 4GB laptop or K8s CronJob" },
        ],
      },
    };

    const subRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "kit-packager-agent",
        worker_uuid: "w_kitpackager_001",
        task_id: "self_seed",
        beat_slot: "own",
        summary: "Packaged complete >320 KiB Portable Agent Kit with 4GB laptop runner & Kubernetes CronJob",
        task_objects: [
          {
            object_key: "portable_agent_kit_test_v1",
            category: "portable_agent_kit",
            summary: "Complete multi-file Portable Agent Kit (skills, rules, hooks, 4GB laptop & K8s runners)",
            search_hints: {
              intent_signature: "package_portable_offline_worker_agent_kit",
              search_keywords: ["agent_kit", "cronjob", "offline_laptop"],
              search_phrases: ["portable offline worker kit", "four gigabyte laptop runner"],
              semantic_synonyms: ["self_contained_agent_bundle"],
              facet_axes: {
                opt_goal: "runs_on_small_4gb_laptop",
                prog_lang: "Python_3_12_Stdlib",
                locale_country: "Kenya_Rural_USSD_2G",
                deliverable_kind: "portable_agent_kit",
              },
            },
            payload: agentKitPayload,
          },
        ],
      }),
    });
    expect(subRes.status).toBe(200);
    const subJson = await subRes.json();
    expect(subJson.ok).toBe(true);
    expect(subJson.contribution_permalink).toContain("/c/");
    expect(subJson.worker_permalink).toContain("/w/w_kitpackager_001");
    expect(subJson.dashboard_url).toContain("/dashboard");
    // The two plain lines the agent shows its person: links to the Task Object, the worker and the dashboard, then the next turn; no hash.
    const printed = String(subJson.contributor_printout).split("\n");
    expect(printed).toHaveLength(2);
    expect(printed[0]).toMatch(/^Links: your contribution \S+\/c\/portable_agent_kit_test_v1 \u00b7 your worker \S+\/w\/w_kitpackager_001 \u00b7 dashboard \S+\/dashboard$/);
    expect(printed[1]).toMatch(/^Next turn: (help a nonprofit|check someone else\u2019s work|its own project)\.$/);
    expect(subJson.contributor_printout).not.toMatch(/[0-9a-f]{12,}|receipt|sha/i);
    expect(subJson.stored_task_objects[0].chunk_count).toBeGreaterThanOrEqual(3);
    expect(subJson.stored_task_objects[0].total_payload_bytes).toBeGreaterThan(320000);

    // Lossless byte-exact reassembly via GET /q/object/<key>
    const objRes = await callGateway("/q/object/portable_agent_kit_test_v1");
    expect(objRes.status).toBe(200);
    const objDoc = await objRes.json();
    expect(objDoc.payload_sha256_verified).toBe(true);
    expect(objDoc.chunk_count).toBeGreaterThanOrEqual(3);
    expect(objDoc.payload.files["skills/offline_triage/SKILL.md"]).toBe(bigSkillDoc);
    expect(objDoc.payload.files["deploy/k8s/worker-cronjob.yaml"]).toBe(bigK8sManifest);

    // Dual-Side Phrase + Facet Search + include_payload=1
    const facetSearchRes = await callGateway(
      "/q/search?q=portable+offline+worker+kit&opt_goal=runs_on_small_4gb_laptop&deliverable_kind=portable_agent_kit&include_payload=1"
    );
    expect(facetSearchRes.status).toBe(200);
    const facetSearch = await facetSearchRes.json();
    expect(facetSearch.results.length).toBeGreaterThanOrEqual(1);
    expect(facetSearch.results[0].id).toBe("portable_agent_kit_test_v1");
    expect(facetSearch.results[0].matched_channels).toContain("worker_phrase_or_facet");
    expect(facetSearch.results[0].payload.kit_version).toBe("1.0.0");

    // Interactive Dashboard, Permalinks & Demo Page (CSP 'self')
    const dashRes = await callGateway("/dashboard");
    expect(dashRes.status).toBe(200);
    expect(dashRes.headers.get("content-security-policy")).toContain("script-src 'self'");
    const dashHtml = await dashRes.text();
    expect(dashHtml).toContain("What the workers are doing");
    expect(dashHtml).toContain("portable_agent_kit_test_v1");

    const dashJsRes = await callGateway("/q/dashboard.js");
    expect(dashJsRes.status).toBe(200);

    const permRes = await callGateway("/c/portable_agent_kit_test_v1");
    expect(permRes.status).toBe(200);
    const permHtml = await permRes.text();
    expect(permHtml).toContain("Put back together exactly from");
    expect(permHtml).toContain("skills/offline_triage/SKILL.md");

    const workerPageRes = await callGateway("/w/w_kitpackager_001");
    expect(workerPageRes.status).toBe(200);
    const workerHtml = await workerPageRes.text();
    expect(workerHtml).toContain("w_kitpackager_001");

    const demoPageRes = await callGateway("/q/demo/portable_agent_kit_test_v1");
    expect(demoPageRes.status).toBe(200);
    expect(demoPageRes.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("enforces atomic CAS /q/claim without double-leases, rejects stale fencing_token with 409, and indexes pure CJK & Devanagari search queries", async () => {
    // 1. Onboard raceOwner to get an authorized worker_token, then seed 8 isolated tasks + CJK/Devanagari task_objects
    const raceObRes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "cas-seeder", mint_new: true }),
    });
    const raceOb = await raceObRes.json();
    const raceOwner = raceOb.worker_profile.worker_uuid;
    const raceWorkerToken = raceOb.worker_token;
    const seedVerbs = Array.from({ length: 8 }, (_, idx) => ({
      tier: "public_general",
      verb_kind: "worker_self_directed",
      owner_worker_uuid: raceOwner,
      title: `CAS Race Probe Step ${idx}`,
      prompt: `Verify atomic lease uniqueness ${idx}`,
    }));
    const seedRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "cas-seeder",
        worker_uuid: raceOwner,
        worker_token: raceWorkerToken,
        task_id: "self_seed",
        summary: "Seed CAS & multi-script objects",
        task_objects: [
          {
            object_key: "cjk_hinanjo_unicode_probe_v1",
            category: "multiscript_schema",
            summary: "避難所 自治体 防災 オフライン名簿スキーマ readability check",
            payload: { script: "ja", terms: ["避難所", "自治体"] },
          },
          {
            object_key: "devanagari_ashraya_probe_v1",
            category: "multiscript_schema",
            summary: "हिन्दी आश्रय सहायता ऑफलाइन पंजीकरण तालिका",
            payload: { script: "hi", terms: ["हिन्दी", "आश्रय", "सहायता"] },
          },
        ],
        queued_verbs: seedVerbs,
      }),
    });
    expect(seedRes.status).toBe(200);

    // 2. Fire 8 concurrent POST /q/claim calls for `slot: "own"` -> 8 distinct task_ids, 0 double-leases!
    const concurrentClaims = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        callGateway("/q/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent_id: `racer-${idx}`,
            worker_uuid: raceOwner,
            worker_token: raceWorkerToken,
            slot: "own",
          }),
        }).then((r) => r.json())
      )
    );
    const leasedIds = concurrentClaims.map((c) => c.lease?.task_id).filter(Boolean);
    expect(leasedIds.length).toBe(8);
    expect(new Set(leasedIds).size).toBe(8);

    // 3. Stale fencing_token rejection (409 Conflict)
    const targetLease = concurrentClaims[0].lease;
    const wrongTokRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "stale-worker",
        worker_uuid: raceOwner,
        worker_token: raceWorkerToken,
        task_id: targetLease.task_id,
        fencing_token: 0,
        summary: "stale before completion",
      }),
    });
    expect(wrongTokRes.status).toBe(409);

    const validSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "racer-0",
        worker_uuid: raceOwner,
        worker_token: raceWorkerToken,
        task_id: targetLease.task_id,
        fencing_token: targetLease.fencing_token,
        summary: "authoritative completion",
      }),
    });
    expect(validSubRes.status).toBe(200);

    const postDoneStaleRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "late-zombie",
        worker_uuid: raceOwner,
        worker_token: raceWorkerToken,
        task_id: targetLease.task_id,
        fencing_token: targetLease.fencing_token,
        summary: "attempted overwrite after done",
      }),
    });
    expect(postDoneStaleRes.status).toBe(409);

    // 4. Pure CJK & pure Devanagari native /q/search + zero spurious SymSpell rewrite on indexed "readability"
    const cjkRes = await callGateway(`/q/search?q=${encodeURIComponent("避難所 自治体")}`);
    expect(cjkRes.status).toBe(200);
    const cjkJson = await cjkRes.json();
    expect(cjkJson.results[0].id).toBe("cjk_hinanjo_unicode_probe_v1");

    const devaRes = await callGateway(`/q/search?q=${encodeURIComponent("हिन्दी आश्रय सहायता")}`);
    expect(devaRes.status).toBe(200);
    const devaJson = await devaRes.json();
    expect(devaJson.results[0].id).toBe("devanagari_ashraya_probe_v1");

    const readRes = await callGateway("/q/search?q=readability");
    const readJson = await readRes.json();
    expect(readJson.query_analysis.typo_corrections.readability).toBeUndefined();
  });

  it("supports v6.2 complexity-aware routing (/q/routing), batch co-claiming, blocked_by_task_id gating, idempotent active-lease reuse, and /q/traces", async () => {
    // 1. /status alias + strict 400/404 validation + /q/traces span capture
    const statusRes = await callGateway("/status");
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.schema).toBe("herma.priority_work_gateway.grid.v6_8");

    const missingWorkerRes = await callGateway("/w/w_nonexistent_unit_probe_404");
    expect(missingWorkerRes.status).toBe(404);

    const emptySubmitRes = await callGateway("/q/submit");
    expect(emptySubmitRes.status).toBe(400);
    const schemaSubmitRes = await callGateway("/q/submit/schema");
    expect(schemaSubmitRes.status).toBe(400);

    // 2. Seed a prerequisite chain + 2 sibling tasks for a GPT Astra / Codex worker
    const astraUuid = "w_codex_astra_unit01";
    const seedRes = await callGateway("/q/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "herma-codex-astra/1.0",
      },
      body: JSON.stringify({
        agent_id: "codex-gpt-astra-01",
        worker_uuid: astraUuid,
        model_hint: "gpt-astra",
        task_id: "self_seed",
        summary: "Stage 0 capability ontology seed enqueueing Stage 1 co-batch + Stage 2 blocked synthesis",
        queued_verbs: [
          {
            task_id: "stage1_ocr_niche_bench_u1",
            tier: "public_general",
            verb_kind: "meta_generator",
            owner_worker_uuid: astraUuid,
            complexity_milli: 860,
            title: "Stage 1A: OCR & Document AI Capability Taxonomy + Benchmark Matrix",
            prompt: "Build polyhierarchical taxonomy and Pareto benchmark rubric for OCR AI tools in Python & Rust.",
          },
          {
            task_id: "stage1_pii_niche_bench_u1",
            tier: "public_general",
            verb_kind: "meta_generator",
            owner_worker_uuid: astraUuid,
            complexity_milli: 840,
            title: "Stage 1B: PII Redaction & Differential Privacy AI Tooling Matrix",
            prompt: "Build polyhierarchical taxonomy and accuracy/latency rubric for PII AI tools.",
          },
          {
            task_id: "stage1_3d_motion_bench_u1",
            tier: "public_general",
            verb_kind: "meta_generator",
            owner_worker_uuid: astraUuid,
            complexity_milli: 850,
            title: "Stage 1C: 3D Rendering & Motion Graphics AI Pipeline Matrix",
            prompt: "Build polyhierarchical taxonomy and deterministic frame-budget rubric for 3D & motion AI tools.",
          },
          {
            task_id: "stage2_cross_niche_synthesis_u1",
            tier: "public_general",
            verb_kind: "eval_and_rank",
            owner_worker_uuid: astraUuid,
            blocked_by_task_id: "stage1_ocr_niche_bench_u1",
            complexity_milli: 910,
            title: "Stage 2: Cross-Niche Interchangeable I/O Pipeline Synthesis (Blocked until Stage 1A)",
            prompt: "Synthesize interchangeable typed I/O pipelines once Stage 1A OCR taxonomy is complete.",
          },
        ],
      }),
    });
    expect(seedRes.status).toBe(200);

    // 3. Batch claim (batch_size: 3) as GPT Astra -> claims the 3 unblocked Stage 1 tasks, NOT the blocked Stage 2 task!
    const batchClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "herma-codex-astra/1.0",
      },
      body: JSON.stringify({
        agent_id: "codex-gpt-astra-01",
        worker_uuid: astraUuid,
        model_hint: "gpt-astra",
        slot: "own",
        batch_size: 3,
      }),
    });
    expect(batchClaimRes.status).toBe(200);
    const batchClaim = await batchClaimRes.json();
    expect(batchClaim.routing_decision.harness_tier).toBe("tier_4_deep_architect_astra");
    expect(batchClaim.co_leased_batch.length).toBe(3);
    const batchIds = batchClaim.co_leased_batch.map((item) => item.task_id);
    expect(batchIds).toContain("stage1_ocr_niche_bench_u1");
    expect(batchIds).not.toContain("stage2_cross_niche_synthesis_u1");

    // 4. Duplicate claim within active-lease window reuses existing lease idempotently (no double-claim)
    const dupClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "herma-codex-astra/1.0" },
      body: JSON.stringify({
        agent_id: "codex-gpt-astra-01",
        worker_uuid: astraUuid,
        model_hint: "gpt-astra",
        slot: "own",
      }),
    });
    expect(dupClaimRes.status).toBe(200);
    const dupClaim = await dupClaimRes.json();
    expect(dupClaim.reused_active_lease).toBe(true);
    expect(batchIds).toContain(dupClaim.lease.task_id);

    // 5. Complete all 3 leased Stage 1 tasks -> Stage 2 (`blocked_by_task_id: stage1_ocr_niche_bench_u1`) unlocks!
    for (const item of batchClaim.co_leased_batch) {
      const doneRes = await callGateway("/q/submit", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "herma-codex-astra/1.0" },
        body: JSON.stringify({
          agent_id: "codex-gpt-astra-01",
          worker_uuid: astraUuid,
          model_hint: "gpt-astra",
          task_id: item.task_id,
          fencing_token: item.fencing_token,
          summary: `Completed ${item.task_id} with verified capability benchmark schema`,
        }),
      });
      expect(doneRes.status).toBe(200);
    }

    const stage2ClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "herma-codex-astra/1.0" },
      body: JSON.stringify({
        agent_id: "codex-gpt-astra-01",
        worker_uuid: astraUuid,
        model_hint: "gpt-astra",
        slot: "own",
      }),
    });
    expect(stage2ClaimRes.status).toBe(200);
    const stage2Claim = await stage2ClaimRes.json();
    expect(stage2Claim.lease.task_id).toBe("stage2_cross_niche_synthesis_u1");

    // 6. Inspect /q/routing and /q/traces
    const routingRes = await callGateway("/q/routing");
    expect(routingRes.status).toBe(200);
    const routingJson = await routingRes.json();
    expect(routingJson.ok).toBe(true);
    const astraArms = routingJson.learned_ucb_arms.filter((a) => a.harness_tier === "tier_4_deep_architect_astra");
    expect(astraArms.length).toBeGreaterThanOrEqual(1);
    expect(astraArms.some((a) => a.success_count >= 1)).toBe(true);

    const tracesErrRes = await callGateway("/q/traces?errors_only=1&limit=20");
    expect(tracesErrRes.status).toBe(200);
    const tracesErr = await tracesErrRes.json();
    expect(tracesErr.traces.length).toBeGreaterThanOrEqual(2);
    expect(tracesErr.traces.every((t) => t.http_status >= 400)).toBe(true);
  });

  it("recovers nested task_objects[*].payload.evaluations, prevents named-agent split-brain UUIDs, escapes demo HTML, and serves Card #7 codex_astra_seedpack", async () => {
    // 1. Named persistent agent onboarding -> subsequent /q/submit without worker_uuid reuses canonical UUID
    const obRes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "muse-herma-unit", capabilities: ["post", "cron"] }),
    });
    expect(obRes.status).toBe(200);
    const obJson = await obRes.json();
    const canonicalUuid = obJson.worker_profile.worker_uuid;

    // 2. Submit nested evaluations inside task_objects[0].payload.evaluations + XSS probe in interactive_demo
    const nestedEvalRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse-herma-unit",
        task_id: "self_seed",
        summary: "Beat-1 evaluation submitted inside nested task_objects[0].payload.evaluations",
        task_objects: [
          {
            object_key: "nested_eval_and_xss_guard_probe_v1",
            category: "evaluation_ledger",
            summary: "Nested evaluations + XSS escaping verification",
            payload: {
              evaluations: [
                {
                  target_kind: "object",
                  target_id: "portable_agent_kit_test_v1",
                  actual_importance: 94,
                  potential_importance: 97,
                  estimated_priority: 95,
                  novelty_milli: 890,
                  rationale: "Recovered from nested Muse-style payload.evaluations",
                },
              ],
              interactive_demo: {
                title: "Safe Demo <img src=x onerror=alert(1)>",
                steps: [{ title: "<script>alert(2)</script>", caption: "Escaped safely" }],
              },
            },
          },
        ],
      }),
    });
    expect(nestedEvalRes.status).toBe(200);
    const nestedEvalJson = await nestedEvalRes.json();
    expect(nestedEvalJson.worker_uuid).toBe(canonicalUuid);
    expect(nestedEvalJson.applied_evaluations.length).toBe(1);
    expect(nestedEvalJson.applied_evaluations[0].target_id).toBe("portable_agent_kit_test_v1");

    // 3. Verify the demo runner builds its nodes with DOM calls (never innerHTML) and the demo HTML escapes untrusted tags
    const demoRunnerRes = await callGateway("/q/demo-runner.js");
    expect(demoRunnerRes.status).toBe(200);
    const demoRunnerJs = await demoRunnerRes.text();
    expect(demoRunnerJs).toContain("textContent");
    expect(demoRunnerJs).not.toContain("innerHTML");

    const demoHtmlRes = await callGateway("/q/demo/nested_eval_and_xss_guard_probe_v1");
    expect(demoHtmlRes.status).toBe(200);
    const demoHtml = await demoHtmlRes.text();
    expect(demoHtml).not.toContain("<img src=x onerror=alert(1)>");
    expect(demoHtml).not.toContain("<script>alert(2)</script>");
    expect(demoHtml).toContain("\\u003cimg src=x onerror=alert(1)>");

    // 4. Card #7 raw prompt endpoint for Codex / GPT Astra
    const codexCardRes = await callGateway("/prompts/raw/codex_astra_seedpack?agent_id=codex-gpt-astra-09");
    expect(codexCardRes.status).toBe(200);
    const codexCardTxt = await codexCardRes.text();
    expect(codexCardTxt).toContain("codex-gpt-astra-09");
    expect(codexCardTxt).toContain("herma-worker/6.3");
    expect(codexCardTxt).toContain("batch_size");
  });
});
