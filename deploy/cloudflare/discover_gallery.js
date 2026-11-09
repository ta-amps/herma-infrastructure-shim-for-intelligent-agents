// Public Open-Source Discovery Gallery, 36-Category Taxonomy Browser, Star-Velocity & Enrichment Rankings,
// Video-as-Code Showcase, and Syndication Feeds (`/discover`, `/discover.txt`, `/discover.js`, `/q/discover`,
// `/q/feed.json`, `/q/rss.xml`, `/q/atom.xml`).
//
// Follows Paper & Ink light-only rules (`color-scheme: only light`), zero inline styles/scripts, single `<h1>`,
// responsive `.table-wrap` tables, display-time `tidyText` / `scrubBannedDeep` filtering, and canonical internal
// navigation (`data-copy-url` progressive copy buttons instead of arbitrary external page anchors).

import {
  DISCOVER_CATEGORIES,
  DISCOVER_ENTRIES,
  DISCOVER_METHODOLOGY,
  DISCOVER_OVERVIEW,
  DISCOVER_REGISTRIES,
  DISCOVER_SHOWCASE_VIDEOS,
} from "./discover_catalog_data.js";
import {
  documentHtml,
  escapeHtml,
  formatBytes,
  formatWhen,
  humanize,
  scrubBannedDeep,
  scrubBannedWords,
  tidyText,
  workerLabel,
} from "./page_shell.js";
import { stripPii } from "./pii_strip.js";
import { reviewLabels } from "./public_read.js";
import { readSeenItemSet } from "./durable_session_and_dag.js";

export const DISCOVER_GALLERY_GRID = Object.freeze({
  schema_id: "herma.discover_gallery.grid.v1",
  api_schema: "herma.discover_gallery.catalog.v1",
  default_page_limit: 24,
  max_page_limit: 96,
  max_offset: 10000,
  feed_default_limit: 40,
  feed_max_limit: 100,
  feed_cache_max_age_sec: 180,
  ranking_top_limit: 15,
  live_d1_object_limit: 18,
  live_table_display_limit: 8,
  peer_sample_limit: 6,
  copied_reset_ms: 1800,
  query_max_len: 120,
  facet_max_len: 64,
  short_label_max_len: 40,
  license_short_max_len: 32,
  sub_niche_max_len: 80,
  compact_title_max_len: 80,
  page_title_prefix_max_len: 70,
  video_title_max_len: 100,
  methodology_title_max_len: 110,
  title_max_len: 140,
  table_summary_max_len: 140,
  card_desc_max_len: 200,
  video_summary_max_len: 240,
  summary_max_len: 280,
  table_locator_max_len: 72,
  locator_max_len: 120,
  http_ok: 200,
  http_not_found: 404,
  http_method_not_allowed: 405,
});

const VALID_TABS = new Set(["all", "explore", "categories", "rankings", "videos", "feeds"]);
const VALID_SORTS = new Set(["featured", "movers", "opportunity", "stars", "recent"]);
const PUBLIC_VISIBILITY = new Set(["public_ngo", "public_commons"]);
const PRESERVED_URL_KEYS = new Set([
  "external_url",
  "url",
  "feed_url",
  "home_page_url",
  "discover_url",
  "discover_page_url",
  "api_url",
  "json_feed_url",
  "rss_url",
  "atom_url",
  "text_copy_url",
  "stream_url",
  "blob_path",
  "permalink_path",
]);

function scrubDiscoverPayload(value) {
  if (Array.isArray(value)) return value.map(scrubDiscoverPayload);
  if (!value || typeof value !== "object") return scrubBannedDeep(value);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, PRESERVED_URL_KEYS.has(k) ? v : scrubDiscoverPayload(v)])
  );
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc2822Date(isoString) {
  const d = new Date(String(isoString || "2026-11-08T06:00:00Z"));
  return Number.isNaN(d.getTime()) ? "Sun, 08 Nov 2026 06:00:00 GMT" : d.toUTCString();
}

function clampInt(raw, fallback, minVal, maxVal) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minVal, Math.min(maxVal, parsed));
}

function buildDiscoverHref(params = {}) {
  const sp = new URLSearchParams();
  for (const key of ["tab", "q", "category", "registry", "sort", "item", "limit", "offset"]) {
    const val = params[key];
    if (val === undefined || val === null || val === "") continue;
    if (key === "tab" && val === "all") continue;
    if (key === "sort" && val === "featured") continue;
    if (key === "offset" && Number(val) === 0) continue;
    if (key === "limit" && Number(val) === DISCOVER_GALLERY_GRID.default_page_limit) continue;
    sp.set(key, String(val));
  }
  const qs = sp.toString();
  return qs ? `/discover?${qs}` : "/discover";
}

