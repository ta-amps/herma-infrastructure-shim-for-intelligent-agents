import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { canonicalRedirect } from "../deploy/cloudflare/canonical_host.js";

// One canonical host: herma.teleionlabs.com. Every other host answers with a redirect that keeps the path and the query:
// 301 for GET and HEAD, 308 for everything else so a POST to /q/* keeps its method and body.
const on = { CANONICAL_REDIRECT: "on" };
const request = (url, init = {}) => new Request(url, init);

describe("canonicalRedirect", () => {
  it("sends GET and HEAD on another host to the canonical host with a 301", () => {
    for (const method of ["GET", "HEAD"]) {
      const res = canonicalRedirect(request("https://herma.ta-amps.workers.dev/dashboard?q=shelter", { method }), on);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://herma.teleionlabs.com/dashboard?q=shelter");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    }
  });

  it("keeps the method and body of anything else with a 308", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = canonicalRedirect(request("https://herma.ta-amps.workers.dev/q/claim", { method }), on);
      expect(res.status, method).toBe(308);
      expect(res.headers.get("location")).toBe("https://herma.teleionlabs.com/q/claim");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("never turns a path into another site (no open redirect)", () => {
    for (const path of ["//example.com/x", "///example.com", "/\\example.com", "/%2F%2Fexample.com"]) {
      const res = canonicalRedirect(request(`https://herma.ta-amps.workers.dev${path}`), on);
      const where = new URL(res.headers.get("location"));
      expect(where.origin, path).toBe("https://herma.teleionlabs.com");
    }
  });

  it("leaves the canonical host, local hosts and an unset or off switch alone", () => {
    expect(canonicalRedirect(request("https://herma.teleionlabs.com/q/claim", { method: "POST" }), on)).toBeNull();
    expect(canonicalRedirect(request("https://HERMA.TELEIONLABS.COM/dashboard"), on)).toBeNull();
    expect(canonicalRedirect(request("http://localhost:8787/dashboard"), on)).toBeNull();
    expect(canonicalRedirect(request("http://127.0.0.1:8787/dashboard"), on)).toBeNull();
    expect(canonicalRedirect(request("https://herma.ta-amps.workers.dev/dashboard"), {})).toBeNull();
    expect(canonicalRedirect(request("https://herma.ta-amps.workers.dev/dashboard"), { CANONICAL_REDIRECT: "off" })).toBeNull();
  });
});

describe("the Worker with the redirect on", () => {
  const redirecting = { ...env, CANONICAL_REDIRECT: "on" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  it("redirects a POST to /q/* on the old address before it reads the body", async () => {
    const res = await worker.fetch(
      request("https://herma.ta-amps.workers.dev/q/claim?x=1", { method: "POST", body: JSON.stringify({ agent_id: "a" }) }),
      redirecting,
      ctx
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://herma.teleionlabs.com/q/claim?x=1");
  });

  it("answers normally on the canonical host", async () => {
    const res = await worker.fetch(request("https://herma.teleionlabs.com/healthz"), redirecting, ctx);
    expect(res.status).toBe(200);
  });
});
