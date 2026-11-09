// What should a worker do now? Machine-readable `next` fields on queue replies, GET /q/next, and the reasons a claim got no lease.
// Measured on real bots, Nov 4: /q/tasks lists Tasks a plain claim refuses for field work, and the refusal gave no reason, so bots probed
// up to 8 calls; a few Tasks needing people trapped worker after worker. Read-only: nothing here leases, writes or runs anything.
import { readSeenItemSet } from "./durable_session_and_dag.js";
import { makerConflictIds } from "./producer_guard.js";

export const DISPATCH_REGIME = Object.freeze({
  default_tier_order: Object.freeze(["public_general", "ngo_priority"]),
  ngo_first_tier_order: Object.freeze(["ngo_priority", "public_general"]),
  demote_review_tasks: true,
  review_suborder_stride: 2,
  review_verb_kinds: Object.freeze(["eval_and_rank", "review", "evaluate", "audit_review"]),
});

export const WORK_NEXT = Object.freeze({
  let_go_workers: 3, // this many different workers let a Task go in the window: a plain claim offers it last, when nothing else is left
  let_go_window_ms: 24 * 3600 * 1000,
  let_go_cache_ms: 60 * 1000,
  let_go_recent_rows: 5000,
  default_tasks: 3,
  max_tasks: 10,
  pool: 40, // shuffled, so bots starting together don't race for the same Task
  prompt_head_chars: 500,
  idle_wait_s: 1800,
  retry_wait_s: 5,
  retry_jitter_s: 10,
  skip_ids: 30,
  dispatch_regime: DISPATCH_REGIME,
});

export function isReviewLikeTaskRow(row) {
  const vk = String(row?.verb_kind || "").trim().toLowerCase();
  if (DISPATCH_REGIME.review_verb_kinds.includes(vk)) return true;
  const title = String(row?.title || "").trim().toLowerCase();
  return title.startsWith("review:") || title.startsWith("beat-1 priority");
}

const q = (publicUrl) => `${String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "")}/q`;
const enc = encodeURIComponent;
const nextUrl = (publicUrl, agentId, skip = "") =>
  `${q(publicUrl)}/next${agentId ? `?agent_id=${enc(agentId)}` : ""}${skip ? `${agentId ? "&" : "?"}skip=${enc(skip)}` : ""}`;

/** A wait with a random part, so workers that failed together don't come back together. */
export function jitteredWait() {
  return WORK_NEXT.retry_wait_s + Math.floor(Math.random() * (WORK_NEXT.retry_jitter_s + 1));
}

const LEASE_ENDED = new Set(["task_not_leased", "lease_expired", "stale_fencing_token", "stale_or_missing_lease_epoch", "leased_by_other_worker"]);

/** The `next` block for a refused reply on a queue route. */
export function nextForError(code, status, publicUrl, route = "") {
  if (route === "release" && LEASE_ENDED.has(code)) {
    return { action: "find_other", url: nextUrl(publicUrl), why: "Your lease already ended or moved, so there is nothing to give back.", retry_same_call: false };
  }
  if (LEASE_ENDED.has(code)) {
    return {
      action: "claim_again_then_resend",
      why: "Your lease ended or moved. Claim this Task again by its id. A lease back means send the same full work with the new fencing_token. No lease means someone else holds it: stop, and keep your work.",
      retry_same_call: false,
    };
  }
  if (code === "task_already_completed") return { action: "find_other", url: nextUrl(publicUrl), why: "This Task is closed. If you closed it, your work is saved.", retry_same_call: false };
  if (code === "missing_fencing_token") return { action: "resend_with_fence", why: "Send the fencing_token from your claim reply, with the same full work.", retry_same_call: false };
  if (code === "invalid_json") return { action: "fix_json_and_resend", why: "Nothing was saved. Fix the one bracket or quote and send every word again. A shorter resend throws work away.", retry_same_call: false };
  if (code === "worker_token_required" || code === "invalid_worker_token") return { action: "use_another_agent_id", why: "That name belongs to a worker with a token. Pick a new id, or send that worker's token.", retry_same_call: false };
  if (code === "forbidden_tier") return { action: "find_other", url: nextUrl(publicUrl), retry_same_call: false };
  if (status >= 500 || status === 429) {
    return { action: "retry_same_call", retry_after_seconds: jitteredWait(), max_tries: 3, why: "Often only a busy moment. Wait with a random extra, then send the same call. After 3 tries stop this run.", retry_same_call: true };
  }
  return { action: "read_detail", url: nextUrl(publicUrl), retry_same_call: false };
}

