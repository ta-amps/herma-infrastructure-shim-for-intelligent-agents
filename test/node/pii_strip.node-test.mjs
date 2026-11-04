import assert from "node:assert/strict";
import { test } from "node:test";
import { stripPii, stripPiiDeep, stripPiiHtml, withoutPersonalData } from "../../deploy/cloudflare/pii_strip.js";

// Made-up, and built here so the file holds no credential-shaped string.
const SK = "sk" + "-abcdefghijklmnopqrstuvwxyz1234";
const GH = "gh" + "p_abcdefghijklmnopqrstuvwxyz1234";

const MUST_STRIP = [
  ["write to ana.perez@gmail.com today", "[email]"],
  ["reach ana on 1-617-204-8831 end", "[phone]"],
  ["reach ana on 0917-123-4567 end", "[phone]"],
  ["reach ana on +44 20 7946 0958 end", "[phone]"],
  ["reach ana on 6172048831 end", "[phone]"],
  ["reach ana on (617) 204-8831 end", "[phone]"],
  ["reach ana on 617.204.8831 end", "[phone]"],
  ["lives at 123 Maple Street, Springfield, IL 62704", "[address]"],
  ["sent to 1200 Lake Shore Dr", "[address]"],
  ["mail P.O. Box 4411 please", "[address]"],
  ["SSN 123-45-6789 on file", "[id number]"],
  ["passport number X1234567", "[id number]"],
  ["case number AB-20391", "[id number]"],
  ["connected from 8.8.4.4 today", "[ip address]"],
  ["from 2607:f8b0:4005:805:0:0:0:200e today", "[ip address]"],
  ["card 4111 1111 1111 1111 expires", "[card number]"],
  ["card 5500-0000-0000-0004 expires", "[card number]"],
  ["IBAN GB29 NWBK 6016 1331 9268 19 paid", "[bank account]"],
  ["DOB: 04/12/1987 noted", "[date of birth]"],
  ["date of birth April 12, 1987 noted", "[date of birth]"],
  ["born on 12 Apr 1987 in", "[date of birth]"],
  ["token " + SK, "[credential]"],
  ["use " + GH, "[credential]"],
  ["Authorization: Bearer abcdefghijklmnopqrstuvwx", "[credential]"],
  ["password: hunter2hunter2", "[credential]"],
  ["api_key=abcd1234efgh5678", "[credential]"],
  ["OPENAI_API_KEY=abcd1234efgh5678", "[credential]"],
  ["pay 4111111111111111 now", "[card number]"],
  ["reach ana on +639171234567 end", "[phone]"],
  ["reach ana on +254712345678 end", "[phone]"],
  ["reach ana on 09171234567 end", "[phone]"],
  ["reach ana on 0712345678 end", "[phone]"],
  ["reach ana on 617-204-8831x123 end", "[phone]"],
  ["reach ana on 011 44 20 7946 0958 end", "[phone]"],
  ["ring 617\u2011204\u20118831 now".replace("\u2011","-").replace("\u2011","\u2013"), "[phone]"],
  ["\\n6172048831 in a JSON string", "[phone]"],
  ["\\n123-45-6789 in a JSON string", "[id number]"],
  ['{"date_of_birth":"04/12/1987"}', "[date of birth]"],
  ["jos\u00e9@gmail.com wrote", "[email]"],
];

