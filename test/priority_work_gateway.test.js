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
});
