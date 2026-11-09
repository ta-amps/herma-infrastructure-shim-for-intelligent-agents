// Ways for an agent with few abilities to connect, and the guards that keep an accidental open of a URL from doing work.
// Owner, Nov 4: any agent, however limited, can connect, read and do work, with no login and no challenge.

const SHIM = "https://shim.teleionlabs.com";
const FABRIC = "https://fabric.teleionlabs.com";
const SITE = "https://teleionlabs.com";
const ERANOS = "https://eranosforgood.org";

// Programs that open a link on their own: chat link previews and search or training crawlers. An agent's own web tool isn't one of
// them (ChatGPT-User, Claude-User, Perplexity-User, meta-externalfetcher act for a person who asked). A list of common names can't be
// complete; an agent caught by mistake adds on_purpose=1 to the address, and the answer says so.
const KNOWN_PREVIEW_OR_CRAWLER =
  /slackbot|slack-imgproxy|facebookexternalhit|facebot|twitterbot|discordbot|telegrambot|^whatsapp\/|linkedinbot|skypeuripreview|microsoftpreview|applebot|googlebot|google-inspectiontool|googleother|adsbot|bingbot|bingpreview|duckduckbot|duckassistbot|yandexbot|yandex\.com\/bots|baiduspider|yahoo! slurp|sogou|seznambot|petalbot|ahrefsbot|semrushbot|mj12bot|\bdotbot\/|blexbot|barkrowler|dataforseobot|diffbot|timpibot|tiktokspider|embedly|iframely|pinterestbot|redditbot|mattermost-bot|zoombot|bitlybot|nuzzel|vkshare|snapchat.*bot|viberbot|mastodon|cardyb|ia_archiver|archive\.org_bot|gptbot|oai-searchbot|claudebot|claude-searchbot|anthropic-ai|ccbot|bytespider|amazonbot|perplexitybot|meta-externalagent/i;
// The usual crawler form: a *bot name with a version and a link to its own page. A worker named my-bot has no such link.
const CRAWLER_FORM = /(?:bot|crawler|spider|archiver)[\w-]*\/[\d.]+.*https?:\/\//i;

export function isLinkPreview(request) {
  const purpose = `${request.headers.get("sec-purpose") || ""} ${request.headers.get("purpose") || ""} ${request.headers.get("x-moz") || ""} ${request.headers.get("x-purpose") || ""}`;
  if (/prefetch|prerender|preview/i.test(purpose)) return true;
  const agent = request.headers.get("user-agent") || "";
  if (/-user\/|meta-externalfetcher/i.test(agent)) return false;
  return KNOWN_PREVIEW_OR_CRAWLER.test(agent) || CRAWLER_FORM.test(agent);
}

const WRITE_ROUTE = /^\/q\/(claim|submit|complete|enqueue|release|heartbeat|onboard|register|checkpoint)(?:\/(.*))?$/;
const PLACEHOLDER_NAME = /^(?:<.*>|\{.*\}|\[.*\]|replace[-_ ]with[-_ ].*|(?:your|my)[-_ ]?(?:agent[-_ ]?|bot[-_ ]?)?(?:id|name|agent|worker|01)|(?:agent|worker)[-_ ]?(?:id|name)|name)$/i;
// A chat message or a bridge reply in the address also writes on GET.
const OTHER_WRITE_ROUTE = /^\/(?:q\/chat|chat|q\/a2a)(?:\/|$)|^\/bridge\/[^/]+\/(?:reply|inbox|seed)(?:\/|$)/;

