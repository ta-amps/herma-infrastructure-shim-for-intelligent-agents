// The light check (owner rule 13: light only, everywhere). A browser opens every redesigned Herma page under BOTH colour
// schemes and fails on any of these:
//   - the page does not pin `color-scheme: only light` in its <meta> tag and on :root (plain `light` is not enough);
//   - a stylesheet holds a `prefers-color-scheme` media query (any dark media query is a failure);
//   - an opaque element larger than 5% of the screen has a background darker than relative luminance 0.25 (a drawn canvas
//     counts by its average pixel), in either colour scheme, on a desktop or a phone screen;
//   - the page looks different under the dark scheme (the body background must be the same in both).
// It fails closed: a missing browser, an unreachable page or an unreadable stylesheet is a failure, never a skip.
//
//   node scripts/light_check.mjs                          local fixtures, rendered by the Worker's own page modules
//   node scripts/light_check.mjs --base https://herma.teleionlabs.com [--routes /,/dashboard]   a deployed site (GETs only)
//
// Playwright comes from this repo's devDependencies (`npm ci`; browsers: `npx playwright install chromium`), or from
// PLAYWRIGHT_MODULE, a path to an installed playwright package.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const external = flag("--base");
const routeArg = flag("--routes");

const LIVE_ROUTES = ["/", "/shim", "/connect", "/starter", "/prompts", "/get-started", "/trust", "/dashboard", "/discover", "/models", "/c/portable_autonomous_worker_agent_kit_v1", "/w/w_agent_muse-worker-01", "/q/demo/demo_dual_side_hybrid_search_v1", "/kits"];
const SCHEMES = ["light", "dark"];
const SCREENS = [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }];

async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE, "index.mjs")).href);
  candidates.push("playwright");
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium;
    } catch { /* try the next one */ }
  }
  console.error("light check FAILED: Playwright is not installed. Run `npm ci` and `npx playwright install chromium`, or set PLAYWRIGHT_MODULE to a playwright package.");
  process.exit(1);
}

// Runs inside the page. Returns the problems it found (an empty list means the page is light).
function auditPage() {
  const problems = [];
  const toLinear = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = (r, g, b) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const parse = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css || "");
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const viewportArea = innerWidth * innerHeight;
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta || meta.content.trim().toLowerCase() !== "only light") problems.push(`meta color-scheme is "${meta ? meta.content : "missing"}", it must be "only light"`);
  const rootScheme = getComputedStyle(document.documentElement).colorScheme.trim().toLowerCase().split(/\s+/).sort().join(" ");
  if (rootScheme !== "light only") problems.push(`the root color-scheme is "${getComputedStyle(document.documentElement).colorScheme}", it must be "only light"`);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    const probe = document.createElement("span");
    probe.style.color = themeColor.content;
    document.body.append(probe);
    const c = parse(getComputedStyle(probe).color);
    probe.remove();
    if (c && luminance(c.r, c.g, c.b) < 0.25) problems.push(`theme-color ${themeColor.content} is dark`);
  }

  const scanRules = (list, where) => {
    for (const rule of list) {
      if (rule.media && /prefers-color-scheme/i.test(rule.media.mediaText || "")) problems.push(`a dark-scheme media query in ${where}: @media ${rule.media.mediaText}`);
      if (rule.style && /dark/i.test(rule.style.getPropertyValue("color-scheme") || "")) problems.push(`color-scheme "${rule.style.getPropertyValue("color-scheme")}" in ${where}`);
      if (rule.cssRules) scanRules(rule.cssRules, where);
    }
  };
  const scanSheets = (sheets, where) => {
    for (const sheet of sheets) {
      let rules = null;
      try { rules = sheet.cssRules; } catch { problems.push(`a stylesheet in ${where} cannot be read`); }
      if (rules) scanRules(rules, sheet.href || where);
    }
  };
  scanSheets(document.styleSheets, "the page");

  const seen = [];
  // The same two rules as the live watchdog: a dark element that covers more than 5% of the screen, or a dark band that is wider than
  // half the screen and taller than 8 px (a 36 px ink banner is only 4.5% of a screen, so the area rule alone misses it).
  // Buttons, links, images, video, svg and canvas may have a dark background (an ink button is allowed), as in the watchdog. A canvas is
  // still checked below by what it draws.
  const MAY_BE_DARK = /^(button|a|img|video|svg|canvas)$/i;
  const visit = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const big = area > 0.05 * viewportArea;
    const band = rect.width > 0.5 * window.innerWidth && rect.height > 8;
    const mayBeDark = MAY_BE_DARK.test(el.localName);
    if (!big && !band) return;
    const share = big ? `${Math.round((area / viewportArea) * 100)}% of the screen` : `a ${Math.round(rect.height)} px band across ${Math.round((rect.width / window.innerWidth) * 100)}% of the width`;
    const bg = parse(cs.backgroundColor);
    if (bg && !mayBeDark && luminance(bg.r, bg.g, bg.b) < 0.25 && ((big && bg.a >= 0.99) || (band && bg.a > 0.5))) {
      seen.push(`${name(el)} is an opaque dark ${big ? "panel" : "band"} (${cs.backgroundColor}, ${share})`);
    }
    if (!big) return;
    if (!mayBeDark && /gradient/i.test(cs.backgroundImage)) {
      for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) {
        const c = parse(m[0]);
        if (c && c.a >= 0.99 && luminance(c.r, c.g, c.b) < 0.25) { seen.push(`${name(el)} has a dark gradient (${m[0]}, ${share})`); break; }
      }
    }
    if (el instanceof HTMLCanvasElement && el.width && el.height) {
      try {
        const data = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
        let sum = 0; let n = 0;
        for (let i = 0; i < data.length; i += 64) { if (data[i + 3] > 250) { sum += luminance(data[i], data[i + 1], data[i + 2]); n += 1; } }
        if (n && sum / n < 0.25) seen.push(`${name(el)} is drawn dark (average luminance ${(sum / n).toFixed(2)}, ${share})`);
      } catch { /* a canvas that cannot be read is not drawn by us */ }
    }
  };
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      visit(el);
      if (el.shadowRoot) {
        scanSheets(el.shadowRoot.styleSheets, `the ${name(el)} shadow root`);
        for (const style of el.shadowRoot.querySelectorAll("style")) if (/prefers-color-scheme/i.test(style.textContent || "")) problems.push(`a dark-scheme media query in the ${name(el)} shadow root`);
        visit(el.shadowRoot.host);
        walk(el.shadowRoot);
      }
    }
  };
  visit(document.documentElement);
  walk(document);
  problems.push(...new Set(seen));
  return { problems, bodyBackground: getComputedStyle(document.body).backgroundColor };
}

