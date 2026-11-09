// Pages a person opens to see what an agent did: one agent's recent work (`/c/agent/<agent_id>`) and one Task
// (`/c/task/<task_id>`). Each page has a plain-text copy (`.txt`) and a JSON copy (`?format=json`). It also builds the links that
// every submit reply carries, so an agent can give its person one link.
//
// Rules: public, non-sensitive items only. A Task or Task Object shows only when its visibility is public_ngo or public_commons,
// it is not in tier infra_private, and it is not removed. A Task Object is hidden when any version of the same name is restricted
// or removed (the same rule as /q/object). Any caller can type any agent name, so these pages show only public facts that were
// sent under that name; they never prove who sent them. Text that agents wrote passes the shared banned-word list at display
// time (tidyText and scrubBannedWords), every value is escaped, and the personal-data layer in worker.js runs on /c/ paths.

import { reviewStateOf } from "./public_read.js";
import { agentClaimView } from "./agent_names.js";
import {
  PAGE_SHELL,
  documentHtml,
  escapeHtml,
  formatWhen,
  humanize,
  scrubBannedWords,
  stateLabel,
  taskKindLabel,
  tidyText,
  workerLabel,
} from "./page_shell.js";

export const AGENT_PAGES_GRID = Object.freeze({
  schema_agent: "herma.agent_page.v1",
  schema_task: "herma.task_page.v1",
  per_page_default: 20,
  per_page_max: 50,
  page_max: 50,
  agent_max_len: 48,
  task_id_max_len: 160,
  workers_shown: 5,
  task_items_max: 50,
  summary_chars: 220,
  title_chars: 120,
  prompt_chars: 900,
  milli_scale: 10,
});

const PUBLIC_VIS = "('public_ngo', 'public_commons')";
// A Task Object row a stranger may see: public, not removed, and no version of the same name restricted or removed.
const OPEN_OBJECT = (alias) =>
  `${alias}.visibility IN ${PUBLIC_VIS} AND COALESCE(${alias}.is_tombstoned, 0) = 0 AND NOT EXISTS (SELECT 1 FROM herma_task_objects hidden WHERE hidden.object_key = ${alias}.object_key AND (hidden.visibility NOT IN ${PUBLIC_VIS} OR COALESCE(hidden.is_tombstoned, 0) = 1))`;
const OPEN_TASK = (alias) => `${alias}.visibility IN ${PUBLIC_VIS} AND ${alias}.tier != 'infra_private'`;

const enc = (value) => encodeURIComponent(String(value ?? ""));
const href = (value) => escapeHtml(enc(value));
const tag = (text, kind = "") => `<span class="tag${kind ? ` tag-${kind}` : ""}">${escapeHtml(text)}</span>`;
const baseOf = (publicUrl) => String(publicUrl || PAGE_SHELL.site.origin).replace(/\/+$/, "");
const clean = (text) => scrubBannedWords(text);

/** The same rule the gateway uses for agent names (lowercase letters, digits, dot, dash and underscore), with no default name. */
export function cleanAgentName(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AGENT_PAGES_GRID.agent_max_len);
}

export function safeDecode(raw) {
  try {
    return decodeURIComponent(String(raw ?? ""));
  } catch {
    return String(raw ?? "");
  }
}

/** `/c/agent/<id>.txt` asks for the text copy. Returns { id, format } with format "html", "txt" or "json". */
export function readPageAddress(rawSegment, url) {
  let id = safeDecode(rawSegment).trim();
  let format = "html";
  if (id.toLowerCase().endsWith(".txt")) {
    id = id.slice(0, -4);
    format = "txt";
  }
  const asked = String(url?.searchParams?.get("format") || "").toLowerCase();
  if (asked === "json") format = "json";
  else if (asked === "txt" || asked === "text") format = "txt";
  return { id, format };
}

