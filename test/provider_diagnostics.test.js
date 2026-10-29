import { describe, expect, it } from "vitest";
import { ERROR_BODY_BYTES, normalizeProviderError, readProviderError } from "../deploy/cloudflare/provider_diagnostics.js";

const bytes = value => new TextEncoder().encode(value);
const classify = error => normalizeProviderError(bytes(JSON.stringify({ error })));
describe("bounded provider-reported diagnostics", () => {
  it.each([
    [{ code: "unsupported_parameter", param: "parallel_tool_calls" }, "unsupported_parameter"],
    [{ message: "parallel_tool_calls is not supported" }, "unsupported_parameter"],
    [{ message: "max_tokens must be at most the model maximum" }, "output_allowance_not_supported"],
    [{ code: "model_not_found" }, "model_unavailable"],
    [{ message: "Model requested does not exist" }, "model_unavailable"],
    [{ code: 404, message: "No endpoints found that support the requested parameters" }, "no_eligible_provider_endpoint"],
    [{ code: "insufficient_quota" }, "credit_or_quota_exhausted"],
    [{ type: "invalid_request_error", message: "Your credit balance is too low" }, "credit_or_quota_exhausted"],
    [{ type: "rate_limit_error", message: "Workspace spend cap reached" }, "credit_or_quota_exhausted"],
    [{ type: "authentication_error" }, "authentication_failed"],
    [{ type: "permission_error" }, "permission_denied"],
    [{ code: "context_length_exceeded", message: "max_tokens exceeds context length" }, "context_too_large"],
    [{ type: "rate_limit_error" }, "rate_limited"],
    [{ type: "overloaded_error" }, "provider_service_unavailable"],
    [{ message: "Unrecognized provider explanation" }, "unknown"],
  ])("classifies a fixed category without echoing %j", (error, reason) => {
    expect(classify(error)).toMatchObject({ source: "provider_reported", body_state: "parsed", reason });
  });

  it("drops arbitrary fields, echoed credentials, identifiers and nested metadata", () => {
    const privateValue = "sk-" + "synthetic".repeat(8);
    for (const value of [privateValue, { nested: privateValue }, [privateValue], true, 987654321]) {
      expect(classify({ type: value, code: value, param: value, message: `Prompt ${privateValue} account acct_synthetic_private request req_synthetic_private`, metadata: { raw: privateValue } })).toEqual({ source: "provider_reported", body_state: "parsed", type: null, code: null, parameter: null, reason: "unknown" });
    }
    expect(normalizeProviderError(bytes(""), privateValue).body_state).toBe("unavailable");
    expect(classify("model not found").reason).toBe("model_unavailable");
  });

  it.each([["", "empty"], ["not json", "malformed"], ["[]", "unrecognized"], ['{"error":null}', "unrecognized"], ["x".repeat(ERROR_BODY_BYTES + 1), "oversized"]])("keeps unknown body %s unknown", (raw, state) => {
    expect(normalizeProviderError(bytes(raw))).toEqual({ source: "provider_reported", body_state: state, type: null, code: null, parameter: null, reason: "unknown" });
  });

  it("rejects invalid UTF-8 and deeply malformed JSON without retaining bytes", () => {
    expect(normalizeProviderError(new Uint8Array([255])).body_state).toBe("malformed");
    expect(normalizeProviderError(bytes("[".repeat(4000))).body_state).toBe("malformed");
  });

  it("cancels an oversized stream before retaining excess error bytes", async () => {
    let reads = 0, cancelled = false;
    const response = new Response(new ReadableStream({ pull(controller) { reads++; controller.enqueue(bytes("x".repeat(4096))); }, cancel() { cancelled = true; } }));
    expect(await readProviderError(response)).toMatchObject({ body_state: "oversized", reason: "unknown" });
    expect(reads).toBeLessThanOrEqual(ERROR_BODY_BYTES / 4096 + 2);
    expect(cancelled).toBe(true);
  });

  it("does not expose stream errors or change unavailable diagnostics", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error("SYNTHETIC private failure detail")); } }));
    expect(await readProviderError(response)).toEqual({ source: "provider_reported", body_state: "unavailable", type: null, code: null, parameter: null, reason: "unknown" });
    const locked = new Response("SYNTHETIC locked body");
    const reader = locked.body.getReader();
    expect((await readProviderError(locked)).body_state).toBe("unavailable");
    reader.releaseLock();
  });
});