function buildFeedQuerySuffix(filters) {
  const sp = new URLSearchParams();
  if (filters.q) sp.set("q", filters.q);
  if (filters.category) sp.set("category", filters.category);
  if (filters.registry) sp.set("registry", filters.registry);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function isPublicActiveRow(row) {
  const vis = String(row?.visibility || "public_commons");
  const tomb = Number(row?.is_tombstoned || 0);
  return PUBLIC_VISIBILITY.has(vis) && tomb === 0;
}

async function loadRecentPublicTaskObjects(db, extraLiveObjects = null) {
  const candidateRows = [];
  if (Array.isArray(extraLiveObjects)) {
    // Group by object_key; if newest extra row is restricted or tombstoned, close all older versions too.
    const newestByKey = new Map();
    extraLiveObjects.forEach((r, idx) => {
      const k = String(r?.object_key || "");
      if (!k) return;
      const rank = Number.isFinite(Number(r?.id)) ? Number(r.id) : idx;
      const prev = newestByKey.get(k);
      if (!prev || rank >= prev.rank) newestByKey.set(k, { row: r, rank });
    });
    for (const { row } of newestByKey.values()) {
      if (isPublicActiveRow(row)) candidateRows.push(row);
    }
  }
  if (db && typeof db.prepare === "function") {
    try {
      const res = await db
        .prepare(
          `SELECT id, object_key, category, summary, producer_agent, quality_milli, eval_count,
                  verification_verdict, visibility, is_tombstoned, total_payload_bytes, created_at
           FROM herma_task_objects
           WHERE COALESCE(visibility, 'public_commons') IN ('public_ngo', 'public_commons')
             AND COALESCE(is_tombstoned, 0) = 0
             AND id IN (
               SELECT MAX(t2.id) FROM herma_task_objects t2 GROUP BY t2.object_key
             )
           ORDER BY quality_milli DESC, id DESC
           LIMIT ?`
        )
        .bind(DISCOVER_GALLERY_GRID.live_d1_object_limit)
        .all();
      if (Array.isArray(res?.results)) {
        candidateRows.push(...res.results.filter(isPublicActiveRow));
      }
    } catch {
      // Fixture and cold in-memory runs may not have populated herma_task_objects yet.
    }
  }
  const seenKeys = new Set();
  const deduped = [];
  for (const row of candidateRows) {
    const rawKey = String(row?.object_key || "");
    if (!rawKey || seenKeys.has(rawKey)) continue;
    seenKeys.add(rawKey);
    const labels = reviewLabels(row);
    deduped.push({
      object_key: rawKey,
      display_title: tidyText(stripPii(rawKey.replace(/_/g, " ")), DISCOVER_GALLERY_GRID.title_max_len) || "Shared Task Object",
      category_label: tidyText(humanize(row?.category || "general"), DISCOVER_GALLERY_GRID.facet_max_len) || "General",
      summary: tidyText(
        stripPii(row?.summary || "Reusable Task Object published by a connected worker."),
        DISCOVER_GALLERY_GRID.summary_max_len
      ),
      maker_label: workerLabel(row?.producer_agent || ""),
      quality_milli: Number(row?.quality_milli || 0),
      eval_count: Number(row?.eval_count || 0),
      total_payload_bytes: Number(row?.total_payload_bytes || 0),
      created_at: String(row?.created_at || ""),
      permalink_path: `/c/${encodeURIComponent(rawKey)}`,
      ...labels,
    });
    if (deduped.length >= DISCOVER_GALLERY_GRID.live_d1_object_limit) break;
  }
  return deduped;
}

function matchesQuery(entry, tokens) {
  if (!tokens.length) return true;
  const hay = `${entry.name} ${entry.summary} ${entry.tags} ${entry.sub_niche} ${entry.category_label} ${entry.registry} ${entry.locator} ${entry.license}`.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

function sortEntries(entries, sortKey) {
  const copy = [...entries];
  if (sortKey === "movers") {
    copy.sort((a, b) => (b.star_delta - a.star_delta) || (b.stars - a.stars) || a.name.localeCompare(b.name));
  } else if (sortKey === "opportunity") {
    copy.sort((a, b) => (b.opportunity_score - a.opportunity_score) || (b.star_delta - a.star_delta) || (b.stars - a.stars) || a.name.localeCompare(b.name));
  } else if (sortKey === "stars") {
    copy.sort((a, b) => (b.stars - a.stars) || (b.opportunity_score - a.opportunity_score) || a.name.localeCompare(b.name));
  } else if (sortKey === "recent") {
    copy.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || (b.opportunity_score - a.opportunity_score) || a.name.localeCompare(b.name));
  }
  return copy;
}

export async function queryDiscoverCatalog(
  db,
  publicUrl,
  rawParams = {},
  {
    extraLiveObjects = null,
    defaultLimit = DISCOVER_GALLERY_GRID.default_page_limit,
    maxLimit = DISCOVER_GALLERY_GRID.max_page_limit,
  } = {}
) {
  const rawTab = String(rawParams.tab || "all").trim().toLowerCase();
  const tab = VALID_TABS.has(rawTab) ? rawTab : "all";
  const rawSort = String(rawParams.sort || "featured").trim().toLowerCase();
  const sort = VALID_SORTS.has(rawSort) ? rawSort : "featured";
  const q = tidyText(String(rawParams.q || "").trim(), DISCOVER_GALLERY_GRID.query_max_len);
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const category = String(rawParams.category || "").trim().toLowerCase().slice(0, DISCOVER_GALLERY_GRID.facet_max_len);
  const registry = String(rawParams.registry || "").trim().slice(0, DISCOVER_GALLERY_GRID.facet_max_len);
  const itemId = String(rawParams.item || rawParams.id || "").trim().slice(0, DISCOVER_GALLERY_GRID.query_max_len);
  const limit = clampInt(rawParams.limit, defaultLimit, 1, maxLimit);
  const offset = clampInt(rawParams.offset, 0, 0, DISCOVER_GALLERY_GRID.max_offset);

  const selectedCategoryObj = DISCOVER_CATEGORIES.find((c) => c.id === category) || null;
  const activeCategory = selectedCategoryObj ? selectedCategoryObj.id : "";
  const selectedRegistryObj = DISCOVER_REGISTRIES.find((r) => r.name.toLowerCase() === registry.toLowerCase()) || null;
  const activeRegistry = selectedRegistryObj ? selectedRegistryObj.name : "";

  const filteredBase = DISCOVER_ENTRIES.filter((entry) => {
    if (activeCategory && entry.category !== activeCategory) return false;
    if (activeRegistry && entry.registry !== activeRegistry) return false;
    return matchesQuery(entry, tokens);
  });

  const unseenBy = String(rawParams.unseen_by || "").trim().toLowerCase();
  const frontierCampaign = String(rawParams.campaign || "default").trim();
  let seenFrontierSet = new Set();
  if (unseenBy && db && filteredBase.length > 0) {
    const candidateKeys = [];
    for (const entry of filteredBase) {
      if (entry.id) candidateKeys.push(entry.id);
      if (entry.locator) candidateKeys.push(entry.locator);
      if (entry.name) candidateKeys.push(entry.name);
    }
    seenFrontierSet = await readSeenItemSet(db, unseenBy, frontierCampaign, candidateKeys);
  }
  const filtered =
    seenFrontierSet.size > 0
      ? filteredBase.filter(
          (e) =>
            !seenFrontierSet.has(String(e.id || "").toLowerCase()) &&
            !seenFrontierSet.has(String(e.locator || "").toLowerCase()) &&
            !seenFrontierSet.has(String(e.name || "").toLowerCase())
        )
      : filteredBase;

  const sorted = sortEntries(filtered, sort);
  const paged = sorted.slice(offset, offset + limit);

  const selectedItem = itemId
    ? DISCOVER_ENTRIES.find((e) => e.id === itemId || e.name.toLowerCase() === itemId.toLowerCase()) || null
    : null;

  const peerItems = selectedItem
    ? DISCOVER_ENTRIES.filter((e) => e.category === selectedItem.category && e.id !== selectedItem.id).slice(
        0,
        DISCOVER_GALLERY_GRID.peer_sample_limit
      )
    : [];

  const topMovers = sortEntries(
    DISCOVER_ENTRIES.filter((e) => e.star_delta > 0),
    "movers"
  ).slice(0, DISCOVER_GALLERY_GRID.ranking_top_limit);

  const topOpportunities = sortEntries(
    DISCOVER_ENTRIES.filter((e) => e.opportunity_score > 0),
    "opportunity"
  ).slice(0, DISCOVER_GALLERY_GRID.ranking_top_limit);

  const liveTaskObjects = await loadRecentPublicTaskObjects(db, extraLiveObjects);
  const feedSuffix = buildFeedQuerySuffix({ q, category: activeCategory, registry: activeRegistry });

  return {
    schema: DISCOVER_GALLERY_GRID.api_schema,
    overview: DISCOVER_OVERVIEW,
    methodology: DISCOVER_METHODOLOGY,
    filters: {
      tab,
      q,
      category: activeCategory,
      category_label: selectedCategoryObj ? selectedCategoryObj.label : "",
      registry: activeRegistry,
      sort,
      item: itemId,
      limit,
      offset,
      ...(unseenBy ? { unseen_by: unseenBy, campaign: frontierCampaign } : {}),
    },
    selected_item: selectedItem,
    peer_items: peerItems,
    total_matches: sorted.length,
    entries: paged,
    categories: DISCOVER_CATEGORIES,
    registries: DISCOVER_REGISTRIES,
    top_movers: topMovers,
    top_opportunities: topOpportunities,
    showcase_videos: DISCOVER_SHOWCASE_VIDEOS,
    live_task_objects: liveTaskObjects,
    feeds: {
      json_feed_url: `${publicUrl}/q/feed.json${feedSuffix}`,
      rss_url: `${publicUrl}/q/rss.xml${feedSuffix}`,
      atom_url: `${publicUrl}/q/atom.xml${feedSuffix}`,
      api_url: `${publicUrl}/q/discover${feedSuffix}`,
      text_copy_url: `${publicUrl}/discover.txt`,
    },
  };
}

function renderEntryCard(entry, currentFilters) {
  const name = escapeHtml(tidyText(entry.name, DISCOVER_GALLERY_GRID.title_max_len));
  const catLabel = escapeHtml(tidyText(entry.category_label, DISCOVER_GALLERY_GRID.facet_max_len));
  const subNiche = escapeHtml(tidyText(entry.sub_niche, DISCOVER_GALLERY_GRID.facet_max_len));
  const summary = escapeHtml(tidyText(entry.summary, DISCOVER_GALLERY_GRID.summary_max_len));
  const locator = escapeHtml(tidyText(entry.locator, DISCOVER_GALLERY_GRID.locator_max_len));
  const registry = escapeHtml(tidyText(entry.registry, DISCOVER_GALLERY_GRID.facet_max_len));
  const license = escapeHtml(tidyText(entry.license, DISCOVER_GALLERY_GRID.facet_max_len));
  const detailHref = buildDiscoverHref({ ...currentFilters, item: entry.id, offset: 0 });
  const catHref = buildDiscoverHref({ tab: "explore", category: entry.category });

  const badges = [
    `<span class="tag tag-object">${registry}</span>`,
    `<span class="tag">${license}</span>`,
  ];
  if (entry.stars > 0) {
    badges.push(`<span class="tag">${entry.stars.toLocaleString("en-US")} stars</span>`);
  }
  if (entry.star_delta > 0) {
    badges.push(`<span class="tag tag-real">+${entry.star_delta.toLocaleString("en-US")} rising</span>`);
  }
  if (entry.opportunity_score > 0) {
    badges.push(`<span class="tag tag-task">Score ${entry.opportunity_score}/100</span>`);
  }

  return `<article class="card">
  <div class="tags">${badges.join("")}</div>
  <h3><a href="${escapeHtml(detailHref)}">${name}</a></h3>
  <p class="muted"><a href="${escapeHtml(catHref)}">${catLabel}</a> &middot; ${subNiche}</p>
  <p>${summary}</p>
  <div class="muted"><small><code>${locator}</code></small></div>
  <div class="card-foot">
    <a class="btn-quiet btn-sm" href="${escapeHtml(detailHref)}">Inspect</a>
    <a class="btn-quiet btn-sm" href="/q/discover?id=${encodeURIComponent(entry.id)}">JSON</a>
    <button type="button" class="btn-quiet btn-sm" data-copy-url="${escapeHtml(entry.external_url)}">Copy source URL</button>
  </div>
</article>`;
}

function renderSelectedItemSection(state) {
  const item = state.selected_item;
  if (!item) {
    if (!state.filters.item) return "";
    return `<section class="section"><div class="wrap"><div class="note note-attn"><strong>No catalog entry matched that identifier.</strong> Showing the full discovery index below.</div></div></section>`;
  }
  const name = escapeHtml(tidyText(item.name, DISCOVER_GALLERY_GRID.title_max_len));
  const summary = escapeHtml(tidyText(item.summary, DISCOVER_GALLERY_GRID.summary_max_len));
  const locator = escapeHtml(tidyText(item.locator, DISCOVER_GALLERY_GRID.locator_max_len));
  const tags = escapeHtml(tidyText(item.tags, DISCOVER_GALLERY_GRID.summary_max_len));
  const peerLinks = state.peer_items
    .map(
      (p) =>
        `<li><a href="${escapeHtml(buildDiscoverHref({ item: p.id }))}">${escapeHtml(tidyText(p.name, DISCOVER_GALLERY_GRID.compact_title_max_len))}</a> <span class="muted">(${escapeHtml(tidyText(p.sub_niche, DISCOVER_GALLERY_GRID.facet_max_len))})</span></li>`
    )
    .join("");

  return `<section class="section" aria-labelledby="selected-entry-h">
  <div class="wrap">
    <div class="panel stack">
      <div class="row-between">
        <div class="stack">
          <div class="tags">
            <span class="tag tag-object">${escapeHtml(tidyText(item.registry, DISCOVER_GALLERY_GRID.short_label_max_len))}</span>
            <span class="tag">${escapeHtml(tidyText(item.category_label, DISCOVER_GALLERY_GRID.facet_max_len))}</span>
            <span class="tag">${escapeHtml(tidyText(item.license, DISCOVER_GALLERY_GRID.short_label_max_len))}</span>
            ${item.opportunity_score > 0 ? `<span class="tag tag-task">Enrichment score ${item.opportunity_score}/100</span>` : ""}
            ${item.star_delta > 0 ? `<span class="tag tag-real">+${item.star_delta.toLocaleString("en-US")} recent stars</span>` : ""}
          </div>
          <h2 id="selected-entry-h">${name}</h2>
        </div>
        <div class="row">
          <button type="button" class="btn btn-sm" data-copy-url="${escapeHtml(item.external_url)}">Copy source URL</button>
          <a class="btn-quiet btn-sm" href="/q/discover?id=${encodeURIComponent(item.id)}">JSON record</a>
          <a class="btn-quiet btn-sm" href="${escapeHtml(buildDiscoverHref({ ...state.filters, item: "" }))}">Close detail</a>
        </div>
      </div>
      <p class="lead">${summary}</p>
      <dl class="kv">
        <dt>Upstream locator</dt>
        <dd><code>${locator}</code></dd>
        <dt>Category &amp; sub-niche</dt>
        <dd><a href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: item.category }))}">${escapeHtml(tidyText(item.category_label, DISCOVER_GALLERY_GRID.facet_max_len))}</a> &middot; ${escapeHtml(tidyText(item.sub_niche, DISCOVER_GALLERY_GRID.sub_niche_max_len))}</dd>
        <dt>Tracked stars</dt>
        <dd>${item.stars.toLocaleString("en-US")}${item.star_delta > 0 ? ` (+${item.star_delta.toLocaleString("en-US")} in current sweep)` : ""}</dd>
        <dt>Discovery track</dt>
        <dd>${escapeHtml(humanize(item.track))}</dd>
        <dt>Search keywords</dt>
        <dd><code>${tags}</code></dd>
        <dt>Category feeds</dt>
        <dd>
          <a href="/q/rss.xml?category=${encodeURIComponent(item.category)}">Category RSS</a> &middot;
          <a href="/q/atom.xml?category=${encodeURIComponent(item.category)}">Category Atom</a> &middot;
          <a href="/q/feed.json?category=${encodeURIComponent(item.category)}">Category JSON Feed</a>
        </dd>
      </dl>
      ${peerLinks ? `<div class="stack"><h3 class="files-h">Related tools in ${escapeHtml(tidyText(item.category_label, DISCOVER_GALLERY_GRID.facet_max_len))}</h3><ul>${peerLinks}</ul></div>` : ""}
    </div>
  </div>
</section>`;
}

export function renderDiscoverHtml(publicUrl, state) {
  const f = state.filters;
  const ov = state.overview;
  const showExplore = f.tab === "all" || f.tab === "explore";
  const showCategories = f.tab === "all" || f.tab === "categories";
  const showRankings = f.tab === "all" || f.tab === "rankings";
  const showVideos = f.tab === "all" || f.tab === "videos";
  const showFeeds = f.tab === "all" || f.tab === "feeds";

  const viewNav = [
    { id: "all", label: "All sections" },
    { id: "explore", label: `Search & browse (${state.total_matches})` },
    { id: "categories", label: `Categories (${ov.category_count})` },
    { id: "rankings", label: "Movers & scores" },
    { id: "videos", label: `Video showcase (${state.showcase_videos.length})` },
    { id: "feeds", label: "RSS, Atom & JSON API" },
  ]
    .map((v) => {
      const pressed = f.tab === v.id ? ' class="btn btn-sm" aria-current="page"' : ' class="btn-quiet btn-sm"';
      return `<a${pressed} href="${escapeHtml(buildDiscoverHref({ ...f, tab: v.id, offset: 0 }))}">${escapeHtml(v.label)}</a>`;
    })
    .join("");

  const catOptions = [
    `<option value="">All ${ov.category_count} categories</option>`,
    ...state.categories.map(
      (c) =>
        `<option value="${escapeHtml(c.id)}"${f.category === c.id ? " selected" : ""}>${escapeHtml(tidyText(c.label, DISCOVER_GALLERY_GRID.facet_max_len))} (${c.count})</option>`
    ),
  ].join("");

  const regOptions = [
    `<option value="">All ${ov.registry_count} registries</option>`,
    ...state.registries.map(
      (r) =>
        `<option value="${escapeHtml(r.name)}"${f.registry === r.name ? " selected" : ""}>${escapeHtml(tidyText(r.name, DISCOVER_GALLERY_GRID.short_label_max_len))} (${r.count})</option>`
    ),
  ].join("");

  const sortOptions = [
    ["featured", "Featured & enriched first"],
    ["movers", "Fastest star velocity"],
    ["opportunity", "Highest enrichment score"],
    ["stars", "Most GitHub / registry stars"],
    ["recent", "Recently updated"],
  ]
    .map(([val, label]) => `<option value="${val}"${f.sort === val ? " selected" : ""}>${label}</option>`)
    .join("");

  const prevOffset = Math.max(0, f.offset - f.limit);
  const nextOffset = f.offset + f.limit;
  const hasPrev = f.offset > 0;
  const hasNext = nextOffset < state.total_matches;

  const paginationRow =
    hasPrev || hasNext
      ? `<div class="row-between section">
          <p class="muted">Showing ${f.offset + 1} to ${Math.min(state.total_matches, f.offset + state.entries.length)} of ${state.total_matches} matching entries.</p>
          <div class="row">
            ${hasPrev ? `<a class="btn-quiet btn-sm" href="${escapeHtml(buildDiscoverHref({ ...f, offset: prevOffset }))}">Previous page</a>` : ""}
            ${hasNext ? `<a class="btn btn-sm" href="${escapeHtml(buildDiscoverHref({ ...f, offset: nextOffset }))}">Next page</a>` : ""}
          </div>
        </div>`
      : "";

  const exploreSection = showExplore
    ? `<section class="section" aria-labelledby="explore-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="explore-h">${f.category_label ? escapeHtml(f.category_label) : "Search & explore curated open-source tools"}</h2>
        <p class="hint">Filter across ${ov.curated_entries.toLocaleString("en-US")} curated seed repositories, ${ov.category_count} technical and creative domains, and ${ov.registry_count} package registries.</p>
      </div>
      ${f.q || f.category || f.registry || f.sort !== "featured" ? `<a class="btn-quiet btn-sm" href="/discover">Clear filters</a>` : ""}
    </div>
    <form class="panel stack" action="/discover" method="get">
      ${f.tab !== "all" ? `<input type="hidden" name="tab" value="${escapeHtml(f.tab)}">` : ""}
      <div class="search-grid">
        <div class="field">
          <label for="discover-q">Keyword, domain, or package name</label>
          <input id="discover-q" name="q" type="search" value="${escapeHtml(f.q)}" placeholder="e.g. webgpu, blender, dialogue, subtitle, flathub, cad">
        </div>
        <div class="field">
          <label for="discover-cat">Category</label>
          <select id="discover-cat" name="category">${catOptions}</select>
        </div>
        <div class="field">
          <label for="discover-reg">Registry</label>
          <select id="discover-reg" name="registry">${regOptions}</select>
        </div>
        <div class="field">
          <label for="discover-sort">Sort order</label>
          <select id="discover-sort" name="sort">${sortOptions}</select>
        </div>
        <div class="field">
          <button class="btn" type="submit">Apply filters</button>
        </div>
      </div>
    </form>
    <p class="note-line">Showing <strong>${state.entries.length}</strong> of <strong>${state.total_matches}</strong> matching entries. Subscribe to this exact filter via <a href="${escapeHtml(state.feeds.rss_url)}">RSS</a>, <a href="${escapeHtml(state.feeds.atom_url)}">Atom</a>, <a href="${escapeHtml(state.feeds.json_feed_url)}">JSON Feed</a>, or <a href="${escapeHtml(state.feeds.api_url)}">JSON API</a>.</p>
    ${
      state.entries.length
        ? `<div class="cards">${state.entries.map((e) => renderEntryCard(e, f)).join("\n")}</div>`
        : `<div class="note">No entries matched those filters. Try broadening the keyword or switching back to <a href="/discover">all categories</a>.</div>`
    }
    ${paginationRow}
  </div>
</section>`
    : "";

  const categoriesSection = showCategories
    ? `<section class="section" aria-labelledby="categories-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="categories-h">Browse all ${ov.category_count} domains &amp; ${ov.registry_count} registries</h2>
        <p class="hint">Every domain has its own filterable view and dedicated RSS, Atom, and JSON feeds.</p>
      </div>
    </div>
    <div class="chips">
      ${state.registries
        .map(
          (r) =>
            `<a class="btn-quiet btn-sm" href="${escapeHtml(buildDiscoverHref({ tab: "explore", registry: r.name }))}">${escapeHtml(tidyText(r.name, DISCOVER_GALLERY_GRID.short_label_max_len))} (${r.count})</a>`
        )
        .join("\n      ")}
    </div>
    <div class="cards section">
      ${state.categories
        .map(
          (c) => `<article class="card">
        <div class="tags">
          <span class="tag tag-object">${c.count} curated</span>
        </div>
        <h3><a href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: c.id }))}">${escapeHtml(tidyText(c.label, DISCOVER_GALLERY_GRID.facet_max_len))}</a></h3>
        <p>${escapeHtml(tidyText(c.description, DISCOVER_GALLERY_GRID.card_desc_max_len))}</p>
        <div class="card-foot">
          <a class="btn-quiet btn-sm" href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: c.id }))}">Browse (${c.count})</a>
          <a class="btn-quiet btn-sm" href="/q/rss.xml?category=${encodeURIComponent(c.id)}">RSS</a>
          <a class="btn-quiet btn-sm" href="/q/feed.json?category=${encodeURIComponent(c.id)}">JSON Feed</a>
        </div>
      </article>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`
    : "";

  const rankingsSection = showRankings
    ? `<section class="section" aria-labelledby="rankings-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="rankings-h">Star-velocity movers &amp; high-opportunity enrichment leaders</h2>
        <p class="hint">Combines longitudinal star-delta sweeps with structured enrichment scoring so zero-star emerging tools stand beside fast-rising releases.</p>
      </div>
    </div>
    <h3>Fastest-rising star movers</h3>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Project</th>
            <th>Category &amp; sub-niche</th>
            <th>Star delta</th>
            <th>Total stars</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          ${state.top_movers
            .map(
              (m) => `<tr>
            <td><a href="${escapeHtml(buildDiscoverHref({ item: m.id }))}">${escapeHtml(tidyText(m.name, DISCOVER_GALLERY_GRID.compact_title_max_len))}</a><small>${escapeHtml(tidyText(m.summary, DISCOVER_GALLERY_GRID.table_summary_max_len))}</small></td>
            <td><a href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: m.category }))}">${escapeHtml(tidyText(m.category_label, DISCOVER_GALLERY_GRID.facet_max_len))}</a><small>${escapeHtml(tidyText(m.sub_niche, DISCOVER_GALLERY_GRID.facet_max_len))}</small></td>
            <td><span class="tag tag-real">+${m.star_delta.toLocaleString("en-US")}</span></td>
            <td>${m.stars.toLocaleString("en-US")}</td>
            <td><code>${escapeHtml(tidyText(m.locator, DISCOVER_GALLERY_GRID.table_locator_max_len))}</code></td>
          </tr>`
            )
            .join("\n          ")}
        </tbody>
      </table>
    </div>
    <div class="section">
      <h3>Highest enrichment opportunity scores</h3>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Project</th>
              <th>Domain</th>
              <th>Enrichment score</th>
              <th>License</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${state.top_opportunities
              .map(
                (o) => `<tr>
              <td><a href="${escapeHtml(buildDiscoverHref({ item: o.id }))}">${escapeHtml(tidyText(o.name, DISCOVER_GALLERY_GRID.compact_title_max_len))}</a><small>${escapeHtml(tidyText(o.summary, DISCOVER_GALLERY_GRID.table_summary_max_len))}</small></td>
              <td><a href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: o.category }))}">${escapeHtml(tidyText(o.category_label, DISCOVER_GALLERY_GRID.facet_max_len))}</a><small>${escapeHtml(tidyText(o.sub_niche, DISCOVER_GALLERY_GRID.facet_max_len))}</small></td>
              <td><span class="tag tag-task">${o.opportunity_score}/100</span></td>
              <td>${escapeHtml(tidyText(o.license, DISCOVER_GALLERY_GRID.license_short_max_len))}</td>
              <td><code>${escapeHtml(tidyText(o.locator, DISCOVER_GALLERY_GRID.table_locator_max_len))}</code></td>
            </tr>`
              )
              .join("\n            ")}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</section>`
    : "";

  const videosSection = showVideos
    ? `<section class="section" aria-labelledby="videos-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="videos-h">Video-as-code, 3D scene &amp; kinematic variation showcase</h2>
        <p class="hint">Rendered deterministically with local GPU Three.js recipes, Explainroo canvas choreography, and sub-pixel Ken Burns parallax, streamed directly from content-addressed Fabric blobs with HTTP 206 byte-range seeking.</p>
      </div>
    </div>
    <div class="cards">
      ${state.showcase_videos
        .map(
          (v) => `<article class="card">
        <div class="tags">
          <span class="tag tag-object">${escapeHtml(tidyText(v.aspect, DISCOVER_GALLERY_GRID.short_label_max_len))}</span>
          <span class="tag">${escapeHtml(formatBytes(v.bytes))}</span>
        </div>
        <h3>${escapeHtml(tidyText(v.title, DISCOVER_GALLERY_GRID.video_title_max_len))}</h3>
        <video controls preload="none" src="${escapeHtml(v.blob_path)}"></video>
        <p>${escapeHtml(tidyText(v.summary, DISCOVER_GALLERY_GRID.video_summary_max_len))}</p>
        <div class="card-foot">
          <a class="btn-quiet btn-sm" href="${escapeHtml(v.blob_path)}">Open MP4 stream</a>
          <a class="btn-quiet btn-sm" href="${escapeHtml(buildDiscoverHref({ tab: "explore", category: v.category }))}">Related tools</a>
        </div>
      </article>`
        )
        .join("\n      ")}
    </div>
  </div>