export function addNextToRefusal(obj, status, publicUrl, route = "") {
  if (!obj || typeof obj !== "object" || obj.next || obj.ok !== false) return obj;
  return { ...obj, next: nextForError(obj.code || obj.error || "", status, publicUrl, route) };
}

/** The `next` block for a claim that got a lease. */
export function nextForLease(publicUrl, agentId, task) {
  const id = enc(task.task_id);
  const fence = task.fencing_token;
  return {
    action: "do_the_work",
    expires_at: task.lease_expires_at || task.expires_at || null,
    heartbeat_url: `${q(publicUrl)}/heartbeat?agent_id=${enc(agentId)}&task_id=${id}&lease_epoch=${fence}`,
    submit_url: `${q(publicUrl)}/submit`,
    give_back_url: `${q(publicUrl)}/release/${enc(agentId)}/${id}/${fence}?reason=short-words`,
    why: "Cannot do the main work? Give it back; do not submit. A submit closes the Task for everyone.",
  };
}

let letGoCache = { at: 0, ids: [] };
/** Tasks that several different workers let go lately. Empty if the table can't be read. */
export async function tasksLetGoOften(db, now = Date.now()) {
  if (now - letGoCache.at < WORK_NEXT.let_go_cache_ms) return letGoCache.ids;
  let ids = [];
  try {
    const cutoff = new Date(now - WORK_NEXT.let_go_window_ms).toISOString();
    const out = await db
      // Only the newest rows, by primary key, so this never scans the whole ledger; only Tasks still open count.
      .prepare(
        `SELECT l.task_id FROM herma_task_attempt_ledger l
         WHERE l.id > (SELECT COALESCE(MAX(id), 0) FROM herma_task_attempt_ledger) - ?
           AND l.outcome LIKE 'released%' AND l.created_at > ?
           AND EXISTS (SELECT 1 FROM herma_durable_queue q WHERE q.task_id = l.task_id AND q.state = 'ready')
         GROUP BY l.task_id HAVING COUNT(DISTINCT l.worker_uuid) >= ? LIMIT 200`
      )
      .bind(WORK_NEXT.let_go_recent_rows, cutoff, WORK_NEXT.let_go_workers)
      .all();
    ids = (out?.results || []).map((r) => String(r.task_id));
  } catch {
    ids = [];
  }
  letGoCache = { at: now, ids };
  return ids;
}
export function resetLetGoCache() {
  letGoCache = { at: 0, ids: [] };
}
const quoteIds = (ids) => ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
export function notLetGoOftenSql(ids) {
  return ids.length ? ` AND task_id NOT IN (${quoteIds(ids)})` : "";
}

/** Says why a claim got no lease, and what to do. */
export async function explainNoLease(db, taskId, { publicUrl, agentId, needsFieldTeam, canDoFieldWork = false } = {}) {
  const another = nextUrl(publicUrl, agentId, taskId);
  const go = (reason, why, extra = {}) => ({ reason, why, next: { action: "find_other", url: another, retry_same_call: false, ...extra } });
  if (!taskId) {
    return { reason: "nothing_ready_for_this_claim", why: "No ready Task matched this claim.", next: { action: "find_other", url: nextUrl(publicUrl, agentId), retry_same_call: false } };
  }
  let row;
  try {
    row = await db.prepare("SELECT state, title, blocked_by_task_id, lease_expires_at FROM herma_durable_queue WHERE task_id = ? LIMIT 1").bind(taskId).first();
  } catch {
    return { reason: "busy_try_again", why: "The reason could not be read just now. Nothing is held.", next: { action: "retry_same_call", retry_after_seconds: jitteredWait(), max_tries: 3, retry_same_call: true } };
  }
  if (!row) return go("no_such_task", "No Task has this id.");
  if (row.state === "done") return go("already_done", "This Task is closed.");
  if (row.state === "leased") return go("held_now", "A worker holds this Task now, maybe you on an earlier claim. If it is yours, keep using the fence you saved. If not, take a different one.", { lease_expires_at: row.lease_expires_at || null });
  if (!canDoFieldWork && needsFieldTeam?.(row.title)) {
    return go("needs_people", "This Task's title says it needs people or a place, so a claim leaves it out. If you really have them, claim again with can_do_field_work=1.");
  }
  if (row.blocked_by_task_id) {
    let pre;
    try {
      pre = await db.prepare("SELECT state FROM herma_durable_queue WHERE task_id = ? LIMIT 1").bind(row.blocked_by_task_id).first();
    } catch {
      return { reason: "busy_try_again", why: "The reason could not be read just now. Nothing is held.", next: { action: "retry_same_call", retry_after_seconds: jitteredWait(), max_tries: 3, retry_same_call: true } };
    }
    if (pre?.state !== "done") return go("waiting_on_another_task", `This Task waits for ${row.blocked_by_task_id} to finish.`);
  }
  return go("not_offered_to_this_worker", "This worker isn't a fit for this Task now, for example its own work to review, or its setup. Take a different one.");
}

