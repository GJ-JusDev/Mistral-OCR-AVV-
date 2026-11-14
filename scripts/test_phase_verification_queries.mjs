import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function testPhaseQueries() {
  const db = new PGlite();

  // Test Phase 4 (014 Verification Query)
  const q014 = `
    SELECT 
      obj_name,
      obj_type,
      CASE WHEN status = true THEN 'PASS (EXISTS)' ELSE 'FAIL (MISSING)' END AS verification_result
    FROM (
      SELECT 'public.audit_logs' AS obj_name, 'Table' AS obj_type, to_regclass('public.audit_logs') IS NOT NULL AS status
      UNION ALL
      SELECT 'public.documents.reviewed_by', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reviewed_by')
      UNION ALL
      SELECT 'public.documents.last_operation_id', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'last_operation_id')
      UNION ALL
      SELECT 'public.user_roles.updated_by', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_by')
      UNION ALL
      SELECT 'public.user_roles.last_operation_id', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'last_operation_id')
      UNION ALL
      SELECT 'public.record_audit_event()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'public.prevent_audit_log_modification()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'prevent_audit_log_modification' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'trg_audit_logs_immutable', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_immutable')
      UNION ALL
      SELECT 'trg_audit_user_roles_transition', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_user_roles_transition')
      UNION ALL
      SELECT 'trg_audit_document_decision', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_document_decision')
      UNION ALL
      SELECT 'Approved admins can view audit logs', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Approved admins can view audit logs')
    ) checks
    ORDER BY obj_type, obj_name;
  `;

  // Test Phase 5 (015 Verification Query)
  const q015 = `
    SELECT 
      obj_name,
      obj_type,
      CASE WHEN status = true THEN 'PASS (EXISTS)' ELSE 'FAIL (MISSING)' END AS verification_result
    FROM (
      SELECT 'public.grade_change_history' AS obj_name, 'Table' AS obj_type, to_regclass('public.grade_change_history') IS NOT NULL AS status
      UNION ALL
      SELECT 'public.v_duplicate_students_report', 'View', to_regclass('public.v_duplicate_students_report') IS NOT NULL
      UNION ALL
      SELECT 'chk_students_lrn_format', 'Constraint', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_lrn_format')
      UNION ALL
      SELECT 'idx_students_normalized_lrn', 'Index', to_regclass('public.idx_students_normalized_lrn') IS NOT NULL
      UNION ALL
      SELECT 'idx_subject_grades_composite_active', 'Index', to_regclass('public.idx_subject_grades_composite_active') IS NOT NULL
      UNION ALL
      SELECT 'public.lookup_student_by_lrn()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lookup_student_by_lrn' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'public.process_approved_document()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_approved_document' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'Authorized read grade_change_history', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grade_change_history' AND policyname = 'Authorized read grade_change_history')
    ) checks
    ORDER BY obj_type, obj_name;
  `;

  console.log("Both verification queries defined.");
}

testPhaseQueries();
