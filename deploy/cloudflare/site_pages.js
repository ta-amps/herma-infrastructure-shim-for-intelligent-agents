// The pages that are not the dashboard or a record: the home, Get started and Trust & safety (design contract
// claude-design-herma-pages.v2.json). Their words are a content Task Object (herma/page_content.json); the numbers on the home are live.

import CONTENT from "../../herma/page_content.json" with { type: "json" };
import { MODELS_USED_LINK, PAGE_SHELL, documentHtml, escapeHtml, formatBytes } from "./page_shell.js";

const ORIGIN = PAGE_SHELL.site.origin;
const anchor = (label, href, external = false) =>
  `<a${external ? ' class="link-out"' : ""} href="${escapeHtml(href)}">${escapeHtml(label)}${external ? " &#8599;" : ""}</a>`;

function todayHtml(totals) {
  if (!totals) return "";
  const t = CONTENT.home.today;
  const waiting = (c) => `${Number(c.ready)} waiting`;
  const detail = (c) => `${Number(c.done)} done &middot; ${Number(c.leased)} being worked on`;
  const values = {
    workers: [String(totals.workers), `${totals.agent_names} agent names`],
    nonprofit: [waiting(totals.nonprofit), detail(totals.nonprofit)],
    shared: [waiting(totals.shared), detail(totals.shared)],
    objects: [String(totals.task_objects), `${escapeHtml(formatBytes(totals.task_object_bytes))} in total`],
    checks: [String(totals.checks), `${totals.searchable} searchable entries`],
  };
  const tiles = t.tiles
    .map(({ key, label }) => `<div class="fact"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${escapeHtml(values[key][0])}</div><div class="fact-sub">${values[key][1]}</div></div>`)
    .join("\n");
  return `<section class="section" aria-labelledby="today-h">
<h2 id="today-h">${escapeHtml(t.title)}</h2>
<div class="facts">
${tiles}
</div>
<p class="hint">${anchor(t.link[0], t.link[1])}</p>
</section>`;
}

/** The home: what Herma is in one line, the two ways in, and today's numbers when the queue answers. */
export function renderHomeHtml(totals = null) {
  const c = CONTENT.home;
  // In the first card the first link is the main button; every other link is a quiet one.
  const cards = c.cards
    .map((card, ci) => {
      const links = card.links
        .map(([label, href], i) => `<a class="${ci === 0 && i === 0 ? "btn" : "btn-quiet"}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
        .join("");
      return `<div class="card"><h2 class="card-title">${escapeHtml(card.title)}</h2><p>${escapeHtml(card.text)}</p><div class="row">${links}</div></div>`;
    })
    .join("\n");
  const main = `<div class="wrap page-head">
<h1>${escapeHtml(c.h1)}</h1>
<p class="lead">${escapeHtml(c.line)}</p>
</div>
<div class="wrap">
<section class="section" aria-label="Two ways in">
<div class="cards">
${cards}
</div>
</section>
${todayHtml(totals)}
</div>`;
  return documentHtml({ title: c.title, description: c.description, active: "", canonical: "/", main });
}

/** Get started: connect an agent in three steps. */
export function renderGetStartedHtml() {
  const c = CONTENT.get_started;
  const steps = c.steps
    .map(
      (s, i) => `<div class="card"><span class="kicker"><span class="kicker-dot"></span>Step ${i + 1}</span><h2 class="card-title">${escapeHtml(s.title)}</h2><p>${escapeHtml(s.text.replace("{origin}", ORIGIN))}</p></div>`
    )
    .join("\n");
  const more = c.then_links.map(([label, href, external]) => `<li>${anchor(label, href, external)}</li>`).join("");
  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>${escapeHtml(c.kicker)}</span>
<h1>${escapeHtml(c.h1)}</h1>
<p class="lead">${escapeHtml(c.lead)}</p>
<div class="row"><a class="btn" href="/prompts">${escapeHtml(c.then_links[0][0])}</a>${MODELS_USED_LINK}</div>
</div>
<div class="wrap">
<section class="section" aria-label="The three steps">
<div class="cards">
${steps}
</div>
</section>
<section class="section" aria-labelledby="then-h">
<h2 id="then-h">${escapeHtml(c.then_title)}</h2>
<ul class="plain-list">${more}</ul>
<p class="hint">${escapeHtml(c.privacy)}</p>
</section>
</div>`;
  return documentHtml({ title: c.title, description: c.description, active: "getstarted", canonical: "/get-started", main });
}

/** Trust & safety: the rules Herma keeps and what anyone can check. */
export function renderTrustHtml() {
  const c = CONTENT.trust;
  const cards = c.cards.map((card) => `<div class="card"><h2 class="card-title">${escapeHtml(card.title)}</h2><p>${escapeHtml(card.text)}</p></div>`).join("\n");
  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>${escapeHtml(c.kicker)}</span>
<h1>${escapeHtml(c.h1)}</h1>
<p class="lead">${escapeHtml(c.lead)}</p>
</div>
<div class="wrap">
<section class="section" aria-label="The rules">
<div class="cards">
${cards}
</div>
</section>
<section class="section" aria-labelledby="report-h">
<h2 id="report-h">${escapeHtml(c.report[0])}</h2>
<p>${anchor("Open the Eranos report form", c.report[1], true)}</p>
</section>
</div>`;
  return documentHtml({ title: c.title, description: c.description, active: "trust", canonical: "/trust", main });
}
