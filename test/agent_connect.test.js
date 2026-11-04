import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://shim.teleionlabs.com";
const call = (path, init) => exports.default.fetch(BASE + path, init);
const leases = async () => Number((await env.HERMA_DB.prepare("SELECT COUNT(*) AS n FROM herma_durable_queue WHERE state = 'leased'").first()).n);

describe("an accidental open of a work address does no work", () => {
  it("a claim with no name or a placeholder name leases nothing and says what to do", async () => {
    await call("/q/pulse");
    const before = await leases();
    for (const path of ["/q/claim", "/q/claim/", "/q/claim?task_id=t1", "/q/claim/%3CYOUR-ID%3E", "/q/claim/YOUR-ID", "/q/claim/your_id", "/q/claim/agent-name", "/q/claim/your-agent-id", "/q/claim/%20", "/q/claim?worker=foo"]) {
      const res = await call(path);
      const text = await res.text();
      expect(res.status, path).toBe(200);
      expect(text, path).toContain("NOTHING WAS DONE");
      expect(text, path).toMatch(/\/q\/claim\/agent-[0-9a-f]{8}/);
    }
    expect(await leases()).toBe(before);
  });

  it("JSON is given when asked", async () => {
    const body = await (await call("/q/claim?format=json")).json();
    expect(body).toMatchObject({ ok: false, code: "name_needed", nothing_was_done: true });
  });

  it("link previews, crawlers, prefetches and HEAD do nothing on every write route", async () => {
    const before = await leases();
    const routes = ["/q/claim/some-worker", "/q/submit/some-worker/t1/fence-1--summary-hello", "/q/release/some-worker/t1/1", "/q/heartbeat?agent_id=some-worker&task_id=t1&lease_epoch=1", "/q/onboard/some-worker"];
    for (const path of routes) {
      for (const headers of [{ "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" }, { "user-agent": "facebookexternalhit/1.1" }, { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }, { "sec-purpose": "prefetch" }]) {
        const res = await call(path, { headers });
        expect(await res.text(), path).toContain("NOTHING WAS DONE");
      }
      const head = await call(path, { method: "HEAD" });
      expect(head.status, path).toBe(200);
    }
    expect(await leases()).toBe(before);
    const worker = await env.HERMA_DB.prepare("SELECT COUNT(*) AS n FROM herma_worker_registry WHERE agent_id = 'some-worker'").first();
    expect(Number(worker.n)).toBe(0);
  });

  it("an agent's own web tool is not treated as a preview", async () => {
    for (const ua of ["ChatGPT-User/1.0", "Claude-User/1.0", "Perplexity-User/1.0", "curl/8", "python-requests/2.34", "Go-http-client/1.1", "node", ""]) {
      const res = await call("/q/claim/agent-tool-probe-1?format=json", { headers: { "user-agent": ua } });
      const body = await res.json();
      expect(body.code, ua).not.toBe("nothing_done_for_link_preview");
    }
  });

  it("catches the crawler form and common previews, but not workers with bot in their name; on_purpose=1 gets through", async () => {
    for (const ua of ["Mozilla/5.0 (compatible; SomeNewBot/1.2; +https://example.org/bot)", "http.rb/5 (Mastodon/4.2; +https://m.example/)", "Mozilla/5.0 (compatible; Cardyb/1.1; +mailto:a@b)"]) {
      expect(await (await call("/q/claim/preview-form-1", { headers: { "user-agent": ua } })).text(), ua).toContain("NOTHING WAS DONE");
    }
    for (const ua of ["my-bot/1.0", "grokbot", "agent-teams/2.0", "crewai-teams/1.0", "zoom-agent/1.0", "slurp-cli/1.0", "Mozilla/5.0 (X11; Linux) WhatsApp/2", "meta-externalfetcher/1.1"]) {
      expect((await (await call("/q/claim/preview-form-2?format=json", { headers: { "user-agent": ua } })).json()).code, ua).not.toBe("nothing_done_for_link_preview");
    }
    const purpose = await (await call("/q/claim/preview-form-3?format=json&on_purpose=1", { headers: { "user-agent": "facebookexternalhit/1.1" } })).json();
    expect(purpose.code).not.toBe("nothing_done_for_link_preview");
  });

  it("a broken escape in the name doesn't crash the Worker", async () => {
    const res = await call("/q/claim/100%25%");
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("a preview of a chat message or a bridge reply does nothing", async () => {
    for (const path of ["/q/chat?message=claim+a+task", "/bridge/some-channel/reply/some-agent/1/summary-hello", "/bridge/some-channel/inbox/some-sender/hello", "/bridge/some-channel/inbox?prompt=hello"]) {
      const res = await call(path, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
      expect(await res.text(), path).toContain("NOTHING WAS DONE");
    }
  });

  it("a submit naming a Task nobody has stores nothing", async () => {
    const res = await call("/q/submit/ghost-worker-1/no-such-task/summary-hello");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("task_not_found");
    const worker = await env.HERMA_DB.prepare("SELECT COUNT(*) AS n FROM herma_worker_registry WHERE agent_id = 'ghost-worker-1'").first();
    expect(Number(worker.n)).toBe(0);
  });
});

describe("discovery and plain answers", () => {
  it("serves the discovery files with no key", async () => {
    for (const path of ["/.well-known/mcp.json", "/.well-known/mcp/server.json", "/.well-known/mcp/server-card.json", "/.well-known/ai-plugin.json"]) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const text = await res.text();
      JSON.parse(text);
      expect(text.toLowerCase()).not.toContain("tessera");
    }
    expect((await call("/sitemap.xml")).status).toBe(200);
    expect((await call("/docs", { redirect: "manual" })).headers.get("location")).toBe("https://teleionlabs.com/docs");
  });

  it("answers a browser preflight on every path", async () => {
    for (const path of ["/", "/llms.txt", "/.well-known/mcp.json", "/nope"]) {
      const res = await call(path, { method: "OPTIONS", headers: { origin: "https://chat.example", "access-control-request-method": "GET" } });
      expect(res.status, path).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("gives plain text to a client that asks for it, and errors name the next step", async () => {
    const home = await call("/", { headers: { accept: "text/plain" } });
    expect(home.headers.get("content-type")).toContain("text/plain");
    expect(await (await call("/nope")).text()).toContain("/llms.txt");
    expect(await (await call("/mcp")).text()).toContain("/q/find");
    expect(await (await call("/q/object/no_such_key")).text()).toContain("/q/find");
  });

  it("robots keep crawlers off the work addresses and let agents' web tools in", async () => {
    const text = await (await call("/robots.txt")).text();
    const [open, crawlers] = text.split("# Search and training crawlers");
    expect(open).not.toContain("/q/claim");
    expect(crawlers).toContain("Disallow: /q/claim");
    expect(crawlers).not.toContain("ChatGPT-User");
  });
});

describe("the whole URL-only flow on a labeled Task", () => {
  it("claims, checks in, and keeps the text of ?result= and non-ASCII slugs", async () => {
    const queued = await (await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "url-flow-1", summary: "setup", queued_verbs: [{ tier: "public_general", title: "url flow test one", prompt: "Test only. Nothing to do here at all." }, { tier: "public_general", title: "url flow test two", prompt: "Test only. Nothing to do here either." }] }) })).json();
    const ids = queued.enqueued_followup_verbs.map((v) => v.task_id);
    expect(ids.length).toBe(2);
    const claim = async (id) => (await (await call(`/q/claim/url-flow-2?task_id=${id}&format=json`)).json()).lease;
    const first = await claim(ids[0]);
    expect((await call(`/q/heartbeat?agent_id=url-flow-2&task_id=${ids[0]}&lease_epoch=${first.fencing_token}`)).status).toBe(200);
    const done = await call(`/q/submit/url-flow-2/${ids[0]}?format=json&result=${encodeURIComponent("real text café 日本語")}&lease_epoch=${first.fencing_token}`);
    expect(done.status).toBe(200);
    expect(JSON.stringify(await done.json())).toContain("real text");
    const second = await claim(ids[1]);
    const slug = encodeURIComponent(`fence-${second.fencing_token}--summary-Plain-words-café-日本語--object-url_flow_key_v1:the-result`).replace(/%3A/g, ":");
    const url = `/q/submit/url-flow-2/${ids[1]}/${slug}?format=json`;
    const once = await call(url);
    expect(once.status).toBe(200);
    const again = await call(url);
    expect(again.status).toBe(200);
    expect((await again.json()).idempotent_replay).toBe(true);
    const stranger = await call(`/q/submit/url-flow-3/${ids[1]}/fence-${second.fencing_token}--summary-stranger`);
    expect(stranger.status).toBeGreaterThanOrEqual(400);
  });
});

describe("a mistyped Task id never throws work away", () => {
  it("keeps a submit that carries a Task Object", async () => {
    const res = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "typo-worker-1", task_id: "typo-task", summary: "s", task_objects: [{ object_key: "typo_key_1", summary: "s", payload: { a: "b" } }] }) });
    expect(res.status).toBe(200);
    expect((await res.json()).stored_task_objects.length).toBe(1);
  });
  it("keeps a structured result, and says plainly when plain text was not saved", async () => {
    const kept = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "typo-worker-3", task_id: "typo-task-3", result: { answer: "real work" } }) });
    expect(kept.status).toBe(200);
    const plain = await call("/q/submit/typo-worker-4/typo-task-4?result=something+real");
    expect(plain.status).toBe(404);
    expect((await plain.json()).detail).toContain("not saved");
  });
  it("refuses a POST with no work with the same plain answer", async () => {
    const res = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "typo-worker-2", task_id: "typo-task-2", summary: "s" }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("task_not_found");
  });
});
