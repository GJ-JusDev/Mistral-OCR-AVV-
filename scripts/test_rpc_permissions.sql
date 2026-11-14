SELECT 
    'Class Adviser Test' AS test_name,
    ta.id AS assignment_id,
    ta.assignment_type,
    public.can_teacher_scan_with_assignment(ta.id) AS can_scan
FROM (
    SELECT set_config('role', 'authenticated', true),
           set_config('request.jwt.claim.sub', '9412725c-7faa-4efa-a654-be78cc40a14f', true),
           set_config('request.jwt.claim.role', 'authenticated', true)
) init
CROSS JOIN public.teacher_assignments ta
WHERE ta.teacher_user_id = '9412725c-7faa-4efa-a654-be78cc40a14f'
  AND ta.assignment_type = 'class_adviser'

UNION ALL

SELECT 
    'Subject Teacher Test' AS test_name,
    ta.id AS assignment_id,
    ta.assignment_type,
    public.can_teacher_scan_with_assignment(ta.id) AS can_scan
FROM (
    SELECT set_config('role', 'authenticated', true),
           set_config('request.jwt.claim.sub', '9412725c-7faa-4efa-a654-be78cc40a14f', true),
           set_config('request.jwt.claim.role', 'authenticated', true)
) init
CROSS JOIN public.teacher_assignments ta
WHERE ta.teacher_user_id = '9412725c-7faa-4efa-a654-be78cc40a14f'
  AND ta.assignment_type = 'subject_teacher'

UNION ALL

SELECT 
    'Unassigned Teacher Hijack Attempt' AS test_name,
    ta.id AS assignment_id,
    ta.assignment_type,
    public.can_teacher_scan_with_assignment(ta.id) AS can_scan
FROM (
    SELECT set_config('role', 'authenticated', true),
           set_config('request.jwt.claim.sub', '411cde47-5c18-4549-8d55-467d0fe61522', true),
           set_config('request.jwt.claim.role', 'authenticated', true)
) init
CROSS JOIN public.teacher_assignments ta
WHERE ta.teacher_user_id = '9412725c-7faa-4efa-a654-be78cc40a14f'
  AND ta.assignment_type = 'class_adviser';
