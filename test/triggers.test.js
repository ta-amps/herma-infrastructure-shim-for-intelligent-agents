import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateProvisions } from "../deploy/cloudflare/herma_engine.js";

const ctx = { text: "synthetic request", file_paths: [], tool_names: [] };
const config = {
  HERMA_MICROMODEL_URL: "https://example.com/classify",
  HERMA_MICROMODEL_MODEL: "muse-spark-open",
  HERMA_EMBEDDINGS_URL: "https://example.com/embeddings",
};
const micro = {
  intent_question: "Should this synthetic rule apply?",
  min_confidence: 0.6,
  fallback_keywords: ["synthetic"],
};
const stored = triggers => ({
  version: 1,
  provision: { prov_id: "PROV-SYNTHETIC-BOUNDARY", enabled: true, priority: 100, triggers },
});
const provision = stored({ micromodel: micro });
const reply = decision => Response.json({ choices: [{ message: { content: JSON.stringify(decision) } }] });
afterEach(() => vi.unstubAllGlobals());

describe("strict model decisions and offline triggers in the Workers runtime", () => {
  it.each([
    ["true", { apply: true, confidence: 0.9 }, true],
    ["one confidence", { apply: true, confidence: 1 }, true],
    ["below threshold", { apply: true, confidence: 0.2 }, false],
    ["false cannot be overridden by label", { apply: false, label: "apply", confidence: 0.9 }, false],
    ...["false", "true", 0, 1, null, [], {}].map((value, i) => ["invalid apply " + i, { apply: value, label: "apply", confidence: 0.9 }, false]),
    ...["0.9", true, false, null, -1, 2, NaN, Infinity].map((value, i) => ["invalid confidence " + i, { apply: true, confidence: value }, false]),
    ["label-only", { label: "apply", confidence: 0.9 }, false],
    ["no confidence", { apply: true }, false],
    ["array label", { apply: true, confidence: 0.9, label: ["apply"] }, false],
    ["object reason", { apply: true, confidence: 0.9, reason: {} }, false],
    ["array decision", [], false],
    ["null decision", null, false],
  ])("handles %s without coercion or fallback", async (_name, decision, expected) => {
    const call = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).messages[0].content).toContain('"apply":true|false');
      return reply(decision);
    });
    vi.stubGlobal("fetch", call);
    const matches = await evaluateProvisions([provision], ctx, config);
    expect(matches).toHaveLength(expected ? 1 : 0);
    expect(call).toHaveBeenCalledTimes(1);
    if (expected) expect(matches[0].match.reasons[0]).toContain("micromodel:llm");
  });

  it.each([
    '{"choices":[null]}',
    '{"choices":[]}',
    JSON.stringify({ choices: [{ message: { content: { apply: true, confidence: 1 } } }] }),
    JSON.stringify({ choices: [{ message: { content: "not JSON" } }] }),
    JSON.stringify({ choices: [{ message: { content: 'prefix {"apply":true,"confidence":1}' } }] }),
    JSON.stringify({ choices: [{ message: { content: '{"apply":true,"confidence":1e400}' } }] }),
    "not an envelope",
    "[]",
    "null",
  ])("rejects malformed response %s even when fallback keywords match", async raw => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(raw)));
    expect(await evaluateProvisions([provision], ctx, config)).toEqual([]);
  });

  it("evaluates all offline tiers with zero provider calls and preserves online fallback", async () => {
    const call = vi.fn(async () => new Response("Unavailable fixture", { status: 503 }));
    vi.stubGlobal("fetch", call);
    const all = stored({
      mode: "all",
      semantic: { exemplars: ["synthetic request"], threshold: 0.3 },
      micromodel: micro,
    });
    const offline = await evaluateProvisions([all], ctx, config, { offlineOnly: true });
    expect(offline).toHaveLength(1);
    expect(offline[0].match.matched_tiers).toEqual(["semantic", "micromodel"]);
    expect(offline[0].match.reasons[0]).toContain("semantic:cosine");
    expect(offline[0].match.reasons[1]).toContain("micromodel:fallback");
    expect(call).not.toHaveBeenCalled();

    const online = await evaluateProvisions([all], ctx, config);
    expect(online).toHaveLength(1);
    // The Worker's semantic implementation is local even in online mode.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(config.HERMA_MICROMODEL_URL);
    expect(online[0].match.reasons[1]).toContain("micromodel:fallback");
  });
});
