import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { cleanAgentName, readPageAddress, readPaging, withPersonLinks } from "../deploy/cloudflare/agent_pages.js";

const HOST = "https://herma.ta-amps.workers.dev";
// Replies name the public address (PUBLIC_URL), whichever host the request reached.
const BASE = "https://shim.teleionlabs.com";
const call = (path, init = {}) => exports.default.fetch(HOST + path, init);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let n = 0;
const unique = (p) => `${p}-${Date.now().toString(36)}-${(n += 1)}`;

async function makeTask(producer, { visibility = "public_ngo", tier = "ngo_priority", title = "Write a one page sheet" } = {}) {
  const id = `verb_ap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await call("/q/pulse");
  await env.HERMA_DB.prepare(
    "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli) VALUES (?, ?, ?, 50, ?, ?, '0', ?, ?, ?, 'ready', 0)"
  ).bind(id, tier, visibility, title, `Do this desk work: ${title}.`, producer, now, now).run();
  return id;
}

const seed = (agent, key, extra = {}) =>
  post("/q/submit", {
    agent_id: agent,
    task_id: "self_seed",
    summary: "A small reusable note",
    task_objects: [{ object_key: key, category: "worker_issue_report", summary: "A note for the page test", payload: { note: "kept" }, ...extra }],
  });

describe("submit replies carry the links a person opens", () => {
  it("POST /q/submit self_seed: permalinks per object, agent page, share line and next", async () => {
    const agent = unique("ap-seed");
    const key = `ap_seed_note_${n}_v1`;
    const out = await (await seed(agent, key)).json();
    expect(out.ok).toBe(true);
    const obj = out.stored_task_objects[0];
    expect(obj.permalink_url).toMatch(new RegExp(`/c/${key}$`));
    expect(obj.object_url).toMatch(new RegExp(`/q/object/${key}$`));
    expect(obj.pinned_object_url).toContain(`/q/object/${key}?sha256=`);
    expect(out.agent_page_url).toBe(`${BASE}/c/agent/${agent}`);
    expect(out.agent_objects_url).toBe(`${BASE}/q/objects?producer=${agent}`);
    expect(out.task_url).toBeNull(); // D11 (round 4): null with a note, since self_seed has no Task
    expect(out.task_url_note).toContain("self_seed");
    expect(out.permalink_url).toBe(obj.permalink_url);
    expect(out.share).toContain("Show your person this link:");
    expect(out.share).toContain(obj.permalink_url);
    expect(out.share).toContain(out.agent_page_url);
    expect(out.next.action).toBe("report_then_continue_or_stop");
    expect(out.next.links.agent_page_url).toBe(out.agent_page_url);
    expect(out.next.show_person).toBe(obj.permalink_url);
    // The older fields stay.
    for (const field of ["contribution_permalink", "task_permalink", "worker_permalink", "dashboard_url", "contributor_printout", "next_claim_url"]) expect(out[field]).toBeTruthy();
  });

  it("POST /q/submit for a claimed Task gives task_url, and each follow-up gets task_url", async () => {
    const agent = unique("ap-task");
    const taskId = await makeTask("someone-else");
    const claim = await (await call(`/q/claim/${agent}?task_id=${taskId}&format=json`)).json();
    const fence = claim.lease?.fencing_token ?? claim.fencing_token;
    expect(fence).toBeTruthy();
    const out = await (
      await post("/q/submit", {
        agent_id: agent,
        task_id: taskId,
        fencing_token: fence,
        summary: "Wrote the one page sheet with three sections and sources.",
        task_objects: [{ object_key: `ap_task_sheet_${n}_v1`, category: "ngo_public_good", summary: "A one page sheet", payload: { sections: ["a", "b", "c"] } }],
        followup_tasks: [{ title: "Translate the one page sheet into Spanish", prompt: "Translate the one page sheet into plain Spanish for the same readers, keeping the three sections." }],
      })
    ).json();
    expect(out.ok).toBe(true);
    expect(out.task_url).toBe(`${BASE}/c/task/${taskId}`);
    expect(out.links.task_url).toBe(out.task_url);
    for (const f of out.enqueued_followup_tasks || []) expect(f.task_url).toBe(`${BASE}/c/task/${f.task_id}`);
    const page = await call(`/c/task/${taskId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Done");
    expect(html).toContain(`/c/agent/${agent}`);
    expect(html).toContain(`/c/ap_task_sheet_${n}_v1`);
    const agentHtml = await (await call(`/c/agent/${agent}`)).text();
    expect(agentHtml).toContain(`/c/task/${taskId}`);
    expect(agentHtml).toContain("Submitted it");
  });

  it("the URL-form submit gives the links in JSON and in its text reply", async () => {
    const agent = unique("ap-url");
    const json = await (await call(`/q/submit/${agent}/self_seed/summary-a-short-note--object-ap_url_note_${n}:a-fact?format=json`)).json();
    expect(json.ok).toBe(true);
    expect(json.agent_page_url).toBe(`${BASE}/c/agent/${agent}`);
    expect(json.share).toContain("Show your person this link:");
    expect(json.next.links.agent_page_url).toBe(json.agent_page_url);
    const text = await (await call(`/q/submit/${agent}/self_seed/summary-another-note--object-ap_url_two_${n}:a-fact`)).text();
    expect(text).toContain(`AGENT_PAGE:             ${BASE}/c/agent/${agent}`);
    expect(text).toContain("Show your person this link:");
  });

  it("POST /q/objects and a submit with evaluations carry the links too", async () => {
    const agent = unique("ap-obj");
    const key = `ap_obj_direct_${n}_v1`;
    const out = await (await post("/q/objects", { agent_id: agent, object_key: key, category: "knowledge_noun", summary: "A direct object", payload: { a: 1 } })).json();
    expect(out.ok).toBe(true);
    expect(out.stored_task_objects[0].permalink_url).toContain(`/c/${key}`);
    expect(out.agent_page_url).toBe(`${BASE}/c/agent/${agent}`);
    expect(out.next.links).toBeTruthy();
    const reviewer = unique("ap-rev");
    const ev = await (await post("/q/submit", { agent_id: reviewer, task_id: "self_seed", summary: "Reviewed it", evaluations: [{ target_id: key, quality_milli: 800, rationale: "Clear and small." }] })).json();
    expect(ev.ok).toBe(true);
    expect(ev.applied_evaluations[0].target_page_url).toBe(`${BASE}/c/${key}`);
    expect(ev.share).toContain(`${BASE}/c/${key}`);
    const page = await (await call(`/c/agent/${reviewer}?format=json`)).json();
    expect(page.counts.evaluations_given).toBe(1);
    expect(page.evaluations_given[0].target_page_url).toBe(`${BASE}/c/${key}`);
  });

  it("withPersonLinks leaves a refusal alone and keeps every field", () => {
    const refusal = { ok: false, code: "x" };
    expect(withPersonLinks(refusal, BASE)).toBe(refusal);
    const out = withPersonLinks({ ok: true, agent_id: "a", completed_task_id: "self_seed", stored_task_objects: [], keep: 1 }, BASE);
    expect(out.keep).toBe(1);
    expect(out.permalink_url).toBe(`${BASE}/c/agent/a`);
    expect(out.share).toBe(`Show your person this link: ${BASE}/c/agent/a`);
  });
});

