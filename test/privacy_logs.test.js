import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { clientFamily } from "../deploy/cloudflare/client_family.js";

// Finding F-PRIV-LOGS-001: Herma keeps a coarse family for a visitor's browser or tool, never the full User-Agent string, and
// nothing derived from an address.
const call = (path, init) => exports.default.fetch(`https://herma.teleionlabs.com${path}`, init);

describe("clientFamily", () => {
  it("keeps one word, never a version, a device or a system", () => {
    expect(clientFamily("Mozilla/5.0 (X11; Linux x86_64; rv:99.0) Gecko/20100101 Firefox/99.0")).toBe("browser");
    expect(clientFamily("curl/8.5.0")).toBe("curl");
    expect(clientFamily("python-requests/2.32.3")).toBe("python");
    expect(clientFamily("node")).toBe("node");
    expect(clientFamily("Go-http-client/2.0")).toBe("go");
    expect(clientFamily("codex_cli_rs/0.40.0")).toBe("agent");
    expect(clientFamily("")).toBe("unknown");
    expect(clientFamily(undefined)).toBe("unknown");
    expect(clientFamily("SomethingElse/1.0 (device 12345)")).toBe("other");
    for (const word of ["browser", "curl", "python", "node", "go", "java", "agent", "other", "unknown"]) expect(clientFamily(word)).toBe(word); // idempotent
  });
});

describe("the trace log", () => {
  it("stores and shows only the family of the browser or tool", async () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:99.0) Gecko/20100101 Firefox/99.0 PrivateDeviceMarker/7";
    const joined = await call("/q/onboard", { method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify({ agent_id: "privacy-trace-agent" }) });
    expect(joined.status).toBe(200);
    const stored = await env.HERMA_DB.prepare("SELECT user_agent, cf_colo FROM herma_gateway_trace_log").all();
    expect(stored.results.length).toBeGreaterThan(0);
    for (const row of stored.results) expect(["browser", "curl", "python", "node", "go", "java", "agent", "other", "unknown", ""]).toContain(row.user_agent);
    const shown = await (await call("/q/traces?limit=50")).text();
    expect(shown).not.toContain("PrivateDeviceMarker");
    expect(shown).not.toContain("Firefox/99.0");
    expect(shown).toContain('"user_agent": "browser"');
  }, 60000);
});