const listOf = (raw) => String(raw || "").replace(/[\u0000-\u001f]/g, "").split(",").map((s) => s.trim().slice(0, 200)).filter(Boolean).slice(0, WORK_NEXT.skip_ids);

/** Tasks this agent gave back in the last `hours` hours. Empty when the record can't be read. */
export async function releasedRecentlyBy(db, agentId, hours = 2) {
  try {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const out = await db
      .prepare("SELECT DISTINCT task_id FROM herma_task_attempt_ledger WHERE agent_id = ? AND outcome LIKE 'released%' AND created_at >= ? LIMIT 50")
      .bind(String(agentId), since)
      .all();
    return (out?.results || []).map((r) => r.task_id).filter(Boolean);
  } catch {
    return [];
  }
}

/** How many different workers gave each Task back. */
async function letGoCountsFor(db, ids) {
  const counts = new Map();
  if (!ids.length) return counts;
  try {
    const out = await db
      .prepare(`SELECT task_id, COUNT(DISTINCT worker_uuid) AS n FROM herma_task_attempt_ledger WHERE outcome LIKE 'released%' AND task_id IN (${ids.map(() => "?").join(",")}) GROUP BY task_id`)
      .bind(...ids)
      .all();
    for (const r of out?.results || []) counts.set(r.task_id, Number(r.n));
  } catch {
    // Optional: the list still answers.
  }
  return counts;
}

