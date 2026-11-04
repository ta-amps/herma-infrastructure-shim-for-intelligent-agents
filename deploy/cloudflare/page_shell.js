// The one shell every Herma page shares: the document head, the thin agent banner, the header and the footer, plus the
// plain-language helpers the pages use (kind and state labels, sizes, dates, and tidying of text that workers wrote).
//
// The words and links come from herma/page_shell.json, which the Python app renders from too; a test keeps the two in step.
// Style: Paper & Ink, light only (owner, Nov 1, 2026). The stylesheet, fonts and shared banner script are static assets
// that Cloudflare serves before the Worker runs (herma/static/assets). Pages never carry inline styles or scripts.

import SHELL from "../../herma/page_shell.json" with { type: "json" };
import BANNED from "./banned_words.generated.js";
import { sha256Hex } from "./sha256_sync.js";
import { emptyTeam, isTeamAgent, matchesBaseline } from "./team_agents.js";

export const PAGE_SHELL = SHELL;

/** Where the models are explained (Agora's Models used page); pages that name a model link it. */
export const MODELS_USED_LINK = `<a class="link-out" href="${SHELL.site.models_used}">Models used &#8599;</a>`;

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
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Teleion Fabric">' +
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
    `<a class="wordmark" href="/">${WORDMARK_SVG}<span>${escapeHtml(SHELL.site.name)}</span>` +
    `${SHELL.site.byline ? `<span class="byline">${escapeHtml(SHELL.site.byline)}</span>` : ""}</a>\n` +
    `<nav class="site-nav" aria-label="Main">\n<ul>${items}</ul>\n</nav>\n` +
    `<a class="header-link" href="${escapeHtml(SHELL.header_link.href)}">${escapeHtml(SHELL.header_link.label)}</a>\n` +
    "</div>\n</header>"
  );
}

