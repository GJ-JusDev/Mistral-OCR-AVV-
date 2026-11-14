GRANT EXECUTE ON FUNCTION public.has_active_teacher_assignment(UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.can_teacher_scan_with_assignment(UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_document(UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_student(UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.get_teacher_authorized_assignments() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.lookup_or_quarantine_student_identity(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.upsert_student_enrollment_history(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.resolve_section_or_identity_conflict(UUID, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;
