import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

declare global {
  // Reuse the client across dev hot-reloads instead of leaking connections.
  var __db: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    );
  }

  // Supabase pooler (port 6543) multiplexes over one connection, which is what
  // serverless needs. prepare:false is required for pgbouncer transaction mode.
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });

  return drizzle(client, { schema });
}

export const db = globalThis.__db ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__db = db;
}

export * from './schema';