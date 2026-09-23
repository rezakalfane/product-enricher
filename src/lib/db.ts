import { createClient, type Client, type InStatement } from '@libsql/client';
import { env } from './env';

export type ActionStatus = 'pending' | 'approved' | 'applied' | 'cancelled' | 'failed';
export type ActionKind =
  | 'create_product'
  | 'update_product'
  | 'add_product_image'
  | 'set_variant_image';

/** A single reviewable change proposed by the analyzer. */
export type QueueAction = {
  id: string;
  job_id: string;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  summary: string;
  confidence: number;
  /** Chosen BigCommerce product, once the user confirms a match. */
  product_id: number | null;
  variant_id: number | null;
  /** JSON blobs, parsed at the route boundary. */
  payload: string;
  candidates: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: string;
  source_type: 'file' | 'text';
  filename: string;
  mime: string;
  status: 'analyzing' | 'done' | 'error';
  note: string | null;
  created_at: string;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     source_type TEXT NOT NULL,
     filename TEXT NOT NULL,
     mime TEXT NOT NULL,
     status TEXT NOT NULL,
     note TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS actions (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     status TEXT NOT NULL,
     title TEXT NOT NULL,
     summary TEXT NOT NULL,
     confidence REAL NOT NULL DEFAULT 0,
     product_id INTEGER,
     variant_id INTEGER,
     payload TEXT NOT NULL DEFAULT '{}',
     candidates TEXT NOT NULL DEFAULT '[]',
     error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS actions_status ON actions(status)`,
  `CREATE INDEX IF NOT EXISTS actions_job ON actions(job_id)`,
];

let client: Client | null = null;
let ready: Promise<Client> | null = null;

/**
 * One libSQL client for the process. Points at Turso when TURSO_DATABASE_URL is set,
 * and at a local SQLite file otherwise, so dev and production run the same code path.
 */
export function getDb(): Promise<Client> {
  if (ready) return ready;
  ready = (async () => {
    client = createClient(
      env.tursoUrl
        ? { url: env.tursoUrl, authToken: env.tursoAuthToken }
        : { url: `file:${env.dbPath}` },
    );
    for (const stmt of SCHEMA) await client.execute(stmt);
    return client;
  })();
  // Don't pin a failed connection to a warm instance — let the next request retry.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

type Args = Record<string, unknown> | unknown[];

/** Run a statement and return typed rows. */
export async function all<T>(sql: string, args?: Args): Promise<T[]> {
  const db = await getDb();
  const rs = await db.execute(args ? { sql, args: args as never } : sql);
  return rs.rows as unknown as T[];
}

/** Run a statement and return the first row, if any. */
export async function one<T>(sql: string, args?: Args): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

/** Run a statement for its side effects. */
export async function run(sql: string, args?: Args): Promise<void> {
  const db = await getDb();
  await db.execute(args ? { sql, args: args as never } : sql);
}

/** Run several writes atomically. */
export async function batch(statements: InStatement[]): Promise<void> {
  if (statements.length === 0) return;
  const db = await getDb();
  await db.batch(statements, 'write');
}

export const now = () => new Date().toISOString();
