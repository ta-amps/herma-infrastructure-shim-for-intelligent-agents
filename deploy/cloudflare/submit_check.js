// A dry run of the rules POST /q/submit enforces, for /q/schema/validate (owner, Nov 6: "validate always says valid, even for {}").
// It reads the Task named in the candidate, writes nothing and leases nothing. `errors` are refusals a submit would give;
// `changes` are what a submit would store differently from what was sent. would_save is true only with no errors.

import { evaluateSubmissionContract } from "./durable_session_and_dag.js";
import { producerConflict } from "./producer_guard.js";
import { sanitizeObjectKeyPreservingSuffix } from "./worker_reputation_and_proposals.js";

export const SUBMIT_CHECK = Object.freeze({
  request_max_bytes: 262144,
  summary_max_len: 1600,
  object_key_max_len: 128,
  min_completion_summary_chars: 12,
  min_followup_prompt_chars: 24,
  max_items_checked: 50,
});

const firstArray = (...vals) => vals.find((v) => Array.isArray(v)) || null;

function objectsOf(c) {
  const raw = c.task_objects || c.output_nouns || c.objects || c.nouns || (c.task_object && typeof c.task_object === "object" ? [c.task_object] : null);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") {
    const looksLikeOne = ["object_key", "key", "summary", "payload", "category"].some((k) => k in raw);
    return looksLikeOne ? [raw] : Object.entries(raw).map(([key, value]) => (value && typeof value === "object" && !Array.isArray(value) ? { object_key: key, ...value } : { object_key: key, payload: value }));
  }
  return [];
}

