# AVV SYSTEM — CONSOLIDATED SHS SF9 BUG FIX AND REGRESSION VERIFICATION REPORT

**Document Version:** 1.0.0  
**Date of Completion:** 2026-11-06  
**Institution:** Taysan Resettlement Integrated School (TRIS)  
**SDO / Division:** DepEd Legazpi City, Albay, Region V (Bicol Region)  
**Academic Target:** Grades 11 & 12, Senior High School K–12 Basic Education Curriculum  
**Lead Roles:** Senior Next.js Engineer, Supabase Database Architect, OCR Integration Engineer, Software Quality Assurance Engineer  

---

## 1. GIT BASELINE AND WORKING TREE STATUS

- **Root Repository Branch:** `master` (No commits yet, containing docx documentation and subproject)
- **Subproject Directory:** `mistral-ocr`
- **Subproject Git Branch:** `main` (commit `bdbdd9d`)
- **Pre-Fix Working Tree Integrity:** 
  - All existing working-tree modifications (spatial identity parser, PSA parser, two-sided upload workflow, and security tests) were strictly preserved.
  - No existing components were overwritten or redesigned.
- **Pre-Fix Quality Baseline:**
  - `npm test`: 401 passing tests, 0 failures.
  - `npx tsc --noEmit`: 0 TypeScript compiler errors.
  - `tests/run_all_security_tests.mjs`: 8 passing security suites.
  - `npm run build`: Production Next.js Turbopack build succeeded with 0 errors.

---

## 2. ROOT CAUSES CONFIRMED

### Defect A — School ID Incorrectly Required from OCR
1. **Document Reality:** The older DepEd Senior High School Form 138 / SF9-SHS layout used by TRIS does not contain a printed or handwritten "School ID" field on either front or back pages.
2. **Parser Over-expectation:** `src/lib/ocr/parser.ts` searched for "School ID" via regular expression and returned empty string / undefined.
3. **Validation Penalty:** `src/lib/validation/rules.ts` evaluated `school_id_present`. When empty, it generated a `warning` forcing overall status to `needs_review` or an `error` forcing `invalid`.
4. **Client Impersonation Risk:** `src/app/api/documents/route.ts` line 147 trusted `body.school_id` from client payloads before falling back to `user_roles.school_id`, creating a multi-tenant vulnerability.
5. **Database State:** Authoritative institution TRIS exists in `schools` table with internal UUID `a0000000-0000-0000-0000-000000000001` and DepEd School ID `500169`, but all existing user accounts in `user_roles` currently have `school_id = NULL`.

### Defect B & C — Review Queue Grade Status Stale & Field Discrepancies
1. **UI Disconnect:** In `src/components/ocr/OcrResultCard.tsx`, editing a grade cell synchronized values but intentionally left `status` and `needsVerification` untouched, leaving status stale as `"Missing"`.
2. **Property Divergence:** Downstream components used inconsistent properties:
   - `GradeRecord`: `sem1_final_grade`, `sem2_final_grade`, `final`.
   - `subject_grades`: column `final_grade`.
   - Database Trigger (`process_approved_document`): reads `grade_record->>'final'`. When `final` was omitted or undefined despite `sem1_final_grade` being present, the trigger inserted `NULL` for `final_grade`.
3. **Physical Blank vs Extracted Grades:** 
   - Document `04ed137a-3f6c-4788-b087-8f25759b2c14`: Source image genuinely lacked marks in Column 3 (Semester Final Grade).
   - Document `0a3536c9-ca5e-49fb-8777-b8db253457a4`: Source image contained handwritten final marks (`88`, `98`, `78`, `74.5`, `85`...) which Azure recognized into Column 3.
4. **Markdown Table Fallback:** In `seniorHighParser.ts`, rows with only 2 numbers assigned `final = undefined`, forcing `status = "Missing"`.

### Defect D — Document Comparison Semester Final Grade Retrieval
1. In `src/app/compare/page.tsx` line 605, the overview modal inspected only `{g.final ?? "-"}` without semester awareness.
2. In `src/lib/validation/documentComparator.ts` lines 404–405, fallback `g?.final ?? g?.sem1_final_grade ?? g?.sem2_final_grade` risked cross-semester grade contamination on 2nd Semester subjects.

---

## 3. FILES CHANGED

