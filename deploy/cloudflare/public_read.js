// What a no-key reader can't read on the model shim. Anything else public stays open to anyone.
//
// Closed, as not found or forbidden: visibility server_infra, tier infra_private, a removed (tombstoned) Task Object, and any older
// version of a Task Object whose newest version is restricted or removed.
// Personal data and credentials in what's open are replaced at display by pii_strip.js, on every public path. Stored records stay as they are.

// reviewed: a verdict only a server key can set says it holds. failed: a verdict says it doesn't. An evaluation with no such verdict
// is on the record, and leaves the work unreviewed: anyone may send one, even a maker under a second name.
const CONFIRMED = /^(?:CONFIRMED|PASS)$/;
const FAILED = /^(?:FAIL|REJECT|REFUT|NOT_)/;
export function reviewStateOf(row) {
  const verdict = String(row?.verification_verdict || "").toUpperCase();
  if (FAILED.test(verdict)) return "failed";
  return Number(row?.eval_count || 0) > 0 && CONFIRMED.test(verdict) ? "reviewed" : "unreviewed";
}
// Owner, Nov 4: a score and what it rests on, not a hard label. A refuted row scores low and stays; a name anyone can make up counts for little.
// checks: { keyed, name_only } distinct checkers, when the caller read them. Without it, a row's evaluations count as name only unless a verdict says more.
export function confidenceOf(row, checks = null) {
  const verdict = String(row?.verification_verdict || "").toUpperCase();
  const state = reviewStateOf(row);
  const evals = Number(row?.eval_count || 0);
  const keyed = checks ? Number(checks.keyed || 0) : 0;
  const named = checks ? Number(checks.name_only || 0) : state === "reviewed" ? 0 : evals;
  const evidence = [state === "failed" ? "a check found it wrong" : state === "reviewed" ? "a check passed it" : verdict === "REPRODUCED" ? "tests were run again and matched" : verdict === "VERIFIED_SEED" ? "our own starter record" : "no check result yet"];
  if (keyed) evidence.push(`${keyed} checker${keyed === 1 ? "" : "s"} with a key or our own checker`);
  if (named) evidence.push(`${named} evaluation${named === 1 ? "" : "s"} from a name only, which count for little`);
  if (state === "failed") return { confidence: 0.05, evidence };
  const base = state === "reviewed" ? 0.7 : verdict === "REPRODUCED" ? 0.6 : verdict === "VERIFIED_SEED" ? 0.5 : 0.3;
  return { confidence: Math.round((base + Math.min(0.2, keyed * 0.1) + Math.min(0.06, named * 0.02)) * 100) / 100, evidence };
}
export function reviewLabels(row) {
  const state = reviewStateOf(row);
  return { review_state: state, reviewed: state === "reviewed", ...confidenceOf(row) };
}
// SQL for a client's review choice; a Task's evaluations are read with their verdicts by the caller's expressions.
const VERDICT = "UPPER(COALESCE(verification_verdict, ''))";
const FAILED_SQL = (v) => `(${v} LIKE 'FAIL%' OR ${v} LIKE 'REJECT%' OR ${v} LIKE 'REFUT%' OR ${v} LIKE 'NOT\\_%' ESCAPE '\\')`;
export function reviewWhere(prefs, { reviewedSql = `(COALESCE(eval_count, 0) > 0 AND ${VERDICT} IN ('CONFIRMED', 'PASS'))`, failedSql = FAILED_SQL(VERDICT) } = {}) {
  const wanted = prefs?.review_state || (prefs?.include_unreviewed === false ? ["reviewed"] : null);
  if (!wanted) return "";
  const parts = [];
  if (wanted.includes("reviewed")) parts.push(`(${reviewedSql} AND NOT ${failedSql})`);
  if (wanted.includes("failed")) parts.push(failedSql);
  if (wanted.includes("unreviewed")) parts.push(`(NOT ${reviewedSql} AND NOT ${failedSql})`);
  return parts.length ? ` AND (${parts.join(" OR ")})` : "";
}

// A Task's evaluations: only a server key's or our own checker's verdict is stored from this date on, so only those rows count.
// Before it, a peer's verdict was stored as sent.
const TRUSTED_VERDICTS_SINCE = "2026-11-04T19:30:00Z";
export const TRUSTED_TASK_EVALUATION_SQL = `created_at >= '${TRUSTED_VERDICTS_SINCE}'`;
// For an object's checkers: from that date, a verdict other than UNREVIEWED came with a key or from our own checker.
export const KEYED_CHECK_SQL = `(created_at >= '${TRUSTED_VERDICTS_SINCE}' AND UPPER(COALESCE(verification_verdict, '')) NOT IN ('', 'UNREVIEWED'))`;

// A reply over the size a client asked for sets aside its largest optional parts, and says which.
const CLAIM_KEEP = /^(ok|schema|task|next|no_lease|helpers|code|error|detail|lease|fencing|worker_token|worker_uuid|worker_profile|warnings|co_leased|reused_active_lease|submit|heartbeat|review_state|reviewed|object_key|sha256_hash|payload_left_out|read_all_at)/;
export function fitReply(body, maxBytes) {
  if (maxBytes == null) return body;
  const size = (value) => new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  const out = { ...body };
  const left = [];
  const optional = Object.keys(out).filter((k) => !CLAIM_KEEP.test(k)).sort((a, b) => size(out[b]) - size(out[a]));
  for (const key of optional) {
    if (size(out) <= maxBytes) break;
    delete out[key];
    left.push(key);
  }
  return left.length ? { ...out, left_out_by_max_bytes: left } : out;
}
