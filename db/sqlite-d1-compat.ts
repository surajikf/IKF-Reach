import { DatabaseSync, type StatementSync, type SQLInputValue } from "node:sqlite";

type D1Meta = {
  changes: number;
  last_row_id: number;
  duration: number;
};

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: true;
  meta: D1Meta;
};

function toMeta(info?: { changes?: number | bigint; lastInsertRowid?: number | bigint }): D1Meta {
  return {
    changes: Number(info?.changes ?? 0),
    last_row_id: Number(info?.lastInsertRowid ?? 0),
    duration: 0,
  };
}

/**
 * Mirrors the slice of Cloudflare D1's PreparedStatement API this app uses
 * (bind/all/first/run), backed by a synchronous node:sqlite statement.
 */
export class CompatPreparedStatement {
  private readonly stmt: StatementSync;
  private args: SQLInputValue[] = [];

  constructor(stmt: StatementSync) {
    this.stmt = stmt;
  }

  bind(...args: unknown[]) {
    this.args = args.map((value) => {
      if (value === undefined) return null;
      if (typeof value === "boolean") return value ? 1 : 0;
      return value;
    }) as SQLInputValue[];
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = this.stmt.all(...this.args) as T[];
    return { results: rows, success: true, meta: toMeta() };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt.get(...this.args) as T | undefined;
    return row ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const info = this.stmt.run(...this.args);
    return { results: [], success: true, meta: toMeta(info) };
  }

  /** Internal: used by batch() to execute a write statement inside a transaction. */
  runSync() {
    return this.stmt.run(...this.args);
  }
}

/**
 * Drop-in replacement for the D1Database interface this app relies on
 * (prepare/batch), backed by a local SQLite file via node:sqlite. Lets
 * every existing `queueDb.prepare(sql).bind(...).all()/.run()/.first()`
 * call site keep working unchanged after moving off Cloudflare D1.
 */
export class SqliteD1Compat {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql: string): CompatPreparedStatement {
    return new CompatPreparedStatement(this.db.prepare(sql));
  }

  async batch<T = Record<string, unknown>>(statements: CompatPreparedStatement[]): Promise<D1Result<T>[]> {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => ({
        results: [] as T[],
        success: true as const,
        meta: toMeta(statement.runSync()),
      }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}