| File Path | Type of Modification | Primary Purpose |
| :--- | :--- | :--- |
| `src/lib/validation/gradeUtils.ts` | **NEW FILE** | Authoritative semester final grade resolver, subject status recalculator, and array normalizer. |
| `src/types/documents.ts` | **MODIFIED** | Added typed metadata fields: `school_id_source`, `school_uuid`, `trusted_school_verified`, `ocr_extracted_school_id`. |
| `src/lib/validation/rules.ts` | **MODIFIED** | Added `school_id_match_institution` rule; enabled trusted school resolution support for `school_id_present`. |
| `src/app/api/documents/route.ts` | **MODIFIED** | Enforced server-side school resolution (TRIS); blocked client override; normalized grades upon staging. |
| `src/app/api/documents/[id]/route.ts` | **MODIFIED** | Sanitized PATCH requests to strip `school_id`, guaranteeing foreign key immutability. |
| `src/components/ocr/OcrResultCard.tsx` | **MODIFIED** | Added read-only "School Configuration" display; added dynamic status recalculation in `handleGradeCellChange`. |
| `src/actions/review.ts` | **MODIFIED** | Enforced server-side grade normalization in `saveDocumentCorrections` and `submitDocumentReview`. |
| `src/lib/validation/documentComparator.ts` | **MODIFIED** | Integrated semester-aware `getAuthoritativeSemesterFinalGrade` to prevent cross-semester contamination. |
| `src/app/compare/page.tsx` | **MODIFIED** | Updated grade summary modal to render semester-aware final grades. |
| `tests/shs_sf9_regression_suite.test.mjs` | **NEW FILE** | 19 targeted automated unit & regression tests covering all 4 confirmed defects. |

---

## 4. EXACT IMPLEMENTATION SUMMARY

### A. Grade Utility Engine (`src/lib/validation/gradeUtils.ts`)
Created three pure, deterministic functions:
1. `getAuthoritativeSemesterFinalGrade(g: GradeRecord | undefined): number | string | undefined`
   - Explicitly checks `g.semester === "1st Semester"` -> returns `g.sem1_final_grade ?? g.final`.
   - Explicitly checks `g.semester === "2nd Semester"` -> returns `g.sem2_final_grade ?? g.final`.
   - Checks semester-isolated populates when `g.semester` is omitted.
   - Strictly eliminates blind `sem1_final_grade ?? sem2_final_grade` fallback.
2. `recalculateSubjectGradeStatus(record: GradeRecord): GradeRecord`
   - Synchronizes `sem1_final_grade`, `sem2_final_grade`, and `final`.
   - Clears empty strings `""` to `undefined`.
   - Evaluates numeric final grade against DepEd threshold: `>= 75` -> `"Passed"`, `< 75` -> `"Failed"`.
   - Preserves exact decimals (`74.5` -> Failed).
   - Sets `needsVerification = true` for borderline scores (`72` to `77`) and quarterly borderline marks.
   - Evaluates missing/blank/unreadable marks (`INC`, `DRP`) -> `"Missing"`, `needsVerification = true`.
3. `normalizeGradeRecords(grades: GradeRecord[] | undefined): GradeRecord[]`
   - Maps arrays through `recalculateSubjectGradeStatus`.

### B. Server-Enforced Institutional Identity (`src/app/api/documents/route.ts`)
- Removed vulnerability `let userSchoolId = body.school_id || null`.
- Queries `user_roles` for the authenticated user.
- If `roleRow.school_id` is null, retrieves single authoritative institutional record for TRIS (`school_id = '500169'`, `id = 'a0000000-0000-0000-0000-000000000001'`).
- Detects and rejects client spoofing attempts where `body.school_id` conflicts with the authorized school UUID (HTTP 403 Forbidden).
- Annotates `extracted_fields` with:
  - `school_id: "500169"`
  - `school_name: "Taysan Resettlement Integrated School"`
  - `school_id_source: "school_configuration"`
  - `trusted_school_verified: true`
  - `school_uuid: "a0000000-0000-0000-0000-000000000001"`

---

## 5. SCHOOL IDENTIFICATION BEHAVIOR

| Condition | Old System Behavior | Corrected Behavior |
| :--- | :--- | :--- |
| **Old SHS SF9 Upload** | Failed `school_id_present`; flagged `needs_review` or `invalid`. | Passes validation; resolves TRIS `500169` server-side; status = `valid`. |
| **Review Queue Display** | Empty editable text input with amber outline demanding manual entry. | Read-only field with blue badge: **"School Configuration"** displaying TRIS and 500169. |
| **Client Spoof Attempt** | Injected client `body.school_id` into database. | Server rejects conflicting `body.school_id` with HTTP 403 Forbidden. |
| **Different Document School ID** | Overwritten silently. | Detected as `ocr_extracted_school_id`; flagged with `school_id_discrepancy` error. |
| **Database Foreign Keys** | `documents.school_id` was NULL. | `documents.school_id` assigned authoritative UUID `a0000000-0000-0000-0000-000000000001`. |

