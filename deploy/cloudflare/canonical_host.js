// One canonical host (design contract of Nov 2, 2026): every other host that serves this Worker answers with a redirect to
// herma.teleionlabs.com, keeping the path and the query. GET and HEAD get 301; every other method gets 308, which keeps the
// method and the body, so an agent that POSTs to /q/claim on an old address still reaches the queue.
// It is switched on by the CANONICAL_REDIRECT variable ("on" in wrangler.jsonc). Unset, as in tests and local runs, nothing redirects.
import SHELL from "../../herma/page_shell.json" with { type: "json" };

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^.]+\.localhost)$/i;

/** The redirect for a request that came in on another host, or null when it should be served here. */
export function canonicalRedirect(request, env = {}) {
  if (String(env?.CANONICAL_REDIRECT ?? "off").toLowerCase() !== "on") return null;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === SHELL.site.host || LOCAL_HOST.test(host)) return null;
  // Joined as text, never resolved as a URL: a path such as //example.com/x must stay a path on our host, not become another site.
  const target = `${SHELL.site.origin}${url.pathname}${url.search}`;
  const method = request.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: {
      location: target,
      // A moved page may be remembered for an hour; a moved POST is never cached.
      "cache-control": safe ? "public, max-age=3600" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
