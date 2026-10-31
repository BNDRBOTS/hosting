CREATE OR REPLACE FUNCTION proofloop_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_touch_updated_at() IS 'Keeps the required updated_at field current for each row.';
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_events', 'agent_runs', 'api_credentials', 'approver_decisions', 'auto_reverts',
    'change_request_outcomes', 'change_requests', 'evidence_artifacts', 'github_connections',
    'password_reset_tokens', 'post_checks', 'projects', 'requirements', 'risk_assessments',
    'sessions', 'ship_records', 'undos', 'users', 'verification_contracts', 'verification_runs'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION proofloop_touch_updated_at()', table_name || '_touch_updated_at', table_name);
  END LOOP;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_agent_run() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' THEN
      RAISE EXCEPTION 'A work attempt must begin in the running state.' USING ERRCODE = '23514';
    END IF;
    SELECT status INTO request_status FROM change_requests WHERE id = NEW.change_request_id;
    IF request_status NOT IN ('implementing', 'fixing') THEN
      RAISE EXCEPTION 'Work can start only while a change is being implemented or repaired.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.change_request_id IS DISTINCT FROM OLD.change_request_id
     OR NEW.sandbox_id IS DISTINCT FROM OLD.sandbox_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR OLD.status <> 'running'
     OR NEW.status NOT IN ('passed', 'failed', 'cancelled')
     OR NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'A work attempt can be ended once, without changing its original details.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_agent_run() IS 'I8: preserves bounded implementation attempts and their immutable sandbox identity.';
--> statement-breakpoint
CREATE TRIGGER agent_runs_lifecycle BEFORE INSERT OR UPDATE ON agent_runs
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_agent_run();
--> statement-breakpoint
COMMENT ON TRIGGER agent_runs_lifecycle ON agent_runs IS 'I8: attempts begin once, end once, and cannot be reopened.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_bind_verification_run() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_project uuid;
BEGIN
  SELECT cr.project_id INTO expected_project
    FROM agent_runs ar JOIN change_requests cr ON cr.id = ar.change_request_id
    WHERE ar.id = NEW.agent_run_id;
  IF expected_project IS NULL OR expected_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'A verification run must belong to the project being checked.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_bind_verification_run() IS 'I4: every verification record is bound to the exact project and its change request.';
--> statement-breakpoint
CREATE TRIGGER verification_runs_project_binding BEFORE INSERT OR UPDATE OF agent_run_id, project_id ON verification_runs
FOR EACH ROW EXECUTE FUNCTION proofloop_bind_verification_run();
--> statement-breakpoint
COMMENT ON TRIGGER verification_runs_project_binding ON verification_runs IS 'I4: prevents attaching a verification to another project.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_passing_run() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'running'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.verified_sha IS DISTINCT FROM OLD.verified_sha
       OR NEW.report IS DISTINCT FROM OLD.report OR NEW.agent_run_id IS DISTINCT FROM OLD.agent_run_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
    RAISE EXCEPTION 'A completed verification is permanently bound to its exact report and code version.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'passed' AND CASE WHEN TG_OP = 'INSERT' THEN true ELSE OLD.status IS DISTINCT FROM 'passed' END THEN
    IF NEW.verified_sha IS NULL OR NEW.verified_sha !~ '^[0-9a-f]{40}([0-9a-f]{24})?$' THEN
      RAISE EXCEPTION 'A passing verification must identify the exact tested code version.' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.report) <> 'object' OR jsonb_object_length(NEW.report) = 0
       OR jsonb_typeof(NEW.report->'claims') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A passing verification must include its machine-generated report and structured claims.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.report->'claims') AS claims(value)
      WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
         OR jsonb_typeof(value->'id') IS DISTINCT FROM 'string'
         OR length(trim(COALESCE(value->>'id', ''))) = 0
         OR jsonb_typeof(value->'statement') IS DISTINCT FROM 'string'
         OR length(trim(COALESCE(value->>'statement', ''))) = 0
    ) OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.report->'claims')) <> jsonb_array_length(NEW.report->'claims') THEN
      RAISE EXCEPTION 'Every verification claim must have a unique identifier and plain description.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM evidence_artifacts WHERE verification_run_id = NEW.id AND length(trim(storage_path)) > 0) THEN
      RAISE EXCEPTION 'A passing verification must have at least one evidence artifact.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_passing_run() IS 'I4/I6: only an exact-version run with a non-empty machine report and captured evidence can pass.';
