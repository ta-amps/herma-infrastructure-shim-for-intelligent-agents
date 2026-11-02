import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { readHomeTotals, resetHomeTotals } from "../deploy/cloudflare/home_totals.js";

// The five plain numbers on the home page use the dashboard's own definitions, so the home and the dashboard never disagree.
const call = (path) => exports.default.fetch(`https://herma.teleionlabs.com${path}`);

describe("readHomeTotals", () => {
  it("agrees with the queue pulse on workers, Tasks and checks", async () => {
    const pulse = await (await call("/q/pulse")).json();
    resetHomeTotals();
    const totals = await readHomeTotals(env.HERMA_DB);
    expect(totals.workers).toBe(pulse.worker_fleet.registered_workers);
    for (const [mine, theirs] of [["nonprofit", "ngo_priority"], ["shared", "public_general"]]) {
      const queue = pulse.queue_counts_by_tier[theirs];
      expect(totals[mine]).toEqual({ ready: queue.ready, leased: queue.leased, done: queue.done });
    }
    expect(totals.checks).toBe(pulse.worker_fleet.total_evaluations);
    expect(totals.searchable).toBe(pulse.queue_embodiments.hybrid_search_sidecar.indexed_unique_contents);
  }, 60000);

  it("is remembered for a moment and is null when the tables are not there", async () => {
    let reads = 0;
    const db = { prepare() { reads += 1; throw new Error("no such table"); } };
    resetHomeTotals();
    expect(await readHomeTotals(db)).toBeNull();
    expect(await readHomeTotals(db)).toBeNull();
    expect(reads).toBe(1); // the second answer came from memory
    expect(await readHomeTotals(null)).toBeNull();
  });
});
