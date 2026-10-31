import { randomUUID } from 'node:crypto';
import { checkDatabaseConnection } from '../../../db/client.ts';

export type SystemStatus =
  | { state: 'ready' }
  | { state: 'unavailable'; referenceId: string };

export async function getSystemStatus(): Promise<SystemStatus> {
  try {
    await checkDatabaseConnection();
    return { state: 'ready' };
  } catch (error) {
    const referenceId = randomUUID();
    console.error('System health check failed', { referenceId, error });
    return { state: 'unavailable', referenceId };
  }
}
