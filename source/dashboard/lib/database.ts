import { env } from 'cloudflare:workers';

type Query = { sql: string; params: unknown[] };
type Result = { results: Record<string, unknown>[]; meta: { changes: number } };
type Runtime = Cloudflare.Env & {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DESK_STORAGE?: string;
};

/** Both adapters preserve the D1 statement interface and atomic batch semantics. */
class PostgresStatement {
  constructor(
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new PostgresStatement(this.sql, params);
  }
  async all() {
    return (await postgres([{ sql: this.sql, params: this.params }]))[0];
  }
  async first() {
    return (await this.all()).results[0] ?? null;
  }
  async run() {
    return (await postgres([{ sql: this.sql, params: this.params }]))[0];
  }
}
async function postgres(statements: Query[]): Promise<Result[]> {
  const config = env as Runtime;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Postgres storage is not configured.');
  const origin = new URL(config.SUPABASE_URL);
  if (origin.protocol !== 'https:')
    throw new Error('Postgres requires an HTTPS endpoint.');
  const response = await fetch(new URL('/rest/v1/rpc/desk_query', origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + config.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ statements }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error('Postgres operation failed (' + response.status + ').');
  return (await response.json()) as Result[];
}
export function database(): D1Database {
  const config = env as Runtime;
  if (config.DESK_STORAGE === 'postgres')
    return {
      prepare: (sql: string) => new PostgresStatement(sql),
      batch: (statements: PostgresStatement[]) =>
        postgres(
          statements.map((statement) => ({
            sql: statement.sql,
            params: statement.params,
          })),
        ),
    } as unknown as D1Database;
  if (config.DESK_STORAGE && config.DESK_STORAGE !== 'd1')
    throw new Error('Unknown storage configuration.');
  if (!config.DB) throw new Error('Task storage is unavailable.');
  return config.DB;
}
