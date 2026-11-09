// One canonical host for people (design contract of Nov 2, 2026): on any other host that reaches this Worker, a page navigation answers with a
// redirect to shim.teleionlabs.com (page_shell.json site.host), keeping the path and the query: 301 for GET and HEAD, 308 for any other method sent to a page.
// herma.teleionlabs.com is a working alias that is served in place and does not redirect.
//
// Only page navigations redirect. A navigation is a GET or HEAD for one of the pages below whose Accept header asks for HTML (a browser, a crawler or a link
// preview always does) and not for JSON (?format=json, or an Accept that names application/json). Everything machines read and write answers in place on the old
// address: /q/*, /v1/*, /api/*, /mcp, /chat, /feedback, /status, /health*, /help, the llms and agent files, /.well-known/*, /prompts/raw/*, the /kits/* downloads,
// the scripts and the stylesheets. So does a plain curl or script request for a page ("Accept: */*"): /kits answers it with its JSON catalog, and a script that
// does not follow redirects should not have to learn that. The live workers call this address with curl, which does not follow a redirect unless it is told to; an
// MCP client does not follow a cross-origin one; a published agent pointer may still name the old address. Eranos made the same choice for its alias (8c3af96).
// Every page names shim.teleionlabs.com as its canonical (rel=canonical), so a search engine loses nothing.
//
// It is switched on by the CANONICAL_REDIRECT variable ("on" in wrangler.jsonc). Unset, as in tests and local runs, nothing redirects.
import SHELL from "../../herma/page_shell.json" with { type: "json" };

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^.]+\.localhost)$/i;
const SERVED_HOSTS = new Set([SHELL.site.host, "herma.teleionlabs.com"]);

// The pages people open in a browser: the paths the Worker answers with HTML (release gate: tests/fixtures/pages).
const PAGE_PATHS = new Set(["/", "/shim", "/console", "/connect", "/starter", "/prompts", "/get-started", "/trust", "/dashboard", "/discover", "/kits"]);
// A starter or dashboard sub-page, a contribution, a worker, a demo, a prompt page. /prompts/raw/* is plain text for agents, so it is not a page.
const PAGE_PREFIXES = ["/starter/", "/dashboard/", "/prompts/", "/c/", "/w/", "/q/demo/"];
const MACHINE_PREFIXES = ["/prompts/raw"];

const pagePath = (pathname) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname);
const isMachinePath = (path) => MACHINE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
const isPagePath = (path) => !isMachinePath(path) && (PAGE_PATHS.has(path) || PAGE_PREFIXES.some((prefix) => path.startsWith(prefix)));

/** Whether this request is a person (or a crawler) opening a page, and not a machine reading or writing. */
export function isPageNavigation(request) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return false; // a CORS preflight is answered where it arrives
  const url = new URL(request.url);
  if (!isPagePath(pagePath(url.pathname))) return false;
  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (url.searchParams.get("format") === "json" || accept.includes("application/json")) return false;
  if (method === "GET" || method === "HEAD") return accept.includes("text/html");
  return true; // anything else sent to a page is answered with a 405 on the canonical host, where the sender is told to go
}

/** The redirect for a page navigation that came in on another host, or null when the request should be served here. */
export function canonicalRedirect(request, env = {}) {
  if (String(env?.CANONICAL_REDIRECT ?? "off").toLowerCase() !== "on") return null;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (SERVED_HOSTS.has(host) || LOCAL_HOST.test(host)) return null;
  if (!isPageNavigation(request)) return null;
  // Joined as text, never resolved as a URL: a path such as //example.com/x must stay a path on our host, not become another site.
  const target = `${SHELL.site.origin}${url.pathname}${url.search}`;
  const method = request.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: {
      location: target,
      // A moved page may be remembered for an hour; a moved POST is never cached. The answer depends on Accept, so a shared cache must say so.
      "cache-control": safe ? "public, max-age=3600" : "no-store",
      vary: "accept",
      "x-content-type-options": "nosniff",
    },
  });
}
