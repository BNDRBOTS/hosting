CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"human_phrase" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"sandbox_id" varchar(255) NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('running', 'passed', 'failed', 'cancelled')),
	CONSTRAINT "agent_runs_attempt_check" CHECK ("agent_runs"."attempt_number" between 1 and 5),
	CONSTRAINT "agent_runs_end_check" CHECK (("agent_runs"."status" = 'running' and "agent_runs"."ended_at" is null) or ("agent_runs"."status" <> 'running' and "agent_runs"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"authentication_tag" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approver_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"evidence_validation" jsonb NOT NULL,
	"spot_check_run_id" uuid NOT NULL,
	"deeper_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approver_decisions_decision_check" CHECK ("approver_decisions"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "auto_reverts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ship_record_id" uuid NOT NULL,
	"reverted_sha" varchar(64) NOT NULL,
	"reverted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"re_check_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_request_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_request_outcomes_outcome_check" CHECK ("change_request_outcomes"."outcome" in ('rejected', 'shipped'))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"request_text" text NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"outcome_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('queued', 'implementing', 'verifying', 'fixing', 'awaiting-approval', 'approved', 'shipping', 'shipped', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "evidence_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_artifacts_kind_check" CHECK ("evidence_artifacts"."kind" in ('screenshot', 'log', 'network', 'database')),
	CONSTRAINT "evidence_artifacts_path_nonempty_check" CHECK (length(trim("evidence_artifacts"."storage_path")) > 0)
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"github_account_id" varchar(255) NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"authentication_tag" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ship_record_id" uuid NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_checks_status_check" CHECK ("post_checks"."status" in ('passed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_connection_id" uuid NOT NULL,
	"github_repo_id" varchar(255) NOT NULL,
	"default_branch" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" varchar(16) DEFAULT 'unevidenced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_status_check" CHECK ("requirements"."status" in ('unevidenced', 'evidenced'))
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"tier" varchar(16) NOT NULL,
	"reasons" jsonb NOT NULL,
	"computed_by" varchar(16) DEFAULT 'rules' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_assessments_tier_check" CHECK ("risk_assessments"."tier" in ('routine', 'high_risk')),
	CONSTRAINT "risk_assessments_computed_by_check" CHECK ("risk_assessments"."computed_by" = 'rules')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ship_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"approver_decision_id" uuid NOT NULL,
	"merged_sha" varchar(64) NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_check_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "undos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ship_record_id" uuid NOT NULL,
	"reverted_sha" varchar(64) NOT NULL,
	"reverted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"initiated_by" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "undos_initiated_by_check" CHECK ("undos"."initiated_by" in ('user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_contracts_status_check" CHECK ("verification_contracts"."status" in ('missing', 'offered', 'active'))
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"verified_sha" varchar(64),
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_runs_status_check" CHECK ("verification_runs"."status" in ('running', 'passed', 'failed')),
	CONSTRAINT "verification_runs_end_check" CHECK (("verification_runs"."status" = 'running' and "verification_runs"."ended_at" is null) or ("verification_runs"."status" <> 'running' and "verification_runs"."ended_at" is not null)),
	CONSTRAINT "verification_runs_sha_check" CHECK ("verification_runs"."status" = 'running' or "verification_runs"."verified_sha" is not null)
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_decisions" ADD CONSTRAINT "approver_decisions_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_decisions" ADD CONSTRAINT "approver_decisions_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approver_decisions" ADD CONSTRAINT "approver_decisions_spot_check_run_id_verification_runs_id_fk" FOREIGN KEY ("spot_check_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reverts" ADD CONSTRAINT "auto_reverts_ship_record_id_ship_records_id_fk" FOREIGN KEY ("ship_record_id") REFERENCES "public"."ship_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reverts" ADD CONSTRAINT "auto_reverts_re_check_run_id_verification_runs_id_fk" FOREIGN KEY ("re_check_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_outcomes" ADD CONSTRAINT "change_request_outcomes_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_checks" ADD CONSTRAINT "post_checks_ship_record_id_ship_records_id_fk" FOREIGN KEY ("ship_record_id") REFERENCES "public"."ship_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_checks" ADD CONSTRAINT "post_checks_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_connection_id_github_connections_id_fk" FOREIGN KEY ("github_connection_id") REFERENCES "public"."github_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_records" ADD CONSTRAINT "ship_records_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_records" ADD CONSTRAINT "ship_records_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_records" ADD CONSTRAINT "ship_records_approver_decision_id_approver_decisions_id_fk" FOREIGN KEY ("approver_decision_id") REFERENCES "public"."approver_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_records" ADD CONSTRAINT "ship_records_post_check_run_id_verification_runs_id_fk" FOREIGN KEY ("post_check_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undos" ADD CONSTRAINT "undos_ship_record_id_ship_records_id_fk" FOREIGN KEY ("ship_record_id") REFERENCES "public"."ship_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_contracts" ADD CONSTRAINT "verification_contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_run_time_idx" ON "agent_events" USING btree ("agent_run_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_attempt_unique" ON "agent_runs" USING btree ("change_request_id","attempt_number");--> statement-breakpoint
CREATE INDEX "agent_runs_change_request_idx" ON "agent_runs" USING btree ("change_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_credentials_user_provider_unique" ON "api_credentials" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_reverts_ship_record_unique" ON "auto_reverts" USING btree ("ship_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_outcomes_request_unique" ON "change_request_outcomes" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "change_requests_project_created_idx" ON "change_requests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_run_idx" ON "evidence_artifacts" USING btree ("verification_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_connections_user_account_unique" ON "github_connections" USING btree ("user_id","github_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_checks_ship_record_unique" ON "post_checks" USING btree ("ship_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_github_repo_unique" ON "projects" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX "projects_connection_idx" ON "projects" USING btree ("github_connection_id");--> statement-breakpoint
CREATE INDEX "requirements_change_request_idx" ON "requirements" USING btree ("change_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_assessments_request_unique" ON "risk_assessments" USING btree ("change_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ship_records_request_unique" ON "ship_records" USING btree ("change_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ship_records_approver_unique" ON "ship_records" USING btree ("approver_decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "undos_ship_record_unique" ON "undos" USING btree ("ship_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_contracts_project_unique" ON "verification_contracts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "verification_runs_agent_run_idx" ON "verification_runs" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "verification_runs_project_sha_idx" ON "verification_runs" USING btree ("project_id","verified_sha");