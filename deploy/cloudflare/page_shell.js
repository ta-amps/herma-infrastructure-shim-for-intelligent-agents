// The one shell every Herma page shares: the document head, the thin agent banner, the header and the footer, plus the
// plain-language helpers the pages use (kind and state labels, sizes, dates, and tidying of text that workers wrote).
//
// The words and links come from herma/page_shell.json, which the Python app renders from too; a test keeps the two in step.
// Style: Paper & Ink, light only (owner, Nov 1, 2026). The stylesheet, fonts and shared banner script are static assets
// that Cloudflare serves before the Worker runs (herma/static/assets). Pages never carry inline styles or scripts.

import SHELL from "../../herma/page_shell.json" with { type: "json" };

export const PAGE_SHELL = SHELL;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const WORDMARK_SVG =
  '<svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<rect x="0" y="0" width="44" height="44" rx="10" fill="var(--mark-1)"/>' +
  '<rect x="56" y="0" width="44" height="44" rx="10" fill="var(--mark-2)"/>' +
  '<rect x="0" y="56" width="44" height="44" rx="10" fill="var(--mark-3)"/>' +
  '<rect x="56" y="56" width="44" height="44" rx="10" fill="var(--mark-4)"/></svg>';

const AGENT_ICON_SVG =
  '<svg class="agent-fallback-icon" viewBox="0 0 40 40" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
  '<path d="M20 12v-3h-3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
  '<rect x="12" y="14" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
  '<path d="M17 19v2M23 19v2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

// The four-tile mark, as a standalone image for the tab icon (a page's CSS variables do not reach a favicon).
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Herma">' +
  '<rect x="0" y="0" width="44" height="44" rx="10" fill="#2A5DB0"/>' +
  '<rect x="56" y="0" width="44" height="44" rx="10" fill="#B8541F"/>' +
  '<rect x="0" y="56" width="44" height="44" rx="10" fill="#11161F"/>' +
  '<rect x="56" y="56" width="44" height="44" rx="10" fill="#2A5DB0"/></svg>\n';

export function bannerHtml() {
  const noun = SHELL.banner;
  const json = JSON.stringify(noun).replace(/</g, "\\u003c");
  return (
    '<ta-agent-banner class="agent-banner" data-site="herma">\n' +
    `<script type="application/json">${json}</script>\n` +
    `<p class="agent-fallback">${AGENT_ICON_SVG}<span class="agent-fallback-lead"><b>${escapeHtml(noun.lead_strong)}</b> ${escapeHtml(noun.lead)}</span> ` +
    `<a href="/llms.txt">${escapeHtml(noun.chip)}</a></p>\n` +
    "</ta-agent-banner>\n" +
    `<script src="${escapeHtml(SHELL.assets.banner_js)}" defer></script>`
  );
}

export function headerHtml(active = "") {
  const items = SHELL.nav
    .map((item) => {
      const current = item.key === active ? ' aria-current="page"' : "";
      return `<li><a href="${escapeHtml(item.href)}"${current}>${escapeHtml(item.label)}</a></li>`;
    })
    .join("");
  return (
    '<header class="site-header">\n<div class="wrap">\n' +
    `<a class="wordmark" href="/">${WORDMARK_SVG}<span>${escapeHtml(SHELL.site.name)}</span></a>\n` +
    `<nav class="site-nav" aria-label="Main">\n<ul>${items}</ul>\n</nav>\n` +
    `<a class="header-link" href="${escapeHtml(SHELL.header_link.href)}">${escapeHtml(SHELL.header_link.label)}</a>\n` +
    "</div>\n</header>"
  );
}