--> statement-breakpoint
CREATE TRIGGER verification_runs_passing_evidence_gate BEFORE INSERT OR UPDATE ON verification_runs
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_passing_run();
--> statement-breakpoint
COMMENT ON TRIGGER verification_runs_passing_evidence_gate ON verification_runs IS 'I4/I6: passing requires exact-version machine evidence.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_approver_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  main_project uuid;
  main_sha text;
  main_status text;
  main_change uuid;
  main_report jsonb;
  claim_record jsonb;
  trace_record jsonb;
  claim_id text;
  evidence_id text;
  check_project uuid;
  check_sha text;
  check_status text;
  check_change uuid;
  risk_tier text;
  spot_id uuid;
  spot_ids jsonb;
  adversarial jsonb;
BEGIN
  IF NEW.decision <> 'approved' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.evidence_validation->'requirements_evidenced', 'false'::jsonb) <> 'true'::jsonb
     OR COALESCE(NEW.evidence_validation->'claims_traced', 'false'::jsonb) <> 'true'::jsonb THEN
    RAISE EXCEPTION 'Approval requires every requirement to be evidenced and every claim to be traced.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM requirements WHERE change_request_id = NEW.change_request_id AND status <> 'evidenced')
     OR NOT EXISTS (SELECT 1 FROM requirements WHERE change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'Approval is blocked until every requirement has evidence.' USING ERRCODE = '23514';
  END IF;

  SELECT vr.project_id, vr.verified_sha, vr.status, ar.change_request_id, vr.report
    INTO main_project, main_sha, main_status, main_change, main_report
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = NEW.verification_run_id;
  IF main_status IS DISTINCT FROM 'passed' OR main_change IS DISTINCT FROM NEW.change_request_id THEN
    RAISE EXCEPTION 'Approval requires a passing verification for this change.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(main_report->'claims') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW.evidence_validation->'claim_traces') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Approval requires the verification claims and their explicit evidence links.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(main_report->'claims') <> jsonb_array_length(NEW.evidence_validation->'claim_traces')
     OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(main_report->'claims')) <> jsonb_array_length(main_report->'claims')
     OR (SELECT count(DISTINCT value->>'claim_id') FROM jsonb_array_elements(NEW.evidence_validation->'claim_traces')) <> jsonb_array_length(NEW.evidence_validation->'claim_traces') THEN
    RAISE EXCEPTION 'Every verification claim must have exactly one explicit evidence trace.' USING ERRCODE = '23514';
  END IF;
  FOR claim_record IN SELECT value FROM jsonb_array_elements(main_report->'claims') LOOP
    claim_id := claim_record->>'id';
    IF jsonb_typeof(claim_record) IS DISTINCT FROM 'object'
       OR jsonb_typeof(claim_record->'id') IS DISTINCT FROM 'string'
       OR length(trim(COALESCE(claim_id, ''))) = 0
       OR jsonb_typeof(claim_record->'statement') IS DISTINCT FROM 'string'
       OR length(trim(COALESCE(claim_record->>'statement', ''))) = 0
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(NEW.evidence_validation->'claim_traces') AS traces(value)
         WHERE value->>'claim_id' = claim_id
           AND CASE WHEN jsonb_typeof(value->'evidence_artifact_ids') = 'array'
                    THEN jsonb_array_length(value->'evidence_artifact_ids') > 0 ELSE false END
       ) THEN
      RAISE EXCEPTION 'Every claim must be plainly described and linked to captured evidence.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR trace_record IN SELECT value FROM jsonb_array_elements(NEW.evidence_validation->'claim_traces') LOOP
    IF jsonb_typeof(trace_record) IS DISTINCT FROM 'object'
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(main_report->'claims') AS claims(value) WHERE value->>'id' = trace_record->>'claim_id')
       OR CASE WHEN jsonb_typeof(trace_record->'evidence_artifact_ids') = 'array'
               THEN jsonb_array_length(trace_record->'evidence_artifact_ids') = 0 ELSE true END THEN
      RAISE EXCEPTION 'Claim traces must point to a claim and at least one captured evidence artifact.' USING ERRCODE = '23514';
    END IF;
    FOR evidence_id IN SELECT jsonb_array_elements_text(trace_record->'evidence_artifact_ids') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM evidence_artifacts
        WHERE id::text = evidence_id AND verification_run_id IN (NEW.verification_run_id, NEW.spot_check_run_id)
      ) THEN
        RAISE EXCEPTION 'Claim evidence must reference an artifact from the final verification or its spot-check.' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  SELECT vr.project_id, vr.verified_sha, vr.status, ar.change_request_id
    INTO check_project, check_sha, check_status, check_change
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = NEW.spot_check_run_id;
  IF NEW.spot_check_run_id = NEW.verification_run_id OR check_status IS DISTINCT FROM 'passed'
     OR check_sha IS DISTINCT FROM main_sha OR check_project IS DISTINCT FROM main_project
     OR check_change IS DISTINCT FROM NEW.change_request_id THEN
    RAISE EXCEPTION 'Approval requires a separate passing spot-check on the same code version.' USING ERRCODE = '23514';
  END IF;

  SELECT tier INTO risk_tier FROM risk_assessments WHERE change_request_id = NEW.change_request_id;
  IF risk_tier IS NULL THEN
    RAISE EXCEPTION 'Approval requires a deterministic risk assessment.' USING ERRCODE = '23514';
  END IF;
  IF risk_tier = 'high_risk' THEN
    adversarial := NEW.deeper_checks->'adversarial_flows';
    spot_ids := NEW.deeper_checks->'spot_check_run_ids';
    IF jsonb_typeof(adversarial) IS DISTINCT FROM 'array'
       OR CASE WHEN jsonb_typeof(adversarial) = 'array' THEN jsonb_array_length(adversarial) ELSE 0 END < 3
       OR jsonb_typeof(spot_ids) IS DISTINCT FROM 'array'
       OR CASE WHEN jsonb_typeof(spot_ids) = 'array' THEN jsonb_array_length(spot_ids) ELSE 0 END < 3
       OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(spot_ids) = 'array' THEN spot_ids ELSE '[]'::jsonb END)) < 3
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(spot_ids) = 'array' THEN spot_ids ELSE '[]'::jsonb END) AS ids(value) WHERE ids.value::uuid = NEW.spot_check_run_id) THEN
      RAISE EXCEPTION 'High-risk approval requires three adversarial flows and three distinct independent spot-checks.' USING ERRCODE = '23514';
    END IF;
    FOR spot_id IN SELECT value::uuid FROM jsonb_array_elements_text(spot_ids) LOOP
      IF spot_id = NEW.verification_run_id OR NOT EXISTS (
        SELECT 1 FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
        WHERE vr.id = spot_id AND vr.status = 'passed' AND vr.verified_sha = main_sha
          AND vr.project_id = main_project AND ar.change_request_id = NEW.change_request_id
      ) THEN
        RAISE EXCEPTION 'Every high-risk spot-check must pass on the same code version.' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_approver_decision() IS 'I5/I6: approval requires complete evidence, traceable claims, a passing final-version run, and a separate same-version re-run; high risk requires three extra flows and spot-checks.';
