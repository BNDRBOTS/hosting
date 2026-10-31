import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://proofloop:proofloop@localhost:5432/proofloop',
  connectionTimeoutMillis: 1500,
});
try {
  await pool.query('SELECT 1');
} catch {
  console.error(`ProofLoop tests need the real local PostgreSQL database. Start the services and apply the data setup, then try again. Reference: ${randomUUID()}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