export function footerHtml() {
  const footer = SHELL.footer;
  const links = (list) => list.map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`).join("");
  return (
    '<footer class="site-footer">\n<div class="wrap">\n' +
    `<p class="footer-brand"><b>${escapeHtml(SHELL.site.name)}</b> <span>${escapeHtml(footer.note)}</span></p>\n` +
    `<nav aria-label="Site information">\n<ul>${links(footer.links)}</ul>\n</nav>\n` +
    `<nav aria-label="${escapeHtml(footer.agent_label)}">\n<ul><li><span class="footer-label">${escapeHtml(footer.agent_label)}</span></li>${links(footer.agent_links)}</ul>\n</nav>\n` +
    `<p class="footer-privacy">${escapeHtml(footer.privacy)}</p>\n` +
    "</div>\n</footer>"
  );
}

/** A whole page: head, banner, header, the page's own main content, footer, then its scripts. */
export function documentHtml({ title, description = "", active = "", main, scripts = [] }) {
  const preload = SHELL.assets.preload
    .map((href) => `<link rel="preload" href="${escapeHtml(href)}" as="font" type="font/woff2" crossorigin>`)
    .join("\n");
  const page = scripts.map((src) => `<script src="${escapeHtml(src)}" defer></script>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | ${escapeHtml(SHELL.site.name)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${preload}
<link rel="stylesheet" href="${escapeHtml(SHELL.assets.css)}">
</head>
<body>
<div role="navigation" aria-label="Skip links"><a class="skip-link" href="#main">Skip to content</a></div>
${bannerHtml()}
${headerHtml(active)}
<main id="main">
${main}
</main>
${footerHtml()}
${page}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-language helpers
// ---------------------------------------------------------------------------------------------------------------

// Worker-written text is tidied before a page shows it. The rules are data, so the dashboard script applies exactly the
// same ones in the browser (renderDashboardJs embeds TIDY_RULES). Words the pages never show are written in pieces, so
// this file never contains them itself.
export const TIDY_RULES = [
  { re: ["\\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_[0-9a-f]{8,}\\b"], flags: "gi", to: "\u2026" },
  { re: ["(?<![0-9a-f])[0-9a-f]{12,}(?![0-9a-f])"], flags: "gi", to: "\u2026" },
  { re: ["\\bl", "lama[\\w.\\-]*(?:\\s+\\d+(?:\\.\\d+)*[\\w\\-]*)?"], flags: "gi", to: "an older model" },
  { re: ["\\bsyn", "thetic\\b"], flags: "gi", to: "example" },
  { re: ["\\bnano\\s?", "muse\\b"], flags: "gi", to: "an agent app" },
  { re: ["\\bmuse\\s+", "code\\b"], flags: "gi", to: "an agent app" },
  { re: ["\\bnouns\\b"], flags: "gi", to: "Task Objects" },
  { re: ["\\bnoun\\b"], flags: "gi", to: "Task Object" },
  { re: ["\\bverbs\\b"], flags: "gi", to: "Tasks" },
  { re: ["\\bverb\\b"], flags: "gi", to: "Task" },
  { re: ["\\breceipts\\b"], flags: "gi", to: "records" },
  { re: ["\\breceipt\\b"], flags: "gi", to: "record" },
  { re: ["\\bsha-?256\\b"], flags: "gi", to: "checksum" },
  // Tidy up what the dropped ids leave behind: empty or unfinished brackets, runs of dots, extra spaces.
  { re: ["\\(\\s*(?:\u2026[,;\\s]*)+\\)"], flags: "g", to: "" },
  { re: ["\\s*\\(\\s*(?:\u2026[,;\\s]*)+$"], flags: "g", to: "" },
  { re: ["(?:\u2026[,;]?\\s*){2,}"], flags: "g", to: "\u2026 " },
  { re: ["\\s+"], flags: "g", to: " " },
];
const COMPILED_RULES = TIDY_RULES.map((rule) => ({ re: new RegExp(rule.re.join(""), rule.flags), to: rule.to }));

/**
 * Text that workers wrote (titles, summaries, labels), made fit to show: long ids and hashes are dropped, the old
 * vocabulary becomes "Task" and "Task Object", receipts become records, and nothing is longer than `max` characters.
 * Only the page changes; the record behind each "Record" link keeps the original words.
 */
export function tidyText(value, max = 240) {
  let text = String(value ?? "");
  for (const rule of COMPILED_RULES) text = text.replace(rule.re, rule.to);
  text = text.trim();
  if (max && text.length > max) {
    const cut = text.slice(0, max);
    text = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max * 0.6))).trimEnd()}\u2026`;
  }
  return text;
}

/** `runs_on_small_4gb_laptop` becomes "Runs on small 4gb laptop". */
export function humanize(id) {
  const words = String(id ?? "").replace(/[_\-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} bytes`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 1, 2026, 13:49 UTC" from an ISO time; empty when it cannot be read. */
export function formatWhen(iso) {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** What a piece of work is, in plain words. */
export function taskKindLabel(tier, kind) {
  if (tier === "ngo_priority" || kind === "ngo_public_good") return "Nonprofit Task";
  if (kind === "eval_and_rank") return "Review";
  if (kind === "worker_self_directed") return "Worker's own Task";
  if (kind === "meta_generator") return "Task maker";
  if (kind === "verb_mutator") return "Task remix";
  return "Shared Task";
}

export function stateLabel(state) {
  switch (String(state ?? "")) {
    case "done":
      return { text: "Done", tone: "real" };
    case "leased":
      return { text: "Being worked on", tone: "attn" };
    case "ready":
      return { text: "Waiting for a worker", tone: "" };
    case "failed":
      return { text: "Needs another try", tone: "caution" };
    default:
      return { text: humanize(state) || "Recorded", tone: "" };
  }
}

/** The worker beat that comes next, in plain words. */
export function nextTurnLabel(iterationCount, cycle = 3) {
  const slot = Number(iterationCount || 0) % cycle;
  return slot === 0 ? "A nonprofit Task" : slot === 1 ? "A review" : "A Task of its own";
}

/** "A volunteer's AI", or "Dedicated worker N (run by ta-amps)" for a worker ta-amps itself runs. */
export function workerLabel(agentId) {
  const id = String(agentId ?? "");
  if (/^(?:eranos|ta-amps)[-_.\s]/i.test(id)) {
    const digits = /(\d+)/.exec(id)?.[1];
    return `Dedicated worker ${digits ? Number(digits) : 1} (run by ta-amps)`;
  }
  return "A volunteer's AI";
}