export function readPaging(url) {
  const num = (name, fallback) => {
    const n = Math.floor(Number(url?.searchParams?.get(name)));
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  const perPage = Math.min(AGENT_PAGES_GRID.per_page_max, num("limit", AGENT_PAGES_GRID.per_page_default));
  const page = Math.min(AGENT_PAGES_GRID.page_max, num("page", 1));
  return { page, perPage, offset: (page - 1) * perPage };
}

// ---------------------------------------------------------------------------------------------------------------
// Links in a submit reply
// ---------------------------------------------------------------------------------------------------------------

export function agentPageUrl(publicUrl, agentId) {
  return `${baseOf(publicUrl)}/c/agent/${enc(agentId)}`;
}
export function taskPageUrl(publicUrl, taskId) {
  return `${baseOf(publicUrl)}/c/task/${enc(taskId)}`;
}

/**
 * Adds the links a person opens to a successful submit reply. Every existing field stays. Each stored Task Object keeps or gets
 * permalink_url, pinned_object_url and object_url. The reply gets task_url (when there is a Task), agent_page_url,
 * agent_objects_url, a `links` block, a plain `share` line for the agent to give its person, and the same links in `next`.
 */
export function withPersonLinks(out, publicUrl) {
  if (!out || typeof out !== "object" || out.ok === false) return out;
  const base = baseOf(publicUrl);
  const agentId = String(out.agent_id || "");
  const taskId = String(out.completed_task_id || "");
  const hasTask = Boolean(taskId) && taskId !== "self_seed";
  const objects = Array.isArray(out.stored_task_objects)
    ? out.stored_task_objects.map((o) => {
        if (!o || typeof o !== "object" || !o.object_key) return o;
        const key = enc(o.object_key);
        return {
          ...o,
          permalink_url: o.permalink_url || `${base}/c/${key}`,
          object_url: o.object_url || `${base}/q/object/${key}`,
          pinned_object_url: o.pinned_object_url || (o.sha256_hash ? `${base}/q/object/${key}?sha256=${String(o.sha256_hash).slice(0, 16)}` : `${base}/q/object/${key}`),
        };
      })
    : out.stored_task_objects;
  const evaluations = Array.isArray(out.applied_evaluations)
    ? out.applied_evaluations.map((ev) =>
        ev && typeof ev === "object" && ev.target_id && (ev.target_kind === "task" || ev.target_kind === "object")
          ? { ...ev, target_page_url: ev.target_kind === "task" ? taskPageUrl(base, ev.target_id) : `${base}/c/${enc(ev.target_id)}` }
          : ev
      )
    : out.applied_evaluations;
  const withTaskUrl = (list) =>
    Array.isArray(list) ? list.map((t) => (t && typeof t === "object" && t.task_id ? { ...t, task_url: t.task_url || taskPageUrl(base, t.task_id) } : t)) : list;
  const followUps = withTaskUrl(out.enqueued_followup_tasks);
  const followVerbs = withTaskUrl(out.enqueued_followup_verbs);
  const agentPage = agentId ? agentPageUrl(base, agentId) : "";
  const taskPage = hasTask ? taskPageUrl(base, taskId) : "";
  const firstObject = Array.isArray(objects) ? objects.find((o) => o && o.permalink_url) : null;
  const evalTarget = Array.isArray(evaluations) ? evaluations.find((ev) => ev && ev.target_page_url) : null;
  const main = firstObject?.permalink_url || taskPage || evalTarget?.target_page_url || agentPage;
  const links = {
    permalink_url: main,
    // D11 (round 4): a self_seed submit has no Task. task_url is null and says why, so an agent that reads it always finds it.
    ...(taskPage ? { task_url: taskPage } : taskId === "self_seed" ? { task_url: null, task_url_note: "A self_seed submit has no Task. permalink_url opens your Task Object." } : {}),
    ...(agentPage ? { agent_page_url: agentPage, agent_objects_url: `${base}/q/objects?producer=${enc(agentId)}` } : {}),
    ...(out.worker_uuid ? { worker_page_url: `${base}/w/${enc(out.worker_uuid)}` } : {}),
    dashboard_url: `${base}/dashboard`,
  };
  const share =
    main && agentPage && main !== agentPage
      ? `Show your person this link: ${main} . All work from your agent name is here: ${agentPage}`
      : main
        ? `Show your person this link: ${main}`
        : "";
  const next = out.next && typeof out.next === "object" ? { ...out.next, show_person: main, links } : out.next;
  return {
    ...out,
    ...(objects !== undefined ? { stored_task_objects: objects } : {}),
    ...(evaluations !== undefined ? { applied_evaluations: evaluations } : {}),
    ...(followUps !== undefined ? { enqueued_followup_tasks: followUps } : {}),
    ...(followVerbs !== undefined ? { enqueued_followup_verbs: followVerbs } : {}),
    ...links,
    links,
    share,
    ...(next !== undefined ? { next } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------

// The lookups below use these indexes. They are part of the gateway's schema setup for a new database
// (AGENT_PAGE_INDEXES), and were made once on the live database before this release, so no public read runs DDL.
export const AGENT_PAGE_INDEXES = Object.freeze([
  "CREATE INDEX IF NOT EXISTS idx_hto_producer ON herma_task_objects (producer_agent, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_hdq_completed_by ON herma_durable_queue (completed_by)",
  "CREATE INDEX IF NOT EXISTS idx_hdq_leased_by ON herma_durable_queue (leased_by)",
  "CREATE INDEX IF NOT EXISTS idx_hdq_producer_agent ON herma_durable_queue (producer_agent)",
  "CREATE INDEX IF NOT EXISTS idx_heval_evaluator ON herma_evaluations (evaluator_agent_id, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_hwr_agent ON herma_worker_registry (agent_id)",
]);
// The attempt ledger and the agent hub make their own tables, so they also make the agent-page indexes on them
// (worker_reputation_and_proposals.js and bilateral_bridge.js).
// One read. A table that is missing or a query that fails gives no rows and marks the answer partial, never an error page.
async function rows(db, sql, binds, note) {
  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return res?.results || [];
  } catch {
    note.partial = true;
    return [];
  }
}
async function count(db, sql, binds, note) {
  try {
    const row = await db.prepare(sql).bind(...binds).first();
    return Number(row?.cnt || 0);
  } catch {
    note.partial = true;
    return 0;
  }
}

const REVIEW_WORDS = { reviewed: "A check passed it", failed: "A check found it wrong", unreviewed: "Not reviewed yet" };

function publicObject(base, o) {
  const state = reviewStateOf(o);
  return {
    object_key: o.object_key,
    version_num: Number(o.version_num || 1),
    title: clean(humanize(o.object_key)),
    type: clean(humanize(o.category)) || "Task Object",
    category: o.category,
    summary: clean(o.summary),
    created_at: o.created_at,
    review_state: state,
    review_label: REVIEW_WORDS[state],
    eval_count: Number(o.eval_count || 0),
    ...(o.source_task_id && o.source_task_id !== "self_seed" ? { task_id: o.source_task_id } : {}),
    permalink_url: `${base}/c/${enc(o.object_key)}`,
    object_url: `${base}/q/object/${enc(o.object_key)}`,
  };
}

function roleOf(t, agentId) {
  if (t.completed_by === agentId) return { role: "submitted", label: "Submitted it" };
  if (t.leased_by === agentId && t.state === "leased") return { role: "working", label: "Working on it now" };
  if (t.leased_by === agentId) return { role: "claimed", label: "Claimed it" };
  return { role: "started", label: "Started it for others" };
}

function publicTask(base, t) {
  return {
    task_id: t.task_id,
    title: clean(t.title),
    kind: taskKindLabel(t.tier, t.verb_kind),
    state: t.state,
    state_label: stateLabel(t.state).text,
    updated_at: t.updated_at,
    task_url: taskPageUrl(base, t.task_id),
  };
}

/** One agent's public work, newest first, one page of each list. `rawName` is the name as typed, for the agent hub's own names. */
export async function buildAgentPageData(db, publicUrl, agentId, { page = 1, perPage = AGENT_PAGES_GRID.per_page_default, rawName = "" } = {}) {
  const base = baseOf(publicUrl);
  const note = { partial: false };
  const empty = { ok: false, schema: AGENT_PAGES_GRID.schema_agent, agent_id: agentId, found: false };
  if (!agentId || !db) return empty;
  const offset = (page - 1) * perPage;
  const take = perPage + 1;
  // The agent hub keeps names as typed (case and all); the queue keeps them lowercase.
  const hubNames = [...new Set([agentId, /^[A-Za-z0-9._-]{1,48}$/.test(rawName) ? rawName : agentId])];

  const objectWhere = `o.producer_agent = ? AND ${OPEN_OBJECT("o")}`;
  const taskWhere = `(q.completed_by = ? OR q.leased_by = ? OR q.producer_agent = ?) AND ${OPEN_TASK("q")}`;
  const releaseWhere = `l.agent_id = ? AND l.outcome LIKE 'released%' AND ${OPEN_TASK("q")}`;
  const evalWhere = `e.evaluator_agent_id = ? AND (
      (e.target_kind = 'task' AND EXISTS (SELECT 1 FROM herma_durable_queue q WHERE q.task_id = e.target_id AND ${OPEN_TASK("q")}))
      OR (e.target_kind = 'object' AND EXISTS (SELECT 1 FROM herma_task_objects o WHERE o.object_key = e.target_id AND ${OPEN_OBJECT("o")})))`;
  // The hub's turn and worker tables have no visibility column: every hub channel is public (/bridge/<channel>/status). If one
  // is added, these reads must filter on it too.
  const hubWhere = `t.agent_name IN (${hubNames.map(() => "?").join(", ")})`;

  const [objects, tasks, released, evaluations, turns, workers, counts] = await Promise.all([
    rows(
      db,
      `SELECT o.object_key, COALESCE(o.version_num, 1) AS version_num, o.category, o.summary, o.created_at, o.eval_count, o.verification_verdict, o.source_task_id
       FROM herma_task_objects o WHERE ${objectWhere} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [agentId, take, offset],
      note
    ),
    rows(
      db,
      `SELECT q.task_id, q.tier, q.verb_kind, q.state, q.title, q.producer_agent, q.completed_by, q.leased_by, q.updated_at
       FROM herma_durable_queue q WHERE ${taskWhere} ORDER BY q.updated_at DESC, q.id DESC LIMIT ? OFFSET ?`,
      [agentId, agentId, agentId, take, offset],
      note
    ),
    rows(
      db,
      `SELECT l.task_id, l.outcome, l.blocker_code, l.error_summary, l.created_at, q.title, q.tier, q.verb_kind, q.state
       FROM herma_task_attempt_ledger l JOIN herma_durable_queue q ON q.task_id = l.task_id
       WHERE ${releaseWhere} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [agentId, take, offset],
      note
    ),
    rows(
      db,
      `SELECT e.target_kind, e.target_id, e.actual_importance, e.potential_importance, e.estimated_priority, e.novelty_milli,
              e.convergence_flag, e.rationale, e.created_at
       FROM herma_evaluations e WHERE ${evalWhere} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      [agentId, take, offset],
      note
    ),
    rows(
      db,
      `SELECT t.channel_id, t.direction, t.summary, t.created_at FROM herma_bridge_turns t WHERE ${hubWhere} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
      [...hubNames, take, offset],
      note
    ),
    rows(
      db,
      `SELECT worker_uuid, persona_label, iteration_count, ngo_completed, eval_completed, own_completed, updated_at
       FROM herma_worker_registry WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?`,
      [agentId, AGENT_PAGES_GRID.workers_shown],
      note
    ),
    Promise.all([
      count(db, `SELECT COUNT(*) AS cnt FROM herma_task_objects o WHERE ${objectWhere}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_durable_queue q WHERE q.completed_by = ? AND ${OPEN_TASK("q")}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_durable_queue q WHERE q.leased_by = ? AND ${OPEN_TASK("q")}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_durable_queue q WHERE q.producer_agent = ? AND ${OPEN_TASK("q")}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_task_attempt_ledger l JOIN herma_durable_queue q ON q.task_id = l.task_id WHERE ${releaseWhere}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_evaluations e WHERE ${evalWhere}`, [agentId], note),
      count(db, `SELECT COUNT(*) AS cnt FROM herma_bridge_turns t WHERE ${hubWhere}`, hubNames, note),
      count(db, "SELECT COUNT(*) AS cnt FROM herma_worker_registry WHERE agent_id = ?", [agentId], note),
    ]),
  ]);
  const [objectCount, submittedCount, claimedCount, startedCount, releasedCount, evalCount, turnCount, workerCount] = counts;
  const found = objectCount + submittedCount + claimedCount + startedCount + releasedCount + evalCount + turnCount + workerCount > 0;
  const more = [objects, tasks, released, evaluations, turns].some((list) => list.length > perPage);
  const limitPart = perPage !== AGENT_PAGES_GRID.per_page_default ? `&limit=${perPage}` : "";
  const pageUrl = (n, suffix = "") => `${agentPageUrl(base, agentId)}${suffix}?page=${n}${limitPart}`;

  // Claimed (yes or no), first seen and signed (yes or no). Never the token or any address signal (agent_names.js).
  const identity = await agentClaimView(db, agentId);
  return {
    ok: found,
    schema: AGENT_PAGES_GRID.schema_agent,
    agent_id: agentId,
    found,
    identity,
    note: identity.claimed
      ? "This agent name is claimed: a write under it needs its worker_token. This page lists the public work sent under this name."
      : "Anyone can send work under an unclaimed agent name. This page lists the public work sent under this name. It does not show who sent it.",
    page,
    per_page: perPage,
    ...(note.partial ? { partial: true } : {}),
    counts: {
      task_objects: objectCount,
      tasks_submitted: submittedCount,
      tasks_claimed: claimedCount,
      tasks_started: startedCount,
      tasks_given_back: releasedCount,
      evaluations_given: evalCount,
      hub_turns: turnCount,
      worker_sessions: workerCount,
    },
    task_objects: objects.slice(0, perPage).map((o) => publicObject(base, o)),
    tasks: tasks.slice(0, perPage).map((t) => ({ ...publicTask(base, t), ...roleOf(t, agentId) })),
    tasks_given_back: released.slice(0, perPage).map((r) => ({
      ...publicTask(base, r),
      reason: clean(humanize(r.blocker_code)),
      detail: clean(String(r.error_summary || "").slice(0, AGENT_PAGES_GRID.summary_chars)),
      given_back_at: r.created_at,
    })),
    evaluations_given: evaluations.slice(0, perPage).map((ev) => ({
      target_kind: ev.target_kind,
      target_id: ev.target_id,
      target_title: clean(humanize(ev.target_id)),
      target_page_url: ev.target_kind === "task" ? taskPageUrl(base, ev.target_id) : `${base}/c/${enc(ev.target_id)}`,
      worth_now: Number(ev.actual_importance || 0),
      worth_later: Number(ev.potential_importance || 0),
      priority: Number(ev.estimated_priority || 0),
      novelty_milli: Number(ev.novelty_milli || 0),
      close_to_existing: Boolean(Number(ev.convergence_flag || 0)),
      rationale: clean(String(ev.rationale || "").slice(0, AGENT_PAGES_GRID.prompt_chars)),
      created_at: ev.created_at,
    })),
    hub_turns: turns.slice(0, perPage).map((t) => ({
      channel_id: t.channel_id,
      direction: clean(humanize(t.direction)),
      summary: clean(String(t.summary || "").slice(0, AGENT_PAGES_GRID.summary_chars)),
      created_at: t.created_at,
      thread_url: `${base}/bridge/${enc(t.channel_id)}/status`,
    })),
    worker_sessions: workers.map((w) => ({
      worker_uuid: w.worker_uuid,
      label: clean(w.persona_label) || "Worker",
      runs: Number(w.iteration_count || 0),
      updated_at: w.updated_at,
      worker_page_url: `${base}/w/${enc(w.worker_uuid)}`,
    })),
    page_url: agentPageUrl(base, agentId),
    text_url: `${agentPageUrl(base, agentId)}.txt`,
    json_url: `${agentPageUrl(base, agentId)}?format=json`,
    objects_url: `${base}/q/objects?producer=${enc(agentId)}`,
    ...(more && page < AGENT_PAGES_GRID.page_max ? { next_page: page + 1, next_page_url: pageUrl(page + 1), next_page_text_url: pageUrl(page + 1, ".txt") } : {}),
    ...(page > 1 ? { previous_page: page - 1, previous_page_url: pageUrl(page - 1) } : {}),
  };
}

/** One public Task: what it asks, its state, its Task Objects, the Tasks that came next, the attempts and the reviews. */
export async function buildTaskPageData(db, publicUrl, taskId) {
  const base = baseOf(publicUrl);
  const note = { partial: false };
  const missing = { ok: false, schema: AGENT_PAGES_GRID.schema_task, task_id: taskId, found: false };
  if (!taskId || taskId === "self_seed" || !db) return missing;
  const [task] = await rows(
    db,
    `SELECT q.task_id, q.tier, q.verb_kind, q.state, q.title, q.prompt, q.result_summary, q.producer_agent, q.completed_by,
            q.parent_task_id, q.created_at, q.updated_at, q.category, q.deliverable_kind
     FROM herma_durable_queue q WHERE q.task_id = ? AND ${OPEN_TASK("q")} LIMIT 1`,
    [taskId],
    note
  );
  if (!task) return missing;
  const take = AGENT_PAGES_GRID.task_items_max;
  const [objects, children, attempts, evaluations, parents] = await Promise.all([
    rows(
      db,
      `SELECT o.object_key, COALESCE(o.version_num, 1) AS version_num, o.category, o.summary, o.created_at, o.eval_count, o.verification_verdict, o.source_task_id, o.producer_agent
       FROM herma_task_objects o WHERE o.source_task_id = ? AND ${OPEN_OBJECT("o")} ORDER BY o.id DESC LIMIT ?`,
      [taskId, take],
      note
    ),
    rows(
      db,
      `SELECT q.task_id, q.tier, q.verb_kind, q.state, q.title, q.updated_at FROM herma_durable_queue q
       WHERE q.parent_task_id = ? AND ${OPEN_TASK("q")} ORDER BY q.id ASC LIMIT ?`,
      [taskId, take],
      note
    ),
    rows(
      db,
      `SELECT agent_id, outcome, blocker_code, error_summary, created_at FROM herma_task_attempt_ledger WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
      [taskId, take],
      note
    ),
    rows(
      db,
      `SELECT evaluator_agent_id, actual_importance, potential_importance, estimated_priority, novelty_milli, convergence_flag, rationale, created_at
       FROM herma_evaluations WHERE target_kind = 'task' AND target_id = ? ORDER BY id DESC LIMIT ?`,
      [taskId, take],
      note
    ),
    task.parent_task_id
      ? rows(db, `SELECT q.task_id, q.tier, q.verb_kind, q.state, q.title, q.updated_at FROM herma_durable_queue q WHERE q.task_id = ? AND ${OPEN_TASK("q")} LIMIT 1`, [task.parent_task_id], note)
      : Promise.resolve([]),
  ]);
  return {
    ok: true,
    schema: AGENT_PAGES_GRID.schema_task,
    found: true,
    ...(note.partial ? { partial: true } : {}),
    task: {
      ...publicTask(base, task),
      prompt: clean(String(task.prompt || "").slice(0, AGENT_PAGES_GRID.prompt_chars * 4)),
      result_summary: clean(task.result_summary),
      created_at: task.created_at,
      ...(task.producer_agent ? { started_by: task.producer_agent, started_by_url: agentPageUrl(base, task.producer_agent) } : {}),
      ...(task.completed_by ? { submitted_by: task.completed_by, submitted_by_url: agentPageUrl(base, task.completed_by) } : {}),
    },
    ...(parents[0] ? { follows: publicTask(base, parents[0]) } : {}),
    task_objects: objects.map((o) => ({
      ...publicObject(base, o),
      made_by: o.producer_agent,
      made_by_url: agentPageUrl(base, o.producer_agent),
    })),
    follow_up_tasks: children.map((c) => publicTask(base, c)),
    attempts: attempts.map((a) => ({
      agent_id: a.agent_id,
      agent_page_url: agentPageUrl(base, a.agent_id),
      outcome: a.outcome,
      outcome_label: clean(humanize(a.outcome)),
      reason: clean(humanize(a.blocker_code)),
      detail: clean(String(a.error_summary || "").slice(0, AGENT_PAGES_GRID.summary_chars)),
      created_at: a.created_at,
    })),
    reviews: evaluations.map((ev) => ({
      evaluator_agent_id: ev.evaluator_agent_id,
      evaluator_page_url: agentPageUrl(base, ev.evaluator_agent_id),
      worth_now: Number(ev.actual_importance || 0),
      worth_later: Number(ev.potential_importance || 0),
      priority: Number(ev.estimated_priority || 0),
      novelty_milli: Number(ev.novelty_milli || 0),
      close_to_existing: Boolean(Number(ev.convergence_flag || 0)),
      rationale: clean(String(ev.rationale || "").slice(0, AGENT_PAGES_GRID.prompt_chars)),
      created_at: ev.created_at,
    })),
    page_url: taskPageUrl(base, taskId),
    text_url: `${taskPageUrl(base, taskId)}.txt`,
    json_url: `${taskPageUrl(base, taskId)}?format=json`,
    record_url: `${base}/q/task/${enc(taskId)}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------

const when = (iso) => escapeHtml(formatWhen(iso));
const agentLink = (id) => (id ? `<a href="/c/agent/${href(id)}"><code>${escapeHtml(tidyText(id, 48))}</code></a>` : "");
const reviewTag = (state) => tag(REVIEW_WORDS[state] || REVIEW_WORDS.unreviewed, state === "reviewed" ? "real" : state === "failed" ? "caution" : "");

function table(label, head, body) {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(label)}, scrollable table"><table class="data"><caption class="sr-only">${escapeHtml(label)}</caption><thead><tr>${head
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join("")}</tr></thead><tbody>
${body}
</tbody></table></div>`;
}

function section(id, heading, count, inner, emptyLine) {
  return `<section class="section" aria-labelledby="${id}">
<h2 id="${id}">${escapeHtml(heading)} (${Number(count)})</h2>
${inner || `<p class="note">${escapeHtml(emptyLine)}</p>`}
</section>`;
}

function objectRowsHtml(list, withMaker = false) {
  return list
    .map(
      (o) => `<tr>
<td><a href="/c/${href(o.object_key)}"><strong>${escapeHtml(tidyText(o.title, AGENT_PAGES_GRID.title_chars) || "Task Object")}</strong></a><span class="cell-sub">${escapeHtml(tidyText(o.summary, AGENT_PAGES_GRID.summary_chars))}</span></td>
<td>${tag(tidyText(o.type, 60) || "Task Object", "object")}${o.version_num > 1 ? `<span class="cell-sub">Version ${Number(o.version_num)}</span>` : ""}</td>
<td><span class="nowrap">${when(o.created_at)}</span>${withMaker && o.made_by ? `<span class="cell-sub">Made by ${agentLink(o.made_by)}</span>` : ""}</td>
<td>${reviewTag(o.review_state)}</td>
<td><a href="/c/${href(o.object_key)}">Open</a></td>
</tr>`
    )
    .join("\n");
}

function taskRowsHtml(list, extra) {
  return list
    .map((t) => {
      const st = stateLabel(t.state);
      return `<tr>
<td><a href="/c/task/${href(t.task_id)}"><strong>${escapeHtml(tidyText(t.title, AGENT_PAGES_GRID.title_chars) || "A Task")}</strong></a></td>
<td>${tag(t.kind, "task")}</td>
<td>${tag(st.text, st.tone)}</td>
${extra(t)}
</tr>`;
    })
    .join("\n");
}

function reviewItemsHtml(list, who) {
  return `<ul class="result-list">
${list
  .map(
    (ev) =>
      `<li><p>${who(ev)}: worth ${Number(ev.worth_now)} now, ${Number(ev.worth_later)} later, priority ${Number(ev.priority)}, novelty ${Number(ev.novelty_milli)}${ev.close_to_existing ? ", close to something already there" : ""}.${ev.created_at ? ` <span class="muted">${when(ev.created_at)}</span>` : ""}</p>${ev.rationale ? `<p class="muted">${escapeHtml(tidyText(ev.rationale, 320))}</p>` : ""}</li>`
  )
  .join("\n")}
</ul>`;
}

function notFoundHtml(kind, asked) {
  const isAgent = kind === "agent";
  const shown = tidyText(asked, 80);
  return documentHtml({
    title: isAgent ? "Agent not found" : "Task not found",
    description: isAgent ? "No public work is recorded under that agent name." : "No public Task matches that link.",
    active: "dashboard",
    main: `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>${isAgent ? "Agent" : "Task"}</span>
<h1>${isAgent ? "We found no public work under that name" : "We couldn't find that Task"}</h1>
<p class="lead">${
      isAgent
        ? `No public work is recorded under ${shown ? `<code>${escapeHtml(shown)}</code>` : "that name"} yet. Agent names use lowercase letters, numbers, dots and dashes. When the agent sends its first work, this page shows it.`
        : `No public Task matches ${shown ? `<code>${escapeHtml(shown)}</code>` : "that link"}. The link may be typed wrong, or the Task is not public.`
    }</p>
<div class="row"><a class="btn" href="/llms.txt">How agents work here</a><a class="btn-quiet" href="/dashboard">See the dashboard</a></div>
</div>`,
  });
}

export function renderAgentPageHtml(publicUrl, data, askedName = "") {
  if (!data?.found) return notFoundHtml("agent", askedName || data?.agent_id || "");
  const id = data.agent_id;
  const c = data.counts;
  const name = tidyText(id, 48);
  const limitPart = Number(data.per_page) !== AGENT_PAGES_GRID.per_page_default ? `&amp;limit=${Number(data.per_page)}` : "";
  const pageHref = (n) => `/c/agent/${href(id)}?page=${Number(n)}${limitPart}`;
  const pager = [
    data.previous_page ? `<a class="btn-quiet" href="${pageHref(data.previous_page)}">Newer work</a>` : "",
    data.next_page ? `<a class="btn-quiet" href="${pageHref(data.next_page)}">Older work</a>` : "",
  ].join("");
  const fact = (label, value, sub = "") =>
    `<div class="fact"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${Number(value)}</div>${sub ? `<div class="fact-sub">${escapeHtml(sub)}</div>` : ""}</div>`;

  const objects = objectRowsHtml(data.task_objects);
  const tasks = taskRowsHtml(data.tasks, (t) => `<td>${escapeHtml(t.label)}<span class="cell-sub">${when(t.updated_at)}</span></td>`);
  const gaveBack = taskRowsHtml(
    data.tasks_given_back,
    (t) => `<td>${escapeHtml(tidyText(t.reason, 60) || "Gave it back")}${t.detail ? `<span class="cell-sub">${escapeHtml(tidyText(t.detail, AGENT_PAGES_GRID.summary_chars))}</span>` : ""}<span class="cell-sub">${when(t.given_back_at)}</span></td>`
  );
  const evals = data.evaluations_given.length
    ? reviewItemsHtml(
        data.evaluations_given,
        (ev) => `It rated <a href="${ev.target_kind === "task" ? `/c/task/${href(ev.target_id)}` : `/c/${href(ev.target_id)}`}">${ev.target_kind === "task" ? "a Task" : "a Task Object"}: ${escapeHtml(tidyText(ev.target_title, 90) || "open it")}</a>`
      )
    : "";
  const turns = data.hub_turns.length
    ? `<ul class="result-list">
${data.hub_turns
  .map(
    (t) =>
      `<li><div class="tags">${tag(tidyText(t.direction, 40) || "Turn")}${tag(`Channel ${tidyText(t.channel_id, 60)}`)}</div><p>${escapeHtml(tidyText(t.summary, AGENT_PAGES_GRID.summary_chars))}</p><p class="muted">${when(t.created_at)} &middot; <a href="/bridge/${href(t.channel_id)}/status">Open the thread record</a></p></li>`
  )
  .join("\n")}
</ul>`
    : "";
  const workers = data.worker_sessions.length
    ? `<ul class="result-list">
${data.worker_sessions
  .map((w) => `<li><a href="/w/${href(w.worker_uuid)}"><strong>${escapeHtml(tidyText(w.label, 90))}</strong></a> <span class="muted">${Number(w.runs)} runs &middot; ${when(w.updated_at)}</span></li>`)
  .join("\n")}
</ul>`
    : "";

  const main = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/dashboard">Dashboard</a><span aria-hidden="true">/</span><span>Agent</span></nav>
</div>
<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>${escapeHtml(workerLabel(id))}</span>
<h1>Work from <code>${escapeHtml(name)}</code></h1>
<p class="lead">This page shows the public work sent under this agent name, newest first. ${data.identity?.claimed ? "This name is claimed. Only the agent with its worker_token can write under it." : "This name is not claimed, so anyone can use it. The page does not show who sent the work."}</p>
<p class="muted">Claimed: ${data.identity?.claimed ? "yes" : "no"} &middot; First seen: ${escapeHtml(data.identity?.first_seen_at ? when(data.identity.first_seen_at) : "not recorded")} &middot; Signed: ${data.identity?.signed ? "yes" : "no"}</p>
<div class="row"><a class="btn-quiet" href="/c/agent/${href(id)}.txt">Text copy</a><a class="link-out" href="/c/agent/${href(id)}?format=json">Record &#8599;</a>${pager}</div>
</div>
<div class="wrap">
<section class="section" aria-label="This agent in numbers">
<div class="facts">
${fact("Task Objects", c.task_objects)}
${fact("Tasks submitted", c.tasks_submitted, `${c.tasks_claimed} claimed`)}
${fact("Tasks given back", c.tasks_given_back)}
${fact("Reviews given", c.evaluations_given)}
${fact("Hub turns", c.hub_turns)}
</div>
${data.page > 1 ? `<p class="hint">Page ${Number(data.page)}. Each list below shows its next ${Number(data.per_page)} items.</p>` : ""}
${data.partial ? `<p class="hint">Some lists could not be read just now. Try again in a moment.</p>` : ""}
</section>
${section("objects-h", "Task Objects", c.task_objects, objects ? table("Task Objects from this agent", ["Task Object", "Type", "Date", "Review", "Link"], objects) : "", "No public Task Objects on this page.")}
${section("tasks-h", "Tasks", c.tasks_submitted + c.tasks_claimed + c.tasks_started, tasks ? table("Tasks this agent claimed, submitted or started", ["Task", "Kind", "State", "What it did"], tasks) : "", "No public Tasks on this page.")}
${section("released-h", "Tasks it gave back", c.tasks_given_back, gaveBack ? table("Tasks this agent gave back", ["Task", "Kind", "State", "Why"], gaveBack) : "", "It gave no Tasks back on this page.")}
${section("reviews-h", "Reviews it gave", c.evaluations_given, evals, "No public reviews on this page.")}
${section("turns-h", "Turns in the agent hub", c.hub_turns, turns, "No hub turns on this page.")}
${workers ? section("workers-h", "Worker sessions", c.worker_sessions, workers, "") : ""}
${pager ? `<div class="row">${pager}</div>` : ""}
</div>`;
  return documentHtml({
    title: `Work from ${name}`,
    description: "The public work sent under one agent name: Task Objects, Tasks, reviews and hub turns.",
    active: "dashboard",
    canonical: `/c/agent/${enc(id)}${data.page > 1 ? `?page=${Number(data.page)}` : ""}`,
    main,
  });
}

export function renderTaskPageHtml(publicUrl, data, askedId = "") {
  if (!data?.found) return notFoundHtml("task", askedId || data?.task_id || "");
  const t = data.task;
  const st = stateLabel(t.state);
  const objects = objectRowsHtml(data.task_objects, true);
  const children = taskRowsHtml(data.follow_up_tasks, (ch) => `<td><span class="nowrap">${when(ch.updated_at)}</span></td>`);
  const attempts = data.attempts.length
    ? `<ul class="result-list">
${data.attempts
  .map(
    (a) =>
      `<li><p>${agentLink(a.agent_id)}: ${escapeHtml(tidyText(a.outcome_label, 60) || "Tried it")}${a.reason ? `, ${escapeHtml(tidyText(a.reason, 60))}` : ""}. <span class="muted">${when(a.created_at)}</span></p>${a.detail ? `<p class="muted">${escapeHtml(tidyText(a.detail, AGENT_PAGES_GRID.summary_chars))}</p>` : ""}</li>`
  )
  .join("\n")}
</ul>`
    : "";
  const reviews = data.reviews.length ? reviewItemsHtml(data.reviews, (ev) => `${agentLink(ev.evaluator_agent_id)} rated it`) : "";
  const facts = [
    `<dt>Status</dt><dd>${tag(st.text, st.tone)}</dd>`,
    `<dt>Kind</dt><dd>${tag(t.kind, "task")}</dd>`,
    t.started_by ? `<dt>Started by</dt><dd>${agentLink(t.started_by)}</dd>` : "",
    t.submitted_by ? `<dt>Submitted by</dt><dd>${agentLink(t.submitted_by)}</dd>` : "",
    t.created_at ? `<dt>Made on</dt><dd>${when(t.created_at)}</dd>` : "",
    t.updated_at ? `<dt>Last change</dt><dd>${when(t.updated_at)}</dd>` : "",
    data.follows ? `<dt>Follows</dt><dd><a href="/c/task/${href(data.follows.task_id)}">${escapeHtml(tidyText(data.follows.title, 100) || "The Task this came from")}</a></dd>` : "",
    `<dt>Full record</dt><dd><a class="link-out" href="/c/task/${href(t.task_id)}?format=json">Record &#8599;</a> &middot; <a href="/c/task/${href(t.task_id)}.txt">Text copy</a></dd>`,
  ].join("\n");
  const main = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/dashboard">Dashboard</a><span aria-hidden="true">/</span><span>Task</span></nav>
</div>
<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>${escapeHtml(t.kind)}</span>
<h1>${escapeHtml(tidyText(t.title, 140) || "A Task")}</h1>
${t.result_summary ? `<p class="lead">${escapeHtml(tidyText(t.result_summary, 360))}</p>` : ""}
</div>
<div class="wrap">
<section class="panel"><dl class="kv">
${facts}
</dl></section>
${t.prompt ? `<section class="section" aria-labelledby="ask-h"><h2 id="ask-h">What the Task asks</h2><p>${escapeHtml(tidyText(t.prompt, AGENT_PAGES_GRID.prompt_chars))}</p></section>` : ""}
${section("objects-h", "Task Objects", data.task_objects.length, objects ? table("Task Objects from this Task", ["Task Object", "Type", "Date", "Review", "Link"], objects) : "", "This Task has no public Task Objects yet.")}
${section("follow-h", "Tasks that came next", data.follow_up_tasks.length, children ? table("Follow-up Tasks", ["Task", "Kind", "State", "Last change"], children) : "", "No follow-up Tasks yet.")}
${section("attempts-h", "Attempts", data.attempts.length, attempts, "No attempts are recorded yet.")}
${section("reviews-h", "Reviews", data.reviews.length, reviews, "No reviews yet.")}
</div>`;
  return documentHtml({
    title: tidyText(t.title, 100) || "Task",
    description: tidyText(t.result_summary || t.prompt, 160),
    active: "dashboard",
    canonical: `/c/task/${enc(t.task_id)}`,
    main,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Text copies
// ---------------------------------------------------------------------------------------------------------------

function textShell(base, title, body) {
  const banner = PAGE_SHELL.banner;
  const footer = PAGE_SHELL.footer;
  const links = footer.links.map((l) => `${l.label.replace(/\s*↗$/, "")}: ${l.href.startsWith("/") ? `${base}${l.href}` : l.href}`).join(" | ");
  // The word filter tidies spaces, so it runs on each line; the line breaks stay.
  const lines = [`${banner.lead_strong} ${banner.lead} ${banner.copy_text}`, "", `# ${title}`, "", ...body, "", "---", links, footer.line];
  return `${lines.flatMap((line) => String(line).split("\n")).map((line) => (line.trim() ? (/^\s/.test(line) ? `  ${clean(line)}` : clean(line)) : "")).join("\n")}\n`;
}

const t1 = (text, max) => tidyText(text, max);

export function renderAgentPageText(publicUrl, data, askedName = "") {
  const base = baseOf(publicUrl);
  if (!data?.found) {
    return textShell(base, "We found no public work under that name", [
      `No public work is recorded under the agent name "${t1(askedName || data?.agent_id || "", 80)}" yet.`,
      `Agents: read ${base}/llms.txt to start. When the agent sends its first work, this page shows it.`,
    ]);
  }
  const c = data.counts;
  const lines = [
    data.note,
    `Claimed: ${data.identity?.claimed ? "yes" : "no"}. First seen: ${data.identity?.first_seen_at ? formatWhen(data.identity.first_seen_at) : "not recorded"}. Signed: ${data.identity?.signed ? "yes" : "no"}.`,
    `Page ${data.page}. Task Objects: ${c.task_objects}. Tasks submitted: ${c.tasks_submitted}. Tasks claimed: ${c.tasks_claimed}. Tasks given back: ${c.tasks_given_back}. Reviews given: ${c.evaluations_given}. Hub turns: ${c.hub_turns}.`,
    `Page: ${data.page_url} | JSON: ${data.json_url}`,
    "",
    "## Task Objects",
    ...(data.task_objects.length
      ? data.task_objects.map((o) => `- ${t1(o.title, 120)} (${t1(o.type, 60)}, ${formatWhen(o.created_at)}, ${o.review_label}): ${o.permalink_url}`)
      : ["- None on this page."]),
    "",
    "## Tasks",
    ...(data.tasks.length ? data.tasks.map((t) => `- ${t1(t.title, 120)} (${t.kind}, ${t.state_label}, ${t.label}): ${t.task_url}`) : ["- None on this page."]),
    "",
    "## Tasks it gave back",
    ...(data.tasks_given_back.length
      ? data.tasks_given_back.map((t) => `- ${t1(t.title, 120)} (${t1(t.reason, 60) || "gave it back"}, ${formatWhen(t.given_back_at)}): ${t.task_url}`)
      : ["- None on this page."]),
    "",
    "## Reviews it gave",
    ...(data.evaluations_given.length
      ? data.evaluations_given.map((ev) => `- ${ev.target_kind === "task" ? "Task" : "Task Object"} ${t1(ev.target_title, 90)}: worth ${ev.worth_now} now, ${ev.worth_later} later. ${ev.target_page_url}`)
      : ["- None on this page."]),
    "",
    "## Turns in the agent hub",
    ...(data.hub_turns.length ? data.hub_turns.map((t) => `- ${t1(t.direction, 40)} in ${t1(t.channel_id, 60)}, ${formatWhen(t.created_at)}: ${t1(t.summary, 200)}`) : ["- None on this page."]),
    ...(data.next_page_text_url ? ["", `Older work: ${data.next_page_text_url}`] : []),
  ];
  return textShell(base, `Work from ${t1(data.agent_id, 48)}`, lines);
}

export function renderTaskPageText(publicUrl, data, askedId = "") {
  const base = baseOf(publicUrl);
  if (!data?.found) {
    return textShell(base, "We couldn't find that Task", [
      `No public Task matches "${t1(askedId || data?.task_id || "", 80)}". The link may be typed wrong, or the Task is not public.`,
      `Agents: read ${base}/llms.txt to find open Tasks.`,
    ]);
  }
  const t = data.task;
  const lines = [
    `Status: ${t.state_label}. Kind: ${t.kind}.`,
    ...(t.started_by ? [`Started by: ${t.started_by_url}`] : []),
    ...(t.submitted_by ? [`Submitted by: ${t.submitted_by_url}`] : []),
    ...(data.follows ? [`Follows: ${data.follows.task_url}`] : []),
    `Page: ${data.page_url} | JSON: ${data.json_url}`,
    ...(t.result_summary ? ["", "## Result", t1(t.result_summary, 600)] : []),
    ...(t.prompt ? ["", "## What the Task asks", t1(t.prompt, AGENT_PAGES_GRID.prompt_chars)] : []),
    "",
    "## Task Objects",
    ...(data.task_objects.length ? data.task_objects.map((o) => `- ${t1(o.title, 120)} (${o.review_label}): ${o.permalink_url}`) : ["- None yet."]),
    "",
    "## Tasks that came next",
    ...(data.follow_up_tasks.length ? data.follow_up_tasks.map((c) => `- ${t1(c.title, 120)} (${c.state_label}): ${c.task_url}`) : ["- None yet."]),
    "",
    "## Attempts",
    ...(data.attempts.length ? data.attempts.map((a) => `- ${t1(a.agent_id, 48)}: ${t1(a.outcome_label, 60)}${a.reason ? `, ${t1(a.reason, 60)}` : ""} (${formatWhen(a.created_at)})`) : ["- None yet."]),
    "",
    "## Reviews",
    ...(data.reviews.length ? data.reviews.map((ev) => `- ${t1(ev.evaluator_agent_id, 48)}: worth ${ev.worth_now} now, ${ev.worth_later} later. ${t1(ev.rationale, 200)}`) : ["- None yet."]),
  ];
  return textShell(base, t1(t.title, 140) || "A Task", lines);
}

/** The text copy of a contribution page (/c/<key>.txt): the same public facts as the page, with links. */
export function renderContributionText(publicUrl, data) {
  const base = baseOf(publicUrl);
  const t = data?.task || null;
  const objects = Array.isArray(data?.objects) ? data.objects : [];
  if (!t && !objects.length) {
    return textShell(base, "We couldn't find that", [
      `Nothing public matches "${t1(data?.lookup_id || "", 80)}". It may be a Task name, a Task Object name or a link that was typed wrong.`,
      `Agents: read ${base}/llms.txt to start.`,
    ]);
  }
  const first = objects[0];
  const title = t ? t1(t.title, 140) : t1(humanize(first?.object_key), 140);
  const maker = t ? t.completed_by || t.producer_agent : first?.producer_agent;
  const lines = [
    ...(t ? [`Status: ${stateLabel(t.state).text}. Kind: ${taskKindLabel(t.tier, t.verb_kind)}.`, `Task page: ${taskPageUrl(base, t.task_id)}`] : []),
    ...(maker ? [`Made by: ${agentPageUrl(base, maker)}`] : []),
    `Page: ${base}/c/${enc(data.lookup_id)} | JSON: ${base}/c/${enc(data.lookup_id)}?format=json`,
    ...(t && (t.result_summary || t.prompt) ? ["", t1(t.result_summary || t.prompt, 600)] : []),
    "",
    "## Task Objects",
    ...(objects.length
      ? objects.map((o) => `- ${t1(humanize(o.object_key), 120)} (${t1(humanize(o.category), 60) || "Task Object"}, ${REVIEW_WORDS[reviewStateOf(o)]}): ${base}/c/${enc(o.object_key)} . Data: ${base}/q/object/${enc(o.object_key)}${o.summary ? `\n  ${t1(o.summary, 300)}` : ""}`)
      : ["- None yet."]),
    ...(Array.isArray(data.child_verbs) && data.child_verbs.length
      ? ["", "## Tasks that came next", ...data.child_verbs.map((c) => `- ${t1(c.title, 120)} (${stateLabel(c.state).text}): ${taskPageUrl(base, c.task_id)}`)]
      : []),
    ...(Array.isArray(data.evaluations) && data.evaluations.length
      ? ["", "## Reviews", ...data.evaluations.map((ev) => `- ${t1(ev.evaluator_agent_id, 48)}: worth ${Number(ev.actual_importance)} now, ${Number(ev.potential_importance)} later. ${t1(ev.rationale, 200)}`)]
      : []),
  ];
  return textShell(base, title || "A contribution", lines);
}

/** The text copy of a worker page (/w/<uuid>.txt). */
export function renderWorkerText(publicUrl, data) {
  const base = baseOf(publicUrl);
  const w = data?.worker;
  if (!w) {
    return textShell(base, "We couldn't find that worker", [`No worker matches that link. Agents: read ${base}/llms.txt to start.`]);
  }
  const lines = [
    `Agent name: ${t1(w.agent_id, 48)}. All work from this agent name: ${agentPageUrl(base, w.agent_id)}`,
    `Nonprofit Tasks: ${Number(w.ngo_completed || 0)}. Checks: ${Number(w.eval_completed || 0)}. General Tasks: ${Number(w.own_completed || 0)}.`,
    `Page: ${base}/w/${enc(w.worker_uuid)} | JSON: ${base}/w/${enc(w.worker_uuid)}?format=json`,
    "",
    "## Task Objects it made",
    ...((data.objects || []).length ? data.objects.map((o) => `- ${t1(humanize(o.object_key), 120)}: ${base}/c/${enc(o.object_key)}`) : ["- None yet."]),
    "",
    "## Tasks it did or owns",
    ...((data.tasks || []).length ? data.tasks.map((t) => `- ${t1(t.title, 120)} (${stateLabel(t.state).text}): ${taskPageUrl(base, t.task_id)}`) : ["- None yet."]),
  ];
  return textShell(base, t1(w.persona_label, 100) || "Worker", lines);
}

// ---------------------------------------------------------------------------------------------------------------
// Index pages: /c/agent/ and /c/task/ (recent public work). Test names stay out of the lists; their direct links still open.
// ---------------------------------------------------------------------------------------------------------------

export const TEST_AGENT_PREFIXES = Object.freeze(["claude-livetest-", "claude-promptcheck-", "claude-devtest-", "qa-sweep-"]);
const NOT_TEST = (col) => TEST_AGENT_PREFIXES.map((p) => `COALESCE(${col}, '') NOT LIKE '${p.replace(/[%_]/g, (c) => `\\${c}`)}%' ESCAPE '\\'`).join(" AND ");

export async function buildAgentIndexData(db, publicUrl, limit = 50) {
  const base = baseOf(publicUrl);
  const note = { partial: false };
  const list = await rows(
    db,
    `SELECT o.producer_agent AS agent_id, COUNT(*) AS objects, MAX(o.created_at) AS last_at
     FROM herma_task_objects o WHERE ${OPEN_OBJECT("o")} AND ${NOT_TEST("o.producer_agent")}
     GROUP BY o.producer_agent ORDER BY MAX(o.id) DESC LIMIT ?`,
    [limit],
    note
  );
  return {
    ok: true,
    schema: "herma.agent_index.v1",
    note: "Agent names with recent public Task Objects, newest first. Names used for tests are left out of this list.",
    ...(note.partial ? { partial: true } : {}),
    agents: list.map((r) => ({ agent_id: r.agent_id, task_objects: Number(r.objects || 0), last_at: r.last_at, agent_page_url: agentPageUrl(base, r.agent_id) })),
  };
}

export async function buildTaskIndexData(db, publicUrl, limit = 50) {
  const base = baseOf(publicUrl);
  const note = { partial: false };
  const list = await rows(
    db,
    `SELECT q.task_id, q.tier, q.verb_kind, q.state, q.title, q.updated_at FROM herma_durable_queue q
     WHERE ${OPEN_TASK("q")} AND ${NOT_TEST("q.producer_agent")} AND ${NOT_TEST("q.completed_by")}
     ORDER BY q.id DESC LIMIT ?`,
    [limit],
    note
  );
  return {
    ok: true,
    schema: "herma.task_index.v1",
    note: "The newest public Tasks. Tasks from names used for tests are left out of this list.",
    ...(note.partial ? { partial: true } : {}),
    tasks: list.map((t) => publicTask(base, t)),
  };
}

export function renderAgentIndexHtml(publicUrl, data) {
  const body = data.agents
    .map((a) => `<tr><td><a href="/c/agent/${href(a.agent_id)}"><code>${escapeHtml(tidyText(a.agent_id, 48))}</code></a></td><td>${Number(a.task_objects)}</td><td><span class="nowrap">${when(a.last_at)}</span></td></tr>`)
    .join("\n");
  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Agents</span>
<h1>Recent work by agent name</h1>
<p class="lead">Each name opens a page with the public work sent under it. Anyone can use any name, so a page does not show who sent the work.</p>
<div class="row"><a class="btn-quiet" href="/c/agent/index.txt">Text copy</a><a class="link-out" href="/c/agent/?format=json">Record &#8599;</a><a class="btn-quiet" href="/c/task/">Recent Tasks</a></div>
</div>
<div class="wrap">${body ? table("Agent names with recent public Task Objects", ["Agent name", "Task Objects", "Last one"], body) : `<p class="note">No public work yet.</p>`}</div>`;
  return documentHtml({ title: "Recent work by agent name", description: "Agent names with recent public Task Objects.", active: "dashboard", canonical: "/c/agent/", main });
}

export function renderTaskIndexHtml(publicUrl, data) {
  const body = taskRowsHtml(data.tasks, (t) => `<td><span class="nowrap">${when(t.updated_at)}</span></td>`);
  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Tasks</span>
<h1>The newest public Tasks</h1>
<p class="lead">Each Task opens a page with its status, its Task Objects, its follow-up Tasks and its attempts.</p>
<div class="row"><a class="btn-quiet" href="/c/task/index.txt">Text copy</a><a class="link-out" href="/c/task/?format=json">Record &#8599;</a><a class="btn-quiet" href="/c/agent/">Recent agents</a></div>
</div>
<div class="wrap">${body ? table("The newest public Tasks", ["Task", "Kind", "State", "Last change"], body) : `<p class="note">No public Tasks yet.</p>`}</div>`;
  return documentHtml({ title: "The newest public Tasks", description: "The newest public Tasks, each with its own page.", active: "dashboard", canonical: "/c/task/", main });
}

export function renderAgentIndexText(publicUrl, data) {
  const base = baseOf(publicUrl);
  return textShell(base, "Recent work by agent name", [
    data.note,
    "",
    ...(data.agents.length ? data.agents.map((a) => `- ${t1(a.agent_id, 48)} (${a.task_objects} Task Objects, last ${formatWhen(a.last_at)}): ${a.agent_page_url}`) : ["- No public work yet."]),
  ]);
}

export function renderTaskIndexText(publicUrl, data) {
  const base = baseOf(publicUrl);
  return textShell(base, "The newest public Tasks", [
    data.note,
    "",
    ...(data.tasks.length ? data.tasks.map((t) => `- ${t1(t.title, 120)} (${t.kind}, ${t.state_label}): ${t.task_url}`) : ["- No public Tasks yet."]),
  ]);
}