const chromium = await loadPlaywright();
let server = null;
let base = external;
let routes = routeArg ? routeArg.split(",").filter(Boolean) : null;
if (!base) {
  const fixtures = await import(pathToFileURL(path.join(ROOT, "scripts/page_fixtures_server.mjs")).href);
  const started = await fixtures.start(Number(process.env.LIGHT_CHECK_PORT || 7799));
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
  routes ||= started.routes;
}
routes ||= LIVE_ROUTES;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error(`light check FAILED: the browser would not start (${String(error.message).split("\n")[0]}). Run \`npx playwright install chromium\`.`);
  server?.close();
  process.exit(1);
}

let failures = 0;
let checked = 0;
for (const screen of SCREENS) {
  for (const route of routes) {
    const backgrounds = [];
    const problems = [];
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, colorScheme: scheme });
      const page = await context.newPage();
      try {
        const response = await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 });
        if (!response) throw new Error("no response");
        if (response.status() >= 500) throw new Error(`HTTP ${response.status()}`);
        const { problems: found, bodyBackground } = await page.evaluate(auditPage);
        backgrounds.push(bodyBackground);
        problems.push(...found.map((p) => `[${scheme}] ${p}`));
      } catch (error) {
        problems.push(`[${scheme}] the page could not be checked: ${String(error.message).split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
    if (backgrounds.length === SCHEMES.length && new Set(backgrounds).size !== 1) problems.push(`the body background changes with the colour scheme: ${backgrounds.join(" vs ")}`);
    checked += 1;
    failures += problems.length;
    console.log(`${problems.length ? "FAIL" : "ok  "} ${screen.name.padEnd(7)} ${route}${problems.length ? "\n      " + [...new Set(problems)].join("\n      ") : ""}`);
  }
}
await browser.close();
server?.close();
console.log(failures ? `\nlight check FAILED: ${failures} problem(s) across ${checked} page views` : `\nlight check passed: ${checked} page views, both colour schemes, desktop and phone`);
process.exit(failures ? 1 : 0);
