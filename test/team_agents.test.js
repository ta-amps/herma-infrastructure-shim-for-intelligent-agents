import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { networkWorkerKind, recordClaimEdge, resetNetworkCaches } from "../deploy/cloudflare/network_activity.js";
import { workerLabel } from "../deploy/cloudflare/page_shell.js";
import { TEAM_AGENTS_KEY, emptyTeam, isTeamAgent, parseTeamAgents, resetTeamAgentsCache } from "../deploy/cloudflare/team_agents.js";

// The agents the team runs itself are an operator-written noun (a private Task Object). A listed agent is "dedicated" on the map and "Dedicated worker
// (run by ta-amps)" on the dashboard; every other agent is "volunteer" on the wire and "A connected AI" on a page. A stranger cannot add itself.

const BASE = "https://herma.teleionlabs.com";
const OPERATOR_KEY = `test-operator-${crypto.randomUUID()}`; // made at run time, so no secret-like literal is in the source
const call = (path, init) => exports.default.fetch(BASE + path, init);
const asOperator = (path, init = {}) => worker.fetch(new Request(BASE + path, { ...init, headers: { "x-bootstrap-secret": OPERATOR_KEY, ...(init.headers || {}) } }), { ...env, BOOTSTRAP_SECRET: OPERATOR_KEY });
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const db = () => env.HERMA_DB;
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const listObject = (agents, extra = {}) => ({
  agent_id: "ta-amps-operator",
  task_objects: [{ object_key: TEAM_AGENTS_KEY, visibility: "server_infra", category: "operator_list", summary: "The agents ta-amps runs itself", payload: { schema: "herma.team_agents.v1", agents, ...extra } }],
});

async function ready() {
  await call("/q/pulse"); // creates the tables
  await call("/q/network");
  await db().prepare("DELETE FROM herma_claim_edge").run().catch(() => {});
  await db().prepare("DELETE FROM herma_task_objects WHERE requested_object_key = ? OR object_key = ?").bind(TEAM_AGENTS_KEY, TEAM_AGENTS_KEY).run().catch(() => {});
  await db().prepare("DELETE FROM herma_worker_registry WHERE agent_id LIKE 'team-test-%'").run().catch(() => {});
  resetTeamAgentsCache();
  resetNetworkCaches();
}

async function addWorker(agentId, uuid) {
  const stamp = "2026-11-02T00:00:00Z";
  await db()
    .prepare("INSERT OR REPLACE INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at, iteration_count) VALUES (?, ?, 'p', 'Careful checker', 'Lens', ?, ?, 1)")
    .bind(uuid, agentId, stamp, stamp)
    .run();
  await db()
    .prepare("INSERT OR REPLACE INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at) VALUES (?, 'public_general', 'public_commons', 50, ?, 'p', '0', 'team-test', ?, ?)")
    .bind(`task_of_${uuid}`, `Plan for ${uuid}`, stamp, stamp)
    .run();
  await recordClaimEdge(db(), { cf: { colo: "IAD", continent: "NA" } }, { task: { task_id: `task_of_${uuid}`, tier: "public_general", verb_kind: "general_verb" }, workerUuid: uuid, agentId, modelHint: "muse-spark-1.3", persona: "Careful checker", nowIso: minutesAgo(uuid.endsWith("1") ? 6 : 4) });
}

const feedKinds = async () => {
  const body = await (await call("/q/network?replay=1")).json();
  return Object.fromEntries(body.recent_claims.map((c) => [c.title, c.worker_kind]));
};

describe("the list, read and matched", () => {
  it("reads a list tolerantly: handles and prefixes, any case, junk and short prefixes dropped", () => {
    const team = parseTeamAgents({ schema: "x", agents: ["Muse-Worker-01", " muse-worker-02 ", "", 5, null, "has space", "x".repeat(81)], prefixes: ["codex-", "ab", "Replay-Builder-"] });
    expect([...team.exact]).toEqual(["muse-worker-01", "muse-worker-02"]);
    expect(team.prefixes).toEqual(["codex-", "replay-builder-"]); // "ab" is too short to name anyone
    expect(parseTeamAgents(JSON.stringify({ agents: ["a-1"] })).exact.has("a-1")).toBe(true);
    for (const junk of [null, undefined, "", "not json", "[]", 7, { chunked_storage: true, agents: ["a"] }, { agents: "a" }]) {
      expect(parseTeamAgents(junk).exact.size + parseTeamAgents(junk).prefixes.length).toBe(0);
    }
    expect(parseTeamAgents({ agents: Array.from({ length: 900 }, (_, i) => `agent-${i}`) }).exact.size).toBe(500);
  });

  it("keeps the old rule and adds the list to it", () => {
    const team = parseTeamAgents({ agents: ["muse-worker-01"], prefixes: ["codex-"] });
    for (const id of ["eranos-worker-3", "ta-amps.helper", "ERANOS_x", "muse-worker-01", "Muse-Worker-01", "codex-history-69e21759"]) expect(isTeamAgent(id, team), id).toBe(true);
    for (const id of ["someone-elses-agent", "muse-worker-011", "eranosx", "", null, "xcodex-1"]) expect(isTeamAgent(id, team), String(id)).toBe(false);
    expect(isTeamAgent("muse-worker-01", emptyTeam())).toBe(false); // without the list only the old rule applies
    expect(networkWorkerKind("muse-worker-01", team)).toBe("dedicated");
    expect(networkWorkerKind("muse-worker-01")).toBe("volunteer");
  });

  it("labels a listed agent as run by ta-amps and any other as connected", () => {
    const team = parseTeamAgents({ agents: ["muse-worker-02"], prefixes: ["codex-"] });
    expect(workerLabel("eranos-worker-3", team)).toBe("Dedicated worker 3 (run by ta-amps)"); // the old rule keeps its number
    expect(workerLabel("muse-worker-02", team)).toBe("Dedicated worker (run by ta-amps)"); // a name only the list gives has no number: a digit inside it would mean nothing
    expect(workerLabel("codex-history-69e21759", team)).toBe("Dedicated worker (run by ta-amps)");
    expect(workerLabel("someone-elses-agent", team)).toBe("A connected AI");
    expect(workerLabel("muse-worker-02", emptyTeam())).toBe("A connected AI");
  });
});

