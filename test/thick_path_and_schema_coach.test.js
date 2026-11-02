import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mirrorPublicArtifactToTesseraAnonymous } from "../deploy/cloudflare/priority_work_gateway.js";

const BASE = "https://herma.ta-amps.workers.dev";

async function callGateway(path, init = {}) {
  return exports.default.fetch(BASE + path, init);
}

async function gzipUtf8(str) {
  const raw = new TextEncoder().encode(str);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

describe("Herma v6.8 + v6.9 Thick-Path Plateau Grid, Schema Coach, Meta FAIR Embeddings, Zero-404/409 UX & Adaptive Co-Leasing", () => {
  it("writes v6_11 schema sentinel into herma_runtime_kv (k, v, expires_at_ms) and serves /health & /q/health", async () => {
    const h1 = await callGateway("/health");
    expect(h1.status).toBe(200);
    const h1Json = await h1.json();
    expect(h1Json.ok).toBe(true);

    const h2 = await callGateway("/q/health");
    expect(h2.status).toBe(200);
    const h2Json = await h2.json();
    expect(h2Json.ok).toBe(true);
    expect(h2Json.schema).toBe("herma.priority_work_gateway.grid.v6_8");
    expect(h2Json.schema_sentinel).toBe("v6_11");
    expect(h2Json.max_chunked_payload_bytes).toBe(16777216);

    const kvRow = await env.HERMA_DB.prepare(
      "SELECT k, v, expires_at_ms FROM herma_runtime_kv WHERE k = 'gateway_schema_version' LIMIT 1"
    ).first();
    expect(kvRow).toBeTruthy();
    expect(kvRow.k).toBe("gateway_schema_version");
    expect(kvRow.v).toBe("v6_11");
    expect(Number(kvRow.expires_at_ms)).toBe(0);
  });

  it("serves /q/schema, /q/schema/validate, open-world submit-time schema_feedback, aliases, and 100% custom payload preservation", async () => {
    const schemaRes = await callGateway("/q/schema");
    expect(schemaRes.status).toBe(200);
    const schemaDoc = await schemaRes.json();
    expect(schemaDoc.ok).toBe(true);
    expect(schemaDoc.extension_policy).toBe("open_world_allow_additional_properties");
    expect(schemaDoc.modality_overlays.agent_kit).toBeDefined();
    expect(schemaDoc.modality_overlays.pipeline_registry).toBeDefined();
    expect(schemaDoc.modality_overlays.multimodal_asset_kit).toBeDefined();
    expect(schemaDoc.modality_overlays.meta_embedding_adapter).toBeDefined();
    expect(schemaDoc.modality_overlays.infra_proposal).toBeDefined();

    const valRes = await callGateway("/q/schema/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "schema-coach-tester",
        task_id: "self_seed",
        desc: "Testing alias tolerance and open-world fields",
        task_objects: [
          {
            object_key: "coach_probe_kit_v1",
            category: "agent_kit",
            depends_on: ["meta_fair_multimodal_embeddings_thick_rag_v1"],
            description: "Agent kit using depends_on and description aliases",
            schema_adaptations: "Added custom_quantum_telemetry inside payload",
            payload: {
              version: "1.0.0",
              custom_quantum_telemetry: { coherence_ms: 42, nested_tags: ["alpha", "beta"] },
            },
          },
        ],
        queued_tasks: [
          {
            tier: "public_general",
            title: "Follow-up task using desc alias",
            desc: "Verify downstream composition with coach_probe_kit_v1",
          },
        ],
      }),
    });
    expect(valRes.status).toBe(200);
    const valDoc = await valRes.json();
    expect(valDoc.valid_for_open_world_submit).toBe(true);
    expect(valDoc.schema_feedback.completeness_score_milli).toBeGreaterThan(500);
    expect(valDoc.schema_feedback.suggested_canonical_aliases.length).toBeGreaterThanOrEqual(2);
    expect(valDoc.schema_feedback.schema_adaptations_honored.length).toBe(1);

    // Submit with aliases + custom payload fields + thick-path perturbation telemetry
    const subRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "schema-coach-tester",
        task_id: "self_seed",
        description: "Submitted with description alias and 5/5 thick-path perturbations",
        execution_telemetry: {
          wall_ms: 920,
          tests_passed: 8,
          tests_total: 8,
          perturbation_pass_count: 5,
          perturbation_total: 5,
          retrace_strategy: "single_pass_thick_plateau",
          retries_or_backtracks: 0,
        },
        task_objects: [
          {
            object_key: "open_world_preserved_kit_schema_tester_20261101_v1",
            category: "agent_kit",
            depends_on: ["meta_fair_multimodal_embeddings_thick_rag_v1"],
            desc: "Reusable kit with custom nested domain properties",
            schema_adaptations: "Preserves arbitrary custom_biome_matrix and sensor_calibration_curve",
            payload: {
              version: "1.2.0",
              custom_biome_matrix: [[1, 0], [0, 1]],
              sensor_calibration_curve: { slope: 0.994, intercept: -0.002, unit: "mV" },
            },
          },
        ],
        queued_tasks: [
          {
            tier: "public_general",
            title: "Verify open-world kit downstream",
            description: "Run 5-perturbation check against open_world_preserved_kit",
          },
        ],
      }),
    });
    expect(subRes.status).toBe(200);
    const subDoc = await subRes.json();
    expect(subDoc.ok).toBe(true);
    expect(subDoc.schema_feedback).toBeDefined();
    expect(subDoc.schema_feedback.flexibility_note).toMatch(/Open-world schema flexibility/i);
    expect(subDoc.thick_path_telemetry).toBeDefined();
    expect(subDoc.thick_path_telemetry.perturbation_invariance_milli).toBe(1000);
    expect(subDoc.thick_path_telemetry.thick_path_score_milli).toBeGreaterThan(750);
    expect(JSON.stringify(subDoc.stored_task_objects[0].built_on_edges)).toContain(
      "meta_fair_multimodal_embeddings_thick_rag_v1"
    );

    const storedKey = subDoc.stored_task_objects[0].object_key;
    const objRes = await callGateway(`/q/object/${encodeURIComponent(storedKey)}`);
    expect(objRes.status).toBe(200);
    const objDoc = await objRes.json();
    expect(objDoc.payload_sha256_verified).toBe(true);
    expect(objDoc.payload.custom_biome_matrix).toEqual([[1, 0], [0, 1]]);
    expect(objDoc.payload.sensor_calibration_curve.slope).toBe(0.994);

    // Check /q/grid-robustness and /q/routing surface thick-path plateau metrics
    const gridRes = await callGateway("/q/grid-robustness");
    expect(gridRes.status).toBe(200);
    const gridDoc = await gridRes.json();
    expect(gridDoc.ok).toBe(true);
    expect(gridDoc.fleet_perturbation_summary.total_perturbation_checks).toBeGreaterThanOrEqual(5);
    expect(gridDoc.configuration_cells_comparison.rejected_brittle_needle_peak).toBe(true);
    expect(gridDoc.configuration_cells_comparison.cells[0].cell_id).toBe("thick_plateau_open_world_band3");

    const routeRes = await callGateway("/q/routing");
    expect(routeRes.status).toBe(200);
    const routeDoc = await routeRes.json();
    expect(routeDoc.thick_path_routing).toBeDefined();
    expect(routeDoc.lease_intelligence).toBeDefined();
  });

  it("publishes Meta FAIR embeddings (/q/embeddings-spec) and seeded Task Object with SONAR, Contriever, Dragon+, MetaCLIP 2, and PE-Core", async () => {
    const specRes = await callGateway("/q/embeddings-spec");
    expect(specRes.status).toBe(200);
    const specText = await specRes.text();
    const forbiddenModelPattern = new RegExp(["Lla", "ma\\s*3\\.2"].join(""), "i");
    expect(specText).not.toMatch(forbiddenModelPattern);

    const specDoc = JSON.parse(specText);
    expect(specDoc.ok).toBe(true);
    const repos = specDoc.models.map((m) => m.hf_repo_id).join(" | ");
    expect(repos).toContain("facebook/SONAR");
    expect(repos).toContain("facebook/contriever-msmarco");
    expect(repos).toContain("facebook/dragon-plus-query-encoder");
    expect(repos).toContain("facebook/metaclip-2");
    expect(repos).toContain("facebook/PE-Core-L14-336");
    expect(specDoc.epsilon_ball_micro_shift_detection.sample_micro_shift_probe.micro_requirement_shift_detected).toBe(
      true
    );
    expect(specDoc.seeded_task_object.stored_in_d1).toBe(true);

    const seededRes = await callGateway("/q/object/meta_fair_multimodal_embeddings_thick_rag_v1");
    expect(seededRes.status).toBe(200);
    const seededObj = await seededRes.json();
    expect(seededObj.payload_sha256_verified).toBe(true);
    expect(seededObj.payload.models.length).toBeGreaterThanOrEqual(5);
    expect(seededObj.payload.python_adapter_snippet).toContain("sonar_or_contriever_epsilon_shift");
  });

  it("supports zero-auth and authenticated /q/feedback (+6 Diagnostic Cred, secret scrubbing, auto_diagnosis) plus /feedback alias", async () => {
    // 1. Anonymous 404 issue report on root /feedback
    const anonRes = await callGateway("/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issue_kind: "route_404",
        endpoint: "/q/task",
        http_status: 404,
        summary: "Hit 404 earlier with leaked token wt_abcdef0123456789abcdef and hmk_secret_999",
        detail: "Testing secret scrubbing on anonymous feedback",
      }),
    });
    expect(anonRes.status).toBe(200);
    const anonDoc = await anonRes.json();
    expect(anonDoc.ok).toBe(true);
    expect(anonDoc.stored_issue_object.category).toBe("worker_issue_report");
    expect(anonDoc.stored_issue_object.summary).toContain("[REDACTED_TOKEN]");
    expect(anonDoc.stored_issue_object.summary).not.toContain("wt_abcdef0123456789abcdef");
    expect(anonDoc.auto_diagnosis.matched_pattern).toBe("http_404_route_or_lookup");

    // 2. Authenticated worker report awards +6 Diagnostic Cred
    const onbRes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "diag-reporter-01", mint_new: true, model_hint: "muse-spark-1.3" }),
    });
    const onbDoc = await onbRes.json();
    const wUuid = onbDoc.worker_profile.worker_uuid;
    const wTok = onbDoc.worker_token;

    const authFbRes = await callGateway("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "diag-reporter-01",
        worker_uuid: wUuid,
        worker_token: wTok,
        issue_kind: "payload_limit",
        endpoint: "/q/submit",
        http_status: 413,
        payload_bytes: 3100000,
        summary: "3.1 MB multimodal bundle needed gzip/upload guidance",
        reproduction: "curl -X POST /q/submit -d @bundle_3mb.json",
      }),
    });
    expect(authFbRes.status).toBe(200);
    const authFbDoc = await authFbRes.json();
    expect(authFbDoc.authenticated_reporter).toBe(true);
    expect(authFbDoc.diagnostic_cred_awarded).toBe(6);
    expect(authFbDoc.auto_diagnosis.matched_pattern).toBe("large_payload_or_http_413");

    const listFbRes = await callGateway("/q/feedback");
    expect(listFbRes.status).toBe(200);
    const listFbDoc = await listFbRes.json();
    expect(listFbDoc.total_recent_reports).toBeGreaterThanOrEqual(2);
  });

  it("eliminates 404/409 worker traps: bare /q/task, /q/tasks, bare /q/object, /q/objects, /q/workers, requested_object_key fallback, /q/object/verb_*, step_mode filter, and GET /q/submit lease_epoch auto-resolution", async () => {
    // Bare /q/task and /q/tasks list tasks instead of 404
    const bareTaskRes = await callGateway("/q/task?limit=5");
    expect(bareTaskRes.status).toBe(200);
    const bareTaskDoc = await bareTaskRes.json();
    expect(Array.isArray(bareTaskDoc.tasks)).toBe(true);
    expect(bareTaskDoc.tasks.length).toBeGreaterThanOrEqual(1);

    const tasksListRes = await callGateway("/q/tasks?state=ready&limit=5");
    expect(tasksListRes.status).toBe(200);

    // Bare /q/object and /q/objects list objects instead of 404
    const bareObjRes = await callGateway("/q/object?limit=5");
    expect(bareObjRes.status).toBe(200);
    const bareObjDoc = await bareObjRes.json();
    expect(Array.isArray(bareObjDoc.objects)).toBe(true);

    // /q/workers alias
    const workersRes = await callGateway("/q/workers");
    expect(workersRes.status).toBe(200);
    const workersDoc = await workersRes.json();
    expect(workersDoc.ok).toBe(true);

    // Submit an atomic_build_step Task Object that triggers auto-versioning or suffix normalization + follow-up task
    const seedSub = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "step-mode-builder-01",
        task_id: "self_seed",
        summary: "Shipped runnable pytest validator and cognitive triage follow-up",
        task_objects: [
          {
            object_key: "runnable_validator_step_probe_v1",
            category: "validator_code",
            summary: "Runnable Python pytest validator for CSV intake",
            payload: { files: { "validator.py": "def validate(row): return bool(row)" }, pytest_passed: true },
          },
        ],
        followup_tasks: [
          {
            tier: "public_general",
            step_mode: "atomic_cognitive_step",
            title: "Rank multilingual shelter rubric ambiguity",
            prompt: "Evaluate and rank top 3 rubric disambiguations.",
          },
        ],
      }),
    });
    expect(seedSub.status).toBe(200);
    const seedSubDoc = await seedSub.json();
    const createdVerbId = seedSubDoc.enqueued_followup_verbs[0].task_id;
    expect(seedSubDoc.stored_task_objects[0].step_mode).toBe("atomic_build_step");
    expect(seedSubDoc.stored_task_objects[0].reuse_mode).toBe("deterministic_code_bypass");

    // Cross-resolve /q/object/<verb_id> cleanly instead of 404!
    const crossVerbRes = await callGateway(`/q/object/${encodeURIComponent(createdVerbId)}`);
    expect(crossVerbRes.status).toBe(200);
    const crossVerbDoc = await crossVerbRes.json();
    expect(crossVerbDoc.resolved_kind).toBe("durable_task_cross_resolved");
    expect(crossVerbDoc.task_id).toBe(createdVerbId);

    // Filter /q/tasks and /q/objects by step_mode
    const cogTasksRes = await callGateway("/q/tasks?step_mode=atomic_cognitive_step");
    expect(cogTasksRes.status).toBe(200);
    const cogTasksDoc = await cogTasksRes.json();
    expect(cogTasksDoc.tasks.some((t) => t.task_id === createdVerbId)).toBe(true);

    const buildObjsRes = await callGateway("/q/objects?step_mode=atomic_build_step");
    expect(buildObjsRes.status).toBe(200);
    const buildObjsDoc = await buildObjsRes.json();
    expect(buildObjsDoc.objects.length).toBeGreaterThanOrEqual(1);

    // Pulse includes step_mode_counts
    const pulseRes = await callGateway("/q/pulse");
    const pulseDoc = await pulseRes.json();
    expect(pulseDoc.step_mode_counts).toBeDefined();

    // Browser GET /q/submit auto-resolves omitted lease_epoch when leased_worker_uuid matches!
    const getClaimRes = await callGateway("/q/claim/browser-get-agent?format=json");
    expect(getClaimRes.status).toBe(200);
    const getClaimDoc = await getClaimRes.json();
    const browserUuid = getClaimDoc.bilateral_guidance.worker_profile.worker_uuid;
    const browserTaskId = getClaimDoc.lease.task_id;

    // Intentionally omit --fence-<n> and ?lease_epoch=<n> on GET while supplying matching uuid-<worker_uuid>
    const getSubNoFence = await callGateway(
      `/q/submit/browser-get-agent/${encodeURIComponent(browserTaskId)}/uuid-${encodeURIComponent(browserUuid)}--summary-completed-via-browser-get-auto-fence?format=json`
    );
    expect(getSubNoFence.status).toBe(200);
    const getSubDoc = await getSubNoFence.json();
    expect(getSubDoc.ok).toBe(true);
    expect(getSubDoc.completed_task_id).toBe(browserTaskId);
  });

  it("supports Content-Encoding: gzip on /q/submit, single-shot & resumable /q/upload + /q/blob/<sha256>, and Tessera >48KB summary mirror + 413/507 rotation", async () => {
    // 1. Gzipped POST /q/submit with multi-hundred-KB payload (> 256 KB inline threshold so multi-chunk D1 storage runs too!)
    const largeText = "thick_plateau_verified_segment_".repeat(10000); // ~310 KB > 262,144 inline max
    const gzPayloadStr = JSON.stringify({
      agent_id: "gzip-chunk-worker-01",
      task_id: "self_seed",
      summary: "Compressed multi-chunk Task Object submission via Content-Encoding: gzip",
      task_objects: [
        {
          object_key: "gzip_multichunk_asset_kit_20261101_v1",
          category: "multimodal_asset_kit",
          step_mode: "atomic_build_step",
          summary: "Multi-chunk gzipped Task Object verified end-to-end",
          payload: { blob_text: largeText, markers: [1, 2, 3] },
        },
      ],
    });
    const gzBytes = await gzipUtf8(gzPayloadStr);
    expect(gzBytes.byteLength).toBeLessThan(gzPayloadStr.length / 5);

    const gzSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: gzBytes,
    });
    expect(gzSubRes.status).toBe(200);
    const gzSubDoc = await gzSubRes.json();
    expect(gzSubDoc.ok).toBe(true);
    expect(gzSubDoc.stored_task_objects[0].chunk_count).toBeGreaterThanOrEqual(2);

    const reassembledRes = await callGateway(
      `/q/object/${encodeURIComponent(gzSubDoc.stored_task_objects[0].object_key)}`
    );
    expect(reassembledRes.status).toBe(200);
    const reassembledDoc = await reassembledRes.json();
    expect(reassembledDoc.payload_sha256_verified).toBe(true);
    expect(reassembledDoc.payload.blob_text.length).toBe(largeText.length);

    // 2. Single-shot binary upload to POST /q/upload -> GET /q/blob/<sha256>
    const sampleBin = new Uint8Array(4096);
    for (let i = 0; i < sampleBin.length; i += 1) sampleBin[i] = (i * 37 + 11) & 0xff;
    const upRes = await callGateway("/q/upload?filename=manifold_mesh.stl&object_key=stl_upload_cas_v1", {
      method: "POST",
      headers: { "content-type": "model/stl" },
      body: sampleBin,
    });
    expect(upRes.status).toBe(201);
    const upDoc = await upRes.json();
    expect(upDoc.ok).toBe(true);
    expect(upDoc.sha256_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(upDoc.registered_task_object.object_key).toContain("stl_upload_cas");

    const blobRes = await callGateway(`/q/blob/${upDoc.sha256_hash}`);
    expect(blobRes.status).toBe(200);
    expect(blobRes.headers.get("x-content-sha256")).toBe(upDoc.sha256_hash);
    const downloaded = new Uint8Array(await blobRes.arrayBuffer());
    expect(downloaded.byteLength).toBe(sampleBin.byteLength);
    expect(Array.from(downloaded.slice(0, 32))).toEqual(Array.from(sampleBin.slice(0, 32)));

    // 3. Resumable multipart upload (/q/upload/init -> PUT parts -> complete)
    const initRes = await callGateway("/q/upload/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "resumable-uploader-01",
        filename: "ambient_stem.wav",
        content_type: "audio/wav",
        object_key: "resumable_wav_stem_v1",
      }),
    });
    expect(initRes.status).toBe(201);
    const initDoc = await initRes.json();
    const upId = initDoc.upload_id;

    const part0 = new TextEncoder().encode("RIFF_HEADER_PART_0_");
    const part1 = new TextEncoder().encode("PCM_SAMPLES_PART_1");
    const p0Res = await callGateway(`/q/upload/${upId}/0`, { method: "PUT", body: part0 });
    expect(p0Res.status).toBe(200);
    const p1Res = await callGateway(`/q/upload/${upId}/1`, { method: "PUT", body: part1 });
    expect(p1Res.status).toBe(200);

    const compRes = await callGateway(`/q/upload/${upId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Assembled 2-part WAV stem" }),
    });
    expect(compRes.status).toBe(201);
    const compDoc = await compRes.json();
    expect(compDoc.resumable_completed).toBe(true);
    expect(compDoc.total_bytes).toBe(part0.byteLength + part1.byteLength);

    // 4. Unit-verify Tessera >48KB compact summary mirror & 507 quota session rotation
    const calls = [];
    let sessionMintCount = 0;
    let firstPutReturned507 = false;
    const mockEnv = {
      TESSERA: {
        async fetch(req) {
          const u = new URL(req.url);
          if (u.pathname === "/v1/session/anonymous") {
            sessionMintCount += 1;
            return new Response(JSON.stringify({ token: `tan_mock_session_${sessionMintCount}` }), { status: 200 });
          }
          const bodyStr = await req.text();
          calls.push({ auth: req.headers.get("authorization"), bytes: bodyStr.length, body: JSON.parse(bodyStr) });
          if (!firstPutReturned507) {
            firstPutReturned507 = true;
            return new Response(JSON.stringify({ error: "quota_exceeded" }), { status: 507 });
          }
          return new Response(JSON.stringify({ receipt_hash: "tessera_rcpt_sha256_ok" }), { status: 200 });
        },
      },
    };
    const hugeArtifact = { object_key: "huge_64kb_test_v1", data: "X".repeat(70000) };
    const mirrorOut = await mirrorPublicArtifactToTesseraAnonymous(
      mockEnv,
      "tessera-test-agent",
      "huge_64kb_test_v1",
      hugeArtifact
    );
    expect(mirrorOut.synced).toBe(true);
    expect(mirrorOut.summary_mirror).toBe(true);
    expect(calls.length).toBe(2); // First hit 507 -> rotated to fresh tan_ session -> succeeded!
    expect(calls[1].bytes).toBeLessThan(48000);
    expect(calls[1].body.value.summary_mirror).toBe(true);
    expect(calls[0].auth).not.toBe(calls[1].auth);
  });

  it("supports Adaptive Multi-Worker Co-Leasing, /q/heartbeat, Zero-Loss Ensemble Merge (DPO pair ready), Late-Finisher Grace, and strict 409 security against spoofers", async () => {
    // 1. Seed a dedicated high-priority task for multi-worker co-lease testing
    const seedRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "ensemble-seeder",
        task_id: "self_seed",
        summary: "Seeded benchmark task for adaptive multi-worker co-leasing",
        followup_tasks: [
          {
            tier: "public_general",
            family: "colease-ensemble-suite",
            step_mode: "atomic_build_step",
            priority: 88,
            title: "Implement deterministic thick-path SONAR reranker",
            prompt: "Ship verified Python/JS reranker and 5-perturbation test suite.",
          },
        ],
      }),
    });
    expect(seedRes.status).toBe(200);
    const seedDoc = await seedRes.json();
    const targetTaskId = seedDoc.enqueued_followup_verbs[0].task_id;

    // 2. Onboard Worker A (muse-spark) and Worker B (kimi-k2.7) and Spoofer C
    const [onbARes, onbBRes, onbCRes] = await Promise.all([
      callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "worker-alpha-muse", mint_new: true, model_hint: "muse-spark-1.3" }),
      }),
      callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "worker-beta-kimi", mint_new: true, model_hint: "kimi-k2.7" }),
      }),
      callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "spoofer-gamma", mint_new: true, model_hint: "unknown" }),
      }),
    ]);
    const workerA = await onbARes.json();
    const workerB = await onbBRes.json();
    const spooferC = await onbCRes.json();

    // 3. Unclaimed task submission MUST still fail closed with 409!
    const unclaimedSpoof = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "spoofer-gamma",
        worker_uuid: spooferC.worker_profile.worker_uuid,
        worker_token: spooferC.worker_token,
        task_id: targetTaskId,
        lease_epoch: 1,
        summary: "Attempted completion on ready unclaimed task",
      }),
    });
    expect(unclaimedSpoof.status).toBe(409);

    // 4. Worker A claims targetTaskId (slot 1 primary lease)
    const claimARes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-alpha-muse",
        worker_uuid: workerA.worker_profile.worker_uuid,
        worker_token: workerA.worker_token,
        model_hint: "muse-spark-1.3",
        task_id: targetTaskId,
      }),
    });
    expect(claimARes.status).toBe(200);
    const claimA = await claimARes.json();
    expect(claimA.lease.task_id).toBe(targetTaskId);
    const epochA = claimA.lease.lease_epoch;

    // 5. Exact same worker (Worker A) calling /q/claim again NEVER double-leases a second slot -> returns reused_active_lease: true!
    const sameWorkerReclaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-alpha-muse",
        worker_uuid: workerA.worker_profile.worker_uuid,
        worker_token: workerA.worker_token,
        model_hint: "muse-spark-1.3",
        task_id: targetTaskId,
        allow_co_lease: true,
      }),
    });
    expect(sameWorkerReclaimRes.status).toBe(200);
    const sameWorkerReclaim = await sameWorkerReclaimRes.json();
    expect(sameWorkerReclaim.reused_active_lease).toBe(true);
    expect(sameWorkerReclaim.lease.lease_epoch).toBe(epochA);

    // 6. Distinct Worker B (kimi-k2.7 != muse-spark-1.3) claims parallel co-lease on the in-flight family!
    const claimBRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-beta-kimi",
        worker_uuid: workerB.worker_profile.worker_uuid,
        worker_token: workerB.worker_token,
        model_hint: "kimi-k2.7",
        family: "colease-ensemble-suite",
      }),
    });
    expect(claimBRes.status).toBe(200);
    const claimB = await claimBRes.json();
    expect(claimB.lease.task_id).toBe(targetTaskId);
    expect(claimB.co_leased_parallel_slot).toBe(2);
    expect(claimB.co_lease_mode).toBe("diverse_model_ensemble");
    const epochB = claimB.lease.lease_epoch;
    expect(epochB).toBeGreaterThan(epochA);

    // 7. Worker B sends a /q/heartbeat to extend its active co-lease
    const hbRes = await callGateway("/q/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-beta-kimi",
        worker_uuid: workerB.worker_profile.worker_uuid,
        worker_token: workerB.worker_token,
        task_id: targetTaskId,
        lease_epoch: epochB,
        extend_seconds: 900,
        progress_note: "Running 5-perturbation pytest suite (4/5 complete)",
      }),
    });
    expect(hbRes.status).toBe(200);
    const hbDoc = await hbRes.json();
    expect(hbDoc.ok).toBe(true);
    expect(hbDoc.lease_epoch).toBe(epochB);

    // 8. Spoofer C (who NEVER claimed a slot) tries to submit with forged epoch 999 -> MUST get 409!
    const forgedSpoof = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "spoofer-gamma",
        worker_uuid: spooferC.worker_profile.worker_uuid,
        worker_token: spooferC.worker_token,
        task_id: targetTaskId,
        lease_epoch: 999,
        summary: "Forged fencing token attempt",
      }),
    });
    expect(forgedSpoof.status).toBe(409);

    // 9. Worker A finishes FIRST -> 200 OK!
    const subARes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-alpha-muse",
        worker_uuid: workerA.worker_profile.worker_uuid,
        worker_token: workerA.worker_token,
        task_id: targetTaskId,
        lease_epoch: epochA,
        summary: "Primary Muse Spark implementation of thick-path SONAR reranker",
        execution_telemetry: { wall_ms: 1200, perturbation_pass_count: 5, perturbation_total: 5 },
        task_objects: [
          {
            object_key: "sonar_reranker_impl_v1",
            category: "meta_embedding_adapter",
            summary: "Muse Spark SONAR reranker implementation",
            payload: { solver: "muse-spark-1.3", pass_rate: 1.0 },
          },
        ],
      }),
    });
    expect(subARes.status).toBe(200);
    const subADoc = await subARes.json();
    expect(subADoc.ok).toBe(true);

    // 10. Worker B finishes SECOND on the now-'done' task using its legitimate co-lease epochB -> ZERO-LOSS 200 OK + DPO pair ready!
    const subBRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "worker-beta-kimi",
        worker_uuid: workerB.worker_profile.worker_uuid,
        worker_token: workerB.worker_token,
        task_id: targetTaskId,
        lease_epoch: epochB,
        summary: "Parallel Kimi-K2.7 ensemble implementation of thick-path SONAR reranker",
        execution_telemetry: { wall_ms: 1650, perturbation_pass_count: 5, perturbation_total: 5 },
        task_objects: [
          {
            // Intentionally pass the EXACT same object_key to verify collision-free __by_<agent_id> preservation!
            object_key: "sonar_reranker_impl_v1",
            category: "meta_embedding_adapter",
            summary: "Kimi-K2.7 SONAR reranker ensemble implementation",
            payload: { solver: "kimi-k2.7", pass_rate: 1.0 },
          },
        ],
      }),
    });
    expect(subBRes.status).toBe(200);
    const subBDoc = await subBRes.json();
    expect(subBDoc.ok).toBe(true);
    expect(subBDoc.resolution_role).toBe("ensemble_co_solver");
    expect(subBDoc.stored_task_objects[0].object_key).toContain("__by_worker-beta-kimi");
    expect(subBDoc.ensemble_group).toBeDefined();
    expect(subBDoc.ensemble_group.solver_count).toBeGreaterThanOrEqual(2);
    expect(subBDoc.ensemble_group.dpo_pair_ready).toBe(true);

    // 11. Verify /q/lease-intelligence reports the multi-solver DPO-ready ensemble group!
    const liRes = await callGateway("/q/lease-intelligence");
    expect(liRes.status).toBe(200);
    const liDoc = await liRes.json();
    expect(liDoc.ok).toBe(true);
    expect(liDoc.dpo_ready_group_count).toBeGreaterThanOrEqual(1);
    expect(liDoc.ensemble_task_groups.some((g) => g.task_id === targetTaskId && g.dpo_pair_ready)).toBe(true);
  });

  it("serves canonical v9 prompt at /prompts/raw/codex_unlimited_frontier_loop_v9 (and v8/v7 aliases) with strict light-only UI and zero em-dashes", async () => {
    const rawV9Res = await callGateway(
      "/prompts/raw/codex_unlimited_frontier_loop_v9?agent_id=codex-wave-99&worker_uuid=w_codex_99"
    );
    expect(rawV9Res.status).toBe(200);
    const rawV9 = await rawV9Res.text();
    expect(rawV9).toContain("(v9)");
    expect(rawV9).toContain("codex-wave-99");
    expect(rawV9).toContain("w_codex_99");
    expect(rawV9).toContain("SONAR");
    expect(rawV9).toContain("Contriever");
    expect(rawV9).toContain("MetaCLIP 2");
    expect(rawV9).toContain("/q/affinity");
    expect(rawV9).toContain("/q/schema");
    expect(rawV9).toContain("/q/feedback");
    expect(rawV9).toContain("proactive_observations");
    expect(rawV9).toContain("/q/upload");
    expect(rawV9).not.toContain("\u2014");

    // v8 and v7 URLs seamlessly upgrade to v9
    const rawV8AliasRes = await callGateway("/prompts/raw/codex_unlimited_frontier_loop_v8");
    expect(rawV8AliasRes.status).toBe(200);
    expect(await rawV8AliasRes.text()).toContain("(v9)");

    const rawV7AliasRes = await callGateway("/prompts/raw/codex_unlimited_frontier_loop_v7");
    expect(rawV7AliasRes.status).toBe(200);
    expect(await rawV7AliasRes.text()).toContain("(v9)");

    const htmlRes = await callGateway("/prompts");
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toMatch(/only light/i);
    expect(html).not.toMatch(/prefers-color-scheme\s*:\s*dark/i);
    expect(html).not.toContain("\u2014");
  });

  it("enforces Herma v6.10 zero-missing taxonomy auto-describer, model_hint canonicalization, /q/affinity Ricardian + setup pairing, and catch-all /q/feedback + proactive_observations peer-review verb loop", async () => {
    // 1. Onboard workers with drifted model_hint values ("Codex", "ollama-cloud/muse-spark-open") and verify canonicalization
    const [onbCodexRes, onbMuseRes] = await Promise.all([
      callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "codex-heavy-builder-01",
          mint_new: true,
          harness_tier: "tier_4_deep_architect_astra",
          model_hint: "Codex",
          capabilities: ["shell", "python", "pytest", "git"],
        }),
      }),
      callGateway("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "muse-peer-reviewer-02",
          mint_new: true,
          harness_tier: "tier_2_structured_json",
          model_hint: "ollama-cloud/muse-spark-open",
          capabilities: ["http", "json", "rubric_eval"],
        }),
      }),
    ]);
    const codexDoc = await onbCodexRes.json();
    const museDoc = await onbMuseRes.json();
    expect(codexDoc.worker_profile.model_hint).toBe("codex");
    expect(museDoc.worker_profile.model_hint).toBe("muse-spark-open");

    // 2. Submit untagged Task Object + two follow-up tasks (one cognitive, one preferred-setup build) + inline proactive_observations
    const untaggedSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-heavy-builder-01",
        worker_uuid: codexDoc.worker_profile.worker_uuid,
        worker_token: codexDoc.worker_token,
        task_id: "self_seed",
        summary: "Seeded untagged Python pytest module + paired affinity tasks + inline observation",
        execution_telemetry: { wall_ms: 820, perturbation_pass_count: 5, perturbation_total: 5 },
        task_objects: [
          {
            object_key: "untagged_auto_enriched_pytest_mod_20261101_v1",
            category: "validator_code",
            summary: "Python pytest verification module for NGO CSV schema validation",
            payload: { code: "def check_schema(row): return isinstance(row, dict)" },
          },
        ],
        proactive_observations: [
          {
            signal_kind: "better_or_alternative_way",
            target_component: "shared_substrate",
            observation: "Batching D1 taxonomy enrichment reduces cold-start queries on multi-object submissions.",
            proposed_alternative: "Group deterministic enrichment writes per chunk transaction.",
          },
        ],
        followup_tasks: [
          {
            tier: "public_general",
            family: "v610-ricardian-pair",
            step_mode: "atomic_cognitive_step",
            priority: 82,
            title: "Triage NGO CSV rubric wording",
            prompt: "Rank 3 rubric phrasing variants without shell execution.",
          },
          {
            tier: "public_general",
            family: "v610-ricardian-pair",
            step_mode: "atomic_build_step",
            priority: 80,
            title: "Build Python pytest CLI adapter with preferred setup",
            prompt: "Implement and test Python CLI adapter.",
            preferred_worker_setup: {
              preferred_harness_tiers: ["tier_4_deep_architect_astra"],
              required_tools: ["shell", "python", "pytest"],
              min_context_tokens: 65536,
              preferred_model_families: ["codex", "gpt-astra"],
              preferred_worker_uuids: [codexDoc.worker_profile.worker_uuid],
            },
          },
        ],
      }),
    });
    expect(untaggedSubRes.status).toBe(200);
    const untaggedSubDoc = await untaggedSubRes.json();
    expect(untaggedSubDoc.proactive_feedback_receipts.length).toBe(1);
    const inlineReviewVerbId = untaggedSubDoc.proactive_feedback_receipts[0].review_verb_id;
    expect(inlineReviewVerbId).toMatch(/^verb_fbk_review_/);

    // 3. Heavy tier_4 CLI worker claims on family="v610-ricardian-pair" with worker_setup -> Ricardian + setup affinity picks atomic_build_step over slightly higher raw-priority cognitive step!
    const heavyClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-heavy-builder-01",
        worker_uuid: codexDoc.worker_profile.worker_uuid,
        worker_token: codexDoc.worker_token,
        family: "v610-ricardian-pair",
        worker_setup: {
          harness_tier: "tier_4_deep_architect_astra",
          model_hint: "codex",
          tools_available: ["shell", "python", "pytest", "git"],
          context_tokens: 131072,
        },
      }),
    });
    expect(heavyClaimRes.status).toBe(200);
    const heavyClaimDoc = await heavyClaimRes.json();
    expect(heavyClaimDoc.lease.step_mode).toBe("atomic_build_step");
    expect(heavyClaimDoc.lease.affinity_telemetry).toBeDefined();
    expect(heavyClaimDoc.lease.affinity_telemetry.setup_fit_milli).toBeGreaterThanOrEqual(800);
    expect(heavyClaimDoc.lease.preferred_worker_setup.preferred_model_families).toContain("codex-frontier");

    // 4. Catch-all POST /q/feedback (both structured signal_kind AND freeform plain text) -> returns 200 + review_verb_id
    const catchAllFbRes = await callGateway("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-heavy-builder-01",
        worker_uuid: codexDoc.worker_profile.worker_uuid,
        worker_token: codexDoc.worker_token,
        signal_kind: "efficiency_concern",
        target_component: "routing_affinity",
        observation: "Heavy CLI workers previously claimed trivial cognitive tasks when build tasks had 2 points lower priority.",
        proposed_alternative: "Apply Ricardian comparative-advantage opportunity-cost adjustment on /q/claim.",
      }),
    });
    expect(catchAllFbRes.status).toBe(200);
    const catchAllFbDoc = await catchAllFbRes.json();
    expect(catchAllFbDoc.ok).toBe(true);
    expect(catchAllFbDoc.review_verb_id).toMatch(/^verb_fbk_review_/);
    expect(catchAllFbDoc.stored_issue_object.category).toBe("system_feedback_signal");
    const reviewVerbId = catchAllFbDoc.review_verb_id;

    // Freeform plain-text feedback also works cleanly!
    const freeformFbRes = await callGateway("/q/feedback", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "Freeform worker note: /q/affinity makes setup pairing super clear for multi-model swarms.",
    });
    expect(freeformFbRes.status).toBe(200);
    const freeformFbDoc = await freeformFbRes.json();
    expect(freeformFbDoc.ok).toBe(true);

    // 5. Enforce drafter != reviewer: reporter attempting to claim its own review_verb_id gets 403 self_review_forbidden!
    const selfClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-heavy-builder-01",
        worker_uuid: codexDoc.worker_profile.worker_uuid,
        worker_token: codexDoc.worker_token,
        task_id: reviewVerbId,
      }),
    });
    expect(selfClaimRes.status).toBe(403);
    const selfClaimDoc = await selfClaimRes.json();
    expect(selfClaimDoc.error).toBe("self_review_forbidden");

    // 6. Independent peer reviewer (muse-peer-reviewer-02 != codex-heavy-builder-01) claims & verifies reviewVerbId -> promotes to /q/proposals!
    const peerClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse-peer-reviewer-02",
        worker_uuid: museDoc.worker_profile.worker_uuid,
        worker_token: museDoc.worker_token,
        task_id: reviewVerbId,
      }),
    });
    expect(peerClaimRes.status).toBe(200);
    const peerClaimDoc = await peerClaimRes.json();
    expect(peerClaimDoc.lease.task_id).toBe(reviewVerbId);

    const peerSubRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse-peer-reviewer-02",
        worker_uuid: museDoc.worker_profile.worker_uuid,
        worker_token: museDoc.worker_token,
        task_id: reviewVerbId,
        lease_epoch: peerClaimDoc.lease.lease_epoch,
        summary: "Independently benchmarked and verified Ricardian opportunity-cost improvement across 5 perturbations.",
        execution_telemetry: { wall_ms: 610, tests_passed: 6, tests_total: 6, perturbation_pass_count: 5, perturbation_total: 5 },
      }),
    });
    expect(peerSubRes.status).toBe(200);
    const peerSubDoc = await peerSubRes.json();
    expect(peerSubDoc.feedback_peer_review).toBeDefined();
    expect(peerSubDoc.feedback_peer_review.verified).toBe(true);
    expect(peerSubDoc.feedback_peer_review.promoted_proposal_key).toBeTruthy();

    // 7. Verify GET /q/affinity returns 200 AND taxonomy_completeness shows 0 missing rows across queue & objects!
    const affRes = await callGateway("/q/affinity");
    expect(affRes.status).toBe(200);
    const affDoc = await affRes.json();
    expect(affDoc.ok).toBe(true);
    expect(affDoc.taxonomy_completeness.durable_queue.missing_intent_bucket).toBe(0);
    expect(affDoc.taxonomy_completeness.durable_queue.missing_target_env).toBe(0);
    expect(affDoc.taxonomy_completeness.durable_queue.missing_prog_lang).toBe(0);
    expect(affDoc.taxonomy_completeness.durable_queue.missing_deliverable_kind).toBe(0);
    expect(affDoc.taxonomy_completeness.durable_queue.empty_required_capabilities_json).toBe(0);
    expect(affDoc.taxonomy_completeness.durable_queue.empty_search_hints_json).toBe(0);
    expect(affDoc.taxonomy_completeness.task_objects.missing_intent_bucket).toBe(0);
    expect(affDoc.taxonomy_completeness.task_objects.missing_target_env).toBe(0);
    expect(affDoc.taxonomy_completeness.task_objects.missing_prog_lang).toBe(0);
    expect(affDoc.taxonomy_completeness.task_objects.missing_deliverable_kind).toBe(0);
    expect(affDoc.taxonomy_completeness.task_objects.empty_search_hints_json).toBe(0);
    expect(affDoc.worker_rankings.length).toBeGreaterThanOrEqual(2);
    expect(affDoc.setup_signature_rankings.length).toBeGreaterThanOrEqual(1);
    expect(affDoc.canonical_model_stats.some((m) => m.canonical_model_family === "codex-frontier")).toBe(true);
    expect(affDoc.canonical_model_stats.some((m) => m.canonical_model_family === "muse-spark")).toBe(true);
    expect(affDoc.worker_rankings.some((w) => w.model_hint === "codex")).toBe(true);
    expect(affDoc.worker_rankings.some((w) => w.model_hint === "muse-spark-open")).toBe(true);
  });
});