--> statement-breakpoint
CREATE TRIGGER approver_decisions_evidence_gate BEFORE INSERT OR UPDATE ON approver_decisions
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_approver_decision();
--> statement-breakpoint
COMMENT ON TRIGGER approver_decisions_evidence_gate ON approver_decisions IS 'I5/I6: incomplete or unsupported approvals are refused.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_ship_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_status text;
  run_sha text;
  run_project uuid;
  run_change uuid;
  approval_decision text;
  approval_run uuid;
  approval_change uuid;
  evidence jsonb;
  spot_id uuid;
  spot_status text;
  spot_sha text;
  spot_project uuid;
  spot_change uuid;
  request_project uuid;
  request_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT project_id, status INTO request_project, request_status FROM change_requests WHERE id = NEW.change_request_id;
  IF request_status IS DISTINCT FROM 'shipping' THEN
    RAISE EXCEPTION 'A change must pass its approval gate before it can ship.' USING ERRCODE = '23514';
  END IF;
  SELECT vr.status, vr.verified_sha, vr.project_id, ar.change_request_id
    INTO run_status, run_sha, run_project, run_change
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = NEW.verification_run_id;
  IF run_status IS DISTINCT FROM 'passed' OR run_sha IS DISTINCT FROM NEW.merged_sha
     OR run_project IS DISTINCT FROM request_project OR run_change IS DISTINCT FROM NEW.change_request_id THEN
    RAISE EXCEPTION 'Shipping requires a passing verification of the exact code version being shipped.' USING ERRCODE = '23514';
  END IF;
  SELECT decision, verification_run_id, change_request_id, evidence_validation, spot_check_run_id
    INTO approval_decision, approval_run, approval_change, evidence, spot_id
    FROM approver_decisions WHERE id = NEW.approver_decision_id;
  IF approval_decision IS DISTINCT FROM 'approved' OR approval_run IS DISTINCT FROM NEW.verification_run_id
     OR approval_change IS DISTINCT FROM NEW.change_request_id
     OR COALESCE(evidence->'requirements_evidenced', 'false'::jsonb) <> 'true'::jsonb
     OR COALESCE(evidence->'claims_traced', 'false'::jsonb) <> 'true'::jsonb THEN
    RAISE EXCEPTION 'Shipping requires independent evidence-validated approval for this passing verification.' USING ERRCODE = '23514';
  END IF;
  SELECT vr.status, vr.verified_sha, vr.project_id, ar.change_request_id
    INTO spot_status, spot_sha, spot_project, spot_change
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = spot_id;
  IF spot_id IS NULL OR spot_id = NEW.verification_run_id OR spot_status IS DISTINCT FROM 'passed'
     OR spot_sha IS DISTINCT FROM NEW.merged_sha OR spot_project IS DISTINCT FROM request_project
     OR spot_change IS DISTINCT FROM NEW.change_request_id THEN
    RAISE EXCEPTION 'Shipping requires a second passing check on the exact code version.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM requirements WHERE change_request_id = NEW.change_request_id AND status <> 'evidenced')
     OR NOT EXISTS (SELECT 1 FROM requirements WHERE change_request_id = NEW.change_request_id) THEN
    RAISE EXCEPTION 'Shipping is blocked until every requirement has evidence.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_ship_record() IS 'I4/I5/I6: a ship record requires a final-version passing run and an independent evidence-validated approval with a separate same-version passing check.';