---

## 6. GRADE FIELD NORMALIZATION BEHAVIOR

| Input Scenario | Extracted Properties | Computed Status | `needsVerification` |
| :--- | :--- | :--- | :--- |
| **1st Sem Final 85** | `sem1_final_grade: 85`, `final: 85` | `Passed` | `false` |
| **1st Sem Final 75** | `sem1_final_grade: 75`, `final: 75` | `Passed` | `true` (borderline 72-77) |
| **1st Sem Final 74** | `sem1_final_grade: 74`, `final: 74` | `Failed` | `true` (borderline 72-77) |
| **1st Sem Decimal 74.5** | `sem1_final_grade: 74.5`, `final: 74.5` | `Failed` | `true` (borderline 72-77) |
| **Physically Blank Final** | `sem1_final_grade: undefined`, `final: undefined` | `Missing` | `true` (genuine blank) |
| **Quarterly Missing (Q1: -, Q2: 85, Final: 85)** | `q1: undefined`, `q2: 85`, `final: 85` | `Passed` | `false` (no fabricated Q1) |
| **2nd Sem Final 90** | `sem2_final_grade: 90`, `final: 90` | `Passed` | `false` (sem1 untouched) |

---

## 7. REVIEW QUEUE CORRECTION BEHAVIOR

- In `src/components/ocr/OcrResultCard.tsx`, `handleGradeCellChange` calls `recalculateSubjectGradeStatus(target)` on every edit.
- Typing `85` immediately switches the row badge from amber `"Missing"` to green `"Passed"`.
- Typing `74` immediately switches the badge to red `"Failed"`.
- Clearing the grade resets the badge to amber `"Missing"`.
- When clicking "Save Corrections", `saveDocumentCorrections` (`src/actions/review.ts`) runs server-side normalization before updating `documents.extracted_fields`.
- Staged corrections survive page reload and keep validation reports synchronized.

---

## 8. COMPARISON PAGE CHANGES

- In `src/lib/validation/documentComparator.ts`, grade retrieval now invokes `getAuthoritativeSemesterFinalGrade(g)`.
- In `src/app/compare/page.tsx`, modal overview invokes `getAuthoritativeSemesterFinalGrade(g) ?? "-"`.
- First-semester final grades render accurately.
- Second-semester final grades render accurately without checking first-semester properties.
- Physically blank grades display as missing (`-`).
- Grade discrepancies between SF9 and SF10 report exact values (e.g. *"Grade discrepancy: SF9 has 85, but SF10 has 82"*).

---

## 9. DATABASE COMPATIBILITY

### Active Trigger Verification: `process_approved_document()`
Inspection of deployed trigger function `process_approved_document()` confirmed:
```sql
clean_final := CASE 
    WHEN (grade_record->>'final') ~ '^-?[0-9]+(\.[0-9]+)?$' 
    THEN (grade_record->>'final')::numeric 
    ELSE NULL 
END;

clean_status := CASE 
    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'passed' THEN 'Passed'
    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'failed' THEN 'Failed'
    ELSE 'Missing'
END;
```
1. **Zero SQL Migrations Needed:** Because our application-level normalization now guarantees that every `GradeRecord` has `final` synchronized with `sem1_final_grade` or `sem2_final_grade`, and `status` synchronized with numeric values, `process_approved_document()` executes flawlessly without database changes.
2. **Approval Action Safety:** `submitDocumentReview` (`src/actions/review.ts`) normalizes `extractedFields.grades` directly in the update transaction when setting `status = 'approved'`.
3. **Audit Trails Intact:** All review decisions and manual field corrections continue to be recorded in `public.review_logs`.

---

## 10. SECURITY VERIFICATION

1. **Multi-Tenant Isolation:**
   - Client-supplied `body.school_id` is never accepted as authoritative. Conflicting IDs are rejected with HTTP 403.
   - `PATCH /api/documents/[id]` strips `school_id`, preventing foreign key mutation on existing documents.
2. **Row Level Security (RLS) Preservation:**
   - Direct inspection confirms all RLS policies on `documents`, `students`, and `subject_grades` remain intact.
   - Setting `documents.school_id` to TRIS UUID `a0000000-0000-0000-0000-000000000001` ensures that school-isolated policies function as expected.
3. **Role-Based Access Control (RBAC):**
   - Approval remains strictly restricted to approved Admins and Principals.
   - Teachers cannot approve documents or edit documents uploaded by other teachers.

---

## 11. AUTOMATED TEST RESULTS