const MUST_STAY = [
  "See 2 CFR 200.329 for monitoring.",
  "Write 250-500 words on it.",
  "Runs on version 1.2.3.4 and v2.10.0.",
  "On 2026-11-04 at 12:30:45 it ran.",
  "digest 0a50d405d63ce7b7 and sha256 2527ce424b7621006c6c0736a3d41c9d6b218e1500643c433733f69deef32362",
  "Task verb_own_13e964be5af3 and verb_pub_f7615a506dcf closed.",
  "object field_adapter_posix_sqlite_v1 stored",
  "1920x1080@30fps with H.264 and 95,846,400 params",
  "7463761408 bytes peak",
  "1793723763031 ms",
  "ft_1793723763031_814b53153549",
  "PRC-29023C-01 was built",
  "99.3% against 94.0%, 150 cases, CI 0.61 to 1.01",
  "$3.46 for 1,762 rows on 2 T4",
  "EIN joins and 3 Main Ways of doing it",
  "See https://example.org/a/617-204-8831/page and `call 617-204-8831` in code.",
  "write to hello@teleionlabs.com or a@example.org; git@github.com:x/y.git; logo@2x.png",
  "std::vector and 10.0.0.1 and 127.0.0.1 and 192.168.1.1",
  "password: <your key>, api_key=$API_KEY, password: str",
  "4111 1111 1111 1112 fails its check digit",
  "Section 501(c)(3), 26 U.S.C. 170, Form 990",
  "Born in 1987 she worked.",
  "not a test EIN, such as 00-0000000 or 00-1234567",
  'API_' + 'KEY: "REPLACE_AT_DEPLOY_TIME"',
  "window_bucket 2026110413 was read",
  "2147483647 and 4294967295 are limits, 2147483648 and 4294967296 too",
  '"fence_token":"int64_monotonic_value"',
  "2023 2024 2025 2026 were the years",
  "20 Google Drive files and 5 Hard Drive bays",
  "14 Supreme Court cases, section 1.2.3.4",
  "45 CFR 164.502 and 42 U.S.C. 1983",
  "Trial 3 of 5 on 12 Maple seedlings",
];

test("each shape is replaced by its typed marker", () => {
  for (const [text, marker] of MUST_STRIP) {
    const out = stripPii(text);
    assert.ok(out.includes(marker), `${text} -> ${out}`);
  }
});

test("everything that only looks like it stays", () => {
  for (const text of MUST_STAY) assert.equal(stripPii(text), text);
});

test("a cited quote keeps a public phone and address but no email or id", () => {
  const quote = "Call 1-800-373-7888 or visit 123 Maple Street; ana@gmail.com, SSN 123-45-6789";
  const out = stripPii(quote, { quote: true });
  assert.ok(out.includes("1-800-373-7888") && out.includes("123 Maple Street"));
  assert.ok(out.includes("[email]") && out.includes("[id number]"));
});

test("JSON: identifiers, digests and code stay; prose does not", () => {
  const value = {
    id: "617-204-8831",
    object_url: "https://x.test/617-204-8831",
    created_at: "617-204-8831",
    count: 6172048831,
    summary: "reach me at 617-204-8831",
    quote: "the hotline is 1-800-373-7888",
    source_url: "https://x.test/a",
    payload: { files: { "a.py": `PHONE = '617-204-8831'  # ${SK}` }, note: "ana@gmail.com" },
    list: ["ana@gmail.com"],
  };
  const out = stripPiiDeep(value);
  assert.equal(out.id, value.id);
  assert.equal(out.object_url, value.object_url);
  assert.equal(out.created_at, value.created_at);
  assert.equal(out.count, value.count);
  assert.equal(out.summary, "reach me at [phone]");
  assert.equal(out.quote, value.quote);
  assert.equal(out.payload.files["a.py"], "PHONE = '617-204-8831'  # [credential]");
  assert.equal(out.payload.note, "[email]");
  assert.equal(stripPiiDeep({ quote: "my cell 617-204-8831" }).quote, "my cell [phone]");
  assert.equal(stripPiiDeep({ source: "Ana, ana@gmail.com" }).source, "Ana, [email]");
  assert.equal(stripPiiDeep({ status: "call ana@gmail.com" }).status, "call [email]");
  assert.equal(stripPiiDeep({ dob: "1987-04-12" }).dob, "[date of birth]");
  assert.deepEqual(out.list, ["[email]"]);
});

