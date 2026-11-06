import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { canonicalRedirect, isPageNavigation } from "../deploy/cloudflare/canonical_host.js";

// One canonical host for people: shim.teleionlabs.com (herma.teleionlabs.com is served in place). On another host only a page navigation redirects: a GET or HEAD for a page that asks for HTML gets a 301,
// anything else sent to a page a 308, and the path and the query are kept. What machines read and write answers in place, so the live workers' curl calls to the
// old address keep working (the same choice Eranos made in 8c3af96).
const on = { CANONICAL_REDIRECT: "on" };
const request = (url, init = {}) => new Request(url, init);
const OLD = "https://herma.ta-amps.workers.dev";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

const PAGES = [
  "/", "/shim", "/console", "/connect", "/starter", "/starter/frontier", "/prompts", "/prompts/some_prompt", "/get-started", "/trust", "/dashboard", "/dashboard/",
  "/dashboard/anything", "/kits", "/c/portable_agent_kit_v1", "/w/w_agent_muse-worker-01", "/q/demo/demo_dual_side_hybrid_search_v1",
];
const MACHINE = [
  "/q/claim", "/q/submit", "/q/pulse", "/q/network", "/q/search", "/q/onboard/x", "/q/help", "/q/leaderboard", "/q/objects", "/q/prompts.js", "/q/dashboard",
  "/healthz", "/health", "/status", "/help", "/chat", "/chat/x", "/feedback", "/connect.json", "/llms.txt", "/llms-full.txt", "/robots.txt", "/favicon.svg",
  "/.well-known/agent-card.json", "/agent-start.json", "/agent-start.js", "/agent-start.css", "/preview.js", "/dashboard.js", "/prompts.js", "/kits.js",
  "/kits/herma-agent-kit.tgz", "/kits/herma-worker-kit.zip", "/kits/SKILL.md", "/prompts/raw/worker_loop", "/api/preview", "/api/conversation-schema",
  "/api/object/x", "/v1/handshake", "/v1/conversations/turn", "/mcp", "/bridge", "/bridge/x", "/experiments", "/reprioritize", "/assets/herma-pages.css",
];

