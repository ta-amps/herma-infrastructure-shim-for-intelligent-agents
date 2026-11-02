// The agents the team runs itself (ta-amps and its own sessions). Herma says "Dedicated worker (run by ta-amps)" and the network map says
// worker_kind "dedicated" for these, and "A connected AI" / "volunteer" for every other agent, because a name that is not on the list may be anyone's.
//
// The list is a noun: one Task Object, `herma_team_agents`, stored private (visibility server_infra). The submission path refuses that visibility to a
// public caller ("Public workers cannot store server_infra task_objects"), so only an operator (the admin token, an infrastructure key, or an
// infrastructure worker) can write it, and the reader below takes only such rows: a stranger cannot add itself, and a public object with the same key
// is never read. The list itself is not published; only the label it gives is (the map's worker_kind, a worker's label on the dashboard).
//
// Its payload: { "schema": "herma.team_agents.v1", "run_by": "ta-amps", "agents": ["muse-worker-01", ...], "prefixes": ["muse-herma-worker", ...] }.
// `agents` are exact handles, `prefixes` match the start of a handle; both ignore case. The rule Herma has always had (a handle that starts with
// eranos or ta-amps) stays and the list adds to it.

export const TEAM_AGENTS_KEY = "herma_team_agents";
export const TEAM_AGENTS_SCHEMA = "herma.team_agents.v1";

const BASELINE = /^(?:eranos|ta-amps)[-_.\s]/i;
const HANDLE = /^[a-z0-9][a-z0-9._:-]*$/;
const MAX_ENTRIES = 500;
const MAX_LENGTH = 80;
const MIN_PREFIX = 4; // a shorter prefix would name half the world
const CACHE_MS = 60_000;

export const emptyTeam = () => ({ exact: new Set(), prefixes: [] });

const cleanHandles = (list, { minLength = 2 } = {}) =>
  (Array.isArray(list) ? list : [])
    .filter((value) => typeof value === "string") // a number or an object in the list is a mistake, not a handle
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= minLength && value.length <= MAX_LENGTH && HANDLE.test(value))
    .slice(0, MAX_ENTRIES);

/** The list a payload names: tolerant, so a wrong payload gives an empty list and never an error. */
export function parseTeamAgents(payload) {
  let object = payload;
  if (typeof payload === "string") {
    try {
      object = JSON.parse(payload);
    } catch {
      return emptyTeam();
    }
  }
  if (!object || typeof object !== "object" || Array.isArray(object) || object.chunked_storage) return emptyTeam();
  return { exact: new Set(cleanHandles(object.agents)), prefixes: cleanHandles(object.prefixes, { minLength: MIN_PREFIX }) };
}

/** Whether ta-amps runs this agent: the old rule, or a handle on the list. */
export function isTeamAgent(agentId, team = emptyTeam()) {
  const id = String(agentId ?? "").trim();
  if (!id) return false;
  if (BASELINE.test(id)) return true;
  const handle = id.toLowerCase();
  return team.exact.has(handle) || team.prefixes.some((prefix) => handle.startsWith(prefix));
}

/** Whether the old rule alone names the agent (its label can then carry a number, as "eranos-worker-3" does). */
export const matchesBaseline = (agentId) => BASELINE.test(String(agentId ?? "").trim());

let cache = null;

/** For tests: forget the list an isolate remembers. */
export function resetTeamAgentsCache() {
  cache = null;
}

/** The newest operator-written list, kept for a minute in an isolate. No list, or a read that fails, is an empty list (everyone else stays "connected"). */
export async function loadTeamAgents(db, nowMs = Date.now()) {
  if (cache && nowMs - cache.at < CACHE_MS) return cache.team;
  let team = emptyTeam();
  try {
    const row = await db
      .prepare(
        `SELECT payload_json FROM herma_task_objects
         WHERE requested_object_key = ? AND visibility = 'server_infra' AND COALESCE(is_tombstoned, 0) = 0
         ORDER BY id DESC LIMIT 1`
      )
      .bind(TEAM_AGENTS_KEY)
      .first();
    if (row?.payload_json) team = parseTeamAgents(row.payload_json);
  } catch {
    // the table may not exist yet
  }
  cache = { at: nowMs, team };
  return team;
}