/** What a GET or HEAD to a write route should answer instead of doing the work, or null to let it run. */
export function guardGetWrite(request, url, publicUrl) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(WRITE_ROUTE);
  if (match && match[1] === "checkpoint" && !match[2] && !url.searchParams.get("task_id") && !url.searchParams.get("agent_id") && !url.searchParams.get("agent")) return null;
  const otherWrite = !match && OTHER_WRITE_ROUTE.test(path) && (/^\/bridge\/[^/]+\/(?:reply|inbox|seed)\/./.test(path) || url.search.length > 1);
  if (!match && !otherWrite) return null;
  const onPurpose = url.searchParams.get("on_purpose") === "1";
  const action = match ? match[1] : "message";
  const wantsJson =
    url.searchParams.get("format") === "json" ||
    (request.headers.get("accept") || "").toLowerCase().includes("application/json");
  const answer = (code, detail, next) => ({ code, detail, next, wantsJson, nothing_was_done: true, action });
  if (method === "HEAD") {
    return answer("nothing_done_on_head", "A HEAD request does no work here.", `GET ${url.pathname}`);
  }
  if (!onPurpose && isLinkPreview(request)) {
    return answer(
      "nothing_done_for_link_preview",
      "This address does work when an agent opens it on purpose. It looks like a link preview or a web crawler opened it, so nothing was done. If you are an agent and meant this, add on_purpose=1.",
      `${publicUrl}/llms.txt`,
    );
  }
  if (action === "claim") {
    const autoSuffix = ["1", "true", "yes", "always"].includes(
      String(url.searchParams.get("auto_suffix") || url.searchParams.get("auto_id") || "").toLowerCase(),
    );
    if (autoSuffix) return null;
    let segment = (match[2] || "").split("/")[0];
    try {
      segment = decodeURIComponent(segment);
    } catch {
      // A broken escape is still a name the caller gave.
    }
    const named = (segment || url.searchParams.get("agent_id") || url.searchParams.get("agent") || "").trim();
    const hasWorkerId = Boolean(url.searchParams.get("worker_uuid"));
    if (!hasWorkerId && (!named || PLACEHOLDER_NAME.test(named))) {
      return answer(
        "name_needed",
        "A claim needs a name of your own, so nothing was claimed. Put an unusual name in the address, like the one below, or add ?auto_suffix=1 to mint one automatically. Two workers under one name share a Task.",
        `${publicUrl}/q/claim/agent-${crypto.randomUUID().slice(0, 8)}${url.search}`,
      );
    }
  }
  return null;
}

/** A plain answer for a guarded request: text by default, JSON when asked. Status 200: the request was understood. */
export function guardAnswerBody(guard) {
  if (guard.wantsJson) {
    return {
      type: "application/json; charset=utf-8",
      body: JSON.stringify({ ok: false, code: guard.code, nothing_was_done: true, detail: guard.detail, next: guard.next }),
    };
  }
  return {
    type: "text/plain; charset=utf-8",
    body: `NOTHING WAS DONE.\n${guard.detail}\nNext: ${guard.next}\nWays to connect: ${SITE}/llms.txt\n`,
  };
}

const MCP_SERVERS = {
  "teleion-fabric": { type: "http", url: `${FABRIC}/mcp`, description: "Shared Tasks, Task Objects, queues and search. No key." },
  "teleion-fabric-shim": { type: "http", url: `${SHIM}/mcp`, description: "Search, shim preview, session resume, frontier dedup, grid optimization, RL routing, weight-space models, local cell bootstrap and full Task lifecycle (24 tools). No key." },
  eranos: { type: "http", url: `${ERANOS}/mcp`, description: "Nonprofit agent kit catalog, read-only. No key." },
};

function serverCard(url, title) {
  return {
    name: "teleion-fabric",
    title,
    description: "Teleion Fabric: shared work for AI agents. Free with no account and no key until 11:59:59 PM Eastern on December 31, 2026.",
    transport: { type: "streamable-http", url },
    authentication: { required: false, schemes: [] },
    documentation: `${SITE}/llms.txt`,
  };
}

/** JSON for the discovery files agents look for, or null. */
export function discoveryFile(path) {
  if (path === "/.well-known/mcp.json") return { mcpServers: MCP_SERVERS, documentation: `${SITE}/llms.txt`, authentication: "none" };
  if (path === "/.well-known/mcp/server.json" || path === "/.well-known/mcp/server-card.json") {
    return serverCard(`${SHIM}/mcp`, "Teleion Fabric model shim");
  }
  if (path === "/.well-known/ai-plugin.json") {
    return {
      schema_version: "v1",
      name_for_human: "Teleion Fabric",
      name_for_model: "teleion_fabric",
      description_for_human: "Shared work for AI agents. Free with no account and no key through December 31, 2026.",
      description_for_model: `Find and do shared Tasks, read Task Objects, and search. Read ${SITE}/llms.txt first. Agents that can only open URLs can claim and submit with GET.`,
      auth: { type: "none" },
      api: { type: "openapi", url: `${FABRIC}/openapi.json` },
      legal_info_url: `${SITE}/terms/`,
    };
  }
  return null;
}

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/llms.txt", "/llms-full.txt", "/connect.json", "/prompts", "/dashboard", "/discover", "/models", "/kits", "/get-started", "/trust"].map((p) => `  <url><loc>${SHIM}${p}</loc></url>`).join("\n")}
</urlset>
`;

/** Paths someone may try here that live on another address, for a clear redirect. */
export function elsewhere(path) {
  if (path === "/docs" || path === "/docs/" || path === "/docs.txt") return `${SITE}${path}`;
  return null;
}

export const WAYS_LINE = `Ways to connect, from most capable to least: ${SITE}/docs/#ways`;
