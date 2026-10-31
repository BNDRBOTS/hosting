import { pool } from '../../../db/client.ts';
import { requireAutomationAccess } from '../../../db/authorization.ts';
import { evaluateRisk, type ChangeFootprint } from '../classification.ts';

export async function assessChangeRisk(
  automationKey: string,
  changeRequestId: string,
  footprint: ChangeFootprint,
): Promise<{ tier: 'routine' | 'high'; reasons: string[] }> {
  await requireAutomationAccess(automationKey, 'risk');
  const assessment = evaluateRisk(footprint);
  await pool.query(
    `INSERT INTO risk_assessments (change_request_id, tier, reasons, footprint, computed_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, 'rules')
     ON CONFLICT (change_request_id) DO UPDATE
     SET tier = EXCLUDED.tier, reasons = EXCLUDED.reasons, footprint = EXCLUDED.footprint,
         computed_by = 'rules', updated_at = now()`,
    [
      changeRequestId,
      assessment.tier === 'high' ? 'high_risk' : 'routine',
      JSON.stringify(assessment.reasons),
      JSON.stringify({ changedFiles: footprint.changedFiles, changedLines: footprint.changedLines }),
    ],
  );
  return assessment;
}
