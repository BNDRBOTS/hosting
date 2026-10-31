ALTER TABLE "risk_assessments" ADD COLUMN "footprint" jsonb DEFAULT '{"changedFiles":[],"changedLines":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_reasons_check" CHECK (jsonb_typeof("risk_assessments"."reasons") = 'array' and (("risk_assessments"."tier" = 'routine' and jsonb_array_length("risk_assessments"."reasons") = 0) or ("risk_assessments"."tier" = 'high_risk' and jsonb_array_length("risk_assessments"."reasons") > 0)));
--> statement-breakpoint
ALTER TABLE "risk_assessments" ALTER COLUMN "footprint" DROP DEFAULT;
--> statement-breakpoint
COMMENT ON CONSTRAINT risk_assessments_reasons_check ON risk_assessments IS 'Only deterministic risk rules may set the tier and their firing reasons.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION proofloop_validate_risk_assessment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  file_path text;
  file_count integer;
  changed_lines integer;
  expected_reasons text[] := ARRAY[]::text[];
  auth_path boolean := false;
  payment_path boolean := false;
  deletion_path boolean := false;
  migration_path boolean := false;
  expected_tier text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.change_request_id IS DISTINCT FROM OLD.change_request_id
      OR EXISTS (SELECT 1 FROM approver_decisions WHERE change_request_id = OLD.change_request_id AND decision = 'approved')) THEN
    RAISE EXCEPTION 'A completed risk assessment cannot be reassigned or changed after approval.' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.footprint) IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW.footprint->'changedFiles') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW.footprint->'changedLines') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW.reasons) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Risk must be based on a structured change footprint and rule list.' USING ERRCODE = '23514';
  END IF;
  changed_lines := (NEW.footprint->>'changedLines')::integer;
  IF changed_lines < 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.footprint->'changedFiles') f(value)
    WHERE jsonb_typeof(f.value) IS DISTINCT FROM 'string' OR length(trim(f.value #>> '{}')) = 0
  ) THEN
    RAISE EXCEPTION 'The change footprint is invalid.' USING ERRCODE = '23514';
  END IF;
  file_count := jsonb_array_length(NEW.footprint->'changedFiles');
  FOR file_path IN SELECT jsonb_array_elements_text(NEW.footprint->'changedFiles') LOOP
    IF file_path ~* '(^|/)(auth|authentication|authn|sign[-_]?in|login|session)(/|\.|$)' THEN auth_path := true; END IF;
    IF file_path ~* '(^|/)(payment|payments|billing|checkout)(/|\.|$)' THEN payment_path := true; END IF;
    IF file_path ~* '(^|/).*(delete|deletion|erase|remove).*(user|account|data).*' THEN deletion_path := true; END IF;
    IF file_path ~* '(^|/)(migrations?|drizzle)(/|\.|$)' THEN migration_path := true; END IF;
  END LOOP;
  IF auth_path THEN expected_reasons := array_append(expected_reasons, 'authentication-path'); END IF;
  IF payment_path THEN expected_reasons := array_append(expected_reasons, 'payment-path'); END IF;
  IF deletion_path THEN expected_reasons := array_append(expected_reasons, 'stored-user-data-deletion'); END IF;
  IF migration_path THEN expected_reasons := array_append(expected_reasons, 'migration-path'); END IF;
  IF file_count > 10 THEN expected_reasons := array_append(expected_reasons, 'file-count-over-10'); END IF;
  IF changed_lines > 400 THEN expected_reasons := array_append(expected_reasons, 'changed-lines-over-400'); END IF;
  expected_tier := CASE WHEN cardinality(expected_reasons) > 0 THEN 'high_risk' ELSE 'routine' END;
  IF NEW.tier IS DISTINCT FROM expected_tier OR NEW.reasons IS DISTINCT FROM to_jsonb(expected_reasons) THEN
    RAISE EXCEPTION 'Risk tier and reasons do not match the deterministic rules.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION proofloop_validate_risk_assessment() IS 'Deterministic risk rules: authentication, payments, stored-user-data deletion, migrations, more than ten files, or more than four hundred changed lines are high risk.';
--> statement-breakpoint
CREATE TRIGGER risk_assessments_deterministic_rules BEFORE INSERT OR UPDATE ON risk_assessments
FOR EACH ROW EXECUTE FUNCTION proofloop_validate_risk_assessment();
--> statement-breakpoint
COMMENT ON TRIGGER risk_assessments_deterministic_rules ON risk_assessments IS 'Risk assessments must exactly match the deterministic rules; no model judgment is accepted.';
--> statement-breakpoint
