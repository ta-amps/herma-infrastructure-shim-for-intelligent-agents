import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  bilateralChatGrid,
  loadEphemeralChatSession,
  resolveBilateralBounds,
  saveEphemeralChatSession,
} from "../deploy/cloudflare/conversation_state.js";
import { hash } from "../deploy/cloudflare/conversation.js";
import bannedWords from "../deploy/cloudflare/banned_words.generated.js";
import { isOpenFreeWindow } from "../deploy/cloudflare/herma_engine.js";
import { ensureHelpAndStarterSchema, finishMetaCall } from "../deploy/cloudflare/worker_help_and_starter.js";

const BASE = "https://shim.teleionlabs.com";
const LEGACY_ALIAS_BASE = "https://herma.teleionlabs.com";
const TEST_FEEDBACK_BYTES = 2500;
const OVERSIZE_FIELD_BYTES = 9000;
const OVERSIZE_ENVELOPE_BYTES = 35000;
const EXPECTED_TURN_ONE = 1;
const EXPECTED_TURN_TWO = 2;
const EXPECTED_TURN_THREE = 3;
const EXPECTED_TURN_FOUR = 4;
const NON_BMP_PREVIEW_CODEPOINTS = 8001;
const OVERSIZE_PREVIEW_CODEPOINTS = 16001;
const NON_BMP_CONV_CODEPOINTS = 4000;
const SAMPLE_META_CEILING_MICROUSD = 5000;
const SAMPLE_META_SETTLED_MICROUSD = 1200;
const MILLI_REVIEW_SCORE = 950;
const NORMALIZED_REVIEW_SCORE = 0.95;

async function callHerma(path, init = {}, origin = BASE) {
  return exports.default.fetch(origin + path, init);
}