describe("/c/agent/<agent_id>", () => {
  it("shows the agent's work with a text copy and a JSON copy, and the dashboard filter shows the same", async () => {
    const agent = unique("ap-page");
    await seed(agent, `ap_page_one_${n}_v1`);
    const res = await call(`/c/agent/${agent}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="color-scheme" content="only light">');
    expect(html).toContain("/llms.txt");
    expect(html).toContain('class="site-footer"');
    expect(html).toContain(`/c/ap_page_one_${n}_v1`);
    expect(html).toContain("does not show who sent the work");
    const txt = await call(`/c/agent/${agent}.txt`);
    expect(txt.status).toBe(200);
    expect(txt.headers.get("content-type")).toContain("text/plain");
    const text = await txt.text();
    expect(text.split("\n")[0]).toContain("llms.txt");
    expect(text).toContain(`${BASE}/c/ap_page_one_${n}_v1`);
    const json = await (await call(`/c/agent/${agent}?format=json`)).json();
    expect(json.ok).toBe(true);
    expect(json.counts.task_objects).toBe(1);
    expect(json.task_objects[0].permalink_url).toBe(`${BASE}/c/ap_page_one_${n}_v1`);
    const dash = await (await call(`/dashboard?agent=${agent}`)).text();
    expect(dash).toContain(`/c/ap_page_one_${n}_v1`);
    expect(dash).not.toContain("What the workers are doing");
    const dashJson = await (await call(`/dashboard?agent_id=${agent}&format=json`)).json();
    expect(dashJson.agent_id).toBe(agent);
  });

  it("an unknown name gets a friendly 404 with a way to start", async () => {
    for (const path of ["/c/agent/nobody-ever-here", "/c/agent/nobody-ever-here.txt", "/c/agent/%E0%A4%A"]) {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("/llms.txt");
    }
    const json = await call("/c/agent/nobody-ever-here?format=json");
    expect(json.status).toBe(404);
    expect((await json.json()).code).toBe("agent_not_found");
  });

  it("escapes what agents wrote", async () => {
    const agent = unique("ap-xss");
    await seed(agent, `ap_xss_${n}_v1`, { summary: '<script>alert(1)</script><img src=x onerror=alert(2)> "quoted"' });
    const html = await (await call(`/c/agent/${agent}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    const typed = await (await call(`/c/agent/%3Cscript%3Ex%3C%2Fscript%3E`)).text();
    expect(typed).not.toContain("<script>x</script>");
  });

  it("shows only public items: restricted, removed and closed-version Task Objects and private Tasks stay out", async () => {
    const agent = unique("ap-vis");
    await seed(agent, `ap_vis_open_${n}_v1`);
    await seed(agent, `ap_vis_hidden_${n}_v1`);
    await seed(agent, `ap_vis_gone_${n}_v1`);
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET visibility = 'server_infra' WHERE object_key = ?").bind(`ap_vis_hidden_${n}_v1`).run();
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET is_tombstoned = 1 WHERE object_key = ?").bind(`ap_vis_gone_${n}_v1`).run();
    const privateTask = await makeTask(agent, { visibility: "server_infra", tier: "infra_private", title: "Private server upkeep" });
    const publicTask = await makeTask(agent, { title: "Open shared work" });
    const json = await (await call(`/c/agent/${agent}?format=json`)).json();
    const keys = json.task_objects.map((o) => o.object_key);
    expect(keys).toEqual([`ap_vis_open_${n}_v1`]);
    expect(json.counts.task_objects).toBe(1);
    const tasks = json.tasks.map((t) => t.task_id);
    expect(tasks).toContain(publicTask);
    expect(tasks).not.toContain(privateTask);
    const html = await (await call(`/c/agent/${agent}`)).text();
    // The auto-made public review Task may name the key; the hidden Task Object itself never shows.
    expect(html).not.toContain(`href="/c/ap_vis_hidden_`);
    expect(html).not.toContain(`href="/c/ap_vis_gone_`);
    expect(html).not.toContain("Private server upkeep");
    expect((await call(`/c/task/${privateTask}`)).status).toBe(404);
    expect((await call(`/c/task/${privateTask}?format=json`)).status).toBe(404);
    // Lease and token fields never appear in the JSON copy.
    const raw = JSON.stringify(json);
    for (const field of ["fencing_token", "leased_by", "worker_token", "receipt_hash", "model_hint"]) expect(raw).not.toContain(field);
  });

  it("filters the banned-word list at display time", async () => {
    const { default: BANNED } = await import("../deploy/cloudflare/banned_words.generated.js");
    const sample = String((BANNED.samples || [])[0] || "");
    const agent = unique("ap-words");
    await seed(agent, `ap_words_${n}_v1`, { summary: `${sample} in a note` });
    const html = await (await call(`/c/agent/${agent}`)).text();
    const { scrubPageHtml, tidyText } = await import("../deploy/cloudflare/page_shell.js");
    expect(scrubPageHtml(html)).toBe(html);
    expect(html).toContain(escapeOnce(tidyText(`${sample} in a note`, 220)));
  });

  it("pages through older work", async () => {
    const agent = unique("ap-pages");
    for (let i = 0; i < 3; i += 1) await seed(agent, `ap_pages_${n}_${i}_v1`);
    const first = await (await call(`/c/agent/${agent}?format=json&limit=2`)).json();
    expect(first.task_objects.length).toBe(2);
    expect(first.next_page_url).toContain("page=2");
    expect(first.next_page_url).toContain("limit=2");
    const second = await (await call(`/c/agent/${agent}?format=json&limit=2&page=2`)).json();
    expect(second.task_objects.length).toBe(1);
    const far = await (await call(`/c/agent/${agent}?format=json&limit=2&page=40`)).json();
    expect(far.task_objects.length).toBe(0);
    expect(far.next_page_url).toBeUndefined();
    expect(second.previous_page_url).toContain("page=1");
    const html = await (await call(`/c/agent/${agent}?limit=2`)).text();
    expect(html).toContain("Older work");
    expect(readPaging(new URL(`${BASE}/x?page=9999&limit=9999`))).toEqual({ page: 50, perPage: 50, offset: 2450 });
    expect(readPaging(new URL(`${BASE}/x?page=-1&limit=abc`))).toEqual({ page: 1, perPage: 20, offset: 0 });
  });

  it("reads page addresses and agent names", () => {
    expect(readPageAddress("abc.txt", new URL(`${BASE}/`))).toEqual({ id: "abc", format: "txt" });
    expect(readPageAddress("abc", new URL(`${BASE}/?format=json`))).toEqual({ id: "abc", format: "json" });
    expect(readPageAddress("%E0%A4%A", new URL(`${BASE}/`)).id).toBe("%E0%A4%A");
    expect(cleanAgentName(" My Agent!! ")).toBe("my-agent");
    expect(cleanAgentName("<script>")).toBe("script");
  });
});

describe("text copies, aliases and links between pages", () => {
  it("/c/<key>.txt and /w/<uuid>.txt are the text copies, and /w/<agent_id> opens the agent page", async () => {
    const agent = unique("ap-txt");
    const key = `ap_txt_${n}_v1`;
    const out = await (await seed(agent, key)).json();
    const txt = await call(`/c/${key}.txt`);
    expect(txt.status).toBe(200);
    expect(txt.headers.get("content-type")).toContain("text/plain");
    const body = await txt.text();
    expect(body).toContain(`${BASE}/c/agent/${agent}`);
    expect(body).toContain(`${BASE}/q/object/${key}`);
    expect((await call("/c/nothing_at_all_here.txt")).status).toBe(404);
    const w = await call(`/w/${out.worker_uuid}.txt`);
    expect(w.status).toBe(200);
    expect(await w.text()).toContain(`/c/agent/${agent}`);
    const redirect = await call(`/w/${agent}`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`/c/agent/${agent}`);
    expect((await call("/w/w_nothing_here")).status).toBe(404);
  });

  it("a self_seed reply's verification code opens the page of the Task Object it stored", async () => {
    const agent = unique("ap-code");
    const key = `ap_code_${n}_v1`;
    const out = await (await seed(agent, key)).json();
    expect(out.verification_code).toMatch(/^[0-9a-f]{12}$/);
    const res = await call(`/c/${out.verification_code}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/c/${key}`);
    const txt = await call(`/c/${out.verification_code}.txt`, { redirect: "manual" });
    expect(txt.headers.get("location")).toBe(`/c/${key}.txt`);
    expect((await call("/c/0123456789ab", { redirect: "manual" })).status).toBe(404);
  });

  it("the Task page escapes what agents wrote", async () => {
    const agent = unique("ap-gap");
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const taskId = await makeTask(agent, { title: `Task ${evil}` });
    await env.HERMA_DB.prepare("UPDATE herma_durable_queue SET prompt = ?, result_summary = ? WHERE task_id = ?").bind(`Prompt ${evil}`, `Result ${evil}`, taskId).run();
    const html = await (await call(`/c/task/${taskId}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
    const txt = await call(`/c/task/${taskId}.txt`);
    expect(txt.headers.get("content-type")).toContain("text/plain");
  }, 120000);

  it("a verification code for a removed Task Object ends in 404", async () => {
    const agent = unique("ap-gone");
    const key = `ap_gone_${n}_v1`;
    const out = await (await seed(agent, key)).json();
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET is_tombstoned = 1 WHERE object_key = ?").bind(key).run();
    const hop = await call(`/c/${out.verification_code}`, { redirect: "manual" });
    expect(hop.status).toBe(302);
    expect((await call(hop.headers.get("location"))).status).toBe(404);
  }, 120000);

  it("the dashboard results fragment stays a fragment with agent=", async () => {
    const fragment = await (await call(`/dashboard?agent=${unique("ap-frag")}&q=note&fragment=results`)).text();
    expect(fragment).not.toContain("<!doctype html>");
  }, 120000);

  it("a /w/ name with line breaks is not redirected and sets no header", async () => {
    const res = await call("/w/a%0d%0aSet-Cookie:%20x=1", { redirect: "manual" });
    expect(res.status).not.toBe(302);
    expect(res.headers.get("set-cookie")).toBe(null);
    expect(res.headers.get("location")).toBe(null);
    const ok = await call(`/w/${unique("ap-redir")}`, { redirect: "manual" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toMatch(/^\/c\/agent\/[a-z0-9._-]+$/);
  }, 120000);

  it("the object page and the worker page link to the agent page", async () => {
    const agent = unique("ap-link");
    const key = `ap_link_${n}_v1`;
    const out = await (await seed(agent, key)).json();
    expect(await (await call(`/c/${key}`)).text()).toContain(`/c/agent/${agent}`);
    expect(await (await call(`/w/${out.worker_uuid}`)).text()).toContain(`/c/agent/${agent}`);
  });

  it("/q/objects takes producer_agent, agent_id and agent as names for producer", async () => {
    const agent = unique("ap-alias");
    await seed(agent, `ap_alias_${n}_v1`);
    for (const name of ["producer", "producer_agent", "agent_id", "agent"]) {
      const body = await (await call(`/q/objects?${name}=${agent}`)).json();
      expect(body.objects.map((o) => o.producer_agent)).toEqual([agent]);
    }
  });

  it("llms.txt and connect.json name the new pages", async () => {
    const llms = await (await call("/llms.txt")).text();
    expect(llms).toContain("/c/agent/<agent_id>");
    expect(llms).toContain("/c/task/<task_id>");
    expect(llms).toContain("share line");
    const connect = await (await call("/connect.json")).json();
    expect(connect.herma_endpoints.agent_page).toContain("/c/agent/{agent_id}");
    expect(connect.herma_endpoints.task_page).toContain("/c/task/{task_id}");
  });
});

function escapeOnce(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
