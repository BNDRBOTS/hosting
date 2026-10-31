import { pool } from '../../../db/client.ts';
import { AuthorizationError, requireAutomationAccess, requireOwnedProject } from '../../../db/authorization.ts';

export interface VerificationContractDefinition {
  flows: Array<{ name: string; steps: string[]; assertions: string[] }>;
  version: number;
}

export async function markContractMissing(sessionToken: string, projectId: string): Promise<void> {
  await requireOwnedProject(pool, sessionToken, projectId);
  await pool.query(
    `INSERT INTO verification_contracts (project_id, status, definition)
     VALUES ($1, 'missing', '{}'::jsonb)
     ON CONFLICT (project_id) DO NOTHING`,
    [projectId],
  );
}

export async function offerVerificationContract(
  sessionToken: string,
  projectId: string,
  definition: VerificationContractDefinition,
): Promise<{ id: string }> {
  await requireOwnedProject(pool, sessionToken, projectId);
  validateDefinition(definition);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO verification_contracts (project_id, status, definition)
     VALUES ($1, 'offered', $2::jsonb)
     ON CONFLICT (project_id) DO UPDATE
     SET status = 'offered', definition = EXCLUDED.definition, updated_at = now()
     WHERE verification_contracts.status <> 'active'
     RETURNING id`,
    [projectId, JSON.stringify(definition)],
  );
  if (!result.rows[0]) throw new Error('An active verification plan cannot be replaced without a new independent validation.');
  return result.rows[0];
}

export async function activateVerificationContract(
  automationKey: string,
  projectId: string,
  validatedDefinition: VerificationContractDefinition,
): Promise<void> {
  await requireAutomationAccess(automationKey, 'verifier');
  validateDefinition(validatedDefinition);
  const result = await pool.query(
    `UPDATE verification_contracts SET status = 'active', updated_at = now()
     WHERE project_id = $1 AND status = 'offered' AND definition = $2::jsonb`,
    [projectId, JSON.stringify(validatedDefinition)],
  );
  if (!result.rowCount) throw new AuthorizationError('The proposed checks must be saved before they can be activated.');
}

export async function getVerificationContract(sessionToken: string, projectId: string): Promise<{ id: string; status: string; definition: unknown } | null> {
  await requireOwnedProject(pool, sessionToken, projectId);
  const result = await pool.query<{ id: string; status: string; definition: unknown }>(
    'SELECT id, status, definition FROM verification_contracts WHERE project_id = $1',
    [projectId],
  );
  return result.rows[0] ?? null;
}

function validateDefinition(definition: VerificationContractDefinition): void {
  if (!Number.isInteger(definition.version) || definition.version < 1 || !Array.isArray(definition.flows) || definition.flows.length === 0) {
    throw new Error('A verification plan must include a version and at least one flow.');
  }
  for (const flow of definition.flows) {
    if (!flow.name.trim() || flow.steps.length === 0 || flow.assertions.length === 0 || flow.steps.some((step) => !step.trim()) || flow.assertions.some((assertion) => !assertion.trim())) {
      throw new Error('Every verification flow must have a name, steps, and measurable checks.');
    }
  }
}