test("a page changes in text and readable attributes, never in scripts; code loses only emails and credentials", () => {
  const html = '<a href="/c/617-204-8831" title="617-204-8831">617-204-8831</a><script>x="617-204-8831"</script><code>617-204-8831</code>';
  assert.equal(stripPiiHtml(html), '<a href="/c/617-204-8831" title="[phone]">[phone]</a><script>x="617-204-8831"</script><code>617-204-8831</code>');
  assert.equal(stripPiiHtml('<meta name="description" content="Beta 617-204-8831"><a href="mailto:ana@gmail.com">x</a><pre>ana@gmail.com</pre>'), '<meta name="description" content="Beta [phone]"><a href="mailto:[email]">x</a><pre>[email]</pre>');
});

test("a toll-free helpline stays; a private number beside it goes", () => {
  assert.equal(stripPii("Free 1-800-373-7888. Separately, a much longer sentence goes here and then my cell 617-204-8831."), "Free 1-800-373-7888. Separately, a much longer sentence goes here and then my cell [phone].");
  for (const number of ["1-800-373-7888", "800-373-7888", "(800) 373-7888", "800.373.7888", "+1 800 373 7888", "8003737888", "18003737888",
    "1-888-373-7888", "877-373-7888", "866-373-7888", "855-373-7888", "844-373-7888", "833-373-7888", "1-800-373-7888 ext. 12"]) {
    assert.equal(stripPii(`call ${number} now`), `call ${number} now`);
  }
  for (const number of ["617-204-8831", "1-617-204-8831", "6172048831", "+44 20 7946 0958", "0917-123-4567", "880-373-7888", "1-801-373-7888", "+44 800 373 7888"]) {
    assert.equal(stripPii(`ring ${number} now`), "ring [phone] now", number);
  }
  assert.equal(stripPiiHtml('<a href="tel:18003737888">Hotline</a><a href="tel:6172048831">Ana</a>'), '<a href="tel:18003737888">Hotline</a><a href="tel:[phone]">Ana</a>');
});

test("a public number stays beside a word that says so; a bare one goes", () => {
  for (const line of ["Hotline: 617-204-8831", "Crisis line 617-204-8831.", "the helpline (617) 204-8831", "Office 0917-123-4567", "Contact us at +44 20 7946 0958", "Call 617.204.8831 today", "617-204-8831 is our office", "call 6172048831"]) {
    assert.equal(stripPii(line), line);
  }
  for (const line of ["My cell is 617-204-8831.", "Ana, 617-204-8831", "6172048831", "+44 20 7946 0958 was on the form"]) {
    assert.ok(stripPii(line).includes("[phone]"), line);
  }
  assert.equal(stripPii("Hotline 617-204-8831; ana@gmail.com"), "Hotline 617-204-8831; [email]");
});

test("the reader's second round", () => {
  assert.equal(stripPiiDeep({ patch: "password: hunter2hunter2" }).patch, "password: [credential]");
  assert.equal(stripPiiDeep({ files: { ".env": "API_KEY=abcd1234efgh5678\nPASSWORD=hunter2hunter2\nHOME=/x" } }).files[".env"], "API_KEY=[credential]\nPASSWORD=[credential]\nHOME=/x");
  assert.equal(stripPiiDeep({ files: { "a.py": "API_KEY=os.environ['K']" } }).files["a.py"], "API_KEY=os.environ['K']");
  const notes = stripPiiDeep({ files: { "notes.md": "ana@gmail.com", "b.csv": "617-204-8831", "c.py": "x = '617-204-8831'" } }).files;
  assert.deepEqual(notes, { "notes.md": "[email]", "b.csv": "[phone]", "c.py": "x = '617-204-8831'" });
  assert.equal(stripPii("token=abc123def456ghi"), "token=[credential]");
  assert.equal(stripPii("token=abcdefghijklmnop and secret: everything"), "token=abcdefghijklmnop and secret: everything");
  assert.equal(stripPii("GTIN 00012345600012"), "GTIN 00012345600012");
  assert.equal(stripPiiDeep({ demand_signal_key: "617-204-8831_c" }).demand_signal_key, "[phone] c");
  assert.equal(stripPiiDeep({ demand_signal_key: "shelter_list_c" }).demand_signal_key, "shelter_list_c");
  const page = '<script id="demo-spec-data" type="application/json">{"n":"617-204-8831"}</script><script>x="617-204-8831"</script>';
  assert.equal(stripPiiHtml(page), '<script id="demo-spec-data" type="application/json">{"n":"[phone]"}</script><script>x="617-204-8831"</script>');
});