--> statement-breakpoint
CREATE TRIGGER ship_records_gate BEFORE INSERT OR UPDATE ON ship_records
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_ship_record();
--> statement-breakpoint
COMMENT ON TRIGGER ship_records_gate ON ship_records IS 'I4/I5/I6: refuses every ship record unless both evidence gates match the exact shipped version.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_change_request_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'A new change request must begin in the queued state.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('shipped', 'rejected') THEN
    RAISE EXCEPTION 'A finished change cannot be reopened.' USING ERRCODE = '23514';
  END IF;
  allowed := CASE OLD.status
    WHEN 'queued' THEN NEW.status IN ('implementing', 'rejected')
    WHEN 'implementing' THEN NEW.status IN ('verifying', 'fixing', 'rejected')
    WHEN 'verifying' THEN NEW.status IN ('fixing', 'awaiting-approval', 'rejected')
    WHEN 'fixing' THEN NEW.status IN ('implementing', 'verifying', 'rejected')
    WHEN 'awaiting-approval' THEN NEW.status IN ('approved', 'fixing', 'rejected')
    WHEN 'approved' THEN NEW.status = 'shipping'
    WHEN 'shipping' THEN NEW.status = 'shipped'
    ELSE false
  END;
  IF NOT allowed THEN RAISE EXCEPTION 'The requested change status transition is not allowed.' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'implementing' AND (
    NOT EXISTS (SELECT 1 FROM requirements WHERE change_request_id = NEW.id)
    OR NOT EXISTS (SELECT 1 FROM risk_assessments WHERE change_request_id = NEW.id)
  ) THEN RAISE EXCEPTION 'Implementation can begin only after requirements and deterministic risk are recorded.' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'approved' AND NOT EXISTS (
    SELECT 1 FROM approver_decisions WHERE change_request_id = NEW.id AND decision = 'approved'
  ) THEN RAISE EXCEPTION 'A change cannot be approved without an independent approval decision.' USING ERRCODE = '23514'; END IF;
  IF NEW.status IN ('shipped', 'rejected') AND length(trim(COALESCE(NEW.outcome_summary, ''))) = 0 THEN
    RAISE EXCEPTION 'A finished change needs a plain-English outcome summary.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'shipped' AND NOT EXISTS (
    SELECT 1 FROM ship_records WHERE change_request_id = NEW.id
  ) THEN RAISE EXCEPTION 'A change cannot be marked shipped without a passing ship record.' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'rejected' AND NOT EXISTS (
    SELECT 1 FROM change_request_outcomes WHERE change_request_id = NEW.id AND outcome = 'rejected' AND length(trim(explanation)) > 0
  ) THEN RAISE EXCEPTION 'A rejected change requires a plain-English explanation.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_change_request_status() IS 'I5/I8: protects the automatic change lifecycle; approval, shipping, and rejection require their durable decision or explanation.';