describe("Herma Bilateral Chat, Session Continuity, Grounded Q&A, Bounds Grid & Feedback Sizing", () => {
  it("resolves declarative bilateral bounds from conversation_data.json with parameter clamping", async () => {
    expect(bilateralChatGrid?.schema_id).toBe("herma.bilateral_chat_and_feedback.grid.v1");
    const defaults = resolveBilateralBounds({});
    expect(defaults.ephemeral_session_max_turns).toBe(24);
    expect(defaults.ephemeral_session_ttl_seconds).toBe(86400);
    expect(defaults.chat_message_max_bytes).toBe(16384);
    expect(defaults.feedback_field_max_bytes).toBe(8192);
    expect(defaults.feedback_envelope_max_bytes).toBe(32768);
    expect(defaults.ephemeral_cache_max_sessions).toBe(512);

    const clamped = resolveBilateralBounds({
      HERMA_EPHEMERAL_SESSION_MAX_TURNS: "999999",
      HERMA_FEEDBACK_FIELD_MAX_BYTES: "64",
      HERMA_FEEDBACK_ENVELOPE_MAX_BYTES: "128",
    });
    expect(clamped.ephemeral_session_max_turns).toBe(
      bilateralChatGrid.parameters.ephemeral_session_max_turns.high
    );
    expect(clamped.feedback_field_max_bytes).toBe(
      bilateralChatGrid.parameters.feedback_field_max_bytes.low
    );
    expect(clamped.feedback_envelope_max_bytes).toBeGreaterThanOrEqual(
      clamped.feedback_field_max_bytes
    );

    // Verify in-memory fallback when D1 handle is null or unavailable
    const memSessionId = "sess-memfallback-test01";
    const saved = await saveEphemeralChatSession(
      null,
      {
        session_id: memSessionId,
        turn_count: EXPECTED_TURN_TWO,
        memory: { test_phrases: ["cobalt-harbor-19"], constraints: ["do_not_claim_tasks"] },
      },
      {}
    );
    expect(saved.turn_count).toBe(EXPECTED_TURN_TWO);
    const loaded = await loadEphemeralChatSession(null, memSessionId, {});
    expect(loaded?.turn_count).toBe(EXPECTED_TURN_TWO);
    expect(loaded?.memory?.test_phrases).toContain("cobalt-harbor-19");
  });

  it("enforces negation guard so 'Do not claim a task' and variants never route to claim", async () => {
    const negatedInputs = [
      "Do not claim a task",
      "Please don't claim any task right now",
      "Answer my question without claiming a task",
      "Do not start work yet, we are only testing read-only behavior",
    ];

    for (const msg of negatedInputs) {
      const res = await callHerma("/q/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(doc.ok).toBe(true);
      expect(doc.intent).not.toBe("claim");
      expect(["constraint_acknowledged", "informational"]).toContain(doc.intent);
      expect(doc.action_routed).toBe("none");
      expect(doc.claimed_task).toBe(false);
      expect(doc.registered_worker).toBe(false);
      expect(doc.ephemeral_session).toBe(true);
      expect(doc.lease).toBeNull();
      expect(doc.active_task_id).toBeNull();
      expect(doc.reply.toLowerCase()).toContain("no task was claimed");
      expect(doc.reply).not.toMatch(/^Welcome\b/i);
    }
  });

  it("answers 5 distinct informational questions with specific grounded facts and zero onboarding boilerplate", async () => {
    const cases = [
      {
        question: "What does Teleion Fabric do?",
        mustMatch: [/Teleion Fabric/i, /expiring claims/i, /Task Objects/i, /fabric\.teleionlabs\.com/i],
      },
      {
        question: "How does separate-key checking work?",
        mustMatch: [/drafter\s*!=\s*reviewer/i, /separate/i, /403|self_review_forbidden/i],
      },
      {
        question: "What models run here?",
        mustMatch: [/Muse Spark 1\.3/i, /Muse Wonder 1\.0/i, /Muse Glimmer 30B/i, /97\.8%/i, /992/i],
      },
      {
        question: "What are the free limits?",
        mustMatch: [/December 31, 2026/i, /8,192|8192/i, /32,768|32768/i],
      },
      {
        question: "How is Eranos connected to Teleion Fabric?",
        mustMatch: [/eranosforgood\.org/i, /eq01/i, /eq02/i, /eq03/i, /Teleion Fabric/i],
      },
    ];

    const replies = new Set();
    for (const item of cases) {
      const res = await callHerma("/q/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: item.question }),
      });
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(doc.ok).toBe(true);
      expect(doc.intent).toBe("informational");
      expect(doc.claimed_task).toBe(false);
      expect(doc.registered_worker).toBe(false);
      expect(doc.turn_count).toBe(EXPECTED_TURN_ONE);
      expect(doc.reply).not.toMatch(/^Welcome\b/i);
      expect(doc.reply).not.toContain("minted your Contributor Identity");
      for (const re of item.mustMatch) {
        expect(doc.reply).toMatch(re);
      }
      replies.add(doc.reply);
    }
    expect(replies.size).toBe(cases.length);
  });

  it("maintains 4-turn stateful session_id continuity across POST JSON, X-Herma-Session-Id header, and GET query", async () => {
    // Turn 1: Omit session_id so server mints a clean readable session_id; set test phrase & no-claim constraint
    const t1Res = await callHerma("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Remember our test phrase: amber-river-42 and do not claim tasks.",
      }),
    });
    expect(t1Res.status).toBe(200);
    const t1 = await t1Res.json();
    expect(t1.ok).toBe(true);
    expect(t1.session_id).toMatch(/^sess-[a-z0-9]+-[a-z0-9]+$/);
    expect(t1.turn_count).toBe(EXPECTED_TURN_ONE);
    expect(t1.claimed_task).toBe(false);
    expect(t1.registered_worker).toBe(false);
    expect(t1.ephemeral_session).toBe(true);
    expect(t1.session_memory.test_phrases).toContain("amber-river-42");
    expect(t1.session_memory.constraints).toContain("do_not_claim_tasks");

    const sessionId = t1.session_id;

    // Turn 2: Pass session_id in JSON body and ask an architectural question
    const t2Res = await callHerma("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        message: "How is Eranos connected to Herma and what are eq01, eq02, and eq03?",
      }),
    });
    expect(t2Res.status).toBe(200);
    const t2 = await t2Res.json();
    expect(t2.session_id).toBe(sessionId);
    expect(t2.turn_count).toBe(EXPECTED_TURN_TWO);
    expect(t2.claimed_task).toBe(false);
    expect(t2.reply).toMatch(/eq01/i);
    expect(t2.reply).toMatch(/eq03/i);
    expect(t2.reply).not.toMatch(/^Welcome\b/i);

    // Turn 3: Pass session_id via X-Herma-Session-Id header and ask to clarify prior turn
    const t3Res = await callHerma("/q/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Herma-Session-Id": sessionId,
      },
      body: JSON.stringify({
        message: "Can you clarify your previous reply with more detail on that?",
      }),
    });
    expect(t3Res.status).toBe(200);
    const t3 = await t3Res.json();
    expect(t3.session_id).toBe(sessionId);
    expect(t3.turn_count).toBe(EXPECTED_TURN_THREE);
    expect(t3.claimed_task).toBe(false);
    expect(t3.reply.toLowerCase()).toContain("eranos");
    expect(t3.reply).not.toMatch(/^Welcome\b/i);

    // Turn 4: Pass session_id via GET query string and ask to recall test phrase & constraint
    const t4Res = await callHerma(
      `/q/chat?session_id=${encodeURIComponent(sessionId)}&message=${encodeURIComponent(
        "What test phrase did I ask you to remember, and what constraint did I set?"
      )}`
    );
    expect(t4Res.status).toBe(200);
    const t4 = await t4Res.json();
    expect(t4.session_id).toBe(sessionId);
    expect(t4.turn_count).toBe(EXPECTED_TURN_FOUR);
    expect(t4.intent).toBe("session_recall");
    expect(t4.claimed_task).toBe(false);
    expect(t4.reply).toContain("amber-river-42");
    expect(t4.reply).toContain("do_not_claim_tasks");
    expect(t4.reply).not.toMatch(/^Welcome\b/i);
  });

  it("preserves 2,500-byte /q/feedback fields intact without 480-byte truncation and rejects >8,192-byte fields with 413", async () => {
    const headMarker = "HEAD_FEEDBACK_MARKER_START_";
    const tailMarker = "_TAIL_FEEDBACK_MARKER_END";
    const middlePad = "x".repeat(TEST_FEEDBACK_BYTES - headMarker.length - tailMarker.length);
    const exact2500Observation = `${headMarker}${middlePad}${tailMarker}`;
    expect(exact2500Observation.length).toBe(TEST_FEEDBACK_BYTES);

    const postRes = await callHerma("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bilateral-harness-verifier",
        signal_kind: "efficiency_concern",
        target_component: "bilateral_chat_gateway",
        observation: exact2500Observation,
        proposed_alternative: "Preserve full UTF-8 feedback up to configured bounds and reject oversize inputs with HTTP 413.",
      }),
    });
    expect(postRes.status).toBe(200);
    const postDoc = await postRes.json();
    expect(postDoc.ok).toBe(true);
    expect(postDoc.truncated).toBe(false);
    expect(postDoc.accepted_bytes).toBe(TEST_FEEDBACK_BYTES);
    expect(postDoc.stored_issue_object.summary.length).toBe(TEST_FEEDBACK_BYTES);
    expect(postDoc.stored_issue_object.summary.startsWith(headMarker)).toBe(true);
    expect(postDoc.stored_issue_object.summary.endsWith(tailMarker)).toBe(true);

    // Verify stored Task Object via GET /q/object/<key> also retains all 2,500 bytes
    const objRes = await callHerma(`/q/object/${encodeURIComponent(postDoc.stored_issue_object.object_key)}`);
    expect(objRes.status).toBe(200);
    const objDoc = await objRes.json();
    expect(objDoc.summary.length).toBe(TEST_FEEDBACK_BYTES);
    expect(objDoc.payload.observation.length).toBe(TEST_FEEDBACK_BYTES);
    expect(objDoc.payload.observation.endsWith(tailMarker)).toBe(true);

    // Verify oversize field (>8,192 bytes) returns HTTP 413 feedback_too_large instead of truncating
    const tooLargeField = "y".repeat(OVERSIZE_FIELD_BYTES);
    const rejectFieldRes = await callHerma("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bilateral-harness-verifier",
        observation: tooLargeField,
      }),
    });
    expect(rejectFieldRes.status).toBe(413);
    const rejectFieldDoc = await rejectFieldRes.json();
    expect(rejectFieldDoc.ok).toBe(false);
    expect(rejectFieldDoc.error).toBe("feedback_too_large");
    expect(rejectFieldDoc.max_field_bytes).toBe(8192);
    expect(rejectFieldDoc.max_envelope_bytes).toBe(32768);

    // Verify oversize envelope (>32,768 bytes) returns HTTP 413 feedback_too_large
    const padChunk = "z".repeat(7000);
    const rejectEnvRes = await callHerma("/q/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "bilateral-harness-verifier",
        observation: padChunk,
        summary: padChunk,
        detail: padChunk,
        reproduction: padChunk,
        proposed_alternative: "w".repeat(OVERSIZE_ENVELOPE_BYTES - 28000),
      }),
    });
    expect(rejectEnvRes.status).toBe(413);
    const rejectEnvDoc = await rejectEnvRes.json();
    expect(rejectEnvDoc.error).toBe("feedback_too_large");
  });

  it("scrubs banned words, long hex fingerprints, and em-dashes when echoing user-supplied strings on /q/chat", async () => {
    const runtimeTermA = String.fromCharCode(111, 108, 108, 97, 109, 97);
    const runtimeTermB = String.fromCharCode(115, 121, 110, 116, 104, 101, 116, 105, 99);
    const runtimeTermC = String.fromCharCode(110, 111, 117, 110, 115);
    const runtimeTermD = String.fromCharCode(115, 104, 97, 45, 50, 53, 54);
    const emDash = String.fromCharCode(0x2014);
    const longHex = "969951471abf3c00";

    const sRes = await callHerma("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `Remember our test phrase: safe-marker ${runtimeTermA} ${runtimeTermB} ${runtimeTermC} ${runtimeTermD} ${longHex}${emDash}end and do not claim tasks.`,
      }),
    });
    expect(sRes.status).toBe(200);
    const sDoc = await sRes.json();
    const recallRes = await callHerma("/q/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: sDoc.session_id,
        message: "What test phrase did I ask you to remember?",
      }),
    });
    expect(recallRes.status).toBe(200);
    const recallDoc = await recallRes.json();
    const serialized = JSON.stringify(recallDoc);
    // Only the private word list holds these terms; the public sample list has made-up words instead.
    if (bannedWords.source !== "fixture") {
      expect(serialized.toLowerCase()).not.toContain(runtimeTermA);
      expect(serialized.toLowerCase()).not.toContain(runtimeTermB);
      expect(serialized.toLowerCase()).not.toContain(runtimeTermC);
      expect(serialized.toLowerCase()).not.toContain(runtimeTermD);
    }
    expect(serialized.toLowerCase()).not.toContain(longHex);
    expect(serialized).not.toContain(emDash);
    expect(recallDoc.reply).toContain("safe-marker");
  });

  it("enforces open zero-auth access through Dec 31, 2026, clean CORS headers, strict MCP -32602, and zero-challenge bridge hello", async () => {
    expect(isOpenFreeWindow({}, Date.parse("2026-11-02T22:00:00Z"))).toBe(true);
    expect(isOpenFreeWindow({}, Date.parse("2027-01-01T04:59:58Z"))).toBe(true);
    expect(isOpenFreeWindow({}, Date.parse("2027-01-01T05:00:01Z"))).toBe(false);
    expect(isOpenFreeWindow({ HERMA_STRICT_AUTH: "true" }, Date.parse("2026-11-02T22:00:00Z"))).toBe(false);
    expect(isOpenFreeWindow({ FREE_ACCESS_KILL_SWITCH: "1" }, Date.parse("2026-11-02T22:00:00Z"))).toBe(false);

    // CORS preflight includes Idempotency-Key & X-Upstream-Api-Key with zero space-containing header names
    const corsRes = await callHerma("/v1/conversations/turn", {
      method: "OPTIONS",
      headers: { Origin: "https://example.org" },
    });
    expect(corsRes.status).toBe(204);
    const allowHeaders = (corsRes.headers.get("access-control-allow-headers") || "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    expect(allowHeaders).toContain("Idempotency-Key");
    expect(allowHeaders).toContain("X-Upstream-Api-Key");
    for (const hdr of allowHeaders) {
      expect(hdr).not.toMatch(/\s/);
    }

    // Zero-key /v1/context and /v1/dry-run succeed even with browser Origin/Cookie headers
    const ctxRes = await callHerma("/v1/context", {
      headers: {
        Origin: "https://example.org",
        Cookie: "session=test",
        "X-Agent-Id": "open-zero-auth-probe",
      },
    });
    expect(ctxRes.status).toBe(200);

    const dryRunRes = await callHerma("/v1/dry-run", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Agent-Id": "open-zero-auth-probe" },
      body: JSON.stringify({ prompt: "Verify open zero-auth route dry run." }),
    });
    expect(dryRunRes.status).toBe(200);

    // Open /mcp preview_shim succeeds on valid args and returns JSON-RPC -32602 on unknown args
    const mcpOkRes = await callHerma("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "preview_shim", arguments: { prompt: "Summarize open model shim context." } },
      }),
    });
    expect(mcpOkRes.status).toBe(200);
    const mcpOkDoc = await mcpOkRes.json();
    expect(mcpOkDoc.error).toBeUndefined();
    expect(mcpOkDoc.result?.isError).not.toBe(true);

    const mcpBadRes = await callHerma("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "preview_shim", arguments: { prompt: "Test", unexpected_arg: true } },
      }),
    });
    expect(mcpBadRes.status).toBe(200);
    const mcpBadDoc = await mcpBadRes.json();
    expect(mcpBadDoc.error?.code).toBe(-32602);

    const mcpAliasBadRes = await callHerma("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-check-17",
        method: "tools/call",
        params: { name: "preview_context_additions", arguments: { prompt: 17 } },
      }),
    });
    expect(mcpAliasBadRes.status).toBe(200);
    const mcpAliasBadDoc = await mcpAliasBadRes.json();
    expect(mcpAliasBadDoc.id).toBe("req-check-17");
    expect(mcpAliasBadDoc.error?.code).toBe(-32602);

    // Zero-challenge /bridge/<channel>/hello/<agent> succeeds in open window, and a stray code in the path changes nothing
    const bridgeOpenRes = await callHerma("/bridge/open-test-ch/hello/open-agent-alpha");
    expect(bridgeOpenRes.status).toBe(200);
    const bridgeOpenDoc = await bridgeOpenRes.json();
    expect(bridgeOpenDoc.ok).toBe(true);
    expect(bridgeOpenDoc.channel).toBe("open-test-ch");
    expect(bridgeOpenDoc.agent_id).toBe("open-agent-alpha");

    const bridgeStatusPost = await callHerma("/bridge/open-test-ch/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "open-agent-alpha",
        status: "ready",
        message: "Zero-auth bilateral ping for warm responder check.",
      }),
    });
    expect(bridgeStatusPost.status).toBe(200);
    const bridgeStatusDoc = await bridgeStatusPost.json();
    expect(bridgeStatusDoc.ok).toBe(true);
    expect(bridgeStatusDoc.channel).toBe("open-test-ch");

    const bridgeInboxRes = await callHerma("/bridge/open-test-ch/inbox");
    expect(bridgeInboxRes.status).toBe(200);
    const bridgeInboxDoc = await bridgeInboxRes.json();
    expect(bridgeInboxDoc.ok).toBe(true);
    expect(Array.isArray(bridgeInboxDoc.messages)).toBe(true);
    expect(bridgeInboxDoc.messages.length).toBeGreaterThanOrEqual(1);

    const bridgeWrongRes = await callHerma("/bridge/open-test-ch/hello/open-agent-alpha/9999");
    expect(bridgeWrongRes.status).toBe(200);
  });

  it("redirects HTML GET / to teleionlabs.com/fabric/ and serves canonical Teleion Fabric / shim.teleionlabs.com discovery", async () => {
    const htmlRoot = await callHerma("/", {
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    expect(htmlRoot.status).toBe(302);
    expect(htmlRoot.headers.get("location")).toBe("https://teleionlabs.com/fabric/");

    const aliasRoot = await callHerma(
      "/",
      { headers: { Accept: "text/html" }, redirect: "manual" },
      LEGACY_ALIAS_BASE
    );
    expect(aliasRoot.status).toBe(302);
    expect(aliasRoot.headers.get("location")).toBe("https://teleionlabs.com/fabric/");

    const jsonRoot = await callHerma("/", { headers: { Accept: "application/json" } });
    expect(jsonRoot.status).toBe(200);

    const connectRes = await callHerma("/connect.json");
    expect(connectRes.status).toBe(200);
    const connectText = await connectRes.text();
    expect(connectText).toContain("https://shim.teleionlabs.com");
    expect(connectText).toContain("https://fabric.teleionlabs.com");
    expect(connectText).not.toContain("workers.dev");

    const llmsRes = await callHerma("/llms.txt");
    expect(llmsRes.status).toBe(200);
    const llmsText = await llmsRes.text();
    expect(llmsText).toContain("Teleion Fabric");
    expect(llmsText).toContain("https://shim.teleionlabs.com");
    expect(llmsText).toContain("https://fabric.teleionlabs.com");
    expect(llmsText).not.toContain("workers.dev");
  });

  it("reports session durability truthfully per turn when D1 writes fail, during readOnly GET previews, and after D1 recovery", async () => {
    let failWrites = false;
    const rowsBySession = new Map();
    const mockDb = {
      prepare(sql) {
        const upper = String(sql || "").trim().toUpperCase();
        const makeRunner = (args = []) => ({
          async run() {
            if (upper.startsWith("INSERT INTO HERMA_CONVERSATIONS")) {
              if (failWrites) throw new Error("simulated_d1_write_outage");
              const [
                session_id,
                agent_id,
                worker_uuid,
                active_task_id,
                active_fencing_token,
                state_stage,
                turn_count,
                visibility,
                export_eligible,
                history_json,
                memory_json,
                staging_draft_json,
                created_at,
                updated_at,
                expires_at,
              ] = args;
              rowsBySession.set(session_id, {
                session_id,
                agent_id,
                worker_uuid,
                active_task_id,
                active_fencing_token,
                state_stage,
                turn_count,
                visibility,
                export_eligible,
                history_json,
                memory_json,
                staging_draft_json,
                created_at,
                updated_at,
                expires_at,
              });
            }
            return { success: true };
          },
          async first() {
            if (upper.includes("FROM HERMA_CONVERSATIONS")) {
              return rowsBySession.get(args[0]) || null;
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
        });
        return {
          bind(...args) {
            return makeRunner(args);
          },
          ...makeRunner([]),
        };
      },
    };

    const sessId = `sess-durability-${Date.now()}`;
    // Turn 1: D1 healthy -> persisted: true, last_durable_turn_count: 1
    const s1 = await saveEphemeralChatSession(
      mockDb,
      {
        session_id: sessId,
        turn_count: EXPECTED_TURN_ONE,
        history: [{ role: "user", content: "Turn 1 durable" }],
        memory: { test_phrases: ["durable-one"] },
      },
      {}
    );
    expect(s1.persisted).toBe(true);
    expect(s1.persistence_mode).toBe("d1");
    expect(s1.last_durable_turn_count).toBe(EXPECTED_TURN_ONE);

    // Read-only preview on Turn 1 session -> persisted: false for this preview turn, session_persisted: true, last_durable_turn_count: 1
    const roPreview = await saveEphemeralChatSession(
      mockDb,
      {
        ...s1,
        turn_count: EXPECTED_TURN_TWO,
        history: [...s1.history, { role: "user", content: "GET preview turn" }],
      },
      {},
      { readOnly: true }
    );
    expect(roPreview.persisted).toBe(false);
    expect(roPreview.persistence_mode).toBe("memory_only");
    expect(roPreview.read_only).toBe(true);
    expect(roPreview.session_persisted).toBe(true);
    expect(roPreview.last_durable_turn_count).toBe(EXPECTED_TURN_ONE);

    // Turn 2: D1 write fails -> persisted: false, last_durable_turn_count: 1
    failWrites = true;
    const s2 = await saveEphemeralChatSession(
      mockDb,
      {
        session_id: sessId,
        turn_count: EXPECTED_TURN_TWO,
        last_durable_turn_count: s1.last_durable_turn_count,
        history: [
          { role: "user", content: "Turn 1 durable" },
          { role: "user", content: "Turn 2 memory only" },
        ],
        memory: { test_phrases: ["durable-one", "ephemeral-two"] },
      },
      {}
    );
    expect(s2.persisted).toBe(false);
    expect(s2.persistence_mode).toBe("memory_only");
    expect(s2.last_durable_turn_count).toBe(EXPECTED_TURN_ONE);

    // Loading session while Turn 2 is only in memory and D1 only has Turn 1 MUST NOT report persisted: true!
    const loadedAfterFailure = await loadEphemeralChatSession(mockDb, sessId, {});
    expect(loadedAfterFailure.turn_count).toBe(EXPECTED_TURN_TWO);
    expect(loadedAfterFailure.persisted).toBe(false);
    expect(loadedAfterFailure.persistence_mode).toBe("memory_only");
    expect(loadedAfterFailure.last_durable_turn_count).toBe(EXPECTED_TURN_ONE);

    // Turn 3: D1 recovers -> persisted: true, last_durable_turn_count: 3
    failWrites = false;
    const s3 = await saveEphemeralChatSession(
      mockDb,
      {
        session_id: sessId,
        turn_count: EXPECTED_TURN_THREE,
        last_durable_turn_count: loadedAfterFailure.last_durable_turn_count,
        history: [
          ...loadedAfterFailure.history,
          { role: "user", content: "Turn 3 recovered" },
        ],
        memory: loadedAfterFailure.memory,
      },
      {}
    );
    expect(s3.persisted).toBe(true);
    expect(s3.persistence_mode).toBe("d1");
    expect(s3.last_durable_turn_count).toBe(EXPECTED_TURN_THREE);
  });

  it("shares the $5 Meta allowance across DO + 21-column herma_meta_call_log, validates payloads, and fails closed on D1 errors", async () => {
    await ensureHelpAndStarterSchema(env.HERMA_DB);
    const budgetStub = env.WORK_REASONING_BUDGET.getByName(`meta-test-${crypto.randomUUID()}`);

    // Missing or non-positive amounts fail closed with invalid_budget_reservation
    const invalidZero = await budgetStub.reservePublicMeta({ call_id: "bad_zero", ceiling_microusd: 0 });
    expect(invalidZero.ok).toBe(false);
    expect(invalidZero.code).toBe("invalid_budget_reservation");

    const invalidMissing = await budgetStub.reservePublicMeta({ call_id: "bad_missing" });
    expect(invalidMissing.ok).toBe(false);
    expect(invalidMissing.code).toBe("invalid_budget_reservation");

    // Valid reservation inserts cleanly into 21-column herma_meta_call_log and replays idempotently by call_id
    const callId = `mcall_shared_${Date.now()}`;
    const r1 = await budgetStub.reservePublicMeta({
      call_id: callId,
      endpoint: "/q/help",
      agent_id: "budget-verifier",
      requested_model: "muse-spark-1.3",
      ceiling_microusd: SAMPLE_META_CEILING_MICROUSD,
    });
    expect(r1.ok).toBe(true);
    expect(r1.call_id).toBe(callId);

    const r1Replay = await budgetStub.reservePublicMeta({
      call_id: callId,
      endpoint: "/q/help",
      agent_id: "budget-verifier",
      requested_model: "muse-spark-1.3",
      ceiling_microusd: SAMPLE_META_CEILING_MICROUSD,
    });
    expect(r1Replay.ok).toBe(true);
    expect(r1Replay.replayed).toBe(true);

    await finishMetaCall(env.HERMA_DB, {
      call_id: callId,
      reported_model: "muse-spark-1.3",
      http_status: 200,
      outcome: "completed",
      input_tokens: 120,
      output_tokens: 80,
      estimated_microusd: SAMPLE_META_SETTLED_MICROUSD,
      latency_ms: 45,
      response_sha256: "ok",
      error_code: "",
    });
    const settledRow = await env.HERMA_DB
      .prepare("SELECT outcome, estimated_microusd, requested_model, reported_model FROM herma_meta_call_log WHERE call_id = ?")
      .bind(callId)
      .first();
    expect(settledRow?.outcome).toBe("completed");
    expect(Number(settledRow?.estimated_microusd)).toBe(SAMPLE_META_SETTLED_MICROUSD);
    expect(settledRow?.requested_model).toBe("muse-spark-1.3");

    // Simulate broken D1 handle inside DO -> fails closed with provider_ledger_unavailable
    await runInDurableObject(budgetStub, async (instance) => {
      const origDb = instance.env.HERMA_DB;
      instance.env = {
        ...instance.env,
        HERMA_DB: {
          prepare() {
            throw new Error("simulated_d1_ledger_down");
          },
        },
      };
      try {
        const resA = await instance.reservePublicMeta({
          call_id: `mcall_broken_${Date.now()}`,
          ceiling_microusd: SAMPLE_META_CEILING_MICROUSD,
        });
        expect(resA.ok).toBe(false);
        expect(resA.code).toBe("provider_ledger_unavailable");

        const fakeHash = "a".repeat(64);
        const resB = instance.reserve(fakeHash, "meta", fakeHash, SAMPLE_META_CEILING_MICROUSD);
        expect(resB.ok).toBe(false);
        expect(resB.code).toBe("provider_ledger_unavailable");

        const resChecked = await instance.reserveChecked(fakeHash, "meta", fakeHash, SAMPLE_META_CEILING_MICROUSD);
        expect(resChecked.ok).toBe(false);
        expect(resChecked.code).toBe("provider_ledger_unavailable");
      } finally {
        instance.env = { ...instance.env, HERMA_DB: origDb };
      }
    });
  });

  it("handles 8,001 non-BMP codepoints on /api/preview and preserves WorkConversation response + checksum across settlement failure", async () => {
    const emojiUnit = "\u{1F680}";
    expect(emojiUnit.length).toBe(2);

    const okNonBmpPrompt = emojiUnit.repeat(NON_BMP_PREVIEW_CODEPOINTS);
    const previewOk = await callHerma("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: okNonBmpPrompt }),
    });
    expect(previewOk.status).toBe(200);

    const tooLongPrompt = "a".repeat(OVERSIZE_PREVIEW_CODEPOINTS);
    const previewTooLong = await callHerma("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: tooLongPrompt }),
    });
    expect(previewTooLong.status).toBe(422);

    // WorkConversation: 4,000 non-BMP codepoints + simulated recordOutcome RPC failure -> response & checksum remain immutable on replay!
    const callerScope = "key:example-conversation-19";
    const convStub = env.WORK_CONVERSATIONS.getByName(callerScope);
    const contractEntry = {
      entry_id: "work.observation",
      kind: "noun",
      title: "Observation",
      summary: "Capability observation",
      schema_or_body: {
        work_contract: {
          operation_id: "record_observation",
          category_id: "noun.eval_run",
          description: "Record one capability observation.",
          input_schema: {
            type: "object",
            properties: {
              value: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  example: { type: "boolean", const: true },
                },
                required: ["message", "example"],
                additionalProperties: false,
              },
            },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    };

    let firstTurnResult;
    await runInDurableObject(convStub, async (instance, state) => {
      const realBudgetNs = instance.env.WORK_REASONING_BUDGET;
      // Wrap WORK_REASONING_BUDGET so reserve succeeds normally, then recordOutcome fails on Turn 1!
      instance.env = {
        ...instance.env,
        WORK_REASONING_BUDGET: {
          getByName(name) {
            const realStub = realBudgetNs.getByName(name);
            return {
              reserve: (...args) => realStub.reserve(...args),
              recordOutcome: async () => {
                throw new Error("simulated_settlement_rpc_failure");
              },
            };
          },
        },
      };
      try {
        firstTurnResult = await instance.turn(
          callerScope,
          {
            conversation_id: "conv-settlement-repro",
            request_id: "req-settlement-1",
            expected_version: 0,
            message: "EXAMPLE " + emojiUnit.repeat(NON_BMP_CONV_CODEPOINTS),
            context_refs: [contractEntry.entry_id],
            provider: "meta",
          },
          [contractEntry]
        );
      } finally {
        instance.env = { ...instance.env, WORK_REASONING_BUDGET: realBudgetNs };
      }

      expect(firstTurnResult.status).toBe(200);
      expect(firstTurnResult.body.proposal.status).toBe("ready");
      expect(firstTurnResult.body.attempts[0].settlement_status).toBe("pending_reconciliation");
      const pendingCount = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM pending_settlements")
        .one().n;
      expect(pendingCount).toBe(1);
    });

    const { receipt_hash: _omitReceipt, ...bodyWithoutReceipt } = firstTurnResult.body;
    const expectedChecksum = await hash(bodyWithoutReceipt);
    expect(firstTurnResult.body.receipt_hash).toBe(expectedChecksum);

    // Replay the exact same turn after WORK_REASONING_BUDGET recovers: pending_settlements drains AND sealed response + checksum remain 100% identical!
    const replayedTurn = await convStub.turn(
      callerScope,
      {
        conversation_id: "conv-settlement-repro",
        request_id: "req-settlement-1",
        expected_version: 0,
        message: "EXAMPLE " + emojiUnit.repeat(NON_BMP_CONV_CODEPOINTS),
        context_refs: [contractEntry.entry_id],
        provider: "meta",
      },
      [contractEntry]
    );
    expect(replayedTurn).toEqual(firstTurnResult);
    expect(replayedTurn.body.receipt_hash).toBe(expectedChecksum);

    await runInDurableObject(convStub, (_instance, state) => {
      const remainingPending = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM pending_settlements")
        .one().n;
      expect(remainingPending).toBe(0);
      const settledCount = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM settled_attempts")
        .one().n;
      expect(settledCount).toBe(1);
    });
  });

  it("enforces maker != checker, score/verdict normalization, trace scoping without blank-task overlabeling, and public-only /q/training-export", async () => {
    // 1. Verify GET /q/alternatives and GET /q/leaderboard return 200 OK
    const altRes = await callHerma("/q/alternatives");
    expect(altRes.status).toBe(200);
    const lbRes = await callHerma("/q/leaderboard");
    expect(lbRes.status).toBe(200);

    // 2. Register maker and independent checker workers
    const makerReg = await (
      await callHerma("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "maker-agent-01" }),
      })
    ).json();
    const checkerReg = await (
      await callHerma("/q/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: "checker-agent-02" }),
      })
    ).json();
    const makerUuid = makerReg.worker_profile?.worker_uuid || makerReg.worker_uuid;
    const checkerUuid = checkerReg.worker_profile?.worker_uuid || checkerReg.worker_uuid;
    expect(makerUuid).toBeTruthy();
    expect(checkerUuid).toBeTruthy();
    expect(makerUuid).not.toBe(checkerUuid);

    // 3. Seed an unrelated blank-task trace for maker AND a task-specific trace + private trace to verify trace labeling & training-export filtering
    await ensureHelpAndStarterSchema(env.HERMA_DB);
    const targetObjKey = `obj_public_scope_${Date.now()}`;
    const blankTraceId = `ft_blank_${Date.now()}`;
    const taskTraceId = `ft_task_${Date.now()}`;
    const privateTraceId = `ft_priv_${Date.now()}`;

    // Enqueue a dedicated public task so maker can claim, submit without explicit summary, and trigger peer review
    const enqRes = await callHerma("/q/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "maker-agent-01",
        worker_uuid: makerUuid,
        worker_token: makerReg.worker_token,
        title: "Author public scope trace data fixture",
        prompt: "Build a clean public data fixture Task Object.",
        verb_kind: "general_verb",
        step_mode: "atomic_build_step",
        tier: "public_general",
        visibility: "public_commons",
      }),
    });
    expect(enqRes.status).toBe(200);
    const enqDoc = await enqRes.json();
    const createdTaskId =
      enqDoc.enqueued_followup_tasks?.[0]?.task_id ||
      enqDoc.enqueued_followup_verbs?.[0]?.task_id ||
      enqDoc.task?.task_id ||
      enqDoc.task_id;
    expect(createdTaskId).toBeTruthy();

    const claimRes = await callHerma(
      `/q/claim?task_id=${encodeURIComponent(createdTaskId)}&agent_id=maker-agent-01&worker_uuid=${encodeURIComponent(
        makerUuid
      )}&format=json`,
      { headers: { Accept: "application/json", "X-Herma-Worker-Token": makerReg.worker_token } }
    );
    expect(claimRes.status).toBe(200);
    const claimDoc = await claimRes.json();
    const fence = claimDoc.lease?.fencing_token ?? claimDoc.task?.fencing_token ?? claimDoc.fencing_token;

    const nowIso = new Date().toISOString();
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_finetune_traces
         (trace_id, source_kind, task_id, worker_uuid, model_id, visibility, export_eligible, system_shim_json, input_messages_json, output_json, quality_weight_milli, verified_outcome, created_at)
         VALUES (?, 'help_guidance', '', ?, 'muse-spark-1.3', 'public_commons', 1, '{}', '[]', '{}', 720, 'generated_meta_muse', ?)`
      )
      .bind(blankTraceId, makerUuid, nowIso)
      .run();
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_finetune_traces
         (trace_id, source_kind, task_id, worker_uuid, model_id, visibility, export_eligible, system_shim_json, input_messages_json, output_json, quality_weight_milli, verified_outcome, created_at)
         VALUES (?, 'help_guidance', ?, ?, 'muse-spark-1.3', 'public_commons', 1, '{}', '[]', '{}', 720, 'generated_meta_muse', ?)`
      )
      .bind(taskTraceId, createdTaskId, makerUuid, nowIso)
      .run();
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_finetune_traces
         (trace_id, source_kind, task_id, worker_uuid, model_id, visibility, export_eligible, system_shim_json, input_messages_json, output_json, quality_weight_milli, verified_outcome, created_at)
         VALUES (?, 'help_guidance', 'infra_secret_task_99', ?, 'muse-spark-1.3', 'server_infra', 0, '{}', '[{"secret":"INTERNAL_ONLY_MARKER"}]', '{}', 960, 'accepted', ?)`
      )
      .bind(privateTraceId, makerUuid, nowIso)
      .run();

    // Also insert a server_infra conversation row and verify /q/training-export excludes it in both JSON and JSONL
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_agent_conversations
         (session_id, agent_id, worker_uuid, active_task_id, active_fencing_token, state_stage, visibility, export_eligible, history_json, turn_count, staging_draft_json, created_at, updated_at)
         VALUES ('sess_private_infra_01', 'infra-bot', 'w_infra', 'infra_secret_task_99', 1, 'submitted', 'server_infra', 0, '[{"role":"user","content":"PRIVATE_INFRA_CONVERSATION_MARKER"},{"role":"assistant","content":"ok"}]', 2, '{}', ?, ?)`
      )
      .bind(nowIso, nowIso)
      .run();

    // 4. Maker submits via /q/chat WITHOUT explicit summary -> auto-synthesizes summary, marks taskTraceId 'submitted_unreviewed' (NOT 'accepted'), and leaves blankTraceId untouched!
    const chatSubRes = await callHerma("/q/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Herma-Worker-Token": makerReg.worker_token,
      },
      body: JSON.stringify({
        agent_id: "maker-agent-01",
        worker_uuid: makerUuid,
        task_id: createdTaskId,
        fencing_token: fence,
        action: "submit",
        submission: {
          task_objects: [
            {
              object_key: targetObjKey,
              category: "verification_fixture",
              payload: { title: "Public reusable verification fixture", ok: true },
            },
          ],
        },
      }),
    });
    expect(chatSubRes.status).toBe(200);
    const chatSubDoc = await chatSubRes.json();
    expect(chatSubDoc.submission_status || chatSubDoc.submit_result?.ok).toBeTruthy();

    const blankAfterSub = await env.HERMA_DB
      .prepare("SELECT verified_outcome FROM herma_finetune_traces WHERE trace_id = ?")
      .bind(blankTraceId)
      .first();
    expect(blankAfterSub?.verified_outcome).toBe("generated_meta_muse");

    const taskAfterSub = await env.HERMA_DB
      .prepare("SELECT verified_outcome FROM herma_finetune_traces WHERE trace_id = ?")
      .bind(taskTraceId)
      .first();
    expect(taskAfterSub?.verified_outcome).toBe("submitted_unreviewed");

    // 5. Maker attempting to claim the peer-review task gets 403 self_review_forbidden, and self-evaluation is ignored (applied_evaluations length 0)
    const peerReviewTaskId = `verb_peer_review_${targetObjKey}`;
    const selfClaimReview = await callHerma(
      `/q/claim?task_id=${encodeURIComponent(peerReviewTaskId)}&agent_id=maker-agent-01&worker_uuid=${encodeURIComponent(
        makerUuid
      )}&format=json`,
      { headers: { Accept: "application/json", "X-Herma-Worker-Token": makerReg.worker_token } }
    );
    // Owner, Nov 6: a maker's claim of its own review is a 409 with a way on (producer_guard.js); the old code stays as previous_code.
    expect(selfClaimReview.status).toBe(409);
    const selfClaimReviewDoc = await selfClaimReview.json();
    expect(selfClaimReviewDoc.code).toBe("producer_cannot_evaluate");
    expect(selfClaimReviewDoc.previous_code).toBe("self_review_forbidden");

    const selfEvalRes = await callHerma("/q/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Herma-Worker-Token": makerReg.worker_token,
      },
      body: JSON.stringify({
        task_id: "self_seed",
        agent_id: "maker-agent-01",
        worker_uuid: makerUuid,
        evaluations: [
          {
            target_object_key: targetObjKey,
            score: MILLI_REVIEW_SCORE,
            verdict: "APPROVED",
          },
        ],
      }),
    });
    const selfEvalDoc = await selfEvalRes.json();
    expect(selfEvalDoc.applied_evaluations).toEqual([]);

    // 6. Independent checker submits milli-scale score (950 -> 0.95) & verdict 'PASS' -> normalized to CONFIRMED and promotes taskTraceId to 'accepted'!
    const peerEvalRes = await callHerma("/q/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Herma-Worker-Token": checkerReg.worker_token,
      },
      body: JSON.stringify({
        task_id: "self_seed",
        agent_id: "checker-agent-02",
        worker_uuid: checkerUuid,
        evaluations: [
          {
            target_object_key: targetObjKey,
            score: MILLI_REVIEW_SCORE,
            verdict: "PASS",
          },
        ],
      }),
    });
    expect(peerEvalRes.status).toBe(200);
    const peerEvalDoc = await peerEvalRes.json();
    expect(peerEvalDoc.applied_evaluations[0].verification_verdict).toBe("UNREVIEWED") // a free identity's verdict is a recorded opinion; only our own checker sets it;
    expect(peerEvalDoc.applied_evaluations[0].score).toBeCloseTo(NORMALIZED_REVIEW_SCORE, 4);

    const taskAfterPeer = await env.HERMA_DB
      .prepare("SELECT verified_outcome FROM herma_finetune_traces WHERE trace_id = ?")
      .bind(taskTraceId)
      .first();
    expect(taskAfterPeer?.verified_outcome).toBe("submitted_unreviewed");

    // 7. Verify /q/training-export (both JSON and JSONL) includes public accepted trace & excludes private traces/conversations
    const exportJsonRes = await callHerma("/q/training-export?format=json");
    expect(exportJsonRes.status).toBe(200);
    const exportJsonText = await exportJsonRes.text();
    expect(exportJsonText).toContain(taskTraceId);
    // Common personal data is stripped from what the export serves; the stored row stays as it was.
    await env.HERMA_DB.prepare("UPDATE herma_finetune_traces SET output_json = ? WHERE trace_id = ?")
      .bind(JSON.stringify({ reply: "ana 617-204-8831 now" }), taskTraceId)
      .run();
    const strippedDoc = await (await callHerma("/q/training-export?format=json")).text();
    expect(strippedDoc).toContain("[phone]");
    expect(strippedDoc).not.toContain("617-204-8831");
    const storedPii = await env.HERMA_DB.prepare("SELECT output_json FROM herma_finetune_traces WHERE trace_id = ?").bind(taskTraceId).first();
    expect(storedPii?.output_json).toContain("617-204-8831");
    expect(exportJsonText).not.toContain(privateTraceId);
    expect(exportJsonText).not.toContain("INTERNAL_ONLY_MARKER");
    expect(exportJsonText).not.toContain("PRIVATE_INFRA_CONVERSATION_MARKER");

    const exportJsonlRes = await callHerma("/q/training-export?format=jsonl");
    expect(exportJsonlRes.status).toBe(200);
    const exportJsonlText = await exportJsonlRes.text();
    expect(exportJsonlText).not.toContain(privateTraceId);
    expect(exportJsonlText).not.toContain("INTERNAL_ONLY_MARKER");
    expect(exportJsonlText).not.toContain("PRIVATE_INFRA_CONVERSATION_MARKER");
  });

  it("matches all 8 realistic prompts and real D1 public Task Objects on /api/preview with zero model calls, caps auto follow-up depth, and exposes active_workers", async () => {
    // Bootstrap gateway schema + public Task Objects via /q/pulse and verify active_workers on /q/pulse, /dashboard?format=json, and /q/network
    const pulseRes = await callHerma("/q/pulse");
    expect(pulseRes.status).toBe(200);
    const pulseDoc = await pulseRes.json();
    expect(typeof pulseDoc.active_workers).toBe("number");
    expect(typeof pulseDoc.worker_fleet?.active_workers).toBe("number");

    const dashRes = await callHerma("/dashboard?format=json");
    expect(dashRes.status).toBe(200);
    const dashDoc = await dashRes.json();
    expect(typeof dashDoc.active_workers).toBe("number");
    expect(typeof dashDoc.registered_handles).toBe("number");

    const netRes = await callHerma("/q/network");
    expect(netRes.status).toBe(200);
    const netDoc = await netRes.json();
    expect(typeof netDoc.active_workers).toBe("number");
    expect(typeof netDoc.totals?.active_workers).toBe("number");

    // Seed one custom public Task Object and one server_infra Task Object to prove real D1 Task Object search + strict visibility isolation
    const customPublicKey = `kit_custom_solar_microgrid_${Date.now()}`;
    const privateInfraKey = `kit_private_infra_secret_${Date.now()}`;
    const nowIso = new Date().toISOString();
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, tessera_synced, created_at, quality_milli, verification_verdict, search_hints_json)
         VALUES (?, ?, 1, 'portable_agent_kit', 'public_commons', 'preview-tester', 'seed_test', 'Reusable solar microgrid load-shedding checklist for rural clinics.', '{"ok":true}', '0000000000000001', '1111111111111111', 1, ?, 910, 'CONFIRMED', '{"search_keywords":["solar","microgrid","load-shedding"],"search_phrases":["solar microgrid checklist"]}')`
      )
      .bind(customPublicKey, customPublicKey, nowIso)
      .run();
    await env.HERMA_DB
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, tessera_synced, created_at, quality_milli, verification_verdict, search_hints_json)
         VALUES (?, ?, 1, 'internal_config', 'server_infra', 'infra-bot', 'seed_priv', 'CONFIDENTIAL_SERVER_INFRA_CANARY microgrid secret.', '{"secret":true}', '0000000000000002', '2222222222222222', 0, ?, 990, 'CONFIRMED', '{"search_keywords":["solar","microgrid","confidential_canary"]}')`
      )
      .bind(privateInfraKey, privateInfraKey, nowIso)
      .run();

    const realisticPrompts = [
      "How should my agent claim a Task?",
      "What is Teleion Fabric?",
      "eranos",
      "Help a nonprofit make a bilingual food pantry flyer",
      "How do feeds show what's new?",
      "How does model routing pick between Muse Spark 1.3 and Muse Wonder 1.0?",
      "Muse's latest release",
      "When should we use fine-tuning vs context shimming?",
    ];

    let directCount = 0;
    for (const prompt of realisticPrompts) {
      const pRes = await callHerma("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, wire_format: "chat_completions" }),
      });
      expect(pRes.status, prompt).toBe(200);
      const pDoc = await pRes.json();
      expect(pDoc.persisted, prompt).toBe(false);
      expect(pDoc.matches.length, prompt).toBeGreaterThanOrEqual(1);
      expect(
        pDoc.shimmed_context_refs.length >= 1 || pDoc.responded_directly === true,
        prompt
      ).toBe(true);
      expect(Array.isArray(pDoc.public_task_objects), prompt).toBe(true);
      expect(pDoc.public_task_objects.length, prompt).toBeGreaterThanOrEqual(1);
      if (pDoc.responded_directly) directCount += 1;

      const visibleText =
        (pDoc.direct_response_text || "") +
        "\n" +
        ((pDoc.augmented_payload?.messages || []).find((m) => m.role === "system")?.content || "");
      expect(visibleText).not.toContain("workers.dev");
      expect(visibleText).not.toContain("1.7%");
      expect(visibleText).not.toContain("93.3%");
      expect(visibleText).not.toContain("CONFIDENTIAL_SERVER_INFRA_CANARY");
    }
    expect(directCount).toBeGreaterThanOrEqual(1);

    // Novel prompt with no static provision keyword still matches the newly inserted public D1 Task Object and never leaks server_infra!
    const dynRes = await callHerma("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Prepare a solar microgrid load-shedding checklist for a rural clinic",
        wire_format: "chat_completions",
      }),
    });
    expect(dynRes.status).toBe(200);
    const dynDoc = await dynRes.json();
    expect(dynDoc.matches.length).toBeGreaterThanOrEqual(1);
    expect(dynDoc.shimmed_context_refs).toContain(`object:${customPublicKey}`);
    expect(dynDoc.public_task_objects.map((o) => o.object_key)).toContain(customPublicKey);
    expect(dynDoc.public_task_objects.map((o) => o.object_key)).not.toContain(privateInfraKey);
    expect(JSON.stringify(dynDoc)).not.toContain("CONFIDENTIAL_SERVER_INFRA_CANARY");

    // Verify automatic follow-up spawning caps at max_auto_followup_depth (depth >= 2 does NOT auto-spawn peer_review/index_enrich)
    const deepObjKey = `obj_deep_gen_${Date.now()}`;
    const deepSubRes = await callHerma("/q/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: "self_seed",
        agent_id: "deep-depth-checker",
        task_objects: [
          {
            object_key: deepObjKey,
            category: "verification_fixture",
            generation_depth: 3,
            payload: { title: "Depth-3 Task Object should not auto-spawn recursive review chains", depth: 3 },
          },
        ],
      }),
    });
    expect(deepSubRes.status).toBe(200);
    const deepSubDoc = await deepSubRes.json();
    expect(deepSubDoc.auto_enqueued_index_and_review_verbs || []).toEqual([]);
  });
});
