import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgres://proofloop:proofloop@localhost:5432/proofloop';
const pool = new Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder: './src/db/migrations' });
  console.log('ProofLoop data setup is ready.');
} catch {
  const referenceId = randomUUID();
  console.error(`ProofLoop could not update its data setup. No data was intentionally removed. Start the local database and try again. Reference: ${referenceId}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
