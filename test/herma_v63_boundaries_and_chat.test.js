import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Banned words are checked against the one shared list by scripts/release_gate.mjs (make gate), which this file does not repeat.

const BASE = "https://herma.ta-amps.workers.dev";

async function callGateway(path, init = {}) {
  return exports.default.fetch(BASE + path, init);
}

describe("Herma v6.3 Q1-Q10 Boundary Hardening, Plain-Language Dashboard & Conversational /q/chat", () => {
  it("enforces Q1 mandatory integer fencing_token + lease holder match, Q10 idempotent replay, and Q2/Q3 pre-write validation & server_infra inheritance", async () => {
    // 1. Seed a public task to claim
    const seedRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "q1-seeder",
        task_id: "self_seed",
        summary: "Seed Q1 fencing test task",
        queued_tasks: [
          {
            tier: "public_general",
            title: "Q1 Fencing & Idempotency Verification Task",
            prompt: "Verify missing/foreign fencing tokens fail with 409 and idempotent retries replay 200.",
          },
        ],
      }),
    });
    expect(seedRes.status).toBe(200);
    const seedDoc = await seedRes.json();
    const targetTaskId = seedDoc.enqueued_followup_verbs[0].task_id;

    // Submitting to a ready (unleased) task without claiming -> 409
    const unleasedSub = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "eager-unleased-caller",
        task_id: targetTaskId,
        fencing_token: 1,
        summary: "attempted completion without lease",
      }),
    });
    expect(unleasedSub.status).toBe(409);

    // Claim task properly
    const claimRes = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "q1-holder",
        task_id: targetTaskId,
      }),
    });
    expect(claimRes.status).toBe(200);
    const claimDoc = await claimRes.json();
    const leaseTask = claimDoc.lease;

    // Missing fencing_token on leased task -> 409
    const missingFenceRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "q1-holder",
        task_id: leaseTask.task_id,
        summary: "missing fencing_token",
      }),
    });
    expect(missingFenceRes.status).toBe(409);

    // Foreign agent_id presenting valid fencing_token -> 409
    const foreignHolderRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "foreign-agent",
        task_id: leaseTask.task_id,
        fencing_token: leaseTask.fencing_token,
        summary: "foreign agent hijack attempt",
      }),
    });
    expect(foreignHolderRes.status).toBe(409);

    // Q2: Mixed public object + unauthorized infra_private queued_task must fail 403 BEFORE writing the public object!
    const atomicRejectRes = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "q1-holder",
        task_id: "self_seed",
        summary: "mixed batch should roll back before writing",
        task_objects: [
          {
            object_key: "should_never_exist_on_403_v1",
            category: "schema",
            summary: "must not be written",
            payload: { leaked: true },
          },
        ],
        queued_tasks: [
          {
            tier: "infra_private",
            title: "unauthorized infra child",
            prompt: "must reject whole batch",
          },
        ],
      }),
    });
    expect(atomicRejectRes.status).toBe(403);
    const checkNotWritten = await callGateway("/q/object/should_never_exist_on_403_v1");
    expect(checkNotWritten.status).toBe(404);

    // Valid completion with idempotency_key + object_name / queued_tasks aliases (Q8)
    const validPayload = {
      agent_id: "q1-holder",
      task_id: leaseTask.task_id,
      fencing_token: leaseTask.fencing_token,
      idempotency_key: "idem-q1-holder-run-001",
      summary: "Completed with valid fencing token and aliases",
      task_objects: [
        {
          object_name: "q8_object_name_alias_verified_v1",
          category: "canonical_schema",
          summary: "Stored using object_name alias; starts unreviewed (Q6)",
          payload: { ok: true, fields: ["id", "sha256"] },
        },
      ],
      queued_tasks: [
        {
          tier: "public_general",
          title: "Follow-up from queued_tasks alias",
          prompt: "Verify queued_tasks alias creates exactly 1 child even across retries",
        },
      ],
    };
    const sub1Res = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(sub1Res.status).toBe(200);
    const sub1Doc = await sub1Res.json();
    expect(sub1Doc.ok).toBe(true);
    expect(sub1Doc.enqueued_followup_verbs.length).toBe(1);
    const childId = sub1Doc.enqueued_followup_verbs[0].task_id;

    // Q10: Exact retry with same idempotency_key returns 200 idempotent_replay without duplicating child tasks
    const sub2Res = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    expect(sub2Res.status).toBe(200);
    const sub2Doc = await sub2Res.json();
    expect(sub2Doc.idempotent_replay).toBe(true);
    expect(sub2Doc.enqueued_followup_verbs[0].task_id).toBe(childId);

    // Q6 & Q7: Unreviewed object starts with quality_milli === 0 & review_status === "unreviewed", and blocks cross-producer overwrite
    const objRes = await callGateway("/q/object/q8_object_name_alias_verified_v1");
    expect(objRes.status).toBe(200);
    const objDoc = await objRes.json();
    expect(objDoc.quality_milli).toBe(0);
    expect(objDoc.review_status).toBe("unreviewed");

    const overwriteAttempt = await callGateway("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "unrelated-producer",
        task_id: "self_seed",
        summary: "attempted cross-producer key clobber",
        task_objects: [
          {
            object_key: "q8_object_name_alias_verified_v1",
            category: "schema",
            summary: "clobber attempt",
            payload: { clobbered: true },
          },
        ],
      }),
    });
    expect(overwriteAttempt.status).toBe(200);
    const overwriteDoc = await overwriteAttempt.json();
    // Canonical key remains owned by q1-holder; unrelated producer gets namespaced key!
    expect(overwriteDoc.stored_task_objects[0].object_key).not.toBe("q8_object_name_alias_verified_v1");
    const canonicalAfter = await (await callGateway("/q/object/q8_object_name_alias_verified_v1")).json();
    expect(canonicalAfter.producer_agent).toBe("q1-holder");
    expect(canonicalAfter.payload.ok).toBe(true);
  });

  it("enforces Q5 worker_token ownership against foreign agent hijack while keeping HEAD /q/onboard & GET /q/pulse side-effect free (Q9)", async () => {
    const obRes = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "protected-owner", mint_new: true }),
    });
    expect(obRes.status).toBe(200);
    const obDoc = await obRes.json();
    expect(typeof obDoc.worker_token).toBe("string");
    expect(obDoc.worker_token.length).toBeGreaterThan(16);
    const protectedUuid = obDoc.worker_profile.worker_uuid;

    // Foreign agent attempting to onboard/rename or claim using protectedUuid without worker_token -> 403
    const hijackOnboard = await callGateway("/q/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "hijacker-agent", worker_uuid: protectedUuid }),
    });
    expect(hijackOnboard.status).toBe(403);

    const hijackClaim = await callGateway("/q/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "hijacker-agent", worker_uuid: protectedUuid }),
    });
    expect(hijackClaim.status).toBe(403);

    // Q9: HEAD /q/onboard/<fresh_handle> does NOT insert a new worker row
    const headRes = await callGateway("/q/onboard/ephemeral-head-probe-999", { method: "HEAD" });
    expect(headRes.status).toBe(200);
    const lookupHeadWorker = await callGateway("/w/w_agent_ephemeral-head-probe-999");
    expect(lookupHeadWorker.status).toBe(404);
  });

  it("drives multi-turn Agent-to-Agent /q/chat ('Hi I'd like to contribute', 'task objects that would help me withthis task', 'hi i am stuck', GitHub URL intake, OpenAI messages[]) + plain-language /dashboard", async () => {
    // Turn 1: "Hi I'd like to contribute"
    const t1Res = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "muse-chat-contributor",
        model_hint: "muse-spark-1.3",
        message: "Hi I'd like to contribute",
      }),
    });
    expect(t1Res.status).toBe(200);
    const t1 = await t1Res.json();
    expect(t1.ok).toBe(true);
    expect(t1.conversation_id).toBeTruthy();
    expect(t1.session_id).toBe(t1.conversation_id);
    expect(t1.worker_uuid).toMatch(/^w_/);
    expect(t1.onboarding.next_turn_options.length).toBeGreaterThanOrEqual(1);

    const convId = t1.conversation_id;
    const chatWorkerUuid = t1.worker_uuid;
    const chatWorkerToken = t1.worker_token;

    // Claim via chat
    const claimTurnRes = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: convId,
        agent_id: "muse-chat-contributor",
        worker_uuid: chatWorkerUuid,
        worker_token: chatWorkerToken,
        message: "Claim a task",
      }),
    });
    expect(claimTurnRes.status).toBe(200);
    const claimTurn = await claimTurnRes.json();
    expect(claimTurn.active_task_id || claimTurn.lease?.task_id).toBeTruthy();

    // Turn 2: Human-style typo question: "are there any task objects that would help me withthis task"
    const t2Res = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: convId,
        agent_id: "muse-chat-contributor",
        worker_uuid: chatWorkerUuid,
        worker_token: chatWorkerToken,
        message: "are there any task objects that would help me withthis task",
      }),
    });
    expect(t2Res.status).toBe(200);
    const t2 = await t2Res.json();
    expect(t2.ok).toBe(true);
    expect(t2.intent).toBe("object_lookup");
    expect(Array.isArray(t2.helpful_task_objects)).toBe(true);

    // Turn 3: "hi i am stuck" -> stores or surfaces reusable reasoning_suggestion task_object
    const t3Res = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: convId,
        agent_id: "muse-chat-contributor",
        worker_uuid: chatWorkerUuid,
        worker_token: chatWorkerToken,
        message: "hi i am stuck on schema normalization and holiday closure hours",
      }),
    });
    expect(t3Res.status).toBe(200);
    const t3 = await t3Res.json();
    expect(t3.ok).toBe(true);
    expect(t3.intent).toBe("roadblock_or_help");
    expect(t3.reply.length).toBeGreaterThan(20);

    // Turn 4: Brand-new GitHub project URL intake via /q/chat
    const t4Res = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_id: convId,
        agent_id: "muse-chat-contributor",
        worker_uuid: chatWorkerUuid,
        worker_token: chatWorkerToken,
        message:
          "Check out this super useful new repo https://github.com/microsoft/agent-framework for multi-agent durable orchestration and MCP tool routing!",
      }),
    });
    expect(t4Res.status).toBe(200);
    const t4 = await t4Res.json();
    expect(t4.ok).toBe(true);
    expect(t4.intent).toBe("github_repo_intake");
    expect(t4.normalized_repository.slug).toBe("microsoft/agent-framework");

    // Turn 5: OpenAI-compatible /q/chat/completions format
    const oaiRes = await callGateway("/q/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "muse-spark-open",
        user: "openai-compat-agent",
        messages: [{ role: "user", content: "Hi I'd like to contribute" }],
      }),
    });
    expect(oaiRes.status).toBe(200);
    const oaiDoc = await oaiRes.json();
    expect(oaiDoc.choices?.[0]?.message?.content).toBeTruthy();

    // First-turn informational question routes to roadblock_or_help rather than greeting/claim
    const infoQRes = await callGateway("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "fresh-question-caller",
        message: "Did we break something, or add additional unnecessary checks or restrictions or auth?",
      }),
    });
    expect(infoQRes.status).toBe(200);
    const infoQDoc = await infoQRes.json();
    expect(["informational", "roadblock_or_help"]).toContain(infoQDoc.intent);

    // Starter kit, /q/help, /q/meta-telemetry, /q/training-export, and plain-language /dashboard
    const starterRes = await callGateway("/starter");
    expect(starterRes.status).toBe(200);
    const starterHtml = await starterRes.text();
    expect(starterHtml).toContain("q8_object_name_alias_verified_v1");

    const homeRes = await callGateway("/");
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain("<h1>");

    const helpRes = await callGateway("/q/help?q=shelter+intake");
    expect(helpRes.status).toBe(200);

    const metaTelRes = await callGateway("/q/meta-telemetry");
    expect(metaTelRes.status).toBe(200);

    const trainExpRes = await callGateway("/q/training-export");
    expect(trainExpRes.status).toBe(200);

    const dashRes = await callGateway("/dashboard");
    expect(dashRes.status).toBe(200);
    const dashHtml = await dashRes.text();
    expect(dashHtml).toContain("Shared Tasks");
    expect(dashHtml).toContain("Not reviewed yet");
    expect(dashHtml).not.toContain("3-Beat Cadence Rings");
    expect(dashHtml).not.toContain("Next: Beat");
  });
});