test("the input is not changed, and text with nothing to find comes back the same", () => {
  const value = { summary: "ana@gmail.com" };
  stripPiiDeep(value);
  assert.equal(value.summary, "ana@gmail.com");
  assert.equal(stripPii("plain words only"), "plain words only");
});

test("the response wrapper: public reads are stripped, our infrastructure and skipped paths aren't, clean bodies keep their bytes", async () => {
  const opts = { paths: ["/q/"], skip: ["/q/claim"], postPaths: ["/q/search"] };
  const answer = (body) => new Response(body, { headers: { "content-type": "application/json", "content-length": String(body.length), etag: "x", digest: "d" } });
  const pii = '{"summary": "ana 617-204-8831"}';
  const read = (url, init) => withoutPersonalData(new Request(`https://x.test${url}`, init), answer(pii), opts);
  const stripped = await read("/q/object/a");
  const doc = JSON.parse(await stripped.text());
  assert.equal(doc.summary, "ana [phone]");
  assert.match(doc.personal_data_note, /stored record/);
  assert.equal(stripped.headers.get("x-personal-data-stripped"), "1");
  for (const name of ["etag", "digest", "content-length"]) assert.equal(stripped.headers.get(name), null);
  // A made-up key header buys nothing: only `trusted` does.
  const faked = await read("/q/object?key=a", { headers: { authorization: "Bearer nonsense" } });
  assert.equal(JSON.parse(await faked.text()).summary, "ana [phone]");
  const trusted = await withoutPersonalData(new Request("https://x.test/q/object/a"), answer(pii), { ...opts, trusted: true });
  assert.equal(await trusted.text(), pii);
  assert.equal(await (await read("/q/claim")).text(), pii);
  assert.equal(await (await read("/healthz")).text(), pii);
  assert.match(await (await read("/q")).text(), /\[phone\]/);
  assert.equal(await (await read("/q/submit", { method: "POST", body: "{}" })).text(), pii);
  assert.match(await (await read("/q/search", { method: "POST", body: "{}" })).text(), /\[phone\]/);
  const clean = '\uFEFF{ "summary":   "nothing here", "n": 1.0 }';
  const same = await withoutPersonalData(new Request("https://x.test/q/object/a"), new Response(new TextEncoder().encode(clean), { headers: { "content-type": "text/plain" } }), opts);
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await same.arrayBuffer()), clean);
  assert.equal(same.headers.get("x-personal-data-stripped"), null);
  const lines = await withoutPersonalData(new Request("https://x.test/q/object/a"), new Response('{"t":"a@gmail.com"}\n', { headers: { "content-type": "application/x-ndjson" } }), opts);
  assert.equal(await lines.text(), '{"t":"[email]"}\n');
  const big = await withoutPersonalData(new Request("https://x.test/q/object/a"), new Response("x".repeat(8 * 1024 * 1024 + 1), { headers: { "content-type": "text/plain" } }), opts);
  assert.equal(big.status, 413);
});

test("long hostile input stays fast", () => {
  for (const unit of ["1", "1-", "a.", "a@", "+", "`a", "a_", "born ", "passport ", "<", "1 "]) {
    const text = unit.repeat(Math.ceil(1024 * 1024 / unit.length));
    const start = Date.now();
    stripPii(text);
    stripPiiHtml(text);
    assert.ok(Date.now() - start < 2000, `${JSON.stringify(unit)} took ${Date.now() - start} ms`);
  }
});
