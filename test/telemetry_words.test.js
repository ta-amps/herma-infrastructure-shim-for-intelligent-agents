// Legacy audit N4: /q/meta-telemetry and /q/affinity show names that workers and their local runners send. The shared
// banned-word list applies to them at display time, with the same helper the pages use.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import BANNED from "../deploy/cloudflare/banned_words.generated.js";
import { scrubBannedDeep, scrubBannedWords } from "../deploy/cloudflare/page_shell.js";

const call = (path, init = {}) => exports.default.fetch("https://herma.ta-amps.workers.dev" + path, init);
// A word the list catches, found at run time from the list's own rules, so this file never spells one.
function findSample() {
  for (const rule of BANNED.displayRules || []) {
    for (const token of String(rule.re).match(/[A-Za-z]{4,}/g) || []) {
      for (const word of [token, token.toLowerCase(), `${token} model`]) if (scrubBannedWords(word) !== word) return word.split(" ")[0];
    }
  }
  return "";
}
const sample = findSample();

describe("telemetry JSON passes the shared word list", () => {
  it("scrubBannedDeep filters keys and string values and keeps numbers", () => {
    expect(sample).not.toBe("");
    const out = scrubBannedDeep({ [sample]: [sample, 3, { model: `${sample}:7b` }], n: 1 });
    expect(JSON.stringify(out)).not.toContain(sample);
    expect(out.n).toBe(1);
  });

  it("/q/affinity and /q/meta-telemetry show no banned word from a worker's model name", async () => {
    await call("/q/pulse");
    const now = new Date().toISOString();
    // A high run count puts the row at the top of /q/affinity's list; the call log row reaches /q/meta-telemetry's recent calls.
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at, model_hint, iteration_count) VALUES (?, ?, 'p', 'Worker', 'lens', ?, ?, ?, 100000)"
    ).bind(`w_tw_${Date.now().toString(36)}`, "tw-runner", now, now, `${sample} runner`).run();
    await call("/q/meta-telemetry");
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_meta_call_log (call_id, endpoint, agent_id, provider, requested_model, reported_model, outcome, created_at) VALUES (?, '/q/help', 'tw-runner', 'meta', ?, ?, 'success', ?)"
    ).bind(`call_tw_${Date.now()}`, `${sample}:7b`, `${sample}:7b`, now).run();
    const seen = {};
    for (const path of ["/q/affinity", "/q/meta-telemetry"]) {
      const text = await (await call(path)).text();
      expect(text).not.toContain(sample);
      seen[path] = text;
    }
    // The rows are really there: their other fields show.
    expect(seen["/q/affinity"]).toContain("tw-runner");
    expect(seen["/q/meta-telemetry"]).toContain("tw-runner");
  });
});