--> statement-breakpoint
CREATE TRIGGER change_requests_status_gate BEFORE INSERT OR UPDATE OF status ON change_requests
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_change_request_status();
--> statement-breakpoint
COMMENT ON TRIGGER change_requests_status_gate ON change_requests IS 'I5/I8: refuses illegal transitions and terminal states without their required records.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_evidence_artifact() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE run_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Captured evidence is retained and cannot be deleted.' USING ERRCODE = '23514'; END IF;
  SELECT status INTO run_state FROM verification_runs WHERE id = NEW.verification_run_id;
  IF run_state IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'Evidence can be attached only while its verification is running.' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Captured evidence records cannot be changed.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_evidence_artifact() IS 'I6/I10: evidence is only attached to a live run and retained unchanged.';
--> statement-breakpoint
CREATE TRIGGER evidence_artifacts_protect BEFORE INSERT OR UPDATE OR DELETE ON evidence_artifacts
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_evidence_artifact();
--> statement-breakpoint
COMMENT ON TRIGGER evidence_artifacts_protect ON evidence_artifacts IS 'I6/I10: prevents replacing or erasing proof after capture.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_approver_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Independent approval records are permanent and cannot be changed or deleted.' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_approver_decision() IS 'I5/I6: an independent decision cannot be rewritten after it is recorded.';
--> statement-breakpoint
CREATE TRIGGER approver_decisions_immutable BEFORE UPDATE OR DELETE ON approver_decisions
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_approver_decision();
--> statement-breakpoint
COMMENT ON TRIGGER approver_decisions_immutable ON approver_decisions IS 'I5/I6: preserves the independent decision.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_requirements() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO request_state FROM change_requests WHERE id = NEW.change_request_id;
    IF request_state IS DISTINCT FROM 'queued' THEN
      RAISE EXCEPTION 'Requirements can be prepared only for a newly received request.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A saved requirement cannot be removed.' USING ERRCODE = '23514'; END IF;
  IF NEW.change_request_id IS DISTINCT FROM OLD.change_request_id OR NEW.text IS DISTINCT FROM OLD.text
     OR (OLD.status = 'evidenced' AND NEW.status IS DISTINCT FROM 'evidenced') THEN
    RAISE EXCEPTION 'Requirement wording and completed evidence records cannot be changed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_requirements() IS 'I6/I10: requirement text and completed evidence cannot be silently altered or erased.';
--> statement-breakpoint
CREATE TRIGGER requirements_immutable_text BEFORE INSERT OR UPDATE OR DELETE ON requirements
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_requirements();
--> statement-breakpoint
COMMENT ON TRIGGER requirements_immutable_text ON requirements IS 'I6/I10: preserves original requirements and evidence status.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_change_request() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A saved change request cannot be removed.' USING ERRCODE = '23514'; END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.request_text IS DISTINCT FROM OLD.request_text THEN
    RAISE EXCEPTION 'The original request and connected project cannot be changed.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('shipped', 'rejected') AND NEW.outcome_summary IS DISTINCT FROM OLD.outcome_summary THEN
    RAISE EXCEPTION 'A finished change outcome cannot be rewritten.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_change_request() IS 'I10: preserves the original user request and its project relationship.';
--> statement-breakpoint
CREATE TRIGGER change_requests_preserve_intake BEFORE UPDATE OR DELETE ON change_requests
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_change_request();
--> statement-breakpoint
COMMENT ON TRIGGER change_requests_preserve_intake ON change_requests IS 'I10: prevents silent loss or rewriting of a user request.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_single_use_tokens() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Reset-token records are retained.' USING ERRCODE = '23514'; END IF;
  IF OLD.used_at IS NOT NULL OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.used_at IS NULL AND NEW.used_at IS NULL) THEN
    RAISE EXCEPTION 'A password-reset link can be used once and cannot be rewritten.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_single_use_tokens() IS 'I10: reset links are expiring, single-use records and cannot be restored or rewritten.';
