import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

const connectionString = process.env.DATABASE_URL ?? 'postgres://proofloop:proofloop@localhost:5432/proofloop';
export const pool = new Pool({ connectionString, max: 10 });
export const db = drizzle(pool, { schema });

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}
