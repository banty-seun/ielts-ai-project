// server/db.ts
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema'; // adjust path if yours differs

// Reuse a single pool in dev (avoid hot-reload duplication)
const globalForDb = global as unknown as { __pool?: Pool; __db?: NodePgDatabase<typeof schema> };

if (!globalForDb.__pool) {
  globalForDb.__pool = new Pool({ connectionString: process.env.DATABASE_URL });
}

if (!globalForDb.__db) {
  globalForDb.__db = drizzle(globalForDb.__pool, { schema });
}

export const pool = globalForDb.__pool; // if you need raw SQL occasionally
export const db: NodePgDatabase<typeof schema> = globalForDb.__db;
export { schema };