--> statement-breakpoint
CREATE TRIGGER password_reset_tokens_single_use BEFORE UPDATE OR DELETE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_single_use_tokens();
--> statement-breakpoint
COMMENT ON TRIGGER password_reset_tokens_single_use ON password_reset_tokens IS 'I10: enforces one-time password reset links.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_session_revocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Session records are retained for audit.' USING ERRCODE = '23514'; END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.revoked_at IS NULL AND NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'A session can be revoked once and cannot be reactivated or rewritten.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_session_revocation() IS 'I10: session revocation is permanent and audit records are retained.';
--> statement-breakpoint
CREATE TRIGGER sessions_revocation_only BEFORE UPDATE OR DELETE ON sessions
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_session_revocation();
--> statement-breakpoint
COMMENT ON TRIGGER sessions_revocation_only ON sessions IS 'I10: revoked sessions cannot be restored or silently removed.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_deny_data_deletion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saved ProofLoop data is retained; no silent deletion is allowed.' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_deny_data_deletion() IS 'I10: user data is never silently destroyed.';
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_events', 'agent_runs', 'api_credentials', 'auto_reverts', 'change_request_outcomes',
    'github_connections', 'post_checks', 'projects', 'risk_assessments', 'ship_records',
    'undos', 'users', 'verification_contracts', 'verification_runs'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION proofloop_deny_data_deletion()', table_name || '_deny_delete', table_name);
    EXECUTE format('COMMENT ON TRIGGER %I ON %I IS %L', table_name || '_deny_delete', table_name, 'I10: saved data cannot be silently destroyed.');
  END LOOP;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_post_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  shipped_sha text;
  shipped_project uuid;
  shipped_change uuid;
  checked_status text;
  checked_sha text;
  checked_project uuid;
  checked_change uuid;
BEGIN
  SELECT sr.merged_sha, p.id, sr.change_request_id INTO shipped_sha, shipped_project, shipped_change
    FROM ship_records sr JOIN change_requests cr ON cr.id = sr.change_request_id
    JOIN projects p ON p.id = cr.project_id WHERE sr.id = NEW.ship_record_id;
  SELECT vr.status, vr.verified_sha, vr.project_id, ar.change_request_id
    INTO checked_status, checked_sha, checked_project, checked_change
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = NEW.verification_run_id;
  IF (NEW.status = 'passed' AND checked_status IS DISTINCT FROM 'passed')
     OR (NEW.status = 'failed' AND checked_status IS DISTINCT FROM 'failed')
     OR checked_sha IS DISTINCT FROM shipped_sha OR checked_project IS DISTINCT FROM shipped_project
     OR checked_change IS DISTINCT FROM shipped_change OR length(trim(NEW.outcome)) = 0 THEN
    RAISE EXCEPTION 'A post-shipping result must match a real verification of the shipped version.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_post_check() IS 'I7: post-shipping outcomes must be machine-verification results for the shipped version.';
--> statement-breakpoint
CREATE TRIGGER post_checks_verification_match BEFORE INSERT OR UPDATE ON post_checks
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_post_check();
--> statement-breakpoint
COMMENT ON TRIGGER post_checks_verification_match ON post_checks IS 'I7: prevents hand-entered or mismatched post-shipping results.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_require_auto_revert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'failed' AND NOT EXISTS (SELECT 1 FROM auto_reverts WHERE ship_record_id = NEW.ship_record_id) THEN
    RAISE EXCEPTION 'A failed post-shipping check requires an automatic reversal before this transaction can finish.' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_require_auto_revert() IS 'I7: a failed post-shipping check cannot commit unless its automatic reversion is recorded.';
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER failed_post_check_requires_revert AFTER INSERT OR UPDATE ON post_checks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION proofloop_require_auto_revert();
--> statement-breakpoint
COMMENT ON TRIGGER failed_post_check_requires_revert ON post_checks IS 'I7: transaction commit is rejected when a failed post-check has no automatic reversion.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_auto_revert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  failed_check boolean;
  shipped_sha text;
  shipped_project uuid;
  shipped_change uuid;
  recheck_status text;
  recheck_sha text;
  recheck_project uuid;
  recheck_change uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM post_checks pc WHERE pc.ship_record_id = NEW.ship_record_id AND pc.status = 'failed'),
         sr.merged_sha, p.id, sr.change_request_id
    INTO failed_check, shipped_sha, shipped_project, shipped_change
    FROM ship_records sr JOIN change_requests cr ON cr.id = sr.change_request_id
    JOIN projects p ON p.id = cr.project_id WHERE sr.id = NEW.ship_record_id;
  SELECT vr.status, vr.verified_sha, vr.project_id, ar.change_request_id
    INTO recheck_status, recheck_sha, recheck_project, recheck_change
    FROM verification_runs vr JOIN agent_runs ar ON ar.id = vr.agent_run_id
    WHERE vr.id = NEW.re_check_run_id;
  IF NOT failed_check OR NEW.reverted_sha = shipped_sha OR recheck_status IS DISTINCT FROM 'passed'
     OR recheck_sha IS DISTINCT FROM NEW.reverted_sha OR recheck_project IS DISTINCT FROM shipped_project
     OR recheck_change IS DISTINCT FROM shipped_change THEN
    RAISE EXCEPTION 'An automatic reversal requires a failed post-check and a passing check of the restored code.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_auto_revert() IS 'I7: validates a failed post-check, restored version, and passing re-check of the restored state.';
