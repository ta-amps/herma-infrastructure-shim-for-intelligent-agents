import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";

const BASE = "https://shim.teleionlabs.com";
const FORBIDDEN_MODEL_RE = new RegExp("ll" + "ama", "i");
const FORBIDDEN_WORD_RE = new RegExp("syn" + "thetic", "i");

async function callWorker(path, init = {}, envOverrides = null) {
  if (envOverrides) {
    return worker.fetch(new Request(BASE + path, init), { ...env, ...envOverrides });
  }
  return exports.default.fetch(BASE + path, init);
}

describe("Public Discovery Gallery, Feeds & HTTP 206 Blob Range Streaming", () => {
  it("serves Paper & Ink /discover HTML, /discover.txt plain copy, and /discover.js progressive helper", async () => {
    const pageRes = await callWorker("/discover", { headers: { accept: "text/html" } });
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get("content-type")).toContain("text/html");
    const html = await pageRes.text();

    expect((html.match(/<h1\b/gi) || []).length).toBe(1);
    expect(html).toContain('<meta name="color-scheme" content="only light">');
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toContain("<style");
    expect(html).toContain('data-copy-url="https://github.com/');
    expect(html).not.toMatch(/href="https:\/\/github\.com\//i);
    expect(html).toContain('<video controls preload="none" src="/q/blob/');
    expect(html).not.toMatch(FORBIDDEN_MODEL_RE);
    expect(html).not.toMatch(FORBIDDEN_WORD_RE);

    const txtRes = await callWorker("/discover.txt");
    expect(txtRes.status).toBe(200);
    expect(txtRes.headers.get("content-type")).toContain("text/plain");
    const txt = await txtRes.text();
    expect(txt).toContain("Discover open-source tools, niches & media");
    expect(txt).toContain("RSS 2.0 Feed");

    const jsRes = await callWorker("/discover.js");
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get("content-type")).toContain("javascript");
    const js = await jsRes.text();
    expect(js).toContain("data-copy-url");
  });

  it("serves filterable /q/discover JSON catalog, item lookup, and 404 on unknown entry id", async () => {
    const allRes = await callWorker("/q/discover");
    expect(allRes.status).toBe(200);
    const body = await allRes.json();
    expect(body.ok).toBe(true);
    expect(body.overview.curated_entries).toBeGreaterThanOrEqual(550);
    expect(body.overview.category_count).toBe(36);
    expect(body.categories.length).toBe(36);
    expect(body.categories.every((c) => c.count > 0)).toBe(true);
    expect(body.showcase_videos.length).toBeGreaterThanOrEqual(8);

    const filteredRes = await callWorker("/q/discover?category=threejs_webgl_webgpu&q=webgpu&sort=movers");
    expect(filteredRes.status).toBe(200);
    const filtered = await filteredRes.json();
    expect(filtered.total_matches).toBeGreaterThanOrEqual(2);
    expect(filtered.entries.every((e) => e.category === "threejs_webgl_webgpu")).toBe(true);

    const firstId = filtered.entries[0].id;
    const itemRes = await callWorker(`/q/discover?id=${encodeURIComponent(firstId)}`);
    expect(itemRes.status).toBe(200);
    const itemDoc = await itemRes.json();
    expect(itemDoc.selected_item?.id).toBe(firstId);

    const missingRes = await callWorker("/q/discover?id=nonexistent_catalog_item_xyz");
    expect(missingRes.status).toBe(404);
  });

  it("serves valid JSON Feed 1.1, RSS 2.0, and Atom 1.0 syndication feeds with category filters", async () => {
    const jfRes = await callWorker("/q/feed.json?category=game_design_and_ai&limit=5");
    expect(jfRes.status).toBe(200);
    expect(jfRes.headers.get("content-type")).toContain("application/feed+json");
    const jf = await jfRes.json();
    expect(jf.version).toBe("https://jsonfeed.org/version/1.1");
    expect(jf.items.length).toBeGreaterThan(0);
    expect(jf.items.length).toBeLessThanOrEqual(5);
    expect(jf.items[0].external_url).toMatch(/^https:\/\//);

    const rssRes = await callWorker("/q/rss.xml?category=video_as_code&limit=5");
    expect(rssRes.status).toBe(200);
    expect(rssRes.headers.get("content-type")).toContain("application/rss+xml");
    const rss = await rssRes.text();
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain("<item>");
    expect(rss).toContain("/discover?item=");

    const atomRes = await callWorker("/q/atom.xml?registry=Flathub&limit=5");
    expect(atomRes.status).toBe(200);
    expect(atomRes.headers.get("content-type")).toContain("application/atom+xml");
    const atom = await atomRes.text();
    expect(atom).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(atom).toContain("<entry>");
  });

  it("streams multi-chunk binary blobs with RFC 9110 HTTP 206 Partial Content byte ranges and 416 bounds check", async () => {
    const totalLen = 200000;
    const payload = new Uint8Array(totalLen);
    for (let i = 0; i < totalLen; i += 1) {
      payload[i] = (i * 31 + 17) & 0xff;
    }

    const onboardRes = await callWorker("/q/onboard/range-test-worker-01?format=json");
    expect(onboardRes.status).toBe(200);
    const onboard = await onboardRes.json();
    const workerToken = onboard.worker_token || onboard.bilateral_guidance?.worker_profile?.worker_token || "";

    const uploadRes = await callWorker("/q/upload?agent_id=range-test-worker-01&filename=demo_clip.mp4&content_type=video/mp4", {
      method: "POST",
      headers: {
        "content-type": "video/mp4",
        ...(workerToken ? { "x-herma-worker-token": workerToken } : {}),
      },
      body: payload,
    });
    expect([200, 201]).toContain(uploadRes.status);
    const uploaded = await uploadRes.json();
    const sha = uploaded.sha256_hash || uploaded.blob?.sha256_hash;
    expect(sha).toMatch(/^[0-9a-f]{64}$/);

    const headRes = await callWorker(`/q/blob/${sha}`, { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("accept-ranges")).toBe("bytes");
    expect(headRes.headers.get("content-length")).toBe(String(totalLen));

    // Prefix range
    const r1 = await callWorker(`/q/blob/${sha}`, { headers: { range: "bytes=0-1023" } });
    expect(r1.status).toBe(206);
    expect(r1.headers.get("accept-ranges")).toBe("bytes");
    expect(r1.headers.get("content-range")).toBe(`bytes 0-1023/${totalLen}`);
    expect(r1.headers.get("content-length")).toBe("1024");
    const b1 = new Uint8Array(await r1.arrayBuffer());
    expect(b1.byteLength).toBe(1024);
    expect(Array.from(b1.subarray(0, 16))).toEqual(Array.from(payload.subarray(0, 16)));

    // Cross-chunk range straddling the 131072-byte chunk boundary
    const r2 = await callWorker(`/q/blob/${sha}`, { headers: { range: "bytes=131000-131199" } });
    expect(r2.status).toBe(206);
    expect(r2.headers.get("content-range")).toBe(`bytes 131000-131199/${totalLen}`);
    const b2 = new Uint8Array(await r2.arrayBuffer());
    expect(b2.byteLength).toBe(200);
    expect(Array.from(b2)).toEqual(Array.from(payload.subarray(131000, 131200)));

    // Suffix range
    const r3 = await callWorker(`/q/blob/${sha}`, { headers: { range: "bytes=-256" } });
    expect(r3.status).toBe(206);
    expect(r3.headers.get("content-range")).toBe(`bytes ${totalLen - 256}-${totalLen - 1}/${totalLen}`);
    const b3 = new Uint8Array(await r3.arrayBuffer());
    expect(b3.byteLength).toBe(256);
    expect(Array.from(b3)).toEqual(Array.from(payload.subarray(totalLen - 256)));

    // Out-of-bounds range -> 416
    const r4 = await callWorker(`/q/blob/${sha}`, { headers: { range: "bytes=500000-600000" } });
    expect(r4.status).toBe(416);
    expect(r4.headers.get("content-range")).toBe(`bytes */${totalLen}`);

    // JSON blob byte-range slice must not be consumed/rewritten by withoutLeaseDetails even with OPEN_WORK_LIMITS=on
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ lease_epoch: 7, fencing_token: 42, payload: "intact" }));
    const jsonUp = await callWorker("/q/upload?agent_id=range-test-worker-01&filename=meta.json&content_type=application/json", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        ...(workerToken ? { "x-herma-worker-token": workerToken } : {}),
      },
      body: jsonBytes,
    });
    expect([200, 201]).toContain(jsonUp.status);
    const jsonSha = (await jsonUp.json()).sha256_hash;
    const jsonSlice = await callWorker(`/q/blob/${jsonSha}`, { headers: { range: "bytes=0-15" } }, { OPEN_WORK_LIMITS: "on" });
    expect(jsonSlice.status).toBe(206);
    const sliceBytes = new Uint8Array(await jsonSlice.arrayBuffer());
    expect(Array.from(sliceBytes)).toEqual(Array.from(jsonBytes.subarray(0, 16)));
  });

  it("hides tombstoned, restricted, and restricted-newest-version Task Objects and strips PII from /discover and /q/discover", async () => {
    // Ensure schema is initialized via the gateway's objects setup
    await callWorker("/q/objects?limit=1");
    await env.HERMA_DB.prepare(
      `INSERT INTO herma_task_objects (object_key, version_num, category, visibility, producer_agent, summary, payload_json, sha256_hash, simhash64_hex, lsh_band_0, quality_milli, eval_count, verification_verdict, is_tombstoned, total_payload_bytes, created_at)
       VALUES
         ('pub_visible_kit_v1', 1, 'knowledge_noun', 'public_commons', 'worker-a', 'Public kit contact bob.child@gmail.com', '{}', 'sha-pub-1', 'aaaaaaaaaaaaaaaa', 'aaaa', 999, 1, 'CONFIRMED', 0, 512, '2026-11-08T05:00:00Z'),
         ('removed_secret_kit_v1', 1, 'knowledge_noun', 'public_commons', 'worker-a', 'Removed tombstoned kit', '{}', 'sha-rem-1', 'aaaaaaaaaaaaaaaa', 'aaaa', 1000, 1, 'CONFIRMED', 1, 512, '2026-11-08T05:01:00Z'),
         ('private_tier_kit_v1', 1, 'knowledge_noun', 'infra_private', 'worker-a', 'Infra private kit', '{}', 'sha-priv-1', 'aaaaaaaaaaaaaaaa', 'aaaa', 1000, 1, 'CONFIRMED', 0, 512, '2026-11-08T05:02:00Z'),
         ('superseded_kit_v1', 1, 'knowledge_noun', 'public_commons', 'worker-a', 'Older public version', '{}', 'sha-sup-1', 'aaaaaaaaaaaaaaaa', 'aaaa', 1000, 1, 'CONFIRMED', 0, 512, '2026-11-08T05:03:00Z'),
         ('superseded_kit_v1', 2, 'knowledge_noun', 'server_infra', 'worker-a', 'Newer restricted version', '{}', 'sha-sup-2', 'aaaaaaaaaaaaaaaa', 'aaaa', 1000, 1, 'CONFIRMED', 0, 512, '2026-11-08T05:04:00Z')`
    ).run();

    const apiRes = await callWorker("/q/discover");
    expect(apiRes.status).toBe(200);
    const body = await apiRes.json();
    const keys = body.live_task_objects.map((o) => o.object_key);
    expect(keys).toContain("pub_visible_kit_v1");
    expect(keys).not.toContain("removed_secret_kit_v1");
    expect(keys).not.toContain("private_tier_kit_v1");
    expect(keys).not.toContain("superseded_kit_v1");
    const visible = body.live_task_objects.find((o) => o.object_key === "pub_visible_kit_v1");
    expect(visible.review_state).toBe("reviewed");
    expect(visible.summary).not.toContain("bob.child");

    const htmlRes = await callWorker("/discover", { headers: { accept: "text/html" } });
    const html = await htmlRes.text();
    expect(html).toContain("pub visible kit v1");
    expect(html).not.toContain("bob.child");
    expect(html).not.toContain("removed secret kit v1");
    expect(html).not.toContain("private tier kit v1");
    expect(html).not.toContain("superseded kit v1");
  });
});