describe("canonicalRedirect", () => {
  it("sends a page navigation on another host to the canonical host with a 301 (GET and HEAD)", () => {
    for (const path of PAGES) {
      for (const method of ["GET", "HEAD"]) {
        const res = canonicalRedirect(request(`${OLD}${path}?q=shelter`, { method, headers: BROWSER }), on);
        expect(res.status, `${method} ${path}`).toBe(301);
        expect(res.headers.get("location")).toBe(`https://shim.teleionlabs.com${path}?q=shelter`);
        expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
        expect(res.headers.get("vary")).toBe("accept"); // the answer for this address depends on what the request asks for
      }
    }
  });

  it("answers a request that does not ask for HTML in place, for every page: curl, a script, a JSON client", () => {
    for (const path of PAGES) {
      for (const headers of [{}, { accept: "*/*" }, { accept: "application/json" }, { accept: "text/plain" }, { accept: "application/json, text/html" }]) {
        expect(canonicalRedirect(request(`${OLD}${path}`, { headers }), on), `${path} ${JSON.stringify(headers)}`).toBeNull();
      }
    }
  });

  it("answers the JSON form of a page in place, even for a browser", () => {
    for (const path of ["/dashboard", "/prompts", "/starter", "/kits", "/c/portable_agent_kit_v1", "/w/w_agent_muse-worker-01"]) {
      expect(canonicalRedirect(request(`${OLD}${path}?format=json`, { headers: BROWSER }), on), `${path}?format=json`).toBeNull();
      expect(canonicalRedirect(request(`${OLD}${path}?q=x&format=json`, { headers: BROWSER }), on), `${path}?q=x&format=json`).toBeNull();
    }
  });

  it("keeps the method of anything else sent to a page with a 308", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = canonicalRedirect(request(`${OLD}/dashboard`, { method }), on);
      expect(res.status, method).toBe(308);
      expect(res.headers.get("location")).toBe("https://shim.teleionlabs.com/dashboard");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    // ...unless the sender asked for JSON, which is a machine talking
    expect(canonicalRedirect(request(`${OLD}/dashboard`, { method: "POST", headers: { accept: "application/json" } }), on)).toBeNull();
    expect(canonicalRedirect(request(`${OLD}/dashboard?format=json`, { method: "POST" }), on)).toBeNull();
  });

  it("answers what machines use in place, whatever the method and whatever the Accept header says", () => {
    for (const path of MACHINE) {
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
        for (const headers of [{}, BROWSER]) {
          expect(canonicalRedirect(request(`${OLD}${path}`, { method, headers }), on), `${method} ${path}`).toBeNull();
        }
      }
    }
  });

  it("keeps the plain-text prompts for agents in place even when a browser asks for them, and answers a CORS preflight where it arrives", () => {
    expect(canonicalRedirect(request(`${OLD}/prompts/raw/worker_loop`, { headers: BROWSER }), on)).toBeNull();
    for (const path of ["/prompts/raw/", "/prompts/raw"]) expect(canonicalRedirect(request(`${OLD}${path}`, { headers: BROWSER }), on), path).toBeNull();
    expect(canonicalRedirect(request(`${OLD}/prompts/worker_loop`, { headers: BROWSER }), on)?.status).toBe(301); // the page about a prompt is a page
    expect(canonicalRedirect(request(`${OLD}/dashboard`, { method: "OPTIONS", headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request(`${OLD}/q/claim`, { method: "OPTIONS" }), on)).toBeNull();
    expect(isPageNavigation(request(`${OLD}/dashboard`, { headers: BROWSER }))).toBe(true);
    expect(isPageNavigation(request(`${OLD}/dashboard`))).toBe(false);
    expect(isPageNavigation(request(`${OLD}/q/claim`, { method: "POST", headers: BROWSER }))).toBe(false);
  });

  it("never turns a path into another site (no open redirect)", () => {
    for (const path of ["/c//example.com/x", "/w///example.com", "/c/%2F%2Fexample.com", "/q/demo//example.com", "/c/\\example.com", "/dashboard//example.com", "/starter//example.com"]) {
      const res = canonicalRedirect(request(`${OLD}${path}`, { headers: BROWSER }), on);
      expect(new URL(res.headers.get("location")).origin, path).toBe("https://shim.teleionlabs.com");
    }
    for (const path of ["//example.com/x", "///example.com", "/\\example.com", "/%2F%2Fexample.com"]) {
      expect(canonicalRedirect(request(`${OLD}${path}`, { headers: BROWSER }), on), path).toBeNull(); // not a page: served here (a 404), never redirected anywhere
    }
  });

  it("leaves the canonical host, local hosts and an unset or off switch alone", () => {
    expect(canonicalRedirect(request("https://shim.teleionlabs.com/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request("https://SHIM.TELEIONLABS.COM/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request("https://herma.teleionlabs.com/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request("https://HERMA.TELEIONLABS.COM/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request("http://localhost:8787/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request("http://127.0.0.1:8787/dashboard", { headers: BROWSER }), on)).toBeNull();
    expect(canonicalRedirect(request(`${OLD}/dashboard`, { headers: BROWSER }), {})).toBeNull();
    expect(canonicalRedirect(request(`${OLD}/dashboard`, { headers: BROWSER }), { CANONICAL_REDIRECT: "off" })).toBeNull();
  });
});

describe("the Worker with the redirect on", () => {
  const redirecting = { ...env, CANONICAL_REDIRECT: "on" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const json = (body, headers = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("serves a POST to /q/claim on the old address in place, as the live workers' curl calls need", async () => {
    const res = await worker.fetch(request(`${OLD}/q/claim?x=1`, json({ agent_id: "canonical-test-agent-1" })), redirecting, ctx);
    expect(res.status).toBe(200); // a claim answered here, not a 308
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body.bilateral_guidance?.worker_profile?.worker_uuid || body.ok).toBeTruthy();
  });

  it("serves a POST to /q/claim in place even when the caller also accepts HTML, and a POST to /q/submit too", async () => {
    const claim = await worker.fetch(request(`${OLD}/q/claim`, json({ agent_id: "canonical-test-agent-2" }, { accept: "text/html,*/*" })), redirecting, ctx);
    expect(claim.status).toBe(200);
    expect(claim.headers.get("location")).toBeNull();
    const submit = await worker.fetch(request(`${OLD}/q/submit`, json({ agent_id: "canonical-test-agent-2" })), redirecting, ctx);
    expect([301, 302, 303, 307, 308]).not.toContain(submit.status); // answered here: whatever it says about the body, it is not a redirect
    expect(submit.headers.get("location")).toBeNull();
  });

  it("serves the machine paths on the old address in place, and the JSON form of a page", async () => {
    for (const path of ["/q/pulse", "/healthz", "/llms.txt", "/connect.json", "/dashboard?format=json", "/prompts/raw/worker_loop"]) {
      const res = await worker.fetch(request(`${OLD}${path}`, { headers: BROWSER }), redirecting, ctx);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
    const search = await worker.fetch(request(`${OLD}/q/search`, json({ q: "shelter" })), redirecting, ctx);
    expect(search.status).toBe(200); // a POST to a machine path
    // a curl read of the kits catalog (no Accept: text/html) is answered here with its JSON, and so is a JSON read of a worker profile
    const catalog = await worker.fetch(request(`${OLD}/kits`, { headers: { accept: "*/*" } }), redirecting, ctx);
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("location")).toBeNull();
    expect(catalog.headers.get("content-type")).toContain("json");
    for (const path of ["/w/w_agent_muse-worker-01?format=json", "/c/portable_agent_kit_v1?format=json", "/starter?format=json"]) {
      const res = await worker.fetch(request(`${OLD}${path}`, { headers: BROWSER }), redirecting, ctx);
      expect([301, 308], path).not.toContain(res.status);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.headers.get("content-type"), path).toContain("json");
    }
    // a script that asks for a page without asking for HTML gets the page here, not a redirect it may not follow
    const plain = await worker.fetch(request(`${OLD}/get-started`, { headers: { accept: "*/*" } }), redirecting, ctx);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("location")).toBeNull();
  });

  it("redirects the pages on the old address when a browser asks for them, keeping the path and the query", async () => {
    for (const path of ["/", "/dashboard?q=shelter", "/prompts", "/get-started", "/trust", "/starter", "/kits", "/w/w_agent_muse-worker-01"]) {
      const res = await worker.fetch(request(`${OLD}${path}`, { headers: BROWSER }), redirecting, ctx);
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location")).toBe(`https://shim.teleionlabs.com${path}`);
    }
    const posted = await worker.fetch(request(`${OLD}/dashboard`, { method: "POST", body: "{}" }), redirecting, ctx);
    expect(posted.status).toBe(308);
  });

  it("answers normally on the canonical host", async () => {
    const res = await worker.fetch(request("https://herma.teleionlabs.com/healthz"), redirecting, ctx);
    expect(res.status).toBe(200);
    const page = await worker.fetch(request("https://herma.teleionlabs.com/get-started", { headers: BROWSER }), redirecting, ctx);
    expect(page.status).toBe(200);
  });
});