--> statement-breakpoint
CREATE TRIGGER auto_reverts_recheck_gate BEFORE INSERT OR UPDATE ON auto_reverts
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_auto_revert();
--> statement-breakpoint
COMMENT ON TRIGGER auto_reverts_recheck_gate ON auto_reverts IS 'I7: an automatic reversal is accepted only after the restored state passes verification.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_validate_ship_post_check_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.post_check_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM post_checks pc WHERE pc.ship_record_id = NEW.id AND pc.verification_run_id = NEW.post_check_run_id
  ) THEN
    RAISE EXCEPTION 'A ship record can reference only its own post-shipping verification.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_ship_post_check_reference() IS 'I7: keeps a ship record attached to its own post-shipping check.';
--> statement-breakpoint
CREATE TRIGGER ship_records_post_check_reference BEFORE UPDATE OF post_check_run_id ON ship_records
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_ship_post_check_reference();
--> statement-breakpoint
COMMENT ON TRIGGER ship_records_post_check_reference ON ship_records IS 'I7: prevents attaching another change’s post-shipping result.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_ship_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A completed ship record cannot be removed.' USING ERRCODE = '23514'; END IF;
  IF NEW.change_request_id IS DISTINCT FROM OLD.change_request_id
     OR NEW.verification_run_id IS DISTINCT FROM OLD.verification_run_id
     OR NEW.approver_decision_id IS DISTINCT FROM OLD.approver_decision_id
     OR NEW.merged_sha IS DISTINCT FROM OLD.merged_sha
     OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
     OR (OLD.post_check_run_id IS NOT NULL AND NEW.post_check_run_id IS DISTINCT FROM OLD.post_check_run_id) THEN
    RAISE EXCEPTION 'A ship record and its tested code version cannot be rewritten.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_ship_record() IS 'I4/I5/I10: preserves the exact shipped version and its approval evidence.';
--> statement-breakpoint
CREATE TRIGGER ship_records_immutable BEFORE UPDATE OR DELETE ON ship_records
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_ship_record();
--> statement-breakpoint
COMMENT ON TRIGGER ship_records_immutable ON ship_records IS 'I4/I5/I10: keeps completed ship evidence immutable.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_completed_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A completed evidence or outcome record cannot be changed or removed.' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_completed_record() IS 'I6/I7/I10: verification, reversion, and terminal outcome records are retained unchanged.';
--> statement-breakpoint
CREATE TRIGGER post_checks_immutable BEFORE UPDATE OR DELETE ON post_checks
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_completed_record();
--> statement-breakpoint
COMMENT ON TRIGGER post_checks_immutable ON post_checks IS 'I7: a failed post-check cannot be changed after its automatic reversal.';
--> statement-breakpoint
CREATE TRIGGER auto_reverts_immutable BEFORE UPDATE OR DELETE ON auto_reverts
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_completed_record();
--> statement-breakpoint
COMMENT ON TRIGGER auto_reverts_immutable ON auto_reverts IS 'I7: automatic reversal and restored-state evidence are permanent.';
--> statement-breakpoint
CREATE TRIGGER undos_immutable BEFORE UPDATE OR DELETE ON undos
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_completed_record();
--> statement-breakpoint
COMMENT ON TRIGGER undos_immutable ON undos IS 'I10: undo records cannot be silently rewritten or removed.';
--> statement-breakpoint
CREATE TRIGGER change_request_outcomes_immutable BEFORE UPDATE OR DELETE ON change_request_outcomes
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_completed_record();
--> statement-breakpoint
COMMENT ON TRIGGER change_request_outcomes_immutable ON change_request_outcomes IS 'I8/I10: terminal explanations remain unchanged.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION proofloop_protect_active_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.definition IS DISTINCT FROM OLD.definition) THEN
    RAISE EXCEPTION 'An active verification plan cannot be silently replaced.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_protect_active_contract() IS 'I6/I10: an active verification plan cannot change without a new independent validation.';
