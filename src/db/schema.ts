import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const recordTimestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Accounts owns identities, revocable sessions, reset tokens, and encrypted API credentials.
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  check('users_password_hash_argon2id_check', sql`${table.passwordHash} like '$argon2id$%'`),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash), index('sessions_user_id_idx').on(table.userId)]);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash), index('password_reset_tokens_user_id_idx').on(table.userId)]);

export const apiCredentials = pgTable('api_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  ciphertext: text('ciphertext').notNull(),
  nonce: varchar('nonce', { length: 24 }).notNull(),
  authenticationTag: varchar('authentication_tag', { length: 24 }).notNull(),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('api_credentials_user_provider_unique').on(table.userId, table.provider)]);

// Projects owns GitHub connections, project identities, and each project's verification contract.
export const githubConnections = pgTable('github_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  githubAccountId: varchar('github_account_id', { length: 255 }).notNull(),
  ciphertext: text('ciphertext').notNull(),
  nonce: varchar('nonce', { length: 24 }).notNull(),
  authenticationTag: varchar('authentication_tag', { length: 24 }).notNull(),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('github_connections_user_account_unique').on(table.userId, table.githubAccountId)]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  githubConnectionId: uuid('github_connection_id').references(() => githubConnections.id, { onDelete: 'restrict' }).notNull(),
  githubRepoId: varchar('github_repo_id', { length: 255 }).notNull(),
  defaultBranch: varchar('default_branch', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('projects_github_repo_unique').on(table.githubRepoId), index('projects_connection_idx').on(table.githubConnectionId)]);

export const verificationContracts = pgTable('verification_contracts', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('verification_contracts_project_unique').on(table.projectId),
  check('verification_contracts_status_check', sql`${table.status} in ('missing', 'offered', 'active')`),
]);

// Change Requests owns user requests, decomposed requirements, and terminal explanations.
export const changeRequests = pgTable('change_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }).notNull(),
  requestText: text('request_text').notNull(),
  status: varchar('status', { length: 32 }).default('queued').notNull(),
  outcomeSummary: text('outcome_summary'),
  ...recordTimestamps(),
}, (table) => [
  index('change_requests_project_created_idx').on(table.projectId, table.createdAt),
  check('change_requests_status_check', sql`${table.status} in ('queued', 'implementing', 'verifying', 'fixing', 'awaiting-approval', 'approved', 'shipping', 'shipped', 'rejected')`),
]);

export const requirements = pgTable('requirements', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  text: text('text').notNull(),
  status: varchar('status', { length: 16 }).default('unevidenced').notNull(),
  ...recordTimestamps(),
}, (table) => [
  index('requirements_change_request_idx').on(table.changeRequestId),
  check('requirements_status_check', sql`${table.status} in ('unevidenced', 'evidenced')`),
]);

export const changeRequestOutcomes = pgTable('change_request_outcomes', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  outcome: varchar('outcome', { length: 16 }).notNull(),
  explanation: text('explanation').notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('change_request_outcomes_request_unique').on(table.changeRequestId),
  check('change_request_outcomes_outcome_check', sql`${table.outcome} in ('rejected', 'shipped')`),
]);

// Agent Runs owns sandbox execution attempts and readable activity events.
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  sandboxId: varchar('sandbox_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('agent_runs_attempt_unique').on(table.changeRequestId, table.attemptNumber),
  index('agent_runs_change_request_idx').on(table.changeRequestId),
  check('agent_runs_status_check', sql`${table.status} in ('running', 'passed', 'failed', 'cancelled')`),
  check('agent_runs_attempt_check', sql`${table.attemptNumber} between 1 and 5`),
  check('agent_runs_end_check', sql`(${table.status} = 'running' and ${table.endedAt} is null) or (${table.status} <> 'running' and ${table.endedAt} is not null)`),
]);

export const agentEvents = pgTable('agent_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'restrict' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  humanPhrase: text('human_phrase').notNull(),
  ...recordTimestamps(),
}, (table) => [index('agent_events_run_time_idx').on(table.agentRunId, table.occurredAt)]);

// Verification Engine owns machine runs and non-empty captured artifacts.
export const verificationRuns = pgTable('verification_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'restrict' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  verifiedSha: varchar('verified_sha', { length: 64 }),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  ...recordTimestamps(),
}, (table) => [
  index('verification_runs_agent_run_idx').on(table.agentRunId),
  index('verification_runs_project_sha_idx').on(table.projectId, table.verifiedSha),
  check('verification_runs_status_check', sql`${table.status} in ('running', 'passed', 'failed')`),
  check('verification_runs_end_check', sql`(${table.status} = 'running' and ${table.endedAt} is null) or (${table.status} <> 'running' and ${table.endedAt} is not null)`),
  check('verification_runs_sha_check', sql`${table.status} = 'running' or ${table.verifiedSha} is not null`),
]);