</section>`
    : "";

  const liveObjectsSection =
    f.tab === "all" && state.live_task_objects.length
      ? `<section class="section" aria-labelledby="live-objects-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="live-objects-h">Recent reusable Task Objects on Teleion Fabric</h2>
        <p class="hint">Live structured schemas, adapters, and checking kits contributed by connected workers and indexed alongside the open-source catalog.</p>
      </div>
      <a class="btn-quiet btn-sm" href="/dashboard">Open live dashboard</a>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Task Object</th>
            <th>Category</th>
            <th>Author</th>
            <th>Size &amp; review state</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          ${state.live_task_objects
            .slice(0, DISCOVER_GALLERY_GRID.live_table_display_limit)
            .map(
              (obj) => `<tr>
            <td><a href="${escapeHtml(obj.permalink_path)}">${escapeHtml(obj.display_title)}</a><small>${escapeHtml(obj.summary)}</small></td>
            <td><span class="tag">${escapeHtml(obj.category_label)}</span></td>
            <td>${escapeHtml(obj.maker_label)}</td>
            <td>${escapeHtml(formatBytes(obj.total_payload_bytes))} &middot; ${escapeHtml(humanize(obj.review_state || "unreviewed"))}</td>
            <td>${escapeHtml(formatWhen(obj.created_at) || "Recent")}</td>
          </tr>`
            )
            .join("\n          ")}
        </tbody>
      </table>
    </div>
  </div>
