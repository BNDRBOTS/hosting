export type RiskLevel = 'routine' | 'high';

export interface ChangeFootprint {
  changedFiles: readonly string[];
  changedLines: number;
}

export const HIGH_RISK_PATH_RULES = [
  { code: 'authentication-path', pattern: /(^|\/)(auth|authentication|authn|sign[-_]?in|login|session)(\/|\.|$)/i },
  { code: 'payment-path', pattern: /(^|\/)(payment|payments|billing|checkout)(\/|\.|$)/i },
  { code: 'stored-user-data-deletion', pattern: /(^|\/).*(delete|deletion|erase|remove).*(user|account|data).*/i },
  { code: 'migration-path', pattern: /(^|\/)(migrations?|drizzle)(\/|\.|$)/i },
] as const;

export const HIGH_RISK_SIZE_LIMITS = { maximumFiles: 10, maximumChangedLines: 400 } as const;

export interface RiskAssessmentResult {
  tier: RiskLevel;
  reasons: string[];
}

export function evaluateRisk(footprint: ChangeFootprint): RiskAssessmentResult {
  if (!Number.isInteger(footprint.changedLines) || footprint.changedLines < 0) {
    throw new RangeError('Changed line count must be a non-negative integer.');
  }
  if (footprint.changedFiles.some((file) => !file.trim())) throw new Error('Changed file paths must not be empty.');
  const reasons: string[] = HIGH_RISK_PATH_RULES
    .filter(({ pattern }) => footprint.changedFiles.some((file) => pattern.test(file)))
    .map(({ code }) => code);
  if (footprint.changedFiles.length > HIGH_RISK_SIZE_LIMITS.maximumFiles) reasons.push('file-count-over-10');
  if (footprint.changedLines > HIGH_RISK_SIZE_LIMITS.maximumChangedLines) reasons.push('changed-lines-over-400');
  return { tier: reasons.length ? 'high' : 'routine', reasons };
}

export function classifyRisk(footprint: ChangeFootprint): RiskLevel {
  return evaluateRisk(footprint).tier;
}
