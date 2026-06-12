// Shared SQLite query helper for DB worker code.
// `db` is oo1.Database or OpfsSAHPoolDb; both expose .exec({ sql, bind, rowMode, callback }).

interface ExecOpts<T> {
  sql: string;
  bind?: unknown[];
  rowMode?: 'object' | 'array';
  callback?: (row: T) => void;
}
interface SqliteHandle {
  exec<T>(opts: ExecOpts<T>): unknown;
}

export function execAll<T = Record<string, unknown>>(
  db: SqliteHandle,
  sql: string,
  bind: unknown[] = [],
): T[] {
  const rows: T[] = [];
  db.exec<T>({
    sql,
    bind,
    rowMode: 'object',
    callback: (row: T) => rows.push(row),
  });
  return rows;
}