</section>`
      : "";

  const feedsAndMethodologySection = showFeeds
    ? `<section class="section" aria-labelledby="feeds-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="feeds-h">Syndication feeds, programmatic JSON API &amp; sweep methodology</h2>
        <p class="hint">Every feed and JSON endpoint accepts <code>?category=...</code>, <code>?registry=...</code>, and <code>?q=...</code> query parameters so teams and agents can follow any niche without polling HTML.</p>
      </div>
    </div>
    <div class="cards">
      ${state.methodology
        .map(
          (m) => `<article class="card">
        <h3>${escapeHtml(tidyText(m.title, DISCOVER_GALLERY_GRID.methodology_title_max_len))}</h3>
        <p>${escapeHtml(tidyText(m.summary, DISCOVER_GALLERY_GRID.summary_max_len))}</p>
      </article>`
        )
        .join("\n      ")}
    </div>
    <div class="table-wrap section">
      <table class="data">
        <thead>
          <tr>
            <th>Feed / Endpoint</th>
            <th>Format</th>
            <th>Address &amp; query filters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><a href="${escapeHtml(state.feeds.json_feed_url)}">JSON Feed 1.1</a></td>
            <td><code>application/feed+json</code></td>
            <td><code>/q/feed.json?category=threejs_webgl_webgpu</code></td>
          </tr>
          <tr>
            <td><a href="${escapeHtml(state.feeds.rss_url)}">RSS 2.0 Feed</a></td>
            <td><code>application/rss+xml</code></td>
            <td><code>/q/rss.xml?category=game_design_and_ai</code></td>
          </tr>
          <tr>
            <td><a href="${escapeHtml(state.feeds.atom_url)}">Atom 1.0 Feed</a></td>
            <td><code>application/atom+xml</code></td>
            <td><code>/q/atom.xml?registry=Flathub</code></td>
          </tr>
          <tr>
            <td><a href="${escapeHtml(state.feeds.api_url)}">Discovery JSON API</a></td>
            <td><code>application/json</code></td>
            <td><code>/q/discover?q=webgpu&amp;sort=movers&amp;limit=20</code></td>
          </tr>
          <tr>
            <td><a href="/discover.txt">Plain-text page copy</a></td>
            <td><code>text/plain</code></td>
            <td><code>/discover.txt</code></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</section>`
    : "";

  const main = `<section class="page-head">
  <div class="wrap">
    <p class="kicker"><span class="kicker-dot" aria-hidden="true"></span>Open-source niche discovery &amp; showcase</p>
    <h1>Discover open-source tools, niches &amp; media</h1>
    <p class="lead">Browse ${ov.curated_entries.toLocaleString("en-US")} curated repositories distilled from ${ov.remote_sweep_indexed.toLocaleString("en-US")} indexed records across ${ov.category_count} domains and ${ov.registry_count} package registries, alongside deterministic 3D and video-as-code streams.</p>
    <div class="row" role="navigation" aria-label="Discovery sections">
      ${viewNav}
    </div>
  </div>
