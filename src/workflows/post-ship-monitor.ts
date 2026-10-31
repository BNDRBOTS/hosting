import { pool } from '../db/client.ts';
import { recordSystemUndo } from '../features/undo/queries/undos.ts';
import { recordPostShipCheck, type PostShipCheckInput } from '../features/watching/queries/watch.ts';

export async function recordPostShipOutcome(
  watcherKey: string,
  input: PostShipCheckInput,
): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recordPostShipCheck(client, watcherKey, input);
    if (input.status === 'failed' && input.revertedSha) {
      await recordSystemUndo(client, watcherKey, input.shipRecordId, input.revertedSha);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
