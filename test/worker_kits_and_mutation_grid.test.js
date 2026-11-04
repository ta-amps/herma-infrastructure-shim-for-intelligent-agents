import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import {
  AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY,
  HERMA_PROMPT_KIT_MUTATION_GRID,
  computeCrc32Bytes,
  computeUtcCadenceBuckets,
} from "../deploy/cloudflare/worker_kits_and_mutation_grid.js";

const BASE = "https://herma.ta-amps.workers.dev";
const BANNED_LL_RE = new RegExp("ll" + "ama", "i");
const BANNED_SYN_RE = new RegExp("syn" + "thetic", "i");

async function callGateway(path, init = {}, envOverrides = null) {
  if (envOverrides) {
    return worker.fetch(new Request(BASE + path, init), { ...env, ...envOverrides });
  }
  return exports.default.fetch(BASE + path, init);
}

async function sha256HexBytes(u8) {
  const digest = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function gunzipBytes(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

function parsePosixUstarTar(tarBytes) {
  expect(tarBytes.byteLength % 512).toBe(0);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  while (offset + 512 <= tarBytes.byteLength) {
    const header = tarBytes.subarray(offset, offset + 512);
    const isZeroBlock = header.every((b) => b === 0);
    if (isZeroBlock) {
      break;
    }
    const nameRaw = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
    const storedChksumOctal = decoder.decode(header.subarray(148, 156)).replace(/\0.*$/, "").trim();
    const magic = decoder.decode(header.subarray(257, 263)).replace(/\0.*$/, "");
    expect(magic).toBe("ustar");

    let computedSum = 0;
    for (let i = 0; i < 512; i += 1) {
      computedSum += i >= 148 && i < 156 ? 0x20 : header[i];
    }
    expect(computedSum).toBe(parseInt(storedChksumOctal, 8));

    const byteSize = parseInt(sizeOctal, 8);
    const dataStart = offset + 512;
    const contentBytes = tarBytes.subarray(dataStart, dataStart + byteSize);
    entries.push({
      name: nameRaw,
      size: byteSize,
      text: decoder.decode(contentBytes),
    });
    const paddedDataBytes = Math.ceil(byteSize / 512) * 512;
    offset = dataStart + paddedDataBytes;
  }

  // Verify trailing 1024-byte end-of-archive zero blocks
  expect(tarBytes.byteLength - offset).toBeGreaterThanOrEqual(1024);
  return entries;
}

function parseAndVerifyPkzipStoreArchive(zipBytes) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder();

  // Locate End of Central Directory (0x06054b50) at end of buffer
  const eocdOffset = zipBytes.byteLength - 22;
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  const entryCount = view.getUint16(eocdOffset + 8, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  expect(centralDirOffset + centralDirSize).toBe(eocdOffset);

  const entries = [];
  let cdPtr = centralDirOffset;
  for (let i = 0; i < entryCount; i += 1) {
    expect(view.getUint32(cdPtr, true)).toBe(0x02014b50);
    const method = view.getUint16(cdPtr + 10, true);
    expect(method).toBe(0);
    const cdCrc32 = view.getUint32(cdPtr + 16, true);
    const compSize = view.getUint32(cdPtr + 20, true);
    const uncompSize = view.getUint32(cdPtr + 24, true);
    expect(compSize).toBe(uncompSize);
    const nameLen = view.getUint16(cdPtr + 28, true);
    const extraLen = view.getUint16(cdPtr + 30, true);
    const commentLen = view.getUint16(cdPtr + 32, true);
    const localHeaderOffset = view.getUint32(cdPtr + 42, true);
    const name = decoder.decode(zipBytes.subarray(cdPtr + 46, cdPtr + 46 + nameLen));

    // Verify matching Local File Header (0x04034b50) and IEEE CRC32
    expect(view.getUint32(localHeaderOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localHeaderOffset + 8, true)).toBe(0);
    expect(view.getUint32(localHeaderOffset + 14, true)).toBe(cdCrc32);
    const lfhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lfhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const payload = zipBytes.subarray(dataStart, dataStart + uncompSize);
    expect(computeCrc32Bytes(payload)).toBe(cdCrc32);

    entries.push({
      name,
      crc32: cdCrc32,
      size: uncompSize,
      text: decoder.decode(payload),
    });

    cdPtr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

describe("Herma v6.11 Downloadable Worker Kits, Prompt/Toolkit Evolutionary Bandit & Cadence Reprioritization", () => {
  it("serves Light-UI-Only HTML and JSON catalog on GET /kits plus deterministic SHA-256 single-file endpoints", async () => {
    const htmlRes = await callGateway("/kits", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(htmlRes.status, await htmlRes.clone().text()).toBe(200);
    const html = await htmlRes.text();
    // The page is on the shared Paper & Ink shell: light only, with its colours in the shared stylesheet.
    expect(html).toContain('<meta name="color-scheme" content="only light">');
    expect(html).toContain("/assets/herma-pages.css");
    expect(html).not.toMatch(/prefers-color-scheme\s*:\s*dark/i);
    expect(html).toContain("herma-agent-kit.tgz");
    expect(html).toContain("herma-worker-kit.zip");

    const jsRes = await callGateway("/kits.js");
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("application/javascript");

    const jsonRes = await callGateway("/kits", {
      headers: { accept: "application/json" },
    });
    expect(jsonRes.status).toBe(200);
    const catalog = await jsonRes.json();
    expect(catalog.ok).toBe(true);
    expect(catalog.kits.length).toBeGreaterThanOrEqual(7);

    const directRoutes = [
      "/kits/package.json",
      "/kits/herma_shim.py",
      "/kits/bootstrap.sh",
      "/kits/SKILL.md",
      "/kits/pretool_guard.py",
      "/kits/mcp-manifest.json",
    ];
    for (const route of directRoutes) {
      const res = await callGateway(route);
      expect(res.status, `Failed on ${route}`).toBe(200);
      const raw = new Uint8Array(await res.arrayBuffer());
      const actualSha = await sha256HexBytes(raw);
      expect(res.headers.get("x-content-sha256")).toBe(actualSha);
      expect(res.headers.get("x-herma-kit-sha256")).toBe(actualSha);
      expect(res.headers.get("etag")).toBe(`"${actualSha}"`);
      expect(Number(res.headers.get("content-length"))).toBe(raw.byteLength);
    }

    const notFoundRes = await callGateway("/kits/nonexistent-kit.bin");
    expect(notFoundRes.status).toBe(404);
  });

  it("dynamically builds a valid POSIX ustar + gzip npm tarball (/kits/herma-agent-kit.tgz) and CRC32 PKZIP bundle (/kits/herma-worker-kit.zip)", async () => {
    const tgzRes = await callGateway("/kits/herma-agent-kit.tgz?arm=arm_default_recommended_v1");
    expect(tgzRes.status).toBe(200);
    expect(tgzRes.headers.get("x-herma-attributed-arm")).toBe("arm_default_recommended_v1");
    const tgzBytes = new Uint8Array(await tgzRes.arrayBuffer());
    const tgzSha = await sha256HexBytes(tgzBytes);
    expect(tgzRes.headers.get("x-content-sha256")).toBe(tgzSha);
    expect(tgzBytes[0]).toBe(0x1f);
    expect(tgzBytes[1]).toBe(0x8b);

    const tarBytes = await gunzipBytes(tgzBytes);
    const tarEntries = parsePosixUstarTar(tarBytes);
    const tarNames = tarEntries.map((e) => e.name);
    expect(tarNames).toEqual([
      "package/package.json",
      "package/index.mjs",
      "package/bin/herma-kit.mjs",
      "package/README.md",
    ]);
    const pkgJson = JSON.parse(tarEntries.find((e) => e.name === "package/package.json").text);
    expect(pkgJson.name).toBe("herma-agent-kit");
    expect(pkgJson.bin["herma-kit"]).toBe("./bin/herma-kit.mjs");
    const cliSrc = tarEntries.find((e) => e.name === "package/bin/herma-kit.mjs").text;
    for (const subcmd of ["status", "search", "describe", "claim", "use", "submit", "feedback"]) {
      expect(cliSrc).toContain(`'${subcmd}'`);
    }

    const zipRes = await callGateway("/kits/herma-worker-kit.zip?arm=arm_skill_zip_first_v1");
    expect(zipRes.status).toBe(200);
    const zipBytes = new Uint8Array(await zipRes.arrayBuffer());
    const zipSha = await sha256HexBytes(zipBytes);
    expect(zipRes.headers.get("x-content-sha256")).toBe(zipSha);

    const zipEntries = parseAndVerifyPkzipStoreArchive(zipBytes);
    const zipNames = zipEntries.map((e) => e.name);
    expect(zipNames).toEqual([
      "herma_shim.py",
      "worker_distributed_indexer.py",
      "herma_cli.mjs",
      "SKILL.md",
      "hooks/pretool_guard.py",
      "hooks/claude_settings_example.json",
      "bootstrap.sh",
    ]);
    expect(zipEntries.find((e) => e.name === "herma_shim.py").text).toContain("class HermaClient");
    expect(zipEntries.find((e) => e.name === "worker_distributed_indexer.py").text).toContain("dense_embedding_int8");
    expect(zipEntries.find((e) => e.name === "hooks/pretool_guard.py").text).toContain("sys.exit(2)");
    expect(zipEntries.find((e) => e.name === "SKILL.md").text).toContain("herma-worker-kit");
  });

  it("seeds agentic_cost_models_and_calibrated_composition_research_v1 and returns it across all 4 target search queries", async () => {
    const queries = ["cost model", "prompt cache", "system-1 confidence", "tool reuse"];
    for (const q of queries) {
      const sRes = await callGateway(`/q/search?q=${encodeURIComponent(q)}&scope=objects`);
      expect(sRes.status).toBe(200);
      const sDoc = await sRes.json();
      const matchedKeys = (sDoc.results || []).map((r) => r.id);
      expect(matchedKeys, `Query '${q}' missed research Task Object`).toContain(
        AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY
      );
    }

    const objRes = await callGateway(`/q/object/${AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY}`);
    expect(objRes.status).toBe(200);
    const objDoc = await objRes.json();
    expect(objDoc.payload.eight_verified_laws.length).toBe(8);
    expect(objDoc.payload.analytical_crossover_thresholds.scenario_02_C_shared_crossover_tokens).toBe(36800);
  });

  it("injects worker_toolkit_guidance on /q/claim, mutates/samples prompt arms on /prompts/raw/v9 & v10, and tracks bandit telemetry on /q/experiments", async () => {
    // 1. Verify /prompts/raw/codex_unlimited_frontier_loop_v9 & v10 default vs mutated bandit arm
    const pDefaultRes = await callGateway("/prompts/raw/codex_unlimited_frontier_loop_v10?mutate=0");
    expect(pDefaultRes.status).toBe(200);
    expect(pDefaultRes.headers.get("x-herma-variant-cell-id")).toBe(HERMA_PROMPT_KIT_MUTATION_GRID.default_cell_id);
    const pDefaultText = await pDefaultRes.text();
    expect(pDefaultText).toContain("RECOMMENDED WORKER TOOLKIT SETUP");
    expect(pDefaultText).not.toContain("\u2014");
    expect(pDefaultText).not.toMatch(BANNED_LL_RE);
    expect(pDefaultText).not.toMatch(BANNED_SYN_RE);

    const pMutRes = await callGateway(
      "/prompts/raw/codex_unlimited_frontier_loop_v9?agent_id=bandit-prompt-tester-01&mutate=1&seed=mutseed42"
    );
    expect(pMutRes.status).toBe(200);
    const mutCellId = pMutRes.headers.get("x-herma-variant-cell-id");
    expect(mutCellId).toBeTruthy();

    // 2. Claim a task with explicit axis overrides -> creates/selects arm and returns worker_toolkit_guidance
    const claimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bandit-worker-e2e-01",
        pitch_framing: "empirical_roi_framing",
        kit_order: "python_shim_first",
        inline_code_density: "full_copy_paste_code_block",
        task_encouragement: "reuse_first_strict_shim",
        worker_setup: {
          harness_tier: "tier_4_deep_architect_astra",
          model_hint: "gpt-astra",
          tools_available: ["python", "pytest", "http"],
        },
      }),
    });
    expect(claimRes.status).toBe(200);
    const claimDoc = await claimRes.json();
    expect(claimDoc.lease).toBeTruthy();
    expect(claimDoc.worker_toolkit_guidance).toBeTruthy();
    const wtg = claimDoc.worker_toolkit_guidance;
    expect(wtg.variant_cell_id).toBeTruthy();
    expect(wtg.mutation_signature).toContain("empirical_roi_framing|python_shim_first|full_copy_paste_code_block");
    expect(wtg.recommended_setups[0].kit_id).toBe("python_shim");
    expect(wtg.task_specific_encouragement.custom_instructions.length).toBeGreaterThan(0);
    expect(wtg.task_specific_encouragement.inline_task_object_code_block).toContain("from herma_shim import HermaClient");

    const activeArm = wtg.variant_cell_id;

    // 3. Exercise kit download, /q/search, /q/feedback, verified /q/submit with builds_on reuse, and 409 failed /q/submit
    const dlRes = await callGateway(`/kits/herma_shim.py?agent_id=bandit-worker-e2e-01`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("x-herma-attributed-arm")).toBe(activeArm);

    const searchRes = await callGateway("/q/search?q=tool+reuse&agent_id=bandit-worker-e2e-01");
    expect(searchRes.status).toBe(200);

    const fbkRes = await callGateway("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bandit-worker-e2e-01",
        signal_kind: "efficiency_concern",
        target_component: "worker_kits",
        observation: "Pre-mounting herma_shim.py eliminated cold boot schema discovery.",
      }),
    });
    expect(fbkRes.status).toBe(200);

    const subRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bandit-worker-e2e-01",
        worker_uuid: claimDoc.bilateral_guidance.worker_profile.worker_uuid,
        task_id: claimDoc.lease.task_id,
        lease_epoch: claimDoc.lease.lease_epoch,
        fencing_token: claimDoc.lease.fencing_token,
        summary: "Completed task reusing verified cost model Task Object shim",
        execution_telemetry: {
          wall_ms: 920,
          tokens_used: 1850,
          tests_passed: 6,
          tests_total: 6,
          perturbation_pass_count: 5,
          perturbation_total: 5,
        },
        task_objects: [
          {
            object_key: "calibrated_reuse_adapter_bandit_worker_20261101_v1",
            category: "portable_agent_kit",
            step_mode: "atomic_build_step",
            summary: "Adapter composing verified 8-scenario cost model decider",
            builds_on: [AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY],
            payload: { ok: true, reused: AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY },
          },
        ],
      }),
    });
    expect(subRes.status).toBe(200);
    const subDoc = await subRes.json();
    expect(subDoc.experiment_arm_outcome?.variant_cell_id).toBe(activeArm);
    expect(subDoc.experiment_arm_outcome?.succeeded).toBe(true);

    // Trigger a stale-fence 409 submit from a second agent attributed to the same arm to verify failed_submits tracking
    const staleRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bandit-stale-caller-02",
        arm: activeArm,
        task_id: claimDoc.lease.task_id,
        fencing_token: 999999,
        summary: "Stale submit probe",
      }),
    });
    expect(staleRes.status).toBe(409);

    // 4. Inspect GET /q/experiments leaderboard and verify all tracked metrics on activeArm
    const expRes = await callGateway("/q/experiments");
    expect(expRes.status).toBe(200);
    const expDoc = await expRes.json();
    expect(expDoc.ok).toBe(true);
    expect(expDoc.schema_sentinel).toBe("v6_11");
    expect(expDoc.leaderboard.length).toBeGreaterThanOrEqual(4);

    const tracked = expDoc.arms.find((a) => a.variant_cell_id === activeArm);
    expect(tracked).toBeTruthy();
    expect(tracked.exposures).toBeGreaterThanOrEqual(1);
    expect(tracked.kit_downloads).toBeGreaterThanOrEqual(1);
    expect(tracked.searches_recorded).toBeGreaterThanOrEqual(1);
    expect(tracked.feedback_count).toBeGreaterThanOrEqual(1);
    expect(tracked.verified_passes).toBeGreaterThanOrEqual(1);
    expect(tracked.task_object_reuses).toBeGreaterThanOrEqual(1);
    expect(tracked.failed_submits).toBeGreaterThanOrEqual(1);
    expect(tracked.total_tokens).toBeGreaterThanOrEqual(1850);
    expect(tracked.total_wall_ms).toBeGreaterThanOrEqual(920);
    expect(tracked.thompson_alpha).toBeGreaterThan(HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config.thompson_prior_alpha);
    expect(tracked.thompson_beta).toBeGreaterThan(HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config.thompson_prior_beta);
  });

  it("auto-seeds hourly/daily aggregate_work_review_and_reprioritize verbs, enforces bounded POST /q/reprioritize clamping, and serves generalist head-of-queue /q/claim", async () => {
    const buckets = computeUtcCadenceBuckets();

    // 1. GET /q/reprioritize returns HTTP 200 and seeds both hourly and daily cadence review verbs
    const repGetRes = await callGateway("/q/reprioritize");
    expect(repGetRes.status).toBe(200);
    const repSnap = await repGetRes.json();
    expect(repSnap.ok).toBe(true);
    expect(repSnap.cadence_review_verbs.hourly_verb_id).toBe(buckets.hourly_verb_id);
    expect(repSnap.cadence_review_verbs.daily_verb_id).toBe(buckets.daily_verb_id);
    expect(repSnap.generalist_head_of_queue.length).toBeGreaterThan(0);

    // 2. Claim the hourly aggregate review verb explicitly and verify pre-aggregated telemetry digest
    const claimHourlyRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "generalist-cadence-reviewer-01",
        task_id: buckets.hourly_verb_id,
      }),
    });
    expect(claimHourlyRes.status).toBe(200);
    const claimHourly = await claimHourlyRes.json();
    expect(claimHourly.lease.task_id).toBe(buckets.hourly_verb_id);
    expect(claimHourly.lease.verb_kind).toBe("aggregate_work_review_and_reprioritize");
    expect(claimHourly.lease.aggregate_telemetry_digest).toBeTruthy();
    expect(claimHourly.lease.aggregate_telemetry_digest.queue_counts_by_intent).toBeDefined();
    expect(claimHourly.lease.aggregate_telemetry_digest.top_unclaimed_candidates).toBeDefined();
    expect(claimHourly.lease.aggregate_telemetry_digest.experiment_arm_leaderboard).toBeDefined();

    // 3. Submit a reprioritization_plan via /q/submit on verb_agg_review_hourly_* including a gap verb + extreme priority_score to verify grid clamping
    const candidateNgoTask = repSnap.generalist_head_of_queue.find((t) => t.tier === "ngo_priority");
    expect(candidateNgoTask).toBeTruthy();

    const submitReviewRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "generalist-cadence-reviewer-01",
        worker_uuid: claimHourly.bilateral_guidance.worker_profile.worker_uuid,
        task_id: buckets.hourly_verb_id,
        lease_epoch: claimHourly.lease.lease_epoch,
        fencing_token: claimHourly.lease.fencing_token,
        summary: "Reviewed hourly fleet digest and proposed bounded head-of-queue reprioritization",
        reprioritization_plan: {
          rationale: "Boost critical NGO interoperability task to head of queue with grid clamping check",
          task_adjustments: [
            {
              task_id: candidateNgoTask.task_id,
              priority_score: 999,
              reason: "Attempted extreme boost must clamp to grid ceiling",
            },
          ],
          boost_stale_tasks: true,
          gap_verbs: [
            {
              tier: "ngo_priority",
              priority: 99,
              category: "cross_domain_verification",
              step_mode: "atomic_build_step",
              title: "Generalist Head-of-Queue Cross-Domain Verification Harness",
              prompt: "Build a zero-dependency cross-domain schema & receipt verification harness.",
            },
          ],
        },
      }),
    });
    expect(submitReviewRes.status).toBe(200);
    const submitReviewDoc = await submitReviewRes.json();
    expect(submitReviewDoc.reprioritization_applied).toBeTruthy();
    expect(submitReviewDoc.reprioritization_applied.applied_adjustments[0].clamped_by_grid).toBe(true);
    expect(submitReviewDoc.reprioritization_applied.applied_adjustments[0].new_priority).toBeLessThanOrEqual(
      HERMA_PROMPT_KIT_MUTATION_GRID.reprioritization_bounds.ngo_priority_ceiling
    );
    expect(submitReviewDoc.reprioritization_applied.enqueued_gap_verbs.length).toBe(1);
    const gapVerbId = submitReviewDoc.reprioritization_applied.enqueued_gap_verbs[0].task_id;

    // 4. Direct POST /q/reprioritize also enforces floor clamping on duplicate demotion
    const directReprioRes = await callGateway("/q/reprioritize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "generalist-triage-02",
        rationale: "Boost gap verb to top ceiling 99 so generalist worker claims it first",
        task_adjustments: [{ task_id: gapVerbId, priority_score: 99, reason: "Top generalist priority" }],
      }),
    });
    expect(directReprioRes.status).toBe(200);
    const directReprioDoc = await directReprioRes.json();
    expect(directReprioDoc.ok).toBe(true);

    // 5. Inspect updated GET /q/reprioritize and verify generalist POST /q/claim picks up the highest-priority head-of-queue task!
    const repAfter = await (await callGateway("/q/reprioritize")).json();
    const expectedHead = repAfter.generalist_head_of_queue[0];
    expect(expectedHead.priority).toBe(99);

    const generalistClaimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "domain-agnostic-generalist-03",
        generalist: true,
      }),
    });
    expect(generalistClaimRes.status).toBe(200);
    const generalistClaim = await generalistClaimRes.json();
    expect(generalistClaim.lease.task_id).toBe(expectedHead.task_id);
  });

  it("validates zero-cloud-spend client dense_embedding_int8 + multi-scale LSH + search_blocks/leafs, awards Indexer Cred & badges, and auto-enqueues enrich/peer-review verbs", async () => {
    const regRes = await callGateway("/q/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "client-indexer-smith-01",
        capability_tags: ["embedding_capable", "peer_reviewer", "python"],
      }),
    });
    expect(regRes.status).toBe(200);
    const regDoc = await regRes.json();
    const smithUuid = regDoc.worker_profile.worker_uuid;
    const smithToken = regDoc.worker_token;

    const denseVec = Array.from({ length: 256 }, (_, idx) => ((idx * 17 + 11) % 200) - 100);
    const directObjRes = await callGateway("/q/objects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "client-indexer-smith-01",
        worker_uuid: smithUuid,
        worker_token: smithToken,
        object_key: "client_indexed_cost_router_v1",
        category: "portable_agent_kit",
        step_mode: "atomic_build_step",
        summary: "Client-indexed cost router with 256-d int8 vector, multi-scale LSH, and block/leaf chunks",
        dense_embedding_int8: denseVec,
        embedding_model_id: "sonar-text-1024-int8-v1",
        embedding_norm: 1.0,
        lsh_small_64b: "a1b2c3d4e5f60718",
        lsh_medium_256b: "0123456789abcdef".repeat(4),
        lsh_wide_1024b: "fedcba9876543210".repeat(16),
        search_blocks: [
          {
            block_id: "blk_0",
            char_range: [0, 320],
            token_estimate: 80,
            summary: "Primary calibrated router decider block",
            lsh_medium_256b: "abcdef0123456789".repeat(4),
          },
        ],
        search_leafs: [
          {
            leaf_id: "leaf_0_0",
            parent_block_id: "blk_0",
            char_range: [0, 140],
            token_estimate: 35,
            excerpt: "Scenario-01 System-1 readiness decider threshold check",
            lsh_small_64b: "1122334455667788",
          },
        ],
        payload: { ok: true, module: "cost_router.py" },
      }),
    });
    expect(directObjRes.status).toBe(200);
    const directObjDoc = await directObjRes.json();
    expect(directObjDoc.stored_task_objects[0].client_index.persisted).toBe(true);
    expect(directObjDoc.stored_task_objects[0].client_index.has_verified_dense_and_lsh).toBe(true);
    expect(directObjDoc.stored_task_objects[0].client_index.has_verified_blocks_and_leafs).toBe(true);
    // Already has dense + medium LSH -> neither index enrich nor fallback peer review verb is auto-enqueued!
    expect(directObjDoc.stored_task_objects[0].auto_enqueued_index_enrich_task_id).toBeUndefined();
    expect(directObjDoc.stored_task_objects[0].auto_enqueued_peer_review_task_id).toBeUndefined();

    const eventKinds = (directObjDoc.worker_cred_events || []).map((e) => e.event_kind);
    expect(eventKinds).toContain("indexer_dense_lsh");
    expect(eventKinds).toContain("indexer_block_leaf");

    const fetchedObj = await (await callGateway("/q/object/client_indexed_cost_router_v1")).json();
    expect(fetchedObj.client_index.embedding_dims).toBe(256);
    expect(fetchedObj.client_index.lsh_wide_1024b).toHaveLength(256);
    expect(fetchedObj.client_index.block_count).toBe(1);
    expect(fetchedObj.client_index.leaf_count).toBe(1);

    const lbDoc = await (await callGateway("/q/leaderboard")).json();
    const smithEntry = (lbDoc.leaderboard || []).find((w) => w.worker_uuid === smithUuid);
    expect(smithEntry).toBeTruthy();
    expect(smithEntry.badges).toContain("vector_smith");
    expect(smithEntry.badges).toContain("cartographer");
    expect(smithEntry.badges).toContain("leaf_cutter");

    // Lightweight HTTP-only worker submits an un-embedded object via POST /q/complete -> auto-enqueues BOTH enrich & peer-review!
    const lightRes = await callGateway("/q/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "lightweight-http-author-02",
        summary: "Authored lightweight rubric without local embeddings",
        output_nouns: [
          {
            object_key: "unindexed_lightweight_rubric_v1",
            category: "rubric",
            summary: "Needs peer embedding enrichment and review",
            payload: { rubric_items: ["clarity", "determinism"] },
          },
        ],
      }),
    });
    expect(lightRes.status).toBe(200);
    const lightDoc = await lightRes.json();
    expect(lightDoc.stored_task_objects[0].auto_enqueued_index_enrich_task_id).toBe(
      "verb_index_enrich_unindexed_lightweight_rubric_v1"
    );
    expect(lightDoc.stored_task_objects[0].auto_enqueued_peer_review_task_id).toBe(
      "verb_peer_review_unindexed_lightweight_rubric_v1"
    );

    // Author cannot claim their own peer-review verb (reviewer != author enforced!)
    const selfReviewClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "lightweight-http-author-02",
          worker_uuid: lightDoc.worker_uuid,
          task_id: "verb_peer_review_unindexed_lightweight_rubric_v1",
        }),
      })
    ).json();
    expect(selfReviewClaim.lease?.task_id).not.toBe("verb_peer_review_unindexed_lightweight_rubric_v1");

    // Foreign embedding-capable peer claims verb_index_enrich_unindexed_lightweight_rubric_v1, submits vectors, and earns +4 enrich cred!
    const enrichClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "client-indexer-smith-01",
          worker_uuid: smithUuid,
          worker_token: smithToken,
          task_id: "verb_index_enrich_unindexed_lightweight_rubric_v1",
        }),
      })
    ).json();
    expect(enrichClaim.lease.task_id).toBe("verb_index_enrich_unindexed_lightweight_rubric_v1");
    expect(enrichClaim.lease.preferred_worker_setup.preferred_setup_tags).toContain("embedding_capable");

    const enrichComplete = await (
      await callGateway("/q/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "client-indexer-smith-01",
          worker_uuid: smithUuid,
          worker_token: smithToken,
          task_id: enrichClaim.lease.task_id,
          fencing_token: enrichClaim.lease.fencing_token,
          summary: "Attached verified client vectors and chunks to unindexed_lightweight_rubric_v1",
          dense_embedding_int8: denseVec,
          lsh_small_64b: "9988776655443322",
          lsh_medium_256b: "fedcba9876543210".repeat(4),
          lsh_wide_1024b: "0123456789abcdef".repeat(16),
        }),
      })
    ).json();
    expect(enrichComplete.ok).toBe(true);
    const enrichCredKinds = (enrichComplete.worker_cred_events || []).map((e) => e.event_kind);
    expect(enrichCredKinds).toContain("indexer_enrich_review");

    const enrichedObj = await (await callGateway("/q/object/unindexed_lightweight_rubric_v1")).json();
    expect(enrichedObj.client_index.has_verified_dense_and_lsh).toBe(true);
  });

  it("preserves 128-char object_keys without truncation, exposes spawned_tasks_attribution on /w/<uuid> & /q/worker/<uuid>, serves clean v11 prompt, and enforces free-access window guardrails", async () => {
    const longKey124 =
      "long_descriptive_universal_capability_manifold_calibration_adapter_20261101_cross_domain_verification_harness_artifact_v1101";
    expect(longKey124.length).toBeGreaterThan(115);
    expect(longKey124.length).toBeLessThanOrEqual(128);

    const spawnerSub = await (
      await callGateway("/q/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "spawner-architect-01",
          summary: "Stored 124-char object_key and spawned 2 follow-up tasks for peer pickup",
          task_objects: [
            {
              object_key: longKey124,
              category: "portable_agent_kit",
              summary: "Lossless >120-char object_key verification artifact",
              payload: { exact_length: longKey124.length },
            },
          ],
          queued_tasks: [
            {
              task_id: "verb_spawned_pickup_alpha_20261101",
              tier: "ngo_priority",
              priority: 97,
              title: "Spawned NGO Task Alpha for Attribution Check",
              prompt: "Execute bounded verification step Alpha.",
            },
            {
              task_id: "verb_spawned_pickup_beta_20261101",
              tier: "public_general",
              priority: 72,
              title: "Spawned General Task Beta Remaining Ready",
              prompt: "Execute bounded verification step Beta.",
            },
          ],
        }),
      })
    ).json();
    expect(spawnerSub.ok).toBe(true);
    expect(spawnerSub.stored_task_objects[0].object_key).toBe(longKey124);

    const longLookup = await (await callGateway(`/q/object/${longKey124}`)).json();
    expect(longLookup.ok).toBe(true);
    expect(longLookup.object_key).toBe(longKey124);

    // Have a peer claim and complete verb_spawned_pickup_alpha_20261101 so solved_by is populated!
    const peerClaim = await (
      await callGateway("/q/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "peer-solver-worker-09",
          task_id: "verb_spawned_pickup_alpha_20261101",
        }),
      })
    ).json();
    expect(peerClaim.lease.task_id).toBe("verb_spawned_pickup_alpha_20261101");

    const peerDone = await (
      await callGateway("/q/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "peer-solver-worker-09",
          worker_uuid: peerClaim.bilateral_guidance.worker_profile.worker_uuid,
          task_id: "verb_spawned_pickup_alpha_20261101",
          fencing_token: peerClaim.lease.fencing_token,
          summary: "Solved spawned alpha task cleanly",
        }),
      })
    ).json();
    expect(peerDone.ok).toBe(true);

    const spawnerUuid = spawnerSub.worker_uuid;
    const wJsonRes = await callGateway(`/q/worker/${spawnerUuid}`);
    expect(wJsonRes.status).toBe(200);
    const wJson = await wJsonRes.json();
    expect(wJson.spawned_tasks_attribution).toBeTruthy();
    expect(wJson.spawned_tasks_attribution.counts.done).toBeGreaterThanOrEqual(1);
    expect(wJson.spawned_tasks_attribution.counts.ready).toBeGreaterThanOrEqual(1);
    const solvedRow = wJson.spawned_tasks_attribution.recent_spawned_tasks.find(
      (r) => r.task_id === "verb_spawned_pickup_alpha_20261101"
    );
    expect(solvedRow?.status).toBe("done");
    expect(solvedRow?.solved_by).toBe("peer-solver-worker-09");

    const wHtmlRes = await callGateway(`/w/${spawnerUuid}`);
    expect(wHtmlRes.status).toBe(200);
    const wHtml = await wHtmlRes.text();
    expect(wHtml).toContain("Tasks it started for others");
    expect(wHtml).toContain("peer-solver-worker-09");
    expect(wHtml).not.toMatch(BANNED_SYN_RE);

    // Verify /prompts/raw/codex_unlimited_frontier_loop_v11
    const v11Res = await callGateway("/prompts/raw/codex_unlimited_frontier_loop_v11?mutate=0");
    expect(v11Res.status).toBe(200);
    const v11Text = await v11Res.text();
    expect(v11Text).toContain("shim.teleionlabs.com");
    expect(v11Text).toContain("dense_embedding_int8");
    expect(v11Text).toContain("RECOMMENDED WORKER TOOLKIT SETUP");
    expect(v11Text).not.toContain("\u2014");
    expect(v11Text).not.toMatch(BANNED_LL_RE);
    expect(v11Text).not.toMatch(BANNED_SYN_RE);

    // Verify Free-Access Window metadata on /q/pulse and enforcement on kill-switch / post-window expiry
    const pulseRes = await callGateway("/q/pulse");
    expect(pulseRes.status).toBe(200);
    const pulseDoc = await pulseRes.json();
    expect(pulseDoc.free_unauthenticated_until).toBe("2026-12-31T23:59:59-05:00");
    expect(pulseDoc.kill_switch_active).toBe(false);

    // Mint a scoped hk_wrk_* key via admin so we can verify authenticated key bypass when free window expires
    const mintKeyRes = await callGateway(
      "/q/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bootstrap-secret": "test-admin-secret-v611",
        },
        body: JSON.stringify({
          key_class: "worker",
          label: "post-dec31-scoped-worker-key",
          scopes: ["queue:claim", "queue:submit", "search:read"],
        }),
      },
      { BOOTSTRAP_SECRET: "test-admin-secret-v611" }
    );
    expect(mintKeyRes.status).toBe(201);
    const mintedKeyDoc = await mintKeyRes.json();
    const rawScopedKey = mintedKeyDoc.api_key;
    expect(rawScopedKey.startsWith("hk_wrk_")).toBe(true);

    // Expired window blocks unauthenticated /q/search with 401, allows /q/pulse with 200, and allows hk_* key with 200!
    const expiredUnauthRes = await callGateway(
      "/q/search?q=cost+model",
      {},
      { HERMA_FREE_WINDOW_NOW_ISO: "2027-01-01T00:00:05-05:00" }
    );
    expect(expiredUnauthRes.status).toBe(401);
    const expiredBody = await expiredUnauthRes.json();
    expect(expiredBody.code).toBe("free_access_window_expired");

    const killPulseRes = await callGateway("/q/pulse", {}, { FREE_ACCESS_KILL_SWITCH: "1" });
    expect(killPulseRes.status).toBe(200);
    const killPulseDoc = await killPulseRes.json();
    expect(killPulseDoc.kill_switch_active).toBe(true);

    const killUnauthClaim = await callGateway(
      "/q/search?q=cost+model",
      {},
      { FREE_ACCESS_KILL_SWITCH: "1" }
    );
    expect(killUnauthClaim.status).toBe(401);

    const killAuthedSearch = await callGateway(
      "/q/search?q=cost+model",
      { headers: { "x-herma-api-key": rawScopedKey } },
      { FREE_ACCESS_KILL_SWITCH: "1" }
    );
    expect(killAuthedSearch.status).toBe(200);
  });
});