export const evidenceArtifacts = pgTable('evidence_artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  verificationRunId: uuid('verification_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  storagePath: text('storage_path').notNull(),
  ...recordTimestamps(),
}, (table) => [
  index('evidence_artifacts_run_idx').on(table.verificationRunId),
  check('evidence_artifacts_kind_check', sql`${table.kind} in ('screenshot', 'log', 'network', 'database')`),
  check('evidence_artifacts_path_nonempty_check', sql`length(trim(${table.storagePath})) > 0`),
]);

// Risk owns deterministic rule assessments; models never set the classification.
export const riskAssessments = pgTable('risk_assessments', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  tier: varchar('tier', { length: 16 }).notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  footprint: jsonb('footprint').$type<{ changedFiles: string[]; changedLines: number }>().notNull(),
  computedBy: varchar('computed_by', { length: 16 }).default('rules').notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('risk_assessments_request_unique').on(table.changeRequestId),
  check('risk_assessments_tier_check', sql`${table.tier} in ('routine', 'high_risk')`),
  check('risk_assessments_reasons_check', sql`jsonb_typeof(${table.reasons}) = 'array' and ((${table.tier} = 'routine' and jsonb_array_length(${table.reasons}) = 0) or (${table.tier} = 'high_risk' and jsonb_array_length(${table.reasons}) > 0))`),
  check('risk_assessments_computed_by_check', sql`${table.computedBy} = 'rules'`),
]);

// Approver owns independent decisions and evidence-validation facts.
export const approverDecisions = pgTable('approver_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  verificationRunId: uuid('verification_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  decision: varchar('decision', { length: 16 }).notNull(),
  evidenceValidation: jsonb('evidence_validation').$type<{ requirements_evidenced: boolean; claims_traced: boolean; claim_traces: Array<{ claim_id: string; evidence_artifact_ids: string[] }> }>().notNull(),
  spotCheckRunId: uuid('spot_check_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  deeperChecks: jsonb('deeper_checks').$type<Record<string, unknown>>().default({}).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
  ...recordTimestamps(),
}, (table) => [
  index('approver_decisions_request_decided_idx').on(table.changeRequestId, table.decidedAt),
  check('approver_decisions_decision_check', sql`${table.decision} in ('approved', 'rejected')`),
]);

// Shipping owns the only durable record that a change was shipped.
export const shipRecords = pgTable('ship_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'restrict' }).notNull(),
  verificationRunId: uuid('verification_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  approverDecisionId: uuid('approver_decision_id').references(() => approverDecisions.id, { onDelete: 'restrict' }).notNull(),
  mergedSha: varchar('merged_sha', { length: 64 }).notNull(),
  mergedAt: timestamp('merged_at', { withTimezone: true }).defaultNow().notNull(),
  postCheckRunId: uuid('post_check_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('ship_records_request_unique').on(table.changeRequestId),
  uniqueIndex('ship_records_approver_unique').on(table.approverDecisionId),
]);

// Watching owns post-ship outcomes and automatic rollback records.
export const postChecks = pgTable('post_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipRecordId: uuid('ship_record_id').references(() => shipRecords.id, { onDelete: 'restrict' }).notNull(),
  verificationRunId: uuid('verification_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  outcome: text('outcome').notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('post_checks_ship_record_unique').on(table.shipRecordId),
  check('post_checks_status_check', sql`${table.status} in ('passed', 'failed')`),
]);

export const autoReverts = pgTable('auto_reverts', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipRecordId: uuid('ship_record_id').references(() => shipRecords.id, { onDelete: 'restrict' }).notNull(),
  revertedSha: varchar('reverted_sha', { length: 64 }).notNull(),
  revertedAt: timestamp('reverted_at', { withTimezone: true }).defaultNow().notNull(),
  reCheckRunId: uuid('re_check_run_id').references(() => verificationRuns.id, { onDelete: 'restrict' }).notNull(),
  ...recordTimestamps(),
}, (table) => [uniqueIndex('auto_reverts_ship_record_unique').on(table.shipRecordId)]);

// Undo is the optional user-requested or automatic reversal record, never an approval.
export const undos = pgTable('undos', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipRecordId: uuid('ship_record_id').references(() => shipRecords.id, { onDelete: 'restrict' }).notNull(),
  revertedSha: varchar('reverted_sha', { length: 64 }).notNull(),
  revertedAt: timestamp('reverted_at', { withTimezone: true }).defaultNow().notNull(),
  initiatedBy: varchar('initiated_by', { length: 16 }).notNull(),
  ...recordTimestamps(),
}, (table) => [
  uniqueIndex('undos_ship_record_unique').on(table.shipRecordId),
  check('undos_initiated_by_check', sql`${table.initiatedBy} in ('user', 'system')`),
]);