function verbsOf(c) {
  const raw =
    c.queued_tasks || c.tasks || c.queued_verbs || c.verbs || c.followup_tasks || c.followup_verbs || c.next_tasks || c.generated_tasks || c.subtasks ||
    (c.verb && typeof c.verb === "object" ? [c.verb] : null);
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** The check. `rawBytes` is the size of the request body as sent, when there was one. */
export async function checkSubmitCandidate(db, candidate, { rawBytes = 0, openLimits = true, infraAllowed = false } = {}) {
  const c = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
  const errors = [];
  const changes = [];
  const err = (code, detail) => errors.push({ code, detail });
  const agent = c.agent_id || c.agent || c.worker || c.worker_id || c.worker_uuid || c.uuid || "";
  const task = c.task_id || c.completed_task_id || c.verb_id || c.task || "";
  if (rawBytes > SUBMIT_CHECK.request_max_bytes) err("request_too_large", `The request is ${rawBytes} bytes; the limit is ${SUBMIT_CHECK.request_max_bytes}. Store large work in parts or with /q/upload.`);
  if (!agent && !task) err("missing_submit_fields", "A submit names a worker (agent_id) and a Task (task_id). To store something with no Task, send task_id self_seed with your agent_id.");
  if (!agent && task) changes.push("No agent_id: the work would be credited to the default name volunteer-agent. Send your own agent_id.");

  const objects = objectsOf(c).slice(0, SUBMIT_CHECK.max_items_checked);
  const verbs = verbsOf(c).slice(0, SUBMIT_CHECK.max_items_checked);
  const evals = firstArray(c.evaluations, c.ratings, c.computed_evaluations) || [];
  const resultBody = c.result ?? c.output ?? c.content;
  const summaryText = String(c.summary || c.result_summary || c.description || c.desc || c.completed_branch || c.title || (typeof resultBody === "string" ? resultBody : "") || "");
  const resultIsEmpty =
    resultBody === undefined || resultBody === null || (typeof resultBody === "string" && !resultBody.trim()) ||
    (typeof resultBody === "object" && Object.keys(resultBody).length === 0);
  // /q/submit wraps a non-empty result, output or content field into a Task Object, so it counts as work here too.
  const hasWork = objects.length > 0 || verbs.length > 0 || evals.length > 0 || !resultIsEmpty;
  if (summaryText.length > SUBMIT_CHECK.summary_max_len) changes.push(`The summary would be cut to ${SUBMIT_CHECK.summary_max_len} characters.`);
  if (!summaryText.trim()) changes.push('No summary: the stored summary would read "completed task branch". Say what you did.');

  const taskId = String(task || "self_seed").trim();
  if (taskId !== "self_seed" && db) {
    let row = null;
    try {
      row = await db
        .prepare("SELECT task_id, state, visibility, tier, lease_expires_at, title, prompt, verb_kind, producer_agent, producer_worker_uuid, owner_worker_uuid FROM herma_durable_queue WHERE task_id = ?")
        .bind(taskId)
        .first();
    } catch {
      changes.push("The Task could not be read just now, so its state was not checked.");
    }
    const fence = c.fencing_token ?? c.lease_epoch ?? c.fence_seq ?? c.claim_revision ?? c.fence ?? c.active_fence;
    if (!row && !hasWork) err("task_not_found", `No Task has the id '${taskId}'. Claim one first, or use task_id self_seed.`);
    else if (!row) changes.push(`No Task has the id '${taskId}'. The work would be kept, but no Task would be closed.`);
    else {
      if ((row.visibility === "server_infra" || row.tier === "infra_private") && !infraAllowed) err("forbidden_tier", "This Task is for server workers only.");
      const makerReason = row.state !== "done" ? await producerConflict(db, row, { agentId: String(agent).toLowerCase(), workerUuid: String(c.worker_uuid || c.uuid || "") }) : "";
      if (makerReason) err("producer_cannot_evaluate", `This Task needs a checker who did not make the work, and ${makerReason}.`);
      if (row.state === "done" && !hasWork) err("task_already_completed", "This Task is closed. A submit with no work saves nothing.");
      if (row.state === "done" && hasWork) changes.push("This Task is closed. Your work would be kept beside the first result, and the Task stays as it is.");
      if (row.state === "ready") err("task_not_leased", "Claim this Task first; a submit needs your lease.");
      if (row.state === "leased" && (fence === undefined || fence === null || String(fence).trim() === "")) err("missing_fencing_token", "Send the fencing_token from your claim reply.");
      if (row.state === "leased" && !hasWork && summaryText.trim().length < SUBMIT_CHECK.min_completion_summary_chars) {
        err("empty_completion", `A completion needs your result: a summary of at least ${SUBMIT_CHECK.min_completion_summary_chars} characters, a Task Object, a follow-up Task or an evaluation.`);
      }
    }
  }
  if (taskId === "self_seed" && !hasWork && summaryText.trim().length < SUBMIT_CHECK.min_completion_summary_chars) {
    changes.push("A self_seed with no Task Object stores nothing reusable. Add a task_objects entry.");
  }

  objects.forEach((o, i) => {
    const label = `task_objects[${i}]`;
    if (!o || typeof o !== "object") {
      changes.push(`${label} is not an object; it would be kept as one value.`);
      return;
    }
    const asked = o.object_key || o.key || o.object_id || o.object_name || o.name || o.id || o.slug || "";
    if (!asked) changes.push(`${label} has no object_key; the server would make one.`);
    else {
      const stored = sanitizeObjectKeyPreservingSuffix(String(asked), SUBMIT_CHECK.object_key_max_len);
      if (stored !== String(asked)) changes.push(`${label}: the object_key "${String(asked).slice(0, 80)}" would be stored as "${stored}". Use letters, digits, _ . : and -.`);
    }
    if (o.payload !== undefined && (o.payload === null || typeof o.payload !== "object")) changes.push(`${label}: payload is not a JSON object; it would be kept as one value. An object is easier to reuse.`);
    if (!o.summary && !o.description) changes.push(`${label} has no summary; others find it by its summary.`);
    if ((o.tier === "infra_private" || o.visibility === "server_infra") && !infraAllowed) err("forbidden_tier", `${label} asks for server-only visibility.`);
  });
  verbs.forEach((v, i) => {
    const prompt = String(v?.prompt || "").trim();
    if (openLimits && (prompt.length < SUBMIT_CHECK.min_followup_prompt_chars || prompt === String(v?.title || "").trim())) {
      changes.push(`follow-up ${i}: it would be dropped. A follow-up needs a real prompt of at least ${SUBMIT_CHECK.min_followup_prompt_chars} characters, not only a title.`);
    }
    if ((v?.tier === "infra_private" || v?.visibility === "server_infra") && !infraAllowed) err("forbidden_tier", `follow-up ${i} asks for a server-only tier.`);
  });
  evals.forEach((ev, i) => {
    if (!ev || typeof ev !== "object" || !(ev.target_id || ev.target_object_key || ev.target_task_id || ev.id)) changes.push(`evaluations[${i}] names no target_id; it would be skipped.`);
  });
  const contractEval = evaluateSubmissionContract(c, objects, summaryText);
  if (!contractEval.contract_clean) {
    for (const issue of contractEval.issues) {
      if (contractEval.strict_enforced) {
        err(issue.code, `${issue.location}: ${issue.detail} ${issue.repair}`);
      } else {
        changes.push(`${issue.location}: ${issue.detail} ${issue.repair}`);
      }
    }
  }
  return {
    would_save: errors.length === 0,
    errors,
    changes,
    contract_clean: contractEval.contract_clean,
    contract_issues: contractEval.issues,
    checked: { task_id: taskId, task_objects: objects.length, follow_ups: verbs.length, evaluations: evals.length },
  };
}
