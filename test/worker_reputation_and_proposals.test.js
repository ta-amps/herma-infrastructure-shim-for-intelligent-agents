import { describe, expect, it } from "vitest";
import { AGENT_START_CSS } from "../deploy/cloudflare/agent_start.js";
import {
  renderContributionPermalinkHtml,
  renderDashboardHtml,
  renderWorkerProfileHtml,
} from "../deploy/cloudflare/dashboard_and_permalinks.js";
import { renderConnectHtml, renderOverviewHtml } from "../deploy/cloudflare/herma_engine.js";
import { buildPromptCatalog, renderPromptsPageHtml } from "../deploy/cloudflare/prompts_page.js";
import {
  REPUTATION_AND_PROPOSAL_GRID,
  buildWorkerScoreAndBadges,
  classifyStorageTier,
  computeSaltedIpFingerprint,
  ensureReputationAndProposalsSchema,
  extractProposalMetadata,
  fetchTaskRelayAndFailureContext,
  handleLeaderboardRequest,
  handleProposalsGovernanceRequest,
  normalizeAssetModality,
  recordTaskAttemptEvent,
  recordVerifiedSubmissionCredAndProposals,
  sanitizeObjectKeyPreservingSuffix,
} from "../deploy/cloudflare/worker_reputation_and_proposals.js";