| Suite / Command | Execution Target | Test Count | Pass | Fail | Exit Code | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `tests/shs_sf9_regression_suite.test.mjs` | Node.js Test Runner (Unit & Integration) | 19 | 19 | 0 | 0 | **PASS** |
| `tests/school_id_validation.test.mjs` | Node.js Test Runner (Existing Validation) | 11 | 11 | 0 | 0 | **PASS** |
| `tests/document_comparator.test.mjs` | Node.js Test Runner (Comparison Engine) | 9 | 9 | 0 | 0 | **PASS** |
| `tests/shs_semester_grade_structure.test.mjs` | Node.js Test Runner (Azure Table Parsing) | 12 | 12 | 0 | 0 | **PASS** |
| `npm test` (Full Master Test Suite) | Node.js Test Runner (All Test Files) | 420 | 420 | 0 | 0 | **PASS** |
| `node tests/run_all_security_tests.mjs` | PostgreSQL 18.6 WASM Engine (PGlite) | 8 suites | 8 suites | 0 | 0 | **PASS** |
| `npx tsc --noEmit` | TypeScript Compiler 5.8 | N/A | 0 errors | 0 | 0 | **PASS** |
| `npm run build` | Next.js 16.3.3 Turbopack Production Build | 22 routes | 22 routes | 0 | 0 | **PASS** |

---

## 12. MANUAL ACCEPTANCE RESULTS

| Scenario | Target Workflow | Result | Classification |
| :--- | :--- | :--- | :--- |
| **Scenario A — Existing Final Grades** | SF9 upload with printed/handwritten final grades (Doc `0a3536c9` pattern). | School resolved as 500169 read-only; Q1, Q2, and Final grades populated; status = `Passed`. | **PASS** |
| **Scenario B — Blank Final Grades** | SF9 upload with blank semester final grade cells (Doc `04ed137a` pattern). | Final grade remains blank; status = `Missing`; no grades fabricated. | **PASS** |
| **Scenario C — Manual Grade Correction** | Review Queue grade editing (entering 85 or 74). | Live status updates to `Passed` (85) or `Failed` (74); saved corrections persist. | **PASS** |
| **Scenario D — Approval and Persistence** | Official document approval workflow. | `process_approved_document()` receives clean numeric grades and status; audit log recorded. | **PASS** |
| **Scenario E — School ID Security** | Submitting spoofed `school_id` via API. | Unauthorized client override blocked; TRIS institutional UUID enforced. | **PASS** |

---

## 13. EXISTING STAGED DOCUMENT REMEDIATION PLAN

Query of live Cloud Supabase database identified 3 existing staged documents:
1. `0a3536c9-ca5e-49fb-8777-b8db253457a4`: Contains OCR extracted final grades. Currently `school_id = NULL`.
2. `04ed137a-3f6c-4788-b087-8f25759b2c14`: Genuinely blank in Column 3 on source card. Currently `school_id = NULL`.
3. `5bc90189-50eb-4ebf-818a-9a99264c8dcf`: Currently `school_id = NULL`.

### Proposed Safe, Reversible Remediation (Pending Separate Approval)
- **Zero Paid OCR API Calls:** Re-process `extracted_fields` locally from cached `raw_ocr_response`.
- **Targeted Transformation:**
  1. Set `documents.school_id = 'a0000000-0000-0000-0000-000000000001'`.
  2. Populate `extracted_fields.school_id = '500169'`, `school_id_source = 'school_configuration'`, `trusted_school_verified = true`.
  3. Execute `normalizeGradeRecords(extracted_fields.grades)` to synchronize `final` with `sem1_final_grade` on Doc `0a3536c9`.
  4. Retain genuine blank status on Doc `04ed137a`.
  5. Re-run `validateFields` in-place.
- **Production Safety:** In accordance with strict restrictions, no production records were modified during this investigation.

---

## 14. REMAINING ISSUES

1. **User Role School Assignments:** Live `user_roles` records currently have `school_id = NULL`. While our application layer now safely falls back to TRIS configuration, a future administrative migration to populate `user_roles.school_id = 'a0000000-0000-0000-0000-000000000001'` for approved staff will harden database-level RLS.
2. **SF9 Document Form Diversity:** Newer DepEd SF9 revisions that include printed School IDs will naturally pass OCR extraction and be cross-validated against TRIS `500169`.

---

## 15. FINAL RECOMMENDATION

1. **Approve Code Changes:** All application-level corrections are verified, regression-tested (420/420 pass), statically typed (0 errors), and build-tested.
2. **Authorize Existing Staged Document Remediation:** Authorize running the local cached-response remediation script to backfill `school_id` and normalize grades on the 3 existing staged documents without incurring OCR API costs.
3. **Deploy to Staging/Production:** The codebase is ready for deployment.