/** GET /q/next: read-only. Up to a few Tasks this worker can claim, picked at random from the top of the queue, frontier engineering work first. */
export async function workNextResponse(url, db, { publicUrl, fieldSql, infraAllowed = false } = {}) {
  const agentId = String(url.searchParams.get("agent_id") || url.searchParams.get("agent") || "").trim().slice(0, 120);
  const asked = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, WORK_NEXT.max_tasks) : WORK_NEXT.default_tasks;
  const skip = listOf(url.searchParams.get("skip"));
  const hasVectors = /(^|,)vectors(,|$)/.test(String(url.searchParams.get("has") || ""));
  const wantPeople = ["1", "true"].includes(url.searchParams.get("can_do_field_work"));
  const letGo = await tasksLetGoOften(db);
  // A Task this agent gave back in the last 2 hours is not offered to it again, unless it asks with include_released=1.
  const includeReleased = ["1", "true"].includes(String(url.searchParams.get("include_released") || ""));
  const releasedByYou = agentId && !includeReleased ? await releasedRecentlyBy(db, agentId) : [];
  const hide = [...new Set([...letGo, ...skip, ...releasedByYou])];
  const vis = infraAllowed ? "visibility IN ('server_infra','public_ngo','public_commons')" : "visibility IN ('public_ngo','public_commons')";
  const prereq = "(COALESCE(blocked_by_task_id,'') = '' OR EXISTS (SELECT 1 FROM herma_durable_queue p WHERE p.task_id = herma_durable_queue.blocked_by_task_id AND p.state = 'done'))";
  const noVectors = hasVectors ? "" : " AND LOWER(COALESCE(title,'')) NOT LIKE '%index enrichment%'";
  const notPeople = wantPeople ? "" : ` AND NOT (${fieldSql})`;
  const notOwn = agentId ? " AND COALESCE(producer_agent,'') != ?" : "";
  const explicitTier = String(url.searchParams.get("tier") || "").trim();
  const priorityRegime = String(url.searchParams.get("priority_regime") || "").trim().toLowerCase();
  const preferReviews = ["1", "true"].includes(String(url.searchParams.get("prefer_reviews") || "").trim().toLowerCase());
  const demoteReviews = DISPATCH_REGIME.demote_review_tasks && !preferReviews;
  const tiers = explicitTier
    ? [explicitTier]
    : priorityRegime === "ngo_first"
      ? [...DISPATCH_REGIME.ngo_first_tier_order]
      : [...DISPATCH_REGIME.default_tier_order];
  const reviewCaseExpr =
    "(CASE WHEN LOWER(COALESCE(verb_kind,'')) IN ('eval_and_rank','review','evaluate','audit_review') OR LOWER(COALESCE(title,'')) LIKE 'review:%' OR LOWER(COALESCE(title,'')) LIKE 'beat-1 priority%' THEN 1 ELSE 0 END)";
  const orderByClause = preferReviews
    ? `ORDER BY ${reviewCaseExpr} DESC, priority DESC, id DESC LIMIT ?`
    : demoteReviews
      ? `ORDER BY ${reviewCaseExpr} ASC, priority DESC, id DESC LIMIT ?`
      : "ORDER BY priority DESC, id DESC LIMIT ?";
  const reviewSubOrder = (r) => (preferReviews ? (isReviewLikeTaskRow(r) ? 0 : 1) : demoteReviews && isReviewLikeTaskRow(r) ? 1 : 0);
  let picked = [];
  let tierUsed = null;
  for (const tier of tiers) {
    if (tier === "infra_private" && !infraAllowed) continue;
    const tierIdx = tiers.indexOf(tier);
    const out = await db
      .prepare(
        `SELECT task_id, tier, priority, title, SUBSTR(prompt, 1, ${Math.max(WORK_NEXT.prompt_head_chars + 1, 2000)}) AS prompt, verb_kind, producer_agent, producer_worker_uuid, owner_worker_uuid FROM herma_durable_queue
         WHERE state = 'ready' AND tier = ? AND ${vis} AND ${prereq}${notPeople}${noVectors}${notOwn}${notLetGoOftenSql(hide)}
         ${orderByClause}`
      )
      .bind(tier, ...(agentId ? [agentId] : []), WORK_NEXT.pool)
      .all();
    // Frontier general work first by default (or nonprofit first when priority_regime=ngo_first); a short list fills up from the next tier.
    if (out?.results?.length && !tierUsed) tierUsed = tier;
    picked.push(
      ...(out?.results || []).map((r) => ({
        ...r,
        order: tierIdx * DISPATCH_REGIME.review_suborder_stride + reviewSubOrder(r),
      }))
    );
    if (picked.length >= limit) break;
  }
  // Tasks several workers let go come last: still offered when nothing else is left.
  const lastResort = letGo.filter((id) => !skip.includes(id) && !releasedByYou.includes(id));
  if (picked.length < limit && lastResort.length) {
    for (const tier of tiers) {
      if (tier === "infra_private" && !infraAllowed) continue;
      const tierIdx = tiers.indexOf(tier);
      const out = await db
        .prepare(
          `SELECT task_id, tier, priority, title, SUBSTR(prompt, 1, ${Math.max(WORK_NEXT.prompt_head_chars + 1, 2000)}) AS prompt, verb_kind, producer_agent, producer_worker_uuid, owner_worker_uuid FROM herma_durable_queue
           WHERE state = 'ready' AND tier = ? AND ${vis} AND ${prereq}${notPeople}${noVectors}${notOwn} AND task_id IN (${lastResort.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")})
           ${orderByClause}`
        )
        .bind(tier, ...(agentId ? [agentId] : []), limit)
        .all();
      if (out?.results?.length && !tierUsed) tierUsed = tier;
      picked.push(
        ...(out?.results || []).map((r) => ({
          ...r,
          order:
            tiers.length * DISPATCH_REGIME.review_suborder_stride +
            tierIdx * DISPATCH_REGIME.review_suborder_stride +
            reviewSubOrder(r),
        }))
      );
      if (picked.length >= limit) break;
    }
  }
  // maker != checker: a review of this agent's own work is left out (producer_guard.js). A claim checks again.
  const makerIds = await makerConflictIds(db, picked, { agentId, workerUuid: url.searchParams.get("worker_uuid") || "" });
  const unseenOnly = ["1", "true"].includes(String(url.searchParams.get("unseen_only") || "").toLowerCase());
  const frontierCampaign = String(url.searchParams.get("campaign") || "default");
  const seenInFrontier =
    unseenOnly && agentId && picked.length > 0
      ? await readSeenItemSet(
          db,
          agentId,
          frontierCampaign,
          picked.map((r) => r.task_id)
        )
      : new Set();
  const pool = picked.filter((r) => !makerIds.has(r.task_id) && !seenInFrontier.has(String(r.task_id).toLowerCase()));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.sort((a, b) => a.order - b.order); // a stable sort: random within a tier
  const claimAs = agentId ? enc(agentId) : "<YOUR-ID>";
  const letGoCounts = await letGoCountsFor(db, pool.slice(0, limit).map((r) => r.task_id));
  const tasks = pool.slice(0, limit).map((r) => ({
    task_id: r.task_id,
    tier: r.tier,
    priority: r.priority,
    title: r.title,
    // D8 and D9 (round 4): the maker, so a worker can apply its own-work rule, and needs_people (false: /q/next leaves those
    // Tasks out unless the caller sent can_do_field_work=1; then it is not stated, review L3).
    producer_agent: r.producer_agent || null,
    ...(wantPeople ? {} : { needs_people: false }),
    prompt_head: String(r.prompt || "").slice(0, WORK_NEXT.prompt_head_chars),
    prompt_cut: String(r.prompt || "").length > WORK_NEXT.prompt_head_chars,
    claim_url: `${q(publicUrl)}/claim/${claimAs}?task_id=${enc(r.task_id)}${wantPeople ? "&can_do_field_work=1" : ""}`,
    task_url: `${q(publicUrl)}/task/${enc(r.task_id)}`,
    let_go_by_workers: letGoCounts.get(r.task_id) || 0,
  }));
  const body = {
    ok: true,
    schema: "shim.work_next.v1",
    read_only: "This call leases nothing. A Task is yours only after a claim.",
    tier: tierUsed,
    tasks,
    left_out: {
      let_go_by_several_workers: letGo.length,
      skipped_by_you: skip.length,
      given_back_by_you_lately: releasedByYou.length,
      ...(unseenOnly ? { seen_in_frontier: seenInFrontier.size } : {}),
      rule: "Left out: Tasks needing people or a place, waiting on another Task, your own, reviews of your own work (maker != checker), and Tasks you gave back in the last 2 hours (add include_released=1 to see them). Tasks let go by several workers come last. Everything stays readable at /q/tasks and claimable by id.",
    },
  };
  if (tasks.length) {
    // A suggestion, not an order: the worker knows its tools; the list is in random order within a tier.
    body.next = {
      action: "claim",
      advisory: true,
      url: tasks[0].claim_url,
      why: "A suggestion. Pick the Task in tasks that fits your tools best, and read its task_url first. If you cannot do it, give it back; do not submit.",
      if_no_lease: "Read no_lease.next in the reply, or take another from tasks.",
      retry_same_call: false,
    };
  } else {
    const wait = WORK_NEXT.idle_wait_s + Math.floor(Math.random() * 300);
    body.next = { action: "stop", reason: "nothing_this_worker_can_do_now", retry_after_seconds: wait, why: "Write Idle and stop. Do not make up work. New Tasks arrive through the day.", retry_same_call: false };
  }
  return body;
}