function createInMemoryD1() {
  const tables = {
    herma_task_attempt_ledger: [],
    herma_worker_cred_events: [],
    herma_task_relay_meta: new Map(),
    herma_proposals_registry: new Map(),
    herma_worker_registry: new Map(),
    herma_task_objects: new Map(),
    herma_durable_queue: new Map(),
  };
  let autoId = 1;

  return {
    _tables: tables,
    prepare(sql) {
      const norm = sql.replace(/\s+/g, " ").trim();
      let bound = [];
      const stmt = {
        bind(...args) {
          bound = args;
          return stmt;
        },
        async run() {
          if (norm.startsWith("CREATE TABLE") || norm.startsWith("CREATE INDEX")) {
            return { meta: { changes: 0 } };
          }
          if (norm.startsWith("INSERT INTO herma_task_attempt_ledger")) {
            tables.herma_task_attempt_ledger.push({
              id: autoId++,
              task_id: bound[0],
              worker_uuid: bound[1],
              agent_id: bound[2],
              outcome: bound[3],
              blocker_code: bound[4],
              error_summary: bound[5],
              alternative_route_used: bound[6],
              suggested_capabilities_json: bound[7],
              alternative_routes_json: bound[8],
              log_object_key: bound[9],
              created_at: bound[10],
            });
            return { meta: { changes: 1 } };
          }
          if (norm.startsWith("INSERT INTO herma_task_relay_meta")) {
            const existing = tables.herma_task_relay_meta.get(bound[0]);
            tables.herma_task_relay_meta.set(bound[0], {
              task_id: bound[0],
              suggested_capabilities_json:
                bound[1] !== "[]" ? bound[1] : existing?.suggested_capabilities_json || "[]",
              alternative_routes_json:
                bound[2] !== "[]" ? bound[2] : existing?.alternative_routes_json || "[]",
              parent_blocker_summary: bound[3] || existing?.parent_blocker_summary || "",
              updated_at: bound[4],
            });
            return { meta: { changes: 1 } };
          }
          if (norm.startsWith("INSERT OR IGNORE INTO herma_worker_cred_events")) {
            if (tables.herma_worker_cred_events.some((e) => e.event_key === bound[0])) {
              return { meta: { changes: 0 } };
            }
            tables.herma_worker_cred_events.push({
              id: autoId++,
              event_key: bound[0],
              worker_uuid: bound[1],
              agent_id: bound[2],
              ip_fingerprint: bound[3],
              event_kind: bound[4],
              points_awarded: bound[5],
              unblock_bonus: bound[6],
              prior_failed_workers: bound[7],
              multiplier_milli: bound[8],
              evidence_ref: bound[9],
              task_id: bound[10],
              object_key: bound[11],
              detail_json: bound[12],
              created_at: bound[13],
            });
            return { meta: { changes: 1 } };
          }
          if (norm.startsWith("INSERT INTO herma_proposals_registry")) {
            const existing = tables.herma_proposals_registry.get(bound[0]);
            tables.herma_proposals_registry.set(bound[0], {
              object_key: bound[0],
              proposal_kind: bound[1],
              target_subsystem: bound[2],
              proposer_agent: bound[3],
              proposer_worker_uuid: bound[4],
              source_task_id: bound[5],
              summary: bound[6],
              proposal_meta_json: bound[7],
              independent_eval_count: existing?.independent_eval_count || 0,
              mean_eval_quality_milli: existing?.mean_eval_quality_milli || 0,
              governance_status: existing?.governance_status || "proposed",
              created_at: existing?.created_at || bound[8],
              updated_at: bound[9],
            });
            return { meta: { changes: 1 } };
          }
          if (norm.startsWith("UPDATE herma_proposals_registry")) {
            const row = tables.herma_proposals_registry.get(bound[4]);
            if (row) {
              row.independent_eval_count = bound[0];
              row.mean_eval_quality_milli = bound[1];
              row.governance_status = bound[2];
              row.updated_at = bound[3];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (norm.includes("FROM herma_task_relay_meta WHERE task_id = ?")) {
            return tables.herma_task_relay_meta.get(bound[0]) || null;
          }
          if (norm.includes("FROM herma_worker_registry WHERE worker_uuid = ?")) {
            return tables.herma_worker_registry.get(bound[0]) || null;
          }
          if (norm.includes("FROM herma_task_objects WHERE object_key = ?")) {
            return tables.herma_task_objects.get(bound[0]) || null;
          }
          if (norm.includes("FROM herma_durable_queue WHERE task_id = ?")) {
            return tables.herma_durable_queue.get(bound[0]) || null;
          }
          if (norm.includes("FROM herma_proposals_registry WHERE object_key = ?")) {
            return tables.herma_proposals_registry.get(bound[0]) || null;
          }
          return null;
        },
        async all() {
          if (norm.includes("SELECT DISTINCT worker_uuid FROM herma_task_attempt_ledger")) {
            const set = new Set(
              tables.herma_task_attempt_ledger
                .filter(
                  (a) =>
                    a.task_id === bound[0] &&
                    a.worker_uuid !== bound[1] &&
                    ["released_blocked", "failed", "expired"].includes(a.outcome)
                )
                .map((a) => a.worker_uuid)
            );
            return { results: Array.from(set).map((worker_uuid) => ({ worker_uuid })) };
          }
          if (norm.includes("FROM herma_task_attempt_ledger WHERE task_id = ?")) {
            const rows = tables.herma_task_attempt_ledger
              .filter((a) => a.task_id === bound[0])
              .slice()
              .reverse()
              .slice(0, Number(bound[1] || 12));
            return { results: rows };
          }
          if (norm.includes("FROM herma_worker_cred_events WHERE worker_uuid = ?")) {
            const rows = tables.herma_worker_cred_events
              .filter((e) => e.worker_uuid === bound[0])
              .slice()
              .reverse();
            return { results: rows };
          }
          if (norm.includes("FROM herma_worker_registry")) {
            return { results: Array.from(tables.herma_worker_registry.values()) };
          }
          if (norm.includes("FROM herma_proposals_registry")) {
            return { results: Array.from(tables.herma_proposals_registry.values()) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
}

describe("Herma v6.7 Reputation, Cooperative Relay, Multimodal & Light-UI-Only Gates", () => {
  it("preserves 68-char Muse object keys intact and keeps _v1/_v2 suffixes on >128-char keys", () => {
    const museKey = "beat1_calibration_paratransit_wave4_muse-herma-worker-01_20261101_v1";
    expect(museKey.length).toBe(68);
    expect(sanitizeObjectKeyPreservingSuffix(museKey)).toBe(museKey);

    const ultraLong =
      "ultra_detailed_multimodal_godot_stl_procedural_mesh_and_audio_pipeline_synthesis_codex-astra-01_20261101_v2";
    const padded = `prefix_${"x".repeat(60)}_${ultraLong}`;
    const shortened = sanitizeObjectKeyPreservingSuffix(padded, 128);
    expect(shortened.length).toBeLessThanOrEqual(128);
    expect(shortened.endsWith("codex-astra-01_20261101_v2")).toBe(true);
  });

  it("hashes client IPs with a one-way salt and never leaks raw IP bytes", async () => {
    const rawIp = "203.0.113.42";
    const fp = await computeSaltedIpFingerprint(rawIp, "test-salt-99");
    expect(fp.startsWith("iph_")).toBe(true);
    expect(fp).not.toContain("203");
    expect(fp).not.toContain("113");
    expect(await computeSaltedIpFingerprint("127.0.0.1")).toBe("");
  });

  it("awards Unblock Bonus (+8 per distinct prior failed worker, cap +24), Bridge Builder, and enforces solver != verifier", async () => {
    const db = createInMemoryD1();
    await ensureReputationAndProposalsSchema(db);

    db._tables.herma_worker_registry.set("w_hero", {
      worker_uuid: "w_hero",
      agent_id: "muse-herma-worker-01",
      harness_tier: "muse_scheduled",
      iteration_count: 5,
      ngo_completed: 3,
      eval_completed: 1,
      own_completed: 1,
      mean_artifact_bytes: 12000,
      updated_at: "2026-11-01T18:00:00Z",
    });

    // 4 prior failed attempts across 3 distinct workers (cap should hold at +24)
    for (const w of ["w_fail_1", "w_fail_2", "w_fail_2", "w_fail_3", "w_fail_4"]) {
      await recordTaskAttemptEvent(db, {
        taskId: "verb_ngo_dmw_01",
        workerUuid: w,
        agentId: w,
        outcome: "released_blocked",
        blockerCode: "http_403_upstream",
        errorSummary: "Direct register endpoint refused VM IP",
        suggestedCapabilities: ["browser_session"],
        alternativeRoutes: ["ecosyste.ms_api", "browser_csv_export"],
      });
    }

    const relayCtx = await fetchTaskRelayAndFailureContext(db, "verb_ngo_dmw_01");
    expect(relayCtx.prior_failed_workers).toBe(4);
    expect(relayCtx.unblock_bounty_points).toBe(REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_cap);
    expect(relayCtx.suggested_capabilities).toContain("browser_session");

    // Zero points if receiptHash is missing
    const noEv = await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_hero",
      agentId: "muse-herma-worker-01",
      receiptHash: "",
    });
    expect(noEv.points_earned_this_submit).toBe(0);

    // Verified solve via alternative route + relay subproblem publication
    const res = await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_hero",
      agentId: "muse-herma-worker-01",
      clientIp: "198.51.100.77",
      taskId: "verb_ngo_dmw_01",
      existingTask: { task_id: "verb_ngo_dmw_01", tier: "ngo_priority", category: "watchdog" },
      receiptHash: "a".repeat(64),
      storedObjects: [
        { object_key: "dmw_erratum_v1", total_payload_bytes: 8192, sha256_hash: "b".repeat(64) },
      ],
      rawObjects: [{ item: { object_key: "dmw_erratum_v1", supersedes: ["dmw_old_v0"] } }],
      enqueuedVerbs: [{ task_id: "verb_ngo_dmw_page2" }],
      rawVerbs: [
        {
          task_id: "verb_ngo_dmw_page2",
          suggested_capabilities: ["browser_session"],
          alternative_routes: ["browser_csv_export"],
        },
      ],
      payload: { alternative_route_used: "ecosyste.ms_api" },
    });

    // 10 (solve) + 5 (NGO) + 24 (unblock cap) = 39 + 10 (eagle eye supersedes) + 2 (relay pub) = 51
    expect(res.points_earned_this_submit).toBe(51);

    const profile = await buildWorkerScoreAndBadges(db, "w_hero");
    expect(profile.total_cred_points).toBe(51);
    expect(profile.badges).toEqual(
      expect.arrayContaining([
        "first_responder",
        "bridge_builder",
        "unblocker",
        "eagle_eye",
        "publisher",
        "ngo_champion",
        "marathoner",
      ])
    );

    const lb = await handleLeaderboardRequest(new URL("https://herma.ta-amps.workers.dev/q/leaderboard"), db);
    expect(lb.ok).toBe(true);
    expect(lb.leaderboard[0].worker_uuid).toBe("w_hero");
  });

  it("tracks infra_proposal & retraining_request through peer reviews to admin_review_ready without self-eval gaming", async () => {
    const db = createInMemoryD1();
    await ensureReputationAndProposalsSchema(db);

    db._tables.herma_task_objects.set("prop_bucket_cas_v1", {
      object_key: "prop_bucket_cas_v1",
      producer_agent: "codex-01",
      worker_uuid: "w_codex_01",
    });

    await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_codex_01",
      agentId: "codex-01",
      taskId: "verb_prop_1",
      receiptHash: "c".repeat(64),
      storedObjects: [{ object_key: "prop_bucket_cas_v1", total_payload_bytes: 4096 }],
      rawObjects: [
        {
          item: {
            object_key: "prop_bucket_cas_v1",
            category: "infra_proposal",
            summary: "Promote >2 MiB STL/WAV/MP4 Task Objects to CAS R2 bucket tier",
            proposal_metadata: {
              proposal_kind: "storage_evolution_proposal",
              target_subsystem: "bucket_tiering",
              proposed_change: "cas://sha256/<hash> pointer envelope for >2 MiB binary blobs",
            },
          },
        },
      ],
    });

    // Self-evaluation by proposer must NOT advance proposal count or award verify points!
    const selfEval = await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_codex_01",
      agentId: "codex-01",
      taskId: "verb_self_eval",
      receiptHash: "d".repeat(64),
      appliedEvaluations: [{ target_kind: "object", target_id: "prop_bucket_cas_v1", quality_milli: 990 }],
    });
    expect(selfEval.points_earned_this_submit).toBe(0);

    // Two independent peer evaluations advance it to admin_review_ready
    await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_peer_a",
      agentId: "muse-peer-a",
      taskId: "verb_eval_a",
      receiptHash: "e".repeat(64),
      appliedEvaluations: [{ target_kind: "object", target_id: "prop_bucket_cas_v1", quality_milli: 880 }],
    });
    await recordVerifiedSubmissionCredAndProposals(db, {
      workerUuid: "w_peer_b",
      agentId: "muse-peer-b",
      taskId: "verb_eval_b",
      receiptHash: "f".repeat(64),
      appliedEvaluations: [{ target_kind: "object", target_id: "prop_bucket_cas_v1", quality_milli: 920 }],
    });

    const gov = await handleProposalsGovernanceRequest(
      new URL("https://herma.ta-amps.workers.dev/q/proposals"),
      db
    );
    expect(gov.counts.admin_review_ready).toBe(1);
    expect(gov.proposals[0].admitted_to_production).toBe(false);
    expect(gov.proposals[0].mean_eval_quality_milli).toBe(900);
  });

  it("classifies multimodal asset modalities and 3-tier storage envelopes cleanly", () => {
    expect(normalizeAssetModality({ asset_modality: "mesh_3d_stl" })).toBe("mesh_3d_stl");
    expect(normalizeAssetModality({ category: "godot_scene_kit" })).toBe("engine_scene_kit");
    expect(normalizeAssetModality({ category: "wav_music_stem" })).toBe("audio_music_stem");
    expect(classifyStorageTier(12000)).toBe("inline_d1");
    expect(classifyStorageTier(250000)).toBe("chunked_d1");
    expect(classifyStorageTier(5000000)).toBe("bucket_cas");
    expect(extractProposalMetadata({ category: "retraining_request" })?.proposal_kind).toBe(
      "retraining_request"
    );
  });

  it("enforces LightThemeOnlyGate across all Herma Cloudflare HTML surfaces and serves codex_unlimited_frontier_loop_v7", () => {
    const surfaces = [
      ["overview", renderOverviewHtml([], [], "https://herma.ta-amps.workers.dev")],
      ["connect", renderConnectHtml("https://herma.ta-amps.workers.dev")],
      ["agent_start", AGENT_START_CSS],
      ["dashboard", renderDashboardHtml("https://herma.ta-amps.workers.dev", {})],
      [
        "permalink",
        renderContributionPermalinkHtml("https://herma.ta-amps.workers.dev", {
          lookup_id: "test",
          task: { task_id: "verb_1", title: "Test", tier: "ngo_priority", state: "done" },
          objects: [],
        }),
      ],
      [
        "worker_profile",
        renderWorkerProfileHtml("https://herma.ta-amps.workers.dev", {
          worker_uuid: "w_1",
          worker: { worker_uuid: "w_1", agent_id: "codex-01", persona_label: "Architect", specialty_lens: "Systems" },
          reputation: { total_cred_points: 39, unblock_bonus_points: 24, badge_details: [{ label: "Unblocker", rule: "Cracked blocked task" }] },
        }),
      ],
      ["prompts", renderPromptsPageHtml("https://herma.ta-amps.workers.dev", {})],
    ];
    for (const [name, html] of surfaces) {
      expect(html, `Dark media query found in ${name}`).not.toMatch(/prefers-color-scheme\s*:\s*dark/i);
      expect(html, `Dual light-dark scheme found in ${name}`).not.toMatch(/color-scheme\s*:\s*light\s+dark/i);
      expect(html, `Dark color-scheme found in ${name}`).not.toMatch(/color-scheme\s*:\s*dark/i);
      expect(html, `Legacy dark background found in ${name}`).not.toMatch(/#0f131a|#0c1017|#0d1117|#102332/i);
      expect(html, `Missing only-light declaration in ${name}`).toMatch(/only light/i);
    }
    const catalog = buildPromptCatalog("https://herma.ta-amps.workers.dev");
    expect(catalog[0].id).toBe("codex_unlimited_frontier_loop_v7");
    expect(catalog[0].body).toContain("ecosyste.ms");
    expect(catalog[0].body).toContain("mesh_3d_stl");
  });
});
