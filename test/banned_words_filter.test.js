import { describe, expect, it } from "vitest";
import { buildTidy, tidyText } from "../deploy/cloudflare/page_shell.js";
import { sha256Hex } from "../deploy/cloudflare/sha256_sync.js";

// The display filter that worker-written text passes through before a page shows it (MUST-FOLLOW rule 16). The real banned words
// live in the ONE shared list outside this repository and reach the Worker through a git-ignored module; these tests drive the
// mechanism with a made-up list, so no banned word is spelled here. The release gate (make gate) exercises the real list.

async function webCryptoSha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("sha256_sync", () => {
  it("matches Web Crypto on short, block-sized and non-ASCII input", async () => {
    const samples = ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(65), "x".repeat(200), "café 日本", "Fnorbleton"];
    for (const sample of samples) {
      expect(sha256Hex(sample)).toBe(await webCryptoSha256(sample));
    }
  });
});

const MADE_UP = {
  displayRules: [
    { re: "\\bglimbo\\s+cloud\\b", flags: "i", to: "a hosted thing" },
    { re: "glimbo", flags: "i", to: "a thing" },
    { re: "\\bzorptest\\b", flags: "i", to: "example" },
    { re: "\\bplorps?\\b", flags: "i", to: { plorp: "Widget", plorps: "Widgets" } },
    { re: "^\\s*Whim\\s*$", flags: "i", to: "Note" },
    { re: "\\bsnarf[a-z]*\\b", flags: "i", to: "…" },
  ],
  privateSha256: [sha256Hex("fnorbleton")],
};

describe("buildTidy", () => {
  const tidy = buildTidy(MADE_UP);

  it("replaces listed words with their descriptions, in the order given", () => {
    expect(tidy("Served by glimbo cloud, then by glimbo")).toBe("Served by a hosted thing, then by a thing");
    expect(tidy("A zorptest run")).toBe("A example run");
  });

  it("maps each matched word through its table, whatever its case", () => {
    expect(tidy("Plorps and a PLORP")).toBe("Widgets and a Widget");
  });

  it("keeps a whole-text rule to a whole text", () => {
    expect(tidy("Whim")).toBe("Note");
    expect(tidy("A whim")).toBe("A whim");
  });

  it("hides a private name by the hash of each word, and only the whole word", () => {
    expect(tidy("by Fnorbleton, not Fnorbletons")).toBe("by …, not Fnorbletons");
    expect(tidy("by FNORBLETON.com")).toBe("by ….com");
  });

  it("drops long ids and hashes and the brackets they leave", () => {
    expect(tidy("Audit (verb_evl_f550d8794064, verb_own_b4e012efd371, verb_own_564830af3d51")).toBe("Audit");
    expect(tidy("See w_musehermawor_8ffbf268 and 969951471abf3c now")).toBe("See … and … now");
  });

  it("keeps the text readable: no em dash, one space, a length limit", () => {
    expect(tidy(`one${String.fromCharCode(0x2014)}two   three`)).toBe("one--two three");
    expect(tidy("word ".repeat(100), 40).length).toBeLessThanOrEqual(41);
    expect(tidy(null)).toBe("");
  });

  it("is not stateful between calls", () => {
    expect(tidy("zorptest zorptest")).toBe("example example");
    expect(tidy("zorptest zorptest")).toBe("example example");
  });
});

describe("tidyText (built from the shared list at build time)", () => {
  it("is a working filter whichever list built it", () => {
    expect(tidyText("a   b")).toBe("a b");
    expect(tidyText("see 969951471abf3c")).toBe("see …");
  });
});
