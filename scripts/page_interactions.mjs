// Clicks through the interactive parts of the redesigned pages (fixture server, the Worker's real page policy) and fails on a
// console error or a handler that does nothing: dashboard search, the prompt filter, copy and worker id, the demo walkthrough,
// the home preview and the banner's panel.   node scripts/page_interactions.mjs   (`make page-check`)
import { chromium } from "playwright";
import { start } from "./page_fixtures_server.mjs";

const { server, port } = await start(Number(process.env.PAGE_CHECK_PORT || 7790));
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"] });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures += 1; };
async function open(route) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(base + route, { waitUntil: "networkidle" });
  return { page, errors };
}

{ // dashboard search
  const { page, errors } = await open("/dashboard");
  await page.fill("#q-input", "shelter");
  await page.click("#btn-run-search");
  await page.waitForSelector("#search-results-box:not([hidden]) table", { timeout: 8000 });
  const rows = await page.locator("#search-results-box tbody tr").count();
  check(rows === 5, `dashboard search shows 5 results (got ${rows})`);
  const text = await page.locator("#search-results-box").innerText();
  check(/31 found/.test(text), "dashboard search says how many it found");
  check(await page.locator("#search-results-box").count() === 1, "the results are swapped into the one results box");
  // Without JavaScript the same form opens the page with the results already in it.
  await page.goto(base + "/dashboard?q=shelter", { waitUntil: "networkidle" });
  check(await page.locator("#search-results-box:not([hidden]) tbody tr").count() === 5, "the search also works as a plain page");
  check(await page.inputValue("#q-input") === "shelter", "the search box keeps what was typed");
  check(await page.locator("details.fold").count() >= 3, "long lists are folded");
  await page.locator("details.fold >> nth=0").locator("summary").click();
  check(errors.length === 0, `dashboard has no console errors ${errors.join(" | ")}`);
}
{ // prompts: a short page of links, the universal worker prompt first, no script
  const { page, errors } = await open("/prompts");
  const links = await page.locator("ol.prompt-list li a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check(links.length >= 12, `the prompts page links every prompt (${links.length})`);
  check(/\/prompts\/raw\/universal-worker\.txt$/.test(links[0] || ""), "the universal worker prompt is first");
  check(links.every((href) => /\/prompts\/raw\/[\w-]+\.txt$/.test(href)), "each link opens a .txt prompt");
  check(errors.length === 0, `prompts has no console errors ${errors.join(" | ")}`);
}
{ // demo walkthrough
  const { page, errors } = await open("/q/demo/demo_dual_side_hybrid_search_v1");
  const before = await page.locator(".step-item.active .step-title").textContent();
  await page.click("#btn-next");
  const after = await page.locator(".step-item.active .step-title").textContent();
  check(before !== after, "Next step moves the walkthrough");
  check((await page.locator("#btn-play").getAttribute("aria-pressed")) === "false", "stepping pauses the walkthrough");
  await page.click("#btn-play");
  check((await page.locator("#btn-play").textContent()) === "Pause", "Play starts it again");
  check(errors.length === 0, `demo has no console errors ${errors.join(" | ")}`);
}
{ // the home: one line, two ways in, today's numbers, and the banner above the header
  const { page, errors } = await open("/");
  check((await page.locator("h1").innerText()) === "Teleion Fabric", "the home heading is Teleion Fabric");
  check((await page.locator(".facts .fact").count()) === 5, "the home shows the five totals");
  check(await page.getByRole("link", { name: "Try the shim" }).isVisible(), "the home links the shim page");
  check(errors.length === 0, `the home has no console errors ${errors.join(" | ")}`);
}
{ // the shim page (the old overview): the inspector
  const { page, errors } = await open("/shim");
  await page.click('[data-herma-preset="tasks"]');
  await page.waitForFunction(() => /refused|Checked|network/.test(document.getElementById("herma-preview-status").textContent), null, { timeout: 8000 });
  check(true, "the preview button answers (the fixture server has no preview API, so it reports that)");
  check(errors.length === 0, `the shim page has no console errors ${errors.join(" | ")}`);
}
{ // the banner's own panel opens
  const { page, errors } = await open("/connect");
  await page.locator("ta-agent-banner").getByRole("button", { name: /How/ }).click();
  check(await page.locator("ta-agent-banner").getByText("Paste this into your agent").isVisible(), "the banner's How panel opens");
  check(errors.length === 0, `connect has no console errors ${errors.join(" | ")}`);
}
{ // no page scrolls sideways on a phone, and none names an agent app (those appear only on Models used)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const { PAGE_ROUTES } = await import("./page_fixtures_server.mjs");
  const apps = /\b(Claude Code|Codex|OpenCode|Antigravity|Gemini CLI|Cursor)\b/;
  for (const route of PAGE_ROUTES) {
    const page = await phone.newPage();
    await page.goto(base + route, { waitUntil: "networkidle" });
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    check(width.scroll <= width.client + 1, `${route} fits a phone without sideways scrolling (${width.scroll} of ${width.client})`);
    const text = await page.evaluate(() => document.body.innerText);
    check(!apps.test(text), `${route} names no agent app`);
    await page.close();
  }
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall interactions work");
process.exit(failures ? 1 : 0);
