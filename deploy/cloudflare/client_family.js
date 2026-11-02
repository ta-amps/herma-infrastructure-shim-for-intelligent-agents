// What Herma keeps of a visitor's browser or tool (finding F-PRIV-LOGS-001): a coarse family, never the version, the device or the operating
// system. A full User-Agent string can single a person out, so the trace log and the bridge records store only one of these words, and
// /q/traces shows only that word, whatever an older row holds.

const FAMILIES = [
  ["browser", /mozilla|chrome|safari|firefox|edg\/|opera|webkit/i],
  ["curl", /\bcurl\b|wget/i],
  ["python", /python|httpx|aiohttp|requests|urllib/i],
  ["node", /\bnode\b|undici|axios|node-fetch|deno|bun/i],
  ["go", /go-http-client|\bgo\b/i],
  ["java", /okhttp|\bjava\b|apache-http/i],
  ["agent", /agent|codex|claude|gemini|opencode|mcp|bot\b/i],
];

const WORDS = new Set([...FAMILIES.map(([family]) => family), "other", "unknown"]);

/** Idempotent: a family word that is already stored comes back unchanged. */
export function clientFamily(userAgent) {
  const text = String(userAgent ?? "").trim();
  if (!text) return "unknown";
  if (WORDS.has(text)) return text;
  for (const [family, pattern] of FAMILIES) if (pattern.test(text)) return family;
  return "other";
}