/** /q/tasks: each Task says what a claim would do, so a list and a claim agree. `claimable=1` is the client's choice. */
export async function markListedTasks(url, body, db, { needsFieldTeam, publicUrl } = {}) {
  if (!body?.ok || !Array.isArray(body.tasks)) return body;
  const ids = body.tasks.map((t) => t.task_id);
  const counts = new Map();
  if (ids.length) {
    try {
      const out = await db
        .prepare(`SELECT task_id, COUNT(DISTINCT worker_uuid) AS n FROM herma_task_attempt_ledger WHERE outcome LIKE 'released%' AND task_id IN (${ids.map(() => "?").join(",")}) GROUP BY task_id`)
        .bind(...ids)
        .all();
      for (const r of out?.results || []) counts.set(r.task_id, Number(r.n));
    } catch {
      // Optional: the list still answers.
    }
  }
  const letGo = new Set(await tasksLetGoOften(db));
  // Which listed Tasks wait on a Task that isn't finished. If that can't be read, they count as waiting: the list stays cautious.
  const blockers = [...new Set(body.tasks.map((t) => t.blocked_by_task_id).filter(Boolean))];
  const doneBlockers = new Set();
  if (blockers.length) {
    try {
      const out = await db.prepare(`SELECT task_id FROM herma_durable_queue WHERE state = 'done' AND task_id IN (${blockers.map(() => "?").join(",")})`).bind(...blockers).all();
      for (const r of out?.results || []) doneBlockers.add(r.task_id);
    } catch {
      // As above.
    }
  }
  // With an agent_id, a list leaves out the reviews of that agent's own work (maker != checker), and says how many.
  const asker = String(url.searchParams.get("agent_id") || url.searchParams.get("agent") || "").trim();
  const makerIds = asker ? await makerConflictIds(db, body.tasks.filter((t) => t.state === "ready"), { agentId: asker, workerUuid: url.searchParams.get("worker_uuid") || "" }) : new Set();
  if (makerIds.size) body = { ...body, tasks: body.tasks.filter((t) => !makerIds.has(t.task_id)), left_out_as_maker: makerIds.size };
  let tasks = body.tasks.map((t) => {
    const needs_people = Boolean(needsFieldTeam?.(t.title));
    const waiting = Boolean(t.blocked_by_task_id) && !doneBlockers.has(t.blocked_by_task_id);
    return { ...t, needs_people, ...(counts.get(t.task_id) ? { let_go_by_workers: counts.get(t.task_id) } : {}), plain_claim_offers_it: t.state === "ready" && !needs_people && !waiting, ...(letGo.has(t.task_id) ? { offered_last: true } : {}) };
  });
  const wantClaimable = url.searchParams.get("claimable") === "1";
  if (wantClaimable) tasks = tasks.filter((t) => t.plain_claim_offers_it);
  return { ...body, tasks, ...(wantClaimable ? { claimable_filter: "applied to this page; total_matching counts before it" } : {}), next: { action: "or_ask", url: nextUrl(publicUrl), why: "GET /q/next names a few Tasks you can claim, in fewer words.", retry_same_call: false } };
}

