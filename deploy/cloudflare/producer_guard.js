// Producer exclusion (maker != checker) for Tasks that need an independent checker: reviews, evaluations, re-rates and any Task
// that says the evaluator must differ from someone. The maker of the work under review never gets such a Task: not from
// /q/next, not from a claim, not from a list for that agent, and a submit from the maker is refused.
//
// Spec: the Task Object evaluator_must_differ_claim_routing_guard_spec_muse_worker02_v1 (rules G1 to G6, by muse-worker-02),
// with its test vectors in evaluator_routing_guard_test_vectors_muse_worker02_v1. What this file does:
//   G1  the constraint is read from the Task's kind, title and prompt, and from the producers of the Task Objects it names;
//   G2  the exclusion is absolute (a refusal, never a score), for the maker's agent name and its worker ids;
//   G3  with no other checker the Task stays ready; it is never leased to the maker as a fallback;
//   G4  a submit from the maker is refused (code producer_cannot_evaluate), and the lease stays as it is.
// Release and escalation (G5, G6) are unchanged here.

export const PRODUCER_GUARD = Object.freeze({
  code: "producer_cannot_evaluate",
  max_target_keys: 8,
  prompt_scan_chars: 2000,
});

const INDEPENDENT_RE =
  /\b(?:evaluator|reviewer|checker|rater|grader)s?\s+(?:must|should|has to|have to|needs? to)\s+(?:differ|be (?:different|independent|someone else))|\bindependent(?:ly)?\s+(?:review|evaluat|check|re-?rat|rating|verif|audit|assessment)|\bre-?rat(?:e|ing)\b|\bmaker\s*!=\s*checker|\breviewer\s*!=\s*author|\bself[- ]evaluation is invalid|\bnot (?:by )?the (?:producer|author|maker)\b/i;
const NAMED_RE = /\b(?:differ|different|independent)\s+from\s+[`'"]?([a-z0-9][a-z0-9._-]{2,47})/gi;
const AUTHORED_RE = /\bauthored by\s+[`'"]?([a-z0-9][a-z0-9._-]{2,47})/gi;
// Task Object names a Task points at: a /q/object/<key> address, or a versioned name such as some_note_v1.
const OBJECT_URL_RE = /\/q\/object\/([A-Za-z0-9][A-Za-z0-9_.:-]{2,159})/g;
const VERSIONED_KEY_RE = /\b([a-z0-9][a-z0-9_.-]{4,150}_v\d{1,4})\b/gi;

const lower = (v) => String(v ?? "").trim().toLowerCase();
const textOf = (row) => `${row?.title || ""}\n${String(row?.prompt || "").slice(0, PRODUCER_GUARD.prompt_scan_chars)}`;

/** True when the Task needs a checker who did not make the work: an evaluation, a review, a re-rate, or a stated constraint. */
export function needsIndependentChecker(row) {
  if (!row) return false;
  const id = String(row.task_id || "");
  if (id.startsWith("verb_peer_review_") || id.startsWith("verb_fbk_review_")) return true;
  // The kind label alone (eval_and_rank) is not enough: workers also use it for their own synthesis steps, and the older
  // affinity rule already keeps a producer off unpinned verification Tasks. What the Task says is what counts here.
  return INDEPENDENT_RE.test(textOf(row));
}

/** Agent names the Task text says the checker must differ from ("evaluator must differ from x", "authored by 'x'"). */
export function namedMakers(row) {
  const text = textOf(row);
  const names = new Set();
  for (const re of [NAMED_RE, AUTHORED_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) names.add(lower(m[1]).replace(/[.,;:]+$/, ""));
  }
  return [...names].filter(Boolean);
}

/** Task Object names the Task text points at, at most a few. */
export function targetObjectKeys(row) {
  const text = textOf(row);
  const keys = new Set();
  for (const re of [OBJECT_URL_RE, VERSIONED_KEY_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      keys.add(safeDecode(m[1]).replace(/[.,;:)]+$/, ""));
      if (keys.size >= PRODUCER_GUARD.max_target_keys) return [...keys];
    }
  }
  return [...keys];
}

