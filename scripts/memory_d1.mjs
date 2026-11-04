// An in-memory stand-in for a D1 database, on Node's built-in SQLite, for the gate and for tests that run the real Worker
// without Cloudflare: the same prepare / bind / run / first / all / batch calls, one connection, nothing written to disk.
class SqliteStmt {
  constructor(sqlite, sql, args = []) { this.sqlite = sqlite; this.sql = sql; this.args = args; }
  bind(...args) { return new SqliteStmt(this.sqlite, this.sql, args); }
  async run() { const res = this.sqlite.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(res.changes ?? 0), last_row_id: Number(res.lastInsertRowid ?? 0) } }; }
  async first() { const row = this.sqlite.prepare(this.sql).get(...this.args); return row ? { ...row } : null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) }; }
}

export async function inMemoryD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  return {
    sqlite,
    prepare: (sql) => new SqliteStmt(sqlite, sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    hasTable(name) { return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)); },
  };
}