</section>
<section class="section" aria-label="Discovery corpus summary">
  <div class="wrap">
    <div class="facts">
      <div class="fact">
        <div class="fact-label">Curated catalog</div>
        <div class="fact-value">${ov.curated_entries.toLocaleString("en-US")}</div>
        <div class="fact-sub">From ${ov.remote_sweep_indexed.toLocaleString("en-US")} sweep records</div>
      </div>
      <div class="fact">
        <div class="fact-label">Cell-matrix coverage</div>
        <div class="fact-value">${ov.cell_matrix_pct}%</div>
        <div class="fact-sub">${ov.cell_matrix_covered.toLocaleString("en-US")} of ${ov.cell_matrix_total.toLocaleString("en-US")} license-recency cells</div>
      </div>
      <div class="fact">
        <div class="fact-label">Domains &amp; niches</div>
        <div class="fact-value">${ov.category_count}</div>
        <div class="fact-sub">${ov.dynamic_niches_tracked.toLocaleString("en-US")} dynamic sub-niches tracked</div>
      </div>
      <div class="fact">
        <div class="fact-label">Registries &amp; streams</div>
        <div class="fact-value">${ov.registry_count}</div>
        <div class="fact-sub">${state.showcase_videos.length} streamed showcase MP4s</div>
      </div>
    </div>
  </div>
