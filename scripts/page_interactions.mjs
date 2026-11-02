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
{ // prompts: name the worker, filter, copy
  const { page, errors } = await open("/prompts");
  await page.fill("#inp-agent", "my-test-worker-ab12");
  const text = await page.locator("#pre-master_v3").textContent();
  check(text.includes("my-test-worker-ab12"), "the prompts fill in the worker name");
  await page.click('.chip[data-filter="evaluation"]');
  const visible = await page.locator(".prompt:visible").count();
  check(visible === 1, `the Reviews chip leaves one prompt (got ${visible})`);
  check((await page.locator('.chip[aria-pressed="true"]').getAttribute("data-filter")) === "evaluation", "the chip is marked pressed");
  await page.click('.chip[data-filter="all"]');
  check((await page.locator(".prompt:visible").count()) === 10, "All shows every prompt");
  await page.locator("#card-master_v3 .copy-btn").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip.includes("my-test-worker-ab12") && clip.length > 2000, "Copy the prompt puts the filled text on the clipboard");
  check((await page.locator("#card-master_v3 .copy-btn").textContent()) === "Copied", "the button says Copied");
  await page.click("#btn-mint-uuid");
  await page.waitForFunction(() => /did not (answer|give)/.test(document.getElementById("mint-status").textContent), null, { timeout: 8000 });
  check(true, "the worker id button reports when the queue does not answer");
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
{ // home inspector
  const { page, errors } = await open("/");
  await page.click('[data-herma-preset="tasks"]');
  await page.waitForFunction(() => /refused|Checked|network/.test(document.getElementById("herma-preview-status").textContent), null, { timeout: 8000 });
  check(true, "the preview button answers (the fixture server has no preview API, so it reports that)");
  check(errors.length === 0, `home has no console errors ${errors.join(" | ")}`);
}
{ // the banner's own panel opens
  const { page, errors } = await open("/connect");
  await page.locator("ta-agent-banner").getByRole("button", { name: /How/ }).click();
  check(await page.locator("ta-agent-banner").getByText("Paste this into your agent").isVisible(), "the banner's How panel opens");
  check(errors.length === 0, `connect has no console errors ${errors.join(" | ")}`);
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall interactions work");
process.exit(failures ? 1 : 0);