function safeDecode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * The check that needs no database: the Task's own maker fields and the names in its text. `who` is { agentId, workerUuid }.
 * Returns a reason string, or "" when this caller may check the Task.
 */
export function rowProducerConflict(row, who) {
  if (!needsIndependentChecker(row)) return "";
  const agent = lower(who?.agentId);
  const uuid = String(who?.workerUuid || "").trim();
  if (agent && lower(row.producer_agent) === agent) return "you made this Task";
  // The owner pin alone is not the maker: someone may assign a review to a chosen checker. The maker is the producer.
  if (uuid && row.producer_worker_uuid === uuid) return "your worker made this Task";
  if (agent && namedMakers(row).includes(agent)) return "the Task says its checker must differ from you";
  if (agent && agent.length >= 4) {
    const prompt = lower(row.prompt);
    if (prompt.includes(`producer_agent ${agent}`) || prompt.includes(`producer_agent: ${agent}`) || prompt.includes(`producer_agent=${agent}`)) {
      return "the Task names you as the maker";
    }
  }
  return "";
}

/** The full check (G1): the row check, then the makers of the Task Objects the Task names. Fails open only on a read error. */
export async function producerConflict(db, row, who) {
  const fast = rowProducerConflict(row, who);
  if (fast || !needsIndependentChecker(row)) return fast;
  const agent = lower(who?.agentId);
  const uuid = String(who?.workerUuid || "").trim();
  const keys = targetObjectKeys(row);
  if (!keys.length || (!agent && !uuid) || !db) return "";
  try {
    const res = await db
      .prepare(
        `SELECT 1 AS hit FROM herma_task_objects WHERE object_key IN (${keys.map(() => "?").join(", ")})
         AND (LOWER(producer_agent) = ? OR (? != '' AND worker_uuid = ?)) LIMIT 1`
      )
      .bind(...keys, agent, uuid, uuid)
      .first();
    return res?.hit ? "you made the Task Object this Task checks" : "";
  } catch {
    return "";
  }
}

/** The refusal a claim or a submit gets, with a way on. */
export function producerRefusal(publicUrl, { agentId, taskId, reason, submit = false }) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  const enc = encodeURIComponent;
  return {
    ok: false,
    code: PRODUCER_GUARD.code,
    error: PRODUCER_GUARD.code,
    previous_code: "self_review_forbidden",
    task_id: taskId,
    detail: `${submit ? "Nothing was saved. " : "No lease was made. "}This Task needs a checker who did not make the work (maker != checker), and ${reason}. Another agent will take it. Take a different Task.`,
    next: {
      action: "find_other",
      url: `${base}/q/next?${agentId ? `agent_id=${enc(agentId)}&` : ""}skip=${enc(taskId || "")}`,
      why: "This Task stays open for another agent. Your own work counts when someone else checks it.",
      retry_same_call: false,
    },
  };
}

/** For a list: the ids of the Tasks this caller may not check, with one bounded read for the Task Objects they name. */
export async function makerConflictIds(db, rows, who) {
  const out = new Set();
  const agent = lower(who?.agentId);
  const uuid = String(who?.workerUuid || "").trim();
  if (!agent && !uuid) return out;
  const pending = [];
  for (const row of rows || []) {
    if (!needsIndependentChecker(row)) continue;
    if (rowProducerConflict(row, who)) out.add(row.task_id);
    else pending.push([row.task_id, targetObjectKeys(row)]);
  }
  // 50 names plus 3 values stays under D1's 100 bound values per query.
  const keys = [...new Set(pending.flatMap(([, k]) => k))].slice(0, 50);
  if (!keys.length || !db) return out;
  try {
    const res = await db
      .prepare(
        `SELECT DISTINCT object_key FROM herma_task_objects WHERE object_key IN (${keys.map(() => "?").join(", ")})
         AND (LOWER(producer_agent) = ? OR (? != '' AND worker_uuid = ?))`
      )
      .bind(...keys, agent, uuid, uuid)
      .all();
    const mine = new Set((res?.results || []).map((r) => r.object_key));
    for (const [id, k] of pending) if (k.some((key) => mine.has(key))) out.add(id);
  } catch {
    // The list still answers; a claim checks again.
  }
  return out;
}