</section>
${renderSelectedItemSection(state)}
${exploreSection}
${categoriesSection}
${rankingsSection}
${videosSection}
${liveObjectsSection}
${feedsAndMethodologySection}`;

  const pageTitle = state.selected_item
    ? `${tidyText(state.selected_item.name, DISCOVER_GALLERY_GRID.page_title_prefix_max_len)} -- Discover open-source tools`
    : f.category_label
      ? `${tidyText(f.category_label, DISCOVER_GALLERY_GRID.page_title_prefix_max_len)} -- Discover open-source tools`
      : "Discover open-source tools, niches & media";

  return documentHtml({
    title: pageTitle,
    description:
      "Search and browse curated open-source tools, emerging zero-star hidden gems, star-velocity movers, multi-registry packages, showcase videos, and RSS/Atom/JSON feeds on Teleion Fabric.",
    active: "",
    main,
    scripts: ["/discover.js"],
    canonical: "/discover",
  });
}

export function renderDiscoverJs() {
  return `// Progressive source-URL copy helper for /discover (Paper & Ink, light only).
(() => {
  document.addEventListener("click", async (event) => {
    const btn = event.target && event.target.closest ? event.target.closest("[data-copy-url]") : null;
    if (!btn) return;
    const url = btn.getAttribute("data-copy-url") || "";
    if (!url) return;
    const priorText = btn.getAttribute("data-orig-label") || btn.textContent || "Copy source URL";
    btn.setAttribute("data-orig-label", priorText);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error("clipboard_unavailable");
      }
      btn.setAttribute("data-state", "copied");
      btn.textContent = "Copied URL";
      setTimeout(() => {
        btn.removeAttribute("data-state");
        btn.textContent = priorText;
      }, ${DISCOVER_GALLERY_GRID.copied_reset_ms});
    } catch {
      btn.textContent = "Copy unavailable";
      setTimeout(() => {
        btn.textContent = priorText;
      }, ${DISCOVER_GALLERY_GRID.copied_reset_ms});
    }
  });
})();
`;
}

export async function handleDiscoverApi(request, url, db, publicUrl) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: DISCOVER_GALLERY_GRID.http_method_not_allowed,
      body: {
        ok: false,
        error: "method_not_allowed",
        detail: `This address does not take ${method}. Instructions: ${publicUrl}/llms.txt`,
      },
    };
  }
  const params = Object.fromEntries(url.searchParams.entries());
  const state = await queryDiscoverCatalog(db, publicUrl, params);
  if ((params.id || params.item) && !state.selected_item && url.pathname.startsWith("/q/")) {
    return {
      status: DISCOVER_GALLERY_GRID.http_not_found,
      body: scrubDiscoverPayload({
        ok: false,
        code: "discover_entry_not_found",
        id: String(params.id || params.item || ""),
        discover_url: `${publicUrl}/discover`,
      }),
    };
  }
  return {
    status: DISCOVER_GALLERY_GRID.http_ok,
    body: scrubDiscoverPayload({
      ok: true,
      schema: state.schema,
      discover_page_url: `${publicUrl}/discover`,
      overview: state.overview,
      filters: state.filters,
      selected_item: state.selected_item,
      peer_items: state.peer_items,
      total_matches: state.total_matches,
      entries: state.entries,
      categories: state.categories,
      registries: state.registries,
      top_movers: state.top_movers,
      top_opportunities: state.top_opportunities,
      showcase_videos: state.showcase_videos.map((v) => ({
        ...v,
        stream_url: `${publicUrl}${v.blob_path}`,
      })),
      live_task_objects: state.live_task_objects,
      feeds: state.feeds,
    }),
  };
}

export async function handleDiscoverJsonFeed(request, url, db, publicUrl) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: DISCOVER_GALLERY_GRID.http_method_not_allowed,
      headers: { "content-type": "application/json; charset=utf-8" },
      rawBody: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }
  const params = Object.fromEntries(url.searchParams.entries());
  const state = await queryDiscoverCatalog(db, publicUrl, params, {
    defaultLimit: DISCOVER_GALLERY_GRID.feed_default_limit,
    maxLimit: DISCOVER_GALLERY_GRID.feed_max_limit,
  });
  const feedTitle = state.filters.category_label
    ? `Teleion Fabric Discovery -- ${state.filters.category_label}`
    : "Teleion Fabric Open-Source Discovery Feed";
  const feedDoc = scrubDiscoverPayload({
    version: "https://jsonfeed.org/version/1.1",
    title: feedTitle,
    home_page_url: `${publicUrl}/discover`,
    feed_url: state.feeds.json_feed_url,
    description:
      "Curated multi-domain open-source repositories, hidden zero-star tools, star-velocity movers, and multi-registry packages.",
    language: "en",
    items: state.entries.map((e) => ({
      id: `${publicUrl}/discover?item=${encodeURIComponent(e.id)}`,
      url: `${publicUrl}/discover?item=${encodeURIComponent(e.id)}`,
      external_url: e.external_url,
      title: `${e.name} (${e.category_label})`,
      content_text: `${scrubBannedWords(e.summary)} | Registry: ${scrubBannedWords(e.registry)} | License: ${scrubBannedWords(e.license)} | Stars: ${e.stars}${e.star_delta > 0 ? ` (+${e.star_delta})` : ""} | Source: ${e.external_url}`,
      date_modified: e.updated_at,
      tags: [e.category, e.registry, e.track],
    })),
  });
  return {
    status: DISCOVER_GALLERY_GRID.http_ok,
    headers: {
      "content-type": "application/feed+json; charset=utf-8",
      "cache-control": `public, max-age=${DISCOVER_GALLERY_GRID.feed_cache_max_age_sec}`,
    },
    rawBody: method === "HEAD" ? null : `${JSON.stringify(feedDoc, null, 2)}\n`,
  };
}

export async function handleDiscoverRssXml(request, url, db, publicUrl) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: DISCOVER_GALLERY_GRID.http_method_not_allowed,
      headers: { "content-type": "application/json; charset=utf-8" },
      rawBody: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }
  const params = Object.fromEntries(url.searchParams.entries());
  const state = await queryDiscoverCatalog(db, publicUrl, params, {
    defaultLimit: DISCOVER_GALLERY_GRID.feed_default_limit,
    maxLimit: DISCOVER_GALLERY_GRID.feed_max_limit,
  });
  const feedTitle = scrubBannedWords(
    state.filters.category_label
      ? `Teleion Fabric Discovery -- ${state.filters.category_label}`
      : "Teleion Fabric Open-Source Discovery Feed"
  );
  const itemsXml = state.entries
    .map((e) => {
      const itemLink = `${publicUrl}/discover?item=${encodeURIComponent(e.id)}`;
      const title = xmlEscape(scrubBannedWords(`${e.name} [${e.registry}]`));
      const prosePart = scrubBannedWords(
        `${e.summary} (${e.category_label} / ${e.sub_niche}; License: ${e.license}; Stars: ${e.stars}${e.star_delta > 0 ? `, +${e.star_delta} rising` : ""}).`
      );
      const desc = xmlEscape(`${prosePart} Upstream: ${e.external_url}`);
      return `    <item>
      <title>${title}</title>
      <link>${xmlEscape(itemLink)}</link>
      <guid isPermaLink="true">${xmlEscape(itemLink)}</guid>
      <category>${xmlEscape(scrubBannedWords(e.category_label))}</category>
      <pubDate>${xmlEscape(toRfc2822Date(e.updated_at))}</pubDate>
      <description>${desc}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(feedTitle)}</title>
    <link>${xmlEscape(`${publicUrl}/discover`)}</link>
    <description>Curated multi-domain open-source tools, emerging zero-star niches, star-velocity movers, and multi-registry releases on Teleion Fabric.</description>
    <language>en-us</language>
    <lastBuildDate>${xmlEscape(toRfc2822Date(state.overview.updated_utc))}</lastBuildDate>
    <atom:link href="${xmlEscape(state.feeds.rss_url)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>