/** The `next` block on GET /q/task/<id>: what a worker can do with this Task now. Advisory; the claim decides. */
export function nextForTask(task, publicUrl, now = Date.now()) {
  const id = enc(task?.task_id || "");
  const state = String(task?.state || "");
  const ends = Date.parse(String(task?.lease_expires_at || ""));
  if (state === "done") {
    return { action: "read_result", advisory: true, url: `${String(publicUrl || "").replace(/\/+$/, "")}/c/task/${id}`, why: "This Task is finished. Its page shows the result and its Task Objects.", retry_same_call: false };
  }
  if (state === "leased" && Number.isFinite(ends) && ends < now) {
    return {
      action: "claim_again",
      advisory: true,
      lease_ended: true,
      url: `${q(publicUrl)}/claim/<YOUR-ID>?task_id=${id}`,
      why: "The lease on this Task ended. A claim by its id can lease it again, with a new fencing_token.",
      retry_same_call: false,
    };
  }
  if (state === "leased") {
    return {
      action: "wait_or_take_another",
      advisory: true,
      lease_expires_at: task.lease_expires_at || null,
      heartbeat_url_template: `${q(publicUrl)}/heartbeat?agent_id=<YOUR-ID>&task_id=${id}&lease_epoch=<YOUR-FENCING-TOKEN>`,
      other_url: nextUrl(publicUrl, "", task?.task_id || ""),
      why: "A worker holds this Task. If it is you, send a heartbeat with your fencing_token to keep the lease. If not, take another Task.",
      retry_same_call: false,
    };
  }
  if (state === "ready") {
    return { action: "claim", advisory: true, url: `${q(publicUrl)}/claim/<YOUR-ID>?task_id=${id}`, why: "This Task is open. Read the prompt first; claim it only if you can do it.", retry_same_call: false };
  }
  return { action: "take_another", advisory: true, url: nextUrl(publicUrl), retry_same_call: false };
}