describe("the list as the Worker keeps it", () => {
  beforeEach(ready, 60000);

  it("an operator writes it, and a listed agent is dedicated on the map and on its worker page, an unlisted one connected", async () => {
    await addWorker("team-test-listed", "w_team_listed_1");
    await addWorker("team-test-other", "w_team_other_2");
    expect(await feedKinds()).toEqual({ "Plan for w_team_listed_1": "volunteer", "Plan for w_team_other_2": "volunteer" }); // no list yet

    const written = await asOperator("/q/objects", post(listObject(["team-test-listed"])));
    expect(written.status).toBe(200);
    resetTeamAgentsCache();
    resetNetworkCaches();
    const body = await (await call("/q/network?replay=1")).json();
    const byTitle = Object.fromEntries(body.recent_claims.map((c) => [c.title, c]));
    expect(byTitle["Plan for w_team_listed_1"]).toMatchObject({ worker_kind: "dedicated", persona: "Careful checker" });
    expect(byTitle["Plan for w_team_listed_1"].model).toMatchObject({ declared: false }); // a team agent's model is not marked as a volunteer's declaration
    expect(byTitle["Plan for w_team_other_2"]).toMatchObject({ worker_kind: "volunteer", persona: null });
    expect(byTitle["Plan for w_team_other_2"].model).toMatchObject({ declared: true });
    expect(JSON.stringify(body)).not.toContain("team-test-listed"); // the list and the handles stay out of the answer

    const listedPage = await (await call("/w/w_team_listed_1")).text();
    const otherPage = await (await call("/w/w_team_other_2")).text();
    expect(listedPage).toContain("Dedicated worker (run by ta-amps)");
    expect(otherPage).toContain("A connected AI");
    expect(otherPage).not.toContain("run by ta-amps");
  });

  it("a stranger cannot add itself: a private list is refused to the public, and a public object with the key is never read", async () => {
    await addWorker("team-test-stranger", "w_team_stranger_3");
    const refused = await call("/q/objects", post(listObject(["team-test-stranger"])));
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("forbidden_tier");
    // The same key as a public object is accepted as any object is, and is not the list.
    const publicOne = listObject(["team-test-stranger"]);
    publicOne.task_objects[0].visibility = "public_commons";
    publicOne.agent_id = "team-test-stranger";
    const stored = await call("/q/objects", post(publicOne));
    expect(stored.status).toBe(200);
    resetTeamAgentsCache();
    resetNetworkCaches();
    expect(await feedKinds()).toEqual({ "Plan for w_team_stranger_3": "volunteer" });
    expect(await (await call("/w/w_team_stranger_3")).text()).toContain("A connected AI");
    // Nor does the operator's own list leak: the private object is not served to the public.
    await asOperator("/q/objects", post(listObject(["team-test-secret-handle"])));
    const served = await call(`/q/object/${TEAM_AGENTS_KEY}`);
    expect(await served.text()).not.toContain("team-test-secret-handle");
  });

  it("the newest list the operator wrote is the one in force", async () => {
    await addWorker("team-test-listed", "w_team_listed_1");
    await asOperator("/q/objects", post(listObject(["team-test-listed"])));
    resetTeamAgentsCache();
    resetNetworkCaches();
    expect((await feedKinds())["Plan for w_team_listed_1"]).toBe("dedicated");
    const later = await asOperator("/q/objects", post(listObject(["someone-else"])));
    expect(later.status).toBe(200);
    resetTeamAgentsCache();
    resetNetworkCaches();
    expect((await feedKinds())["Plan for w_team_listed_1"]).toBe("volunteer"); // the agent was taken off
  });
});
