// Prints "yes" when Playwright's browser is installed, so `make check` can say plainly when it skips the browser checks.
import fs from "node:fs";

try {
  const { chromium } = await import("playwright");
  if (fs.existsSync(chromium.executablePath())) process.stdout.write("yes");
} catch {
  /* no Playwright, no browser checks */
}