--> statement-breakpoint
CREATE TRIGGER verification_contracts_active_immutable BEFORE UPDATE ON verification_contracts
FOR EACH ROW EXECUTE FUNCTION proofloop_protect_active_contract();
--> statement-breakpoint
COMMENT ON TRIGGER verification_contracts_active_immutable ON verification_contracts IS 'I6/I10: prevents silently weakening an active verification plan.';
--> statement-breakpoint

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname, c.conrelid::regclass AS relation_name FROM pg_constraint c
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('COMMENT ON CONSTRAINT %I ON %s IS %L', constraint_row.conname, constraint_row.relation_name,
      'I10: ON DELETE RESTRICT preserves user data and prevents silent orphaning.');
  END LOOP;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname, c.conrelid::regclass AS relation_name FROM pg_constraint c
    WHERE c.contype = 'c' AND c.connamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('COMMENT ON CONSTRAINT %I ON %s IS %L', constraint_row.conname, constraint_row.relation_name,
      'Domain invariant: this database constraint enforces the allowed values for the owning feature.');
  END LOOP;
END;
$$;
--> statement-breakpoint
COMMENT ON CONSTRAINT agent_runs_attempt_check ON agent_runs IS 'I8: repair attempts may never exceed five.';
--> statement-breakpoint
COMMENT ON CONSTRAINT risk_assessments_computed_by_check ON risk_assessments IS 'Risk classification is computed only by deterministic rules.';
--> statement-breakpoint
COMMENT ON CONSTRAINT evidence_artifacts_path_nonempty_check ON evidence_artifacts IS 'I6: every evidence artifact must name a non-empty stored file.';
--> statement-breakpoint
COMMENT ON CONSTRAINT approver_decisions_decision_check ON approver_decisions IS 'I5/I6: only explicit independent machine decisions are stored; no human approval field exists.';
--> statement-breakpoint

COMMENT ON TABLE users IS 'Accounts feature: email identities and Argon2id password hashes.';
--> statement-breakpoint
COMMENT ON TABLE sessions IS 'Accounts feature: expiring, revocable sessions; token material is hashed.';
--> statement-breakpoint
COMMENT ON TABLE password_reset_tokens IS 'Accounts feature: hashed, expiring, single-use password reset links.';
--> statement-breakpoint
COMMENT ON TABLE api_credentials IS 'Accounts feature: AES-256-GCM encrypted API keys.';
--> statement-breakpoint
COMMENT ON TABLE github_connections IS 'Projects feature: encrypted GitHub access credentials.';
--> statement-breakpoint
COMMENT ON TABLE projects IS 'Projects feature: user-named GitHub projects and default branches.';
--> statement-breakpoint
COMMENT ON TABLE verification_contracts IS 'Verification Contract feature: detected, offered, or independently validated checks.';
--> statement-breakpoint
COMMENT ON TABLE change_requests IS 'Change Requests feature: original plain-English requests and lifecycle state.';
--> statement-breakpoint
COMMENT ON TABLE requirements IS 'Change Requests feature: testable requirements and evidence status.';
--> statement-breakpoint
COMMENT ON TABLE change_request_outcomes IS 'Change Requests feature: terminal plain-English explanations.';
--> statement-breakpoint
COMMENT ON TABLE agent_runs IS 'Agent Runs feature: isolated implementation attempts.';
--> statement-breakpoint
COMMENT ON TABLE agent_events IS 'Agent Runs feature: plain-English progress events.';
--> statement-breakpoint
COMMENT ON TABLE verification_runs IS 'Verification Engine feature: machine runs bound to one project version.';
--> statement-breakpoint
COMMENT ON TABLE evidence_artifacts IS 'Verification Engine feature: paths to captured evidence files.';
--> statement-breakpoint
COMMENT ON TABLE risk_assessments IS 'Risk feature: deterministic rules-only classification.';
--> statement-breakpoint
COMMENT ON TABLE approver_decisions IS 'Approver feature: independent evidence-validated decisions.';
--> statement-breakpoint
COMMENT ON TABLE ship_records IS 'Shipping feature: the only durable record that a change shipped.';
--> statement-breakpoint
COMMENT ON TABLE post_checks IS 'Watching feature: machine-verified checks of shipped code.';
--> statement-breakpoint
COMMENT ON TABLE auto_reverts IS 'Watching feature: automatic reversals and verified restored states.';
--> statement-breakpoint
COMMENT ON TABLE undos IS 'Undo feature: optional user-requested or automatic reversals.';
--> statement-breakpoint