`;
  return {
    status: DISCOVER_GALLERY_GRID.http_ok,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": `public, max-age=${DISCOVER_GALLERY_GRID.feed_cache_max_age_sec}`,
    },
    rawBody: method === "HEAD" ? null : xml,
  };
}

export async function handleDiscoverAtomXml(request, url, db, publicUrl) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: DISCOVER_GALLERY_GRID.http_method_not_allowed,
      headers: { "content-type": "application/json; charset=utf-8" },
      rawBody: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }
  const params = Object.fromEntries(url.searchParams.entries());
  const state = await queryDiscoverCatalog(db, publicUrl, params, {
    defaultLimit: DISCOVER_GALLERY_GRID.feed_default_limit,
    maxLimit: DISCOVER_GALLERY_GRID.feed_max_limit,
  });
  const feedTitle = scrubBannedWords(
    state.filters.category_label
      ? `Teleion Fabric Discovery -- ${state.filters.category_label}`
      : "Teleion Fabric Open-Source Discovery Feed"
  );
  const entriesXml = state.entries
    .map((e) => {
      const itemLink = `${publicUrl}/discover?item=${encodeURIComponent(e.id)}`;
      const title = xmlEscape(scrubBannedWords(`${e.name} (${e.category_label})`));
      const summary = xmlEscape(
        scrubBannedWords(
          `${e.summary} | Registry: ${e.registry} | License: ${e.license} | Stars: ${e.stars}${e.star_delta > 0 ? ` (+${e.star_delta})` : ""}`
        )
      );
      return `  <entry>
    <id>${xmlEscape(itemLink)}</id>
    <title>${title}</title>
    <updated>${xmlEscape(e.updated_at)}</updated>
    <link rel="alternate" type="text/html" href="${xmlEscape(itemLink)}" />
    <link rel="related" href="${xmlEscape(e.external_url)}" />
    <category term="${xmlEscape(e.category)}" label="${xmlEscape(scrubBannedWords(e.category_label))}" />
    <summary>${summary}</summary>
  </entry>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(`${publicUrl}/discover`)}</id>
  <title>${xmlEscape(feedTitle)}</title>
  <updated>${xmlEscape(state.overview.updated_utc)}</updated>
  <link rel="alternate" type="text/html" href="${xmlEscape(`${publicUrl}/discover`)}" />
  <link rel="self" type="application/atom+xml" href="${xmlEscape(state.feeds.atom_url)}" />
  <author><name>Teleion Fabric</name></author>
${entriesXml}
</feed>
`;
  return {
    status: DISCOVER_GALLERY_GRID.http_ok,
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": `public, max-age=${DISCOVER_GALLERY_GRID.feed_cache_max_age_sec}`,
    },
    rawBody: method === "HEAD" ? null : xml,
  };
}