export function footerHtml() {
  const footer = SHELL.footer;
  const links = footer.links.map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`).join("");
  return (
    '<footer class="site-footer">\n<div class="wrap">\n' +
    `<div class="footer-row"><a class="footer-brand" href="/">${WORDMARK_SVG}<span>${escapeHtml(SHELL.site.name)}</span></a>\n` +
    `<nav aria-label="Site information">\n<ul>${links}</ul>\n</nav></div>\n` +
    `<p class="footer-line">${escapeHtml(footer.line)}</p>\n` +
    "</div>\n</footer>"
  );
}

/** The canonical address of a path on this site, as the design contract sets it: always https://shim.teleionlabs.com. */
export function canonicalUrl(path) {
  const clean = String(path || "/").split("#")[0];
  return `${SHELL.site.origin}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

/** A whole page: head, banner, header, the page's own main content, footer, then its scripts. */
export function documentHtml({ title, description = "", active = "", main, scripts = [], canonical = "" }) {
  // Every page names the one canonical host (rel=canonical), whichever host it was reached on.
  const canonicalLink = canonical ? `<link rel="canonical" href="${escapeHtml(canonicalUrl(canonical))}">\n` : "";
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
<meta name="color-scheme" content="only light">
${canonicalLink}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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

// Worker-written text is filtered before a page shows it (MUST-FOLLOW rule 16). The banned words come from the ONE shared
// list (notes/coordination-2026-10-31/rules/banned-words.json). It is read when the Worker is built and written into the
// git-ignored module banned_words.generated.js, so this file never spells a banned word, and the module stays on the
// server: no script a browser receives carries these rules. Only the page changes; stored records keep their words.
const ELLIPSIS = "\u2026";

// Rules that are not about words: long ids and hashes are dropped, then the brackets and spaces they leave are tidied.
const ID_RULES = [
  { re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_[0-9a-f]{8,}\b/gi, to: ELLIPSIS },
  { re: /(?<![0-9a-f])[0-9a-f]{12,}(?![0-9a-f])/gi, to: ELLIPSIS },
];
const CLEANUP_RULES = [
  { re: /\u2014/g, to: "--" },
  { re: /\(\s*(?:\u2026[,;\s]*)+\)/g, to: "" },
  { re: /\s*\(\s*(?:\u2026[,;\s]*)+$/g, to: "" },
  { re: /(?:\u2026[,;]?\s*){2,}/g, to: `${ELLIPSIS} ` },
  { re: /\s+/g, to: " " },
];
const MAX_REMEMBERED_WORDS = 5000;

/**
 * A display filter for one banned-word configuration, { displayRules: [{ re, flags, to }], privateSha256: [hash] }.
 * `to` is a replacement string, or an object that maps the lowercase matched word to its replacement. Private names are
 * kept only as sha256 hashes, so each word is hashed and a match becomes an ellipsis.
 */
export function buildTidy(config) {
  const rules = (config.displayRules || []).map((rule) => {
    const flags = rule.flags.includes("g") ? rule.flags : `${rule.flags}g`;
    const to = typeof rule.to === "string" ? rule.to : (match) => rule.to[match.toLowerCase()] ?? ELLIPSIS;
    return { re: new RegExp(rule.re, flags), to };
  });
  const hashes = new Set((config.privateSha256 || []).map((hash) => String(hash).toLowerCase()));
  const remembered = new Map();
  const isPrivateName = (word) => {
    if (!remembered.has(word)) {
      if (remembered.size >= MAX_REMEMBERED_WORDS) remembered.clear();
      remembered.set(word, hashes.has(sha256Hex(word)));
    }
    return remembered.get(word);
  };
  return function tidy(value, max = 240) {
    let text = String(value ?? "");
    for (const rule of ID_RULES) text = text.replace(rule.re, rule.to);
    for (const rule of rules) text = text.replace(rule.re, rule.to);
    if (hashes.size) text = text.replace(/[A-Za-z0-9]+/g, (word) => (isPrivateName(word.toLowerCase()) ? ELLIPSIS : word));
    for (const rule of CLEANUP_RULES) text = text.replace(rule.re, rule.to);
    text = text.trim();
    if (max && text.length > max) {
      const cut = text.slice(0, max);
      text = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max * 0.6))).trimEnd()}${ELLIPSIS}`;
    }
    return text;
  };
}

export function buildBannedScrubber(config) {
  const rules = (config.displayRules || []).map((rule) => {
    const flags = rule.flags.includes("g") ? rule.flags : `${rule.flags}g`;
    const to = typeof rule.to === "string" ? rule.to : (match) => rule.to[match.toLowerCase()] ?? ELLIPSIS;
    return { re: new RegExp(rule.re, flags), to };
  });
  const hashes = new Set((config.privateSha256 || []).map((hash) => String(hash).toLowerCase()));
  const remembered = new Map();
  const isPrivateName = (word) => {
    if (!remembered.has(word)) {
      if (remembered.size >= MAX_REMEMBERED_WORDS) remembered.clear();
      remembered.set(word, hashes.has(sha256Hex(word)));
    }
    return remembered.get(word);
  };
  return function scrub(value) {
    let text = String(value ?? "");
    for (const rule of rules) text = text.replace(rule.re, rule.to);
    if (hashes.size) text = text.replace(/[A-Za-z0-9]+/g, (word) => (isPrivateName(word.toLowerCase()) ? ELLIPSIS : word));
    for (const rule of CLEANUP_RULES) text = text.replace(rule.re, rule.to);
    return text.trim();
  };
}

/**
 * Text that workers wrote (titles, summaries, labels), made fit to show: long ids and hashes are dropped, every word on
 * the shared banned-word list is replaced by its plain description, and nothing is longer than `max` characters.
 */
export const tidyText = buildTidy(BANNED);
export const scrubBannedWords = buildBannedScrubber(BANNED);

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

// The agents the team runs, as the Worker last read them (deploy/cloudflare/team_agents.js; the gateway sets it before it renders a page). Without a
// list only the old rule applies. A render is synchronous, so a page sees one list from start to end.
let currentTeam = emptyTeam();

/** The list of team-run agents the labels below use. */
export function useTeamAgents(team) {
  currentTeam = team || emptyTeam();
}

/**
 * "Dedicated worker N (run by ta-amps)" for an agent ta-amps itself runs (a name from the old rule carries its number; a name only the list gives does not,
 * because a number found inside it would mean nothing), and "A connected AI" for every other agent: a name that is not on the list may be anyone's, so the
 * page does not say more than it knows.
 */
export function workerLabel(agentId, team = currentTeam) {
  const id = String(agentId ?? "");
  if (!isTeamAgent(id, team)) return "A connected AI";
  if (!matchesBaseline(id)) return "Dedicated worker (run by ta-amps)";
  const digits = /(\d+)/.exec(id)?.[1];
  return `Dedicated worker ${digits ? Number(digits) : 1} (run by ta-amps)`;
}
