// One check for "this looks like a credential". Nothing shaped like one is kept in a record, shown back or sent to anyone else.
import { scrubSensitiveText } from "./bilateral_bridge.js";

// The well-known token shapes, with the length rules that keep real project names such as sk-learn-contrib out of them.
const TOKEN_SHAPES =
  /(?<![A-Za-z0-9])(?:hk_(?:wrk|ep|inf)_[A-Za-z0-9_-]{16,}|hmk_[A-Za-z0-9_-]{16,}|wt_[a-f0-9]{24,}|(?:tsk|tan)_(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{16,}|sk-(?:ant|proj|svcacct|admin)-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{20,}|[A-Fa-f0-9]{32,}(?![A-Za-z0-9]))/;

/** A repository name that must not be sent to GitHub. Narrow, because real names must still be found. */
export function nameLooksLikeToken(text) {
  return TOKEN_SHAPES.test(String(text ?? ""));
}

/** Free text that must not be stored or shown back. Wider: the shared scrubber too, since a false alarm here only skips a record. */
export function textHasCredential(text) {
  const value = String(text ?? "");
  return TOKEN_SHAPES.test(value) || scrubSensitiveText(value) !== value.trim();
}
