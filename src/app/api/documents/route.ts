import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { validateFields } from '@/lib/validation/engine';
import { 
  evaluateStudentIdentity, 
  verifyStudentCollision, 
  matchStudentIdentityMatrix 
} from '@/lib/validation/studentMatcher';
import { normalizeGradeRecords, updateExtractedFieldsAverages, normalizeObservedValueMarking, sanitizeLearnersObservedValues } from '@/lib/validation/gradeUtils';
import { mergeAcademicGrades } from '@/lib/validation/gradeMerger';
import { normalizeLrn } from '@/lib/validation/patterns';
import { matchSchool } from '@/lib/validation/schoolMatcher';
import { logAuditEvent } from '@/lib/audit/auditLogger';
import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
  normalizeStrandKey,
  type TeacherAssignmentRecord,
  type TeacherModulePolicy,
} from '@/lib/teacher/assignments';
import { compareDocumentContextWithAssignment } from '@/lib/teacher/sectionScanner';
import { ingestRosterDocument } from '@/lib/upload/rosterIngestion';
import {
  formatBatchNumber,
  getDocumentCompositeKey,
  resolveDocumentStudentNameDisplay as resolveDisplayStudentName,
} from '@/lib/validation/nameComparison';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to view documents." }, { status: 401 });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account is pending administrator approval." }, { status: 403 });
    }

    const userRole = (roleRow.role || "").toLowerCase().trim();
    if (userRole === "admin" || userRole === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role cannot access document records. Documents module has been removed from Admin experience.",
          code: "ADMIN_DOCUMENTS_REMOVED",
        },
        { status: 403 }
      );
    }

    let query = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: order === 'asc' })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    } else {
      query = query.neq('status', 'archived').neq('status', 'deleted');
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const refreshSignedUrl = async (urlOrPath: string | undefined | null): Promise<string | undefined> => {
      if (!urlOrPath || typeof urlOrPath !== "string" || urlOrPath.startsWith("data:") || urlOrPath.startsWith("uploaded-")) {
        return urlOrPath || undefined;
      }
      try {
        let storagePath = "";
        if (urlOrPath.includes("/documents/")) {
          storagePath = urlOrPath.split("/documents/")[1].split("?")[0];
        } else if (!urlOrPath.startsWith("http")) {
          storagePath = urlOrPath;
        }
        if (storagePath) {
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 3600); // 1 hour
          if (signed?.signedUrl) {
            return signed.signedUrl;
          }
        }
      } catch {
        // Retain original URL if signing cannot be completed
      }
      return urlOrPath;
    };

    const docs = await Promise.all(
      (data || []).map(async (doc: any) => {
        if (doc?.image_url) {
          const signed = await refreshSignedUrl(doc.image_url);
          if (signed) doc.image_url = signed;
        }
        return doc;
      })
    );

    // Zero-redundancy deduplication by student composite key:
    // (normalizedLrn + "::" + normalizedStudentName + "::" + canonicalDocumentType)
    // Keep only the most recently updated record and filter out empty "-" ghost rows.
    const dedupMap = new Map<string, any>();
    for (const doc of docs) {
      if (doc?.status === 'archived' || doc?.status === 'deleted' || doc?.deleted_at) continue;
      const studentName = resolveDisplayStudentName(doc);
      // Filter out legacy unverified/orphan rows and pre-confirmation drafts
      if (!studentName || studentName === "-" || studentName === "No student found" || studentName.startsWith("Incomplete Name")) continue;
      const ef = (doc.extracted_fields || {}) as Record<string, any>;
      if (ef.commit_to_registry === false || doc.status === "pre_confirmation") continue;

      const compKey = getDocumentCompositeKey(doc);
      const existing = dedupMap.get(compKey);
      if (!existing) {
        dedupMap.set(compKey, doc);
      } else {
        const existingTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
        const docTime = new Date(doc.updated_at || doc.created_at || 0).getTime();
        if (docTime >= existingTime) {
          dedupMap.set(compKey, doc);
        }
      }
    }

    const deduplicatedDocs = Array.from(dedupMap.values()).map((doc: any) => {
      const ef = (doc.extracted_fields || {}) as Record<string, any>;
      const rawBatch = ef.batch_number || ef.batch_id || doc.batch_id || doc.batch_number;
      const formattedBatch = formatBatchNumber(rawBatch, doc.created_at || doc.submission_date || doc.updated_at);
      return {
        ...doc,
        batch_number: formattedBatch,
      };
    });

    return NextResponse.json({ documents: deduplicatedDocs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = await createClient();

    // 1. Get authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to submit documents." }, { status: 401 });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account is pending administrator approval." }, { status: 403 });
    }

    const uploadedBy = user.id;

    // 2. Enforce active document_type: Senior High School supported types
    let documentType = String(body.document_type || "sf9").toLowerCase().trim();
    if (documentType === "psa") documentType = "birth_cert";
    const validDocTypes = ['sf1', 'sf2', 'sf5', 'sf9', 'sf10', 'birth_cert'];
    if (!validDocTypes.includes(documentType)) {
      return NextResponse.json({
        error: `Unsupported document type: '${documentType}'. The active AVV Senior High School scope supports SF1, SF2, SF5, SF9, SF10, and PSA Birth Certificate.`,
      }, { status: 400 });
    }

    const userRole = String(roleRow.role || "").toLowerCase().trim();
    if (userRole === "principal") {
      return NextResponse.json(
        {
          error: "Forbidden: Principal role is monitoring-only and cannot create or scan academic documents.",
          code: "PRINCIPAL_READ_ONLY",
        },
        { status: 403 }
      );
    }
    if (userRole === "admin" || userRole === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role is restricted to management and approval. Only authorized Teachers may scan or upload documents.",
          code: "ADMIN_CANNOT_UPLOAD",
        },
        { status: 403 }
      );
    }
    if (userRole !== "teacher") {
      return NextResponse.json(
        {
          error: "Forbidden: Only authorized Teachers may scan or upload documents.",
          code: "UNAUTHORIZED_ROLE",
        },
        { status: 403 }
      );
    }

    // 2a. Server-side strict Class Adviser assignment ownership & active status validation
    const requestedAssignmentId: string | null =
      body.teacher_assignment_id || body.assignment_id || null;
    const assignmentConfirmed: boolean =
      body.assignment_confirmed === true || body.assignment_confirmed === "true";

    let serverAssignment: TeacherAssignmentRecord | null = null;
    const schoolScanPolicy: TeacherModulePolicy = {
      school_id: roleRow.school_id || "",
      allow_subject_teacher_scanning: false,
    };

    if (requestedAssignmentId) {
      const { data: aRow } = await (supabase as any)
        .from("teacher_assignments")
        .select("*")
        .eq("id", requestedAssignmentId)
        .maybeSingle();
      serverAssignment = aRow || null;
    }

    if (String(roleRow.role || "").toLowerCase() === "teacher") {
      const authCheck = evaluateTeacherScanAuthorization({
        userRole: roleRow.role,
        userId: user.id,
        accountStatus: roleRow.account_status,
        userSchoolId: roleRow.school_id,
        assignment: serverAssignment,
        policy: schoolScanPolicy,
        assignmentConfirmed,
      });

      if (!authCheck.allowed) {
        await logAuditEvent({
          category: "SECURITY",
          action: "UNAUTHORIZED_ACCESS_DENIED",
          outcome: "DENIED",
          actorUserId: user.id,
          actorEmail: user.email,
          actorRole: roleRow.role,
          actorSchoolId: roleRow.school_id,
          targetType: "teacher_assignment",
          targetId: requestedAssignmentId,
          reason: authCheck.error,
          details: { code: authCheck.code, document_type: documentType },
        });
        return NextResponse.json(
          { error: authCheck.error, code: authCheck.code },
          { status: authCheck.statusCode }
        );
      }

      // Reject frontend-tampered assignment parameters that contradict the authoritative DB record
      if (serverAssignment) {
        if (
          body.selected_school_year &&
          normalizeSchoolYearKey(body.selected_school_year) !==
            normalizeSchoolYearKey(serverAssignment.school_year)
        ) {
          return NextResponse.json(
            {
              error: "Forbidden: Submitted school year does not match your authorized server assignment.",
              code: "ASSIGNMENT_PARAMETER_MISMATCH",
            },
            { status: 403 }
          );
        }
        if (
          body.selected_grade_level &&
          normalizeGradeLevelKey(body.selected_grade_level) !==
            normalizeGradeLevelKey(serverAssignment.grade_level)
        ) {
          return NextResponse.json(
            {
              error: "Forbidden: Submitted grade level does not match your authorized server assignment.",
              code: "ASSIGNMENT_PARAMETER_MISMATCH",
            },
            { status: 403 }
          );
        }
        if (
          body.selected_section &&
          normalizeSectionKey(body.selected_section) !==
            normalizeSectionKey(serverAssignment.section)
        ) {
          return NextResponse.json(
            {
              error: "Forbidden: Submitted section does not match your authorized server assignment.",
              code: "ASSIGNMENT_PARAMETER_MISMATCH",
            },
            { status: 403 }
          );
        }
        if (
          body.selected_strand &&
          serverAssignment.strand_or_track &&
          normalizeStrandKey(body.selected_strand) !==
            normalizeStrandKey(serverAssignment.strand_or_track)
        ) {
          return NextResponse.json(
            {
              error: "Forbidden: Submitted strand/track does not match your authorized server assignment.",
              code: "ASSIGNMENT_PARAMETER_MISMATCH",
            },
            { status: 403 }
          );
        }
      }
    }

    // 3. Normalize status to valid enum. Disallow unverified documents from being uploaded directly as 'approved'.
    let status = String(body.status || "submitted").toLowerCase().trim();
    const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected'];
    if (!validStatuses.includes(status)) {
      status = 'submitted';
    }

    // 4. Staging / Verification-safe student identity handling
    let studentId = body.student_id || null;
    if (['sf1', 'sf2', 'sf5'].includes(documentType)) {
      studentId = null;
    }
    const extractedFields = body.extracted_fields ? { ...body.extracted_fields } : {};
    if (documentType === 'sf9' || documentType === 'sf10') {
      const candidateGrade = String(
        body.selected_grade_level ||
        body.grade_level ||
        extractedFields.selected_grade_level ||
        extractedFields.grade_level ||
        ""
      ).trim();

      const levelCheckCandidate = candidateGrade || String(extractedFields.academic_level || "").trim();

      // Enforce Senior High School (Grade 11 & Grade 12) scope.
      const isExplicitlyUnsupported = /^(?:elementary|kinder|kindergarten|junior\s+high|jhs|high\s+school|grade\s*([1-9]|10)\b|[1-9]\b|10\b)/i.test(levelCheckCandidate);
      if (isExplicitlyUnsupported) {
        return NextResponse.json({
          error: `Unsupported grade level: '${levelCheckCandidate}'. The active AVV scope supports only Senior High School (Grade 11 and Grade 12).`,
        }, { status: 400 });
      }

      // Normalize to SHS semestral structure without inventing missing grade_level
      extractedFields.academic_level = "Senior High School";
      if (/12|xii\b/i.test(candidateGrade)) {
        extractedFields.selected_grade_level = "Grade 12";
        extractedFields.grade_level = "Grade 12";
      } else if (/11|xi\b/i.test(candidateGrade)) {
        extractedFields.selected_grade_level = "Grade 11";
        extractedFields.grade_level = "Grade 11";
      } else {
        // Missing or ambiguous grade level: do NOT invent "Grade 11"
        extractedFields.grade_level = null;
        extractedFields.selected_grade_level = null;
        if (documentType === 'sf9') {
          extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
          if (!extractedFields.flags.includes("missing_grade_level")) {
            extractedFields.flags.push("missing_grade_level");
          }
          status = 'needs_review';
        }
      }
      extractedFields.grading_period_scheme = "quarterly_semestral";
    }

    // 4. Server-enforced institutional identity resolution (TRIS)
    let trustedSchoolUuid: string | null = roleRow?.school_id || null;

    let { data: authoritativeSchool } = await supabase
      .from('schools')
      .select('id, school_id, name')
      .eq('school_id', '500169')
      .maybeSingle();

    if (!authoritativeSchool) {
      const { data: legacySchool } = await supabase
        .from('schools')
        .select('id, school_id, name')
        .or('id.eq.a0000000-0000-0000-0000-000000000001,school_id.eq.300792')
        .maybeSingle();
      if (legacySchool) {
        authoritativeSchool = legacySchool;
      }
    }

    if (!trustedSchoolUuid && authoritativeSchool?.id) {
      trustedSchoolUuid = authoritativeSchool.id;
    }

    if (
      body.school_id &&
      body.school_id !== trustedSchoolUuid &&
      body.school_id !== authoritativeSchool?.school_id
    ) {
      return NextResponse.json(
        { error: "Forbidden: Conflicting or unauthorized school association provided." },
        { status: 403 }
      );
    }

    if (!trustedSchoolUuid) {
      return NextResponse.json(
        { error: "Configuration Error: No authorized school institution could be resolved." },
        { status: 500 }
      );
    }

    const userSchoolId = trustedSchoolUuid;

    // 4a. Evaluate student identity & full name + LRN matching matrix (school-scoped via RPC + fallback)
    const identityEval = evaluateStudentIdentity(extractedFields);
    const extractedDisplayName =
      [identityEval.firstName, identityEval.middleName, identityEval.lastName, identityEval.suffix]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      (extractedFields.name ? String(extractedFields.name).trim() : null);
    let identityMatchResult: any = null;
    const quarantineConflictsToInsert: Array<{
      conflict_type: string;
      extracted_lrn: string | null;
      extracted_name: string | null;
      existing_student_id: string | null;
      expected_context: Record<string, any>;
      extracted_context: Record<string, any>;
    }> = [];

    if (identityEval.isValidLrn && identityEval.normalizedLrn) {
      let existingStudent: any = null;
      let studentByNameDiffLrn: any = null;

      try {
        const { data: rpcMatch } = await (supabase as any).rpc(
          "lookup_or_quarantine_student_identity",
          {
            p_school_id: userSchoolId,
            p_lrn: identityEval.normalizedLrn,
            p_first_name: identityEval.firstName || null,
            p_last_name: identityEval.lastName || null,
          }
        );

        if (rpcMatch && typeof rpcMatch === "object") {
          if (rpcMatch.outcome === "MATCHED_LRN_AND_NAME" || rpcMatch.outcome === "SAME_LRN_CONFLICT_NAME") {
            existingStudent = {
              id: rpcMatch.student_id,
              lrn: rpcMatch.matched_lrn,
              first_name: rpcMatch.first_name || "",
              last_name: rpcMatch.last_name || "",
              school_id: userSchoolId,
            };
          } else if (rpcMatch.outcome === "DIFF_LRN_SAME_NAME") {
            studentByNameDiffLrn = {
              id: rpcMatch.student_id,
              lrn: rpcMatch.matched_lrn,
              first_name: rpcMatch.first_name || "",
              last_name: rpcMatch.last_name || "",
            };
          }
          if (rpcMatch.current_enrollment) {
            extractedFields.previous_enrollment = rpcMatch.current_enrollment;
          }
        }
      } catch {
        // Fallback to direct queries if Migration 022 RPC is unavailable
      }

      if (!existingStudent && !studentByNameDiffLrn) {
        const { data: directByLrn } = await supabase
          .from('students')
          .select('id, lrn, first_name, middle_name, last_name, suffix, school_id')
          .eq('school_id', userSchoolId)
          .eq('lrn', identityEval.normalizedLrn)
          .maybeSingle();
        existingStudent = directByLrn || null;

        if (!existingStudent && identityEval.isValidName && identityEval.lastName && identityEval.firstName) {
          const { data: foundByName } = await supabase
            .from('students')
            .select('id, lrn, first_name, last_name')
            .eq('school_id', userSchoolId)
            .ilike('last_name', identityEval.lastName.trim())
            .ilike('first_name', identityEval.firstName.trim())
            .limit(1)
            .maybeSingle();
          if (foundByName && foundByName.lrn !== identityEval.normalizedLrn) {
            studentByNameDiffLrn = foundByName;
          }
        }
      }

      identityMatchResult = matchStudentIdentityMatrix({
        extracted: identityEval,
        existingStudentByLrn: existingStudent,
        existingStudentByNameDiffLrn: studentByNameDiffLrn,
      });

      if (identityMatchResult.canAutoLink && identityMatchResult.studentId) {
        studentId = identityMatchResult.studentId;
        extractedFields.existing_student_id = identityMatchResult.studentId;
        if (existingStudent) {
          extractedFields.existing_student_name = `${existingStudent.last_name}, ${existingStudent.first_name}`;
        }
      } else if (identityMatchResult.matchType === "SAME_LRN_CONFLICT_NAME") {
        studentId = null;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
        quarantineConflictsToInsert.push({
          conflict_type: "SAME_LRN_CONFLICT_NAME",
          extracted_lrn: identityEval.normalizedLrn,
          extracted_name: extractedDisplayName,
          existing_student_id: existingStudent?.id || null,
          expected_context: existingStudent
            ? { lrn: existingStudent.lrn, name: `${existingStudent.last_name}, ${existingStudent.first_name}` }
            : {},
          extracted_context: {
            lrn: identityEval.normalizedLrn,
            name: extractedDisplayName,
            section: extractedFields.section || null,
          },
        });
      } else if (identityMatchResult.matchType === "SAME_LRN_MINOR_DIFF") {
        studentId = identityMatchResult.studentId;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
      } else if (identityMatchResult.matchType === "DIFF_LRN_SAME_NAME") {
        studentId = null;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
        quarantineConflictsToInsert.push({
          conflict_type: "DIFF_LRN_SAME_NAME",
          extracted_lrn: identityEval.normalizedLrn,
          extracted_name: extractedDisplayName,
          existing_student_id: studentByNameDiffLrn?.id || null,
          expected_context: studentByNameDiffLrn
            ? { lrn: studentByNameDiffLrn.lrn, name: `${studentByNameDiffLrn.last_name}, ${studentByNameDiffLrn.first_name}` }
            : {},
          extracted_context: {
            lrn: identityEval.normalizedLrn,
            name: extractedDisplayName,
            section: extractedFields.section || null,
          },
        });
      } else if (identityMatchResult.matchType === "NEW_LRN_NEW_NAME") {
        extractedFields.candidate_student = {
          lrn: identityEval.normalizedLrn,
          first_name: identityEval.firstName || null,
          middle_name: identityEval.middleName || null,
          last_name: identityEval.lastName || null,
          suffix: identityEval.suffix || null,
          grade_level: extractedFields.grade_level || null,
          sex: extractedFields.sex === 'M' || extractedFields.sex === 'F' ? extractedFields.sex : null,
          staged_at: new Date().toISOString(),
        };
        status = 'needs_review';
      }
    } else {
      extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
      if (!identityEval.normalizedLrn) {
        if (!extractedFields.flags.includes("missing_lrn")) {
          extractedFields.flags.push("missing_lrn");
        }
      } else {
        if (!extractedFields.flags.includes("invalid_lrn")) {
          extractedFields.flags.push("invalid_lrn");
        }
      }
      status = 'needs_review';
    }

    // 5d. Store institutional configuration in extracted_fields
    if (authoritativeSchool) {
      const isMatchingAuthoritative =
        !extractedFields.school_name ||
        extractedFields.school_name.trim() === "" ||
        matchSchool(extractedFields.school_name, [authoritativeSchool.name]).matched;

      if (isMatchingAuthoritative) {
        if (!extractedFields.school_id || extractedFields.school_id.trim() === "") {
          extractedFields.school_id = authoritativeSchool.school_id;
          extractedFields.school_id_source = "school_configuration";
          extractedFields.trusted_school_verified = true;
        } else if (extractedFields.school_id === authoritativeSchool.school_id) {
          extractedFields.school_id_source = extractedFields.school_id_source || "school_configuration";
          extractedFields.trusted_school_verified = true;
        } else {
          extractedFields.ocr_extracted_school_id = extractedFields.school_id;
          extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
          if (!extractedFields.flags.includes("school_id_discrepancy")) {
            extractedFields.flags.push("school_id_discrepancy");
          }
        }

        if (!extractedFields.school_name || extractedFields.school_name.trim() === "") {
          extractedFields.school_name = authoritativeSchool.name;
        }
        extractedFields.school_uuid = authoritativeSchool.id;
      } else {
        extractedFields.trusted_school_verified = false;
        extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
        if (!extractedFields.flags.includes("external_school_document")) {
          extractedFields.flags.push("external_school_document");
        }
      }
    }

    // Normalize grades using semester-aware rules to avoid stale status
    if (Array.isArray(extractedFields.grades) && extractedFields.grades.length > 0) {
      extractedFields.grades = normalizeGradeRecords(extractedFields.grades);
      Object.assign(extractedFields, updateExtractedFieldsAverages(extractedFields));
    }

    if (extractedFields.observed_values) {
      extractedFields.observed_values = sanitizeLearnersObservedValues(extractedFields.observed_values);
    }

    const rawSy = String(
      extractedFields.school_year || body.school_year || serverAssignment?.school_year || ""
    ).trim();
    const sy = rawSy.length > 0 ? rawSy : null;
    if (!sy && documentType === "sf9") {
      extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
      if (!extractedFields.flags.includes("missing_school_year")) {
        extractedFields.flags.push("missing_school_year");
      }
      status = "needs_review";
    }

    const rawGl = String(
      extractedFields.grade_level ||
      body.grade_level ||
      extractedFields.selected_grade_level ||
      serverAssignment?.grade_level ||
      ""
    ).trim();
    const gl = rawGl.length > 0 ? rawGl : null;
    if (!gl && documentType === "sf9") {
      extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
      if (!extractedFields.flags.includes("missing_grade_level")) {
        extractedFields.flags.push("missing_grade_level");
      }
      status = "needs_review";
    }

    // 5e. Assignment context comparison & mixed-student front/back quarantine check
    const effectiveSection =
      serverAssignment?.section ||
      (extractedFields.section ? String(extractedFields.section).trim() : null) ||
      (body.section ? String(body.section).trim() : null);
    const effectiveStrand =
      serverAssignment?.strand_or_track ||
      (extractedFields.strand || extractedFields.track_strand || extractedFields.shs_track || null);

    let hasContextMismatch = false;
    if (serverAssignment) {
      const ctxComparison = compareDocumentContextWithAssignment({
        assignment: serverAssignment,
        documentType: documentType as "sf9" | "sf10",
        extractedFields,
      });

      if (!ctxComparison.matchesAssignment) {
        hasContextMismatch = true;
        status = "needs_review";
        extractedFields.flags = Array.from(
          new Set([...(extractedFields.flags || []), ...ctxComparison.flags])
        );
        extractedFields.assignment_context_mismatches = ctxComparison.mismatches;
        for (const cType of ctxComparison.conflictTypes) {
          quarantineConflictsToInsert.push({
            conflict_type: cType,
            extracted_lrn: identityEval.normalizedLrn || null,
            extracted_name: extractedDisplayName,
            existing_student_id: studentId,
            expected_context: {
              school_year: serverAssignment.school_year,
              grade_level: serverAssignment.grade_level,
              section: serverAssignment.section,
              strand_or_track: serverAssignment.strand_or_track,
            },
            extracted_context: {
              school_year: extractedFields.school_year || null,
              grade_level: extractedFields.grade_level || null,
              section: extractedFields.section || null,
              strand_or_track: extractedFields.track_strand || extractedFields.shs_track || null,
            },
          });
        }
      }
    }

    const hasMixedFrontBack = Boolean(extractedFields.mixed_student_front_back);
    if (hasMixedFrontBack) {
      status = "needs_review";
      extractedFields.identity_conflict = true;
      studentId = null;
      quarantineConflictsToInsert.push({
        conflict_type: "MIXED_FRONT_BACK_IDENTITY",
        extracted_lrn: identityEval.normalizedLrn || null,
        extracted_name: extractedDisplayName,
        existing_student_id: null,
        expected_context: serverAssignment
          ? {
              section: serverAssignment.section,
              strand_or_track: serverAssignment.strand_or_track,
              grade_level: serverAssignment.grade_level,
            }
          : {},
        extracted_context: {
          details: extractedFields.identity_conflict_details || "Front and back scans show conflicting learner identities.",
        },
      });
    }

    const hasRequiredCanonicalPeriod = documentType === "sf10" || Boolean(sy && gl);
    const incomingFileHash = body.file_hash || (body.image_url ? crypto.createHash("sha256").update(body.image_url).digest("hex") : null);
    if (incomingFileHash) {
      extractedFields.file_hash = incomingFileHash;
    }

    const hasIdentityConflict =
      hasMixedFrontBack ||
      identityMatchResult?.matchType === "SAME_LRN_CONFLICT_NAME" ||
      identityMatchResult?.matchType === "DIFF_LRN_SAME_NAME";

    if (hasIdentityConflict) {
      extractedFields.identity_conflict = true;
      extractedFields.manual_lrn_verification_required = true;
      studentId = null;
    }

    const canonicalLrn =
      !hasIdentityConflict && identityEval.isValidLrn && identityEval.normalizedLrn
        ? identityEval.normalizedLrn
        : null;

    if (canonicalLrn) {
      extractedFields.canonical_lrn = canonicalLrn;
    }

    // Race-safe student linking / creation (never duplicates a student on section/strand changes)
    if (!hasRequiredCanonicalPeriod) {
      if (studentId) {
        extractedFields.staged_student_id = studentId;
        studentId = null;
      }
      status = "needs_review";
    } else if (
      !hasIdentityConflict &&
      identityMatchResult?.canAutoCreate &&
      identityEval.normalizedLrn &&
      identityEval.firstName &&
      identityEval.lastName &&
      !studentId
    ) {
      const insertStudentRes = await supabase
        .from("students")
        .insert({
          school_id: userSchoolId,
          lrn: identityEval.normalizedLrn,
          first_name: identityEval.firstName,
          last_name: identityEval.lastName,
          middle_name: identityEval.middleName || null,
          suffix: identityEval.suffix || null,
          grade_level: gl,
          sex: extractedFields.sex === "M" || extractedFields.sex === "F" ? extractedFields.sex : null,
          status: "active",
        })
        .select("id")
        .maybeSingle();

      if (insertStudentRes.data?.id) {
        studentId = insertStudentRes.data.id;
        extractedFields.existing_student_id = insertStudentRes.data.id;
      } else {
        // Race fallback: another concurrent request created this LRN inside the school
        try {
          const { data: raceMatch } = await (supabase as any).rpc(
            "lookup_or_quarantine_student_identity",
            {
              p_school_id: userSchoolId,
              p_lrn: identityEval.normalizedLrn,
              p_first_name: identityEval.firstName || null,
              p_last_name: identityEval.lastName || null,
            }
          );
          if (raceMatch?.student_id && raceMatch.outcome === "MATCHED_LRN_AND_NAME") {
            studentId = raceMatch.student_id;
            extractedFields.existing_student_id = raceMatch.student_id;
          }
        } catch {
          const { data: existingStu } = await supabase
            .from("students")
            .select("id")
            .eq("school_id", userSchoolId)
            .eq("lrn", identityEval.normalizedLrn)
            .maybeSingle();
          if (existingStu?.id) {
            studentId = existingStu.id;
            extractedFields.existing_student_id = existingStu.id;
          }
        }
      }
    }

    // Track section/strand enrollment history without duplicating student identity
    if (studentId && sy && gl && effectiveSection && !hasIdentityConflict && !hasContextMismatch) {
      try {
        const { data: enrollRes } = await (supabase as any).rpc(
          "upsert_student_enrollment_history",
          {
            p_student_id: studentId,
            p_school_id: userSchoolId,
            p_school_year: sy,
            p_grade_level: gl,
            p_section: effectiveSection,
            p_strand_or_track: effectiveStrand || null,
            p_adviser_user_id:
              serverAssignment?.assignment_type === "class_adviser"
                ? serverAssignment.teacher_user_id
                : null,
            p_source_document_id: null,
          }
        );
        if (enrollRes?.transferred) {
          extractedFields.flags = Array.from(
            new Set([...(extractedFields.flags || []), "section_transfer_recorded"])
          );
          extractedFields.enrollment_transfer = {
            previous_section: enrollRes.previous_section || null,
            previous_strand: enrollRes.previous_strand || null,
            new_section: effectiveSection,
            new_strand: effectiveStrand || null,
          };
        }
      } catch {
        // Optional before Migration 022 is applied
      }
    }

    // Acquire transactional advisory lock if Migration 021 RPC is installed
    try {
      await (supabase as any).rpc("acquire_canonical_document_lock", {
        p_school_id: userSchoolId,
        p_document_type: documentType,
        p_canonical_key: studentId || canonicalLrn || incomingFileHash || "staging",
        p_school_year: sy,
        p_grade_level: gl,
      });
    } catch {
      // Optional before Migration 021 is deployed
    }

    // Helper to resolve canonical academic document by learner + academic period or unresolved file_hash
    const findExistingCanonicalDocument = async (): Promise<any | null> => {
      const hasCompleteAcademicIdentity =
        !hasIdentityConflict &&
        Boolean(canonicalLrn || studentId) &&
        (documentType === "sf10" || Boolean(sy && gl));

      if (hasCompleteAcademicIdentity) {
        const candidateDocs: any[] = [];

        // Step A: Search for active canonical documents by verified student_id
        if (studentId) {
          const { data: foundByStudent } = await supabase
            .from("documents")
            .select("*")
            .eq("school_id", userSchoolId)
            .eq("document_type", documentType)
            .eq("student_id", studentId)
            .not("status", "in", '("archived","rejected")')
            .order("created_at", { ascending: false });

          if (foundByStudent && foundByStudent.length > 0) {
            candidateDocs.push(...foundByStudent);
          }
        }

        // Step B: Search by normalized LRN inside extracted_fields (covers student_id IS NULL staged rows)
        if (canonicalLrn) {
          const { data: foundByLrn } = await supabase
            .from("documents")
            .select("*")
            .eq("school_id", userSchoolId)
            .eq("document_type", documentType)
            .contains("extracted_fields", { lrn: canonicalLrn })
            .not("status", "in", '("archived","rejected")')
            .order("created_at", { ascending: false });

          if (foundByLrn && foundByLrn.length > 0) {
            for (const d of foundByLrn) {
              if (!candidateDocs.some((existing) => existing.id === d.id)) {
                candidateDocs.push(d);
              }
            }
          }
        }

        if (candidateDocs.length > 0) {
          const matchingDocs = candidateDocs.filter((cDoc: any) => {
            const ef = (cDoc.extracted_fields || {}) as Record<string, any>;
            if (ef.identity_conflict === true) return false;

            // 1. Student identity anti-collision check
            const cLastName =
              ef.last_name ||
              (ef.name?.includes(",") ? ef.name.split(",")[0].trim() : ef.name);
            if (identityEval.lastName && cLastName) {
              const coll = verifyStudentCollision(identityEval.lastName, {
                id: cDoc.id,
                first_name: ef.first_name || "",
                last_name: cLastName,
              });
              if (coll.hasConflict) return false;
            }

            if (documentType === "sf9") {
              // 2. Strict null-safe school year matching: both must be present and equal
              const incomingSy = (sy || "").trim();
              const docSy = (cDoc.school_year || ef.school_year || "").trim();
              if (!incomingSy || !docSy || incomingSy !== docSy) {
                return false;
              }

              // 3. Strict null-safe grade level matching: both must normalize to '11' or '12' and match
              const incomingGl = (gl || "").toLowerCase().replace(/[^0-9]/g, "");
              const docGl = (cDoc.grade_level || ef.grade_level || ef.selected_grade_level || "").toLowerCase().replace(/[^0-9]/g, "");
              if (!incomingGl || !docGl || incomingGl !== docGl) {
                return false;
              }
            }

            return true;
          });

          if (matchingDocs.length > 0) {
            // Sort matching documents to select canonical active record:
            // 1. 'approved' (authoritative verified record must NEVER be bypassed)
            // 2. 'needs_review' (active in Review Queue)
            // 3. others
            matchingDocs.sort((a: any, b: any) => {
              const priority = (s: string) => {
                if (s === "approved") return 1;
                if (s === "needs_review") return 2;
                return 3;
              };
              const pDiff = priority(a.status) - priority(b.status);
              if (pDiff !== 0) return pDiff;
              return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            });

            return matchingDocs[0];
          }
        }
      }

      // Null-safe staging deduplication fallback: if unresolved (missing LRN/SY/GL or identity conflict),
      // prevent duplicate staging rows for the exact same uploaded scan within the same school & document_type
      if (!hasCompleteAcademicIdentity && incomingFileHash) {
        const { data: stageCandidates } = await supabase
          .from("documents")
          .select("*")
          .eq("school_id", userSchoolId)
          .eq("document_type", documentType)
          .not("status", "in", '("archived","rejected")')
          .order("created_at", { ascending: false })
          .limit(20);

        if (stageCandidates && stageCandidates.length > 0) {
          const matchedStage = stageCandidates.find((cDoc: any) => {
            const ef = (cDoc.extracted_fields || {}) as Record<string, any>;
            const scanHist = Array.isArray(ef.scan_history) ? ef.scan_history : [];
            return (
              cDoc.file_hash === incomingFileHash ||
              ef.file_hash === incomingFileHash ||
              cDoc.image_url === body.image_url ||
              scanHist.some((s: any) => s.file_hash === incomingFileHash)
            );
          });
          if (matchedStage) {
            return matchedStage;
          }
        }
      }

      return null;
    };

    // Quarantine helper for identity collisions, mixed front/back scans, and context mismatches
    const persistQuarantinedConflicts = async (docId: string) => {
      if (!quarantineConflictsToInsert.length) return;
      for (const c of quarantineConflictsToInsert) {
        try {
          await (supabase as any).from("student_identity_conflicts").insert({
            school_id: userSchoolId,
            document_id: docId,
            assignment_id: serverAssignment?.id || null,
            conflict_type: c.conflict_type,
            extracted_lrn: c.extracted_lrn,
            extracted_name: c.extracted_name,
            existing_student_id: c.existing_student_id,
            expected_context: c.expected_context,
            extracted_context: c.extracted_context,
            status: "pending",
            created_by: user.id,
          });
          await logAuditEvent({
            category: "REVIEW",
            action: "IDENTITY_CONFLICT_QUARANTINED",
            outcome: "WARNING",
            actorUserId: user.id,
            actorEmail: user.email,
            actorRole: roleRow?.role || "teacher",
            actorSchoolId: userSchoolId,
            targetType: "document",
            targetId: docId,
            reason: `Quarantined ${c.conflict_type}`,
            details: {
              conflict_type: c.conflict_type,
              extracted_lrn: c.extracted_lrn,
              extracted_name: c.extracted_name,
            },
          });
        } catch {
          // Optional table / duplicate open conflict ignored
        }
      }
    };

    // ── 6. CANONICAL ACADEMIC DOCUMENT RESOLUTION & INCREMENTAL UPDATE ────────
    const existingCanonicalDoc = await findExistingCanonicalDocument();

    // ── 7. INCREMENTAL UPDATE OR DUPLICATE SUPPRESSION FOR EXISTING DOCUMENT ───
    const processCanonicalMergeOrSuppress = async (canonicalDoc: any) => {
      // Security check: Strict school isolation
      if (canonicalDoc.school_id !== userSchoolId) {
        return NextResponse.json(
          { error: "Forbidden: You cannot modify or overwrite a document belonging to another school." },
          { status: 403 }
        );
      }

      const rawScanHistory: any[] = Array.isArray(canonicalDoc.extracted_fields?.scan_history)
        ? canonicalDoc.extracted_fields.scan_history
        : Array.isArray(canonicalDoc.extracted_fields?.scan_evidence_history)
        ? canonicalDoc.extracted_fields.scan_evidence_history
        : [];
      const existingScanHistory: any[] = [...rawScanHistory];

      // Preserve initial scan as Version 1 if scan history was empty
      if (existingScanHistory.length === 0 && canonicalDoc.image_url) {
        existingScanHistory.push({
          version: 1,
          uploaded_at: canonicalDoc.created_at || new Date().toISOString(),
          uploaded_by: canonicalDoc.uploaded_by,
          file_hash: canonicalDoc.file_hash || canonicalDoc.extracted_fields?.file_hash || null,
          original_filename: canonicalDoc.original_filename || "Initial Scan",
          image_url: canonicalDoc.image_url,
          back_image_url: canonicalDoc.extracted_fields?.back_image_url || null,
          detected_quarters: (canonicalDoc.extracted_fields?.grades || []).flatMap((g: any) => {
            const qs: string[] = [];
            if (g.q1 !== undefined && g.q1 !== null) qs.push("Q1");
            if (g.q2 !== undefined && g.q2 !== null) qs.push("Q2");
            if (g.q3 !== undefined && g.q3 !== null) qs.push("Q3");
            if (g.q4 !== undefined && g.q4 !== null) qs.push("Q4");
            return qs;
          }),
        });
      }

      const isHashMatch = Boolean(
        incomingFileHash && (
          canonicalDoc.file_hash === incomingFileHash ||
          canonicalDoc.extracted_fields?.file_hash === incomingFileHash ||
          existingScanHistory.some((s: any) => s.file_hash === incomingFileHash)
        )
      );

      // Deterministic grade merge
      const mergeResult = mergeAcademicGrades({
        existingGrades: canonicalDoc.extracted_fields?.grades || [],
        incomingGrades: extractedFields.grades || [],
        baseFields: canonicalDoc.extracted_fields || {},
        isExistingApproved: canonicalDoc.status === "approved",
        defaultSemester: extractedFields.semester || canonicalDoc.semester || "1st Semester",
      });

      // Scenario D: Exact duplicate upload (identical hash and identical grades)
      if (isHashMatch || (mergeResult.isIdentical && !mergeResult.hasNewGrades && mergeResult.conflicts.length === 0)) {
        await logAuditEvent({
          category: "DOCUMENT",
          action: "DOCUMENT_UPLOADED",
          outcome: "SUCCESS",
          actorUserId: user.id,
          actorEmail: user.email,
          actorRole: roleRow?.role || "teacher",
          actorSchoolId: userSchoolId,
          actorSchoolName: authoritativeSchool?.name,
          targetType: "document",
          targetId: canonicalDoc.id,
          targetLabel: `${documentType.toUpperCase()} - ${body.original_filename || "Document"}`,
          reason: "Duplicate document upload detected; reused existing canonical academic record",
          details: {
            result: "EXISTING_DOCUMENT",
            document_id: canonicalDoc.id,
            file_hash: incomingFileHash,
          },
        });

        return NextResponse.json({
          ...canonicalDoc,
          id: canonicalDoc.id,
          code: "EXISTING_DOCUMENT",
          message: "This document has already been uploaded. No new academic record was created.",
          is_existing: true,
          canonical_document_id: canonicalDoc.id,
        }, { status: 200 });
      }

      // Scenario B & C: Incremental quarter or semester grade update!
      const newVersion = existingScanHistory.length + 1;
      const detectedQuarters = mergeResult.addedQuarters.map(a => `${a.subject} ${a.quarter.toUpperCase()}`);
      const scanEntry = {
        version: newVersion,
        uploaded_at: new Date().toISOString(),
        uploaded_by: uploadedBy,
        file_hash: incomingFileHash,
        original_filename: body.original_filename || canonicalDoc.original_filename,
        image_url: body.image_url || canonicalDoc.image_url,
        back_image_url: body.back_image_url || extractedFields.back_image_url || canonicalDoc.extracted_fields?.back_image_url,
        detected_quarters: detectedQuarters,
      };

      const updatedScanHistory = [...existingScanHistory, scanEntry];

      const mergedFlags = Array.from(new Set([
        ...(canonicalDoc.extracted_fields?.flags || []),
        ...(extractedFields.flags || []),
        ...(mergeResult.conflicts.length > 0 ? ["conflicting_grades"] : []),
      ]));

      const mergedExtractedFields: any = {
        ...canonicalDoc.extracted_fields,
        ...mergeResult.mergedFields,
        scan_history: updatedScanHistory,
        scan_evidence_history: updatedScanHistory,
        last_scan_version: newVersion,
        flags: mergedFlags,
        incremental_update_summary: {
          last_updated_at: new Date().toISOString(),
          last_updated_by: uploadedBy,
          previous_version: existingScanHistory.length,
          current_version: newVersion,
          added_quarters: mergeResult.addedQuarters,
          conflicts_count: mergeResult.conflicts.length,
        },
      };

      if (mergedExtractedFields.observed_values) {
        mergedExtractedFields.observed_values = sanitizeLearnersObservedValues(mergedExtractedFields.observed_values);
      }

      if (mergeResult.conflicts.length > 0) {
        mergedExtractedFields.grade_conflicts = [
          ...(canonicalDoc.extracted_fields?.grade_conflicts || []),
          ...mergeResult.conflicts,
        ];
      }

      if (canonicalDoc.status === "approved") {
        mergedExtractedFields.previous_approval = {
          approved_at: canonicalDoc.updated_at,
          reviewed_by: canonicalDoc.reviewed_by,
          previous_grades: canonicalDoc.extracted_fields?.grades,
        };
      }

      const updatePayload: any = {
        extracted_fields: mergedExtractedFields,
        image_url: body.image_url || canonicalDoc.image_url,
        status: "needs_review", // Staged in the existing review queue item!
        updated_at: new Date().toISOString(),
        last_operation_id: crypto.randomUUID(),
        school_year: sy || canonicalDoc.school_year,
        grade_level: gl || canonicalDoc.grade_level,
        semester: extractedFields.semester || canonicalDoc.semester || "1st Semester",
        ...(serverAssignment?.id ? { teacher_assignment_id: serverAssignment.id } : {}),
        ...(effectiveSection ? { section: effectiveSection } : {}),
        ...(effectiveStrand ? { strand_or_track: effectiveStrand } : {}),
        ...(assignmentConfirmed && serverAssignment?.id
          ? {
              assignment_confirmed_at: new Date().toISOString(),
              assignment_confirmed_by: user.id,
            }
          : {}),
      };
      if (studentId || canonicalDoc.student_id) {
        updatePayload.student_id = studentId || canonicalDoc.student_id;
      }

      const { data: updatedDoc, error: updateErr } = await supabase
        .from("documents")
        .update(updatePayload)
        .eq("id", canonicalDoc.id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 400 });
      }

      await persistQuarantinedConflicts(canonicalDoc.id);

      // Record in document_scans table if it exists
      try {
        await (supabase as any).from("document_scans").insert({
          document_id: canonicalDoc.id,
          student_id: studentId || canonicalDoc.student_id,
          scan_version: newVersion,
          file_hash: incomingFileHash,
          image_url: body.image_url || canonicalDoc.image_url,
          back_image_url: body.back_image_url || extractedFields.back_image_url,
          original_filename: body.original_filename,
          detected_quarters: detectedQuarters,
          uploaded_by: uploadedBy,
        });
      } catch {
        // Table optional / unmigrated
      }

      await logAuditEvent({
        category: "DOCUMENT",
        action: "DOCUMENT_UPLOADED",
        outcome: "SUCCESS",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: roleRow?.role || "teacher",
        actorSchoolId: userSchoolId,
        actorSchoolName: authoritativeSchool?.name,
        targetType: "document",
        targetId: canonicalDoc.id,
        targetLabel: `${documentType.toUpperCase()} - ${body.original_filename || "Document"}`,
        reason: "User updated existing canonical academic record with incremental quarter grades",
        details: {
          result: "ACADEMIC_RECORD_UPDATED",
          document_id: canonicalDoc.id,
          added_quarters: mergeResult.addedQuarters,
          conflicts_count: mergeResult.conflicts.length,
          new_status: "needs_review",
        },
      });

      return NextResponse.json({
        ...updatedDoc,
        id: canonicalDoc.id,
        code: "ACADEMIC_RECORD_UPDATED",
        message: mergeResult.conflicts.length > 0
          ? "Conflicting grades detected. Manual verification required."
          : "Existing academic record updated with new quarter grades. Pending verification.",
        is_incremental_update: true,
        canonical_document_id: canonicalDoc.id,
        added_quarters: mergeResult.addedQuarters,
      }, { status: 200 });
    };

    if (existingCanonicalDoc) {
      return await processCanonicalMergeOrSuppress(existingCanonicalDoc);
    }

    // ── 8. NEW CANONICAL ACADEMIC RECORD CREATION (SCENARIO A / E) ─────────────
    const initialScanEntry = {
      version: 1,
      uploaded_at: new Date().toISOString(),
      uploaded_by: uploadedBy,
      file_hash: incomingFileHash,
      original_filename: body.original_filename,
      image_url: body.image_url,
      back_image_url: body.back_image_url || extractedFields.back_image_url,
      detected_quarters: (extractedFields.grades || []).flatMap((g: any) => {
        const qs: string[] = [];
        if (g.q1 !== undefined) qs.push("Q1");
        if (g.q2 !== undefined) qs.push("Q2");
        if (g.q3 !== undefined) qs.push("Q3");
        if (g.q4 !== undefined) qs.push("Q4");
        return qs;
      }),
    };
    extractedFields.scan_history = [initialScanEntry];
    extractedFields.scan_evidence_history = [initialScanEntry];
    extractedFields.last_scan_version = 1;

    // Prepare document payload
    const documentPayload: any = {
      student_id: studentId,
      school_id: userSchoolId,
      document_type: documentType,
      image_url: body.image_url || "uploaded-document",
      original_filename: body.original_filename || null,
      extracted_text: body.extracted_text || null,
      extracted_fields: extractedFields,
      ocr_model: body.ocr_model || "mistral-ocr-latest",
      ocr_confidence: typeof body.ocr_confidence === "number" ? body.ocr_confidence : null,
      status: status,
      uploaded_by: uploadedBy,
      school_year: sy,
      grade_level: gl,
      semester: extractedFields.semester || null,
      teacher_assignment_id: serverAssignment?.id || null,
      section: effectiveSection || null,
      strand_or_track: effectiveStrand || null,
      assignment_confirmed_at: assignmentConfirmed && serverAssignment?.id ? new Date().toISOString() : null,
      assignment_confirmed_by: assignmentConfirmed && serverAssignment?.id ? user.id : null,
    };

    let docData: any;
    let docError: any;

    // Idempotent upsert: if document_id is provided, check if document already exists
    if (body.document_id) {
      const { data: existingDoc } = await supabase
        .from('documents')
        .select('id, uploaded_by, school_id, status')
        .eq('id', body.document_id)
        .maybeSingle();

      if (existingDoc?.id) {
        if (existingDoc.uploaded_by !== uploadedBy || existingDoc.school_id !== userSchoolId) {
          return NextResponse.json(
            { error: "Forbidden: You cannot modify or overwrite a document belonging to another user or school." },
            { status: 403 }
          );
        }
        if (existingDoc.status === 'approved' || existingDoc.status === 'archived') {
          return NextResponse.json(
            { error: "Conflict: Cannot overwrite an approved or archived document record." },
            { status: 409 }
          );
        }

        const updateRes = await supabase
          .from('documents')
          .update(documentPayload)
          .eq('id', body.document_id)
          .eq('uploaded_by', uploadedBy)
          .eq('school_id', userSchoolId)
          .select()
          .single();
        docData = updateRes.data;
        docError = updateRes.error;
      } else {
        const insertRes = await supabase
          .from('documents')
          .insert({ ...documentPayload, id: body.document_id })
          .select()
          .single();
        docData = insertRes.data;
        docError = insertRes.error;

        // Safe conflict handling for concurrent race condition (either by document_id PK or canonical unique index)
        if (docError && (docError.code === '23505' || docError.message?.includes('duplicate key') || docError.message?.includes('unique constraint'))) {
          const { data: conflictDoc } = await supabase
            .from('documents')
            .select('id, uploaded_by, school_id, status')
            .eq('id', body.document_id)
            .maybeSingle();

          if (conflictDoc) {
            if (conflictDoc.uploaded_by !== uploadedBy || conflictDoc.school_id !== userSchoolId) {
              return NextResponse.json(
                { error: "Forbidden: You cannot modify or overwrite a document belonging to another user or school." },
                { status: 403 }
              );
            }
            if (conflictDoc.status === 'approved' || conflictDoc.status === 'archived') {
              return NextResponse.json(
                { error: "Conflict: Cannot overwrite an approved or archived document record." },
                { status: 409 }
              );
            }

            const updateRes = await supabase
              .from('documents')
              .update(documentPayload)
              .eq('id', body.document_id)
              .eq('uploaded_by', uploadedBy)
              .eq('school_id', userSchoolId)
              .select()
              .single();
            docData = updateRes.data;
            docError = updateRes.error;
          } else {
            // Concurrent winner inserted a different document_id with the same canonical academic identity
            const concurrentWinner = await findExistingCanonicalDocument();
            if (concurrentWinner) {
              return await processCanonicalMergeOrSuppress(concurrentWinner);
            }
          }
        }
      }
    } else {
      // Deduplication fallback: check for identical recent submission by same teacher
      if (documentPayload.image_url && documentPayload.image_url !== "uploaded-document") {
        const { data: recentDup } = await supabase
          .from('documents')
          .select('id, uploaded_by, school_id, status')
          .eq('uploaded_by', uploadedBy)
          .eq('school_id', userSchoolId)
          .eq('document_type', documentType)
          .eq('image_url', documentPayload.image_url)
          .in('status', ['submitted', 'extracted', 'validated', 'needs_review'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentDup?.id) {
          const updateRes = await supabase
            .from('documents')
            .update(documentPayload)
            .eq('id', recentDup.id)
            .eq('uploaded_by', uploadedBy)
            .eq('school_id', userSchoolId)
            .select()
            .single();
          docData = updateRes.data;
          docError = updateRes.error;
        }
      }

      if (!docData) {
        const insertRes = await supabase
          .from('documents')
          .insert(documentPayload)
          .select()
          .single();
        docData = insertRes.data;
        docError = insertRes.error;

        if (docError && (docError.code === '23505' || docError.message?.includes('duplicate key') || docError.message?.includes('unique constraint'))) {
          const concurrentWinner = await findExistingCanonicalDocument();
          if (concurrentWinner) {
            return await processCanonicalMergeOrSuppress(concurrentWinner);
          }
        }
      }
    }

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 400 });
    }

    await persistQuarantinedConflicts(docData.id);

    // Ingest multi-learner roster documents (SF1, SF2, SF5) into child tables
    let rosterIngestionResult: any = null;
    if (['sf1', 'sf2', 'sf5'].includes(documentType)) {
      try {
        rosterIngestionResult = await ingestRosterDocument({
          db: supabase,
          documentId: docData.id,
          schoolId: userSchoolId,
          documentType: documentType as 'sf1' | 'sf2' | 'sf5',
          extractedText: body.extracted_text || '',
          extractedFields,
          azureTables: body.azure_tables,
          ocrProvider: (docData.ocr_model || '').toLowerCase().includes('azure') ? 'azure' : 'mistral',
          ocrConfidence: typeof docData.ocr_confidence === 'number' ? docData.ocr_confidence : 0.95,
        });
      } catch (ingestErr) {
        console.error('[api/documents] Multi-learner roster ingestion error:', ingestErr);
      }
    }

    // Record initial scan version in document_scans table
    try {
      await (supabase as any).from("document_scans").insert({
        document_id: docData.id,
        student_id: studentId,
        scan_version: 1,
        file_hash: incomingFileHash,
        image_url: docData.image_url,
        back_image_url: extractedFields.back_image_url || null,
        original_filename: body.original_filename,
        detected_quarters: initialScanEntry.detected_quarters,
        uploaded_by: uploadedBy,
      });
    } catch {
      // Table optional / unmigrated
    }

    // 9. Run validation engine if fields exist
    if (docData && Object.keys(extractedFields).length > 0) {
      try {
        const { data: schoolsData } = await supabase.from('schools').select('name');
        const knownSchools = (schoolsData || []).map((s: { name: string }) => s.name);
        const report = validateFields(extractedFields, {
          knownSchools,
          ocrConfidence: typeof docData.ocr_confidence === "number" ? docData.ocr_confidence : undefined,
        });

        if (report.results && report.results.length > 0) {
          const resultsToInsert = report.results.map((res) => ({
            document_id: docData.id,
            rule_name: res.ruleName || res.rule_name || "rule",
            field_name: res.fieldName || res.field_name || null,
            passed: res.passed,
            expected_value: res.expectedValue || res.expected_value || null,
            actual_value: typeof res.actualValue === 'string' ? res.actualValue : (res.actual_value || (res.actualValue !== undefined ? JSON.stringify(res.actualValue) : null)),
            message: res.message || null,
          }));

          await supabase.from('validation_results').insert(resultsToInsert);
        }

        let newStatus: string;
        if (report.status === 'invalid' || status === 'rejected') {
          newStatus = 'rejected';
        } else if (report.status === 'needs_review' || status === 'needs_review') {
          newStatus = 'needs_review';
        } else {
          newStatus = 'validated';
        }

        await supabase
          .from('documents')
          .update({ status: newStatus })
          .eq('id', docData.id);

        docData.status = newStatus;
      } catch (valErr) {
        console.error("[api/documents] Validation execution error:", valErr);
      }
    }

    // Administrative audit logging for document creation
    await logAuditEvent({
      category: "DOCUMENT",
      action: "DOCUMENT_UPLOADED",
      outcome: "SUCCESS",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: roleRow?.role || "teacher",
      actorSchoolId: userSchoolId,
      actorSchoolName: authoritativeSchool?.name,
      targetType: "document",
      targetId: docData.id,
      targetLabel: `${documentType.toUpperCase()} - ${body.original_filename || "Document"}`,
      reason: "User created new canonical academic record staged for review",
      details: {
        document_type: documentType,
        grade_level: extractedFields.grade_level,
        final_status: docData.status,
        student_id: studentId,
      },
    });

    return NextResponse.json({
      ...docData,
      roster_ingestion: rosterIngestionResult,
      code: "ACADEMIC_RECORD_CREATED",
      message: "Academic record created. Pending verification.",
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Helper to identify safely ignorable table/column errors when cleaning child tables
 * (e.g. 42P01 table does not exist, PGRST205 schema cache missing table, 42703 column does not exist)
 */
function isIgnorableChildTableError(err: any): boolean {
  if (!err) return true;
  const code = String(err.code || "").toUpperCase();
  const msg = String(err.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    msg.includes("column")
  );
}

/**
 * Known foreign-key child tables in the AVV schema that reference documents.id
 */
const CHILD_TABLES_BY_DOC_ID = [
  "validation_results",
  "review_logs",
  "subject_grades",
  "academic_standing_history",
  "attendance_records",
  "attendance_summaries",
  "remedial_records",
  "grade_change_history",
  "document_scans",
  "student_identity_conflicts",
  "sf1_roster_entries",
  "sf2_attendance_entries",
  "sf5_promotion_entries",
  "psa_identity_records",
  "field_extraction_traces",
  "academic_award_evaluations",
  "learner_observed_values",
  "sf9_grading_scale_legends",
  "document_segments",
  "validation_findings",
  "validation_reports",
  "discrepancies",
  "review_queue",
  "grades",
];

/**
 * DELETE /api/documents
 * Clears / resets all stored document records and batches for the current school
 * so the registry can be wiped and subsequent uploads restart cleanly at BATCH-001.
 *
 * Implements strict RLS bypass using admin/service-role client when available,
 * explicit .in('id', documentIds) filter to prevent PostgREST WHERE clause requirements,
 * pre-deletion of foreign-key child records, best-effort storage cleanup, and clean
 * soft-archive fallback when database constraints block hard deletion.
 */
export async function DELETE(request: NextRequest) {
  try {
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in." }, { status: 401 });
    }

    const { data: roleRow, error: roleErr } = await userClient
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleErr) {
      return NextResponse.json({
        error: `Database authorization check failed: ${roleErr.message}`,
        details: { code: roleErr.code, message: roleErr.message },
      }, { status: 500 });
    }

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account is pending administrator approval." }, { status: 403 });
    }

    // Resolve privileged server/admin client (service-role Supabase client if configured, falling back cleanly to authenticated client)
    let db: any = userClient;
    try {
      const adminClient = createAdminClient();
      if (adminClient) {
        db = adminClient;
      }
    } catch {
      db = userClient;
    }

    const schoolId = roleRow.school_id;

    // 1. Fetch matching target documentIds and storage file paths scoped to user's school / uploaded_by
    // Use .select('*') to avoid PostgREST column missing errors on optional fields
    let fetchQuery = db
      .from("documents")
      .select("*");

    if (schoolId) {
      fetchQuery = fetchQuery.eq("school_id", schoolId);
    } else {
      fetchQuery = fetchQuery.eq("uploaded_by", user.id);
    }

    const { data: targetDocs, error: fetchErr } = await fetchQuery;

    if (fetchErr) {
      console.error("[DELETE /api/documents] Failed to query documents:", fetchErr);
      return NextResponse.json({
        error: `Failed to fetch target documents: ${fetchErr.message}`,
        details: { code: fetchErr.code, message: fetchErr.message },
      }, { status: 500 });
    }

    if (!targetDocs || targetDocs.length === 0) {
      return NextResponse.json({
        success: true,
        clearedCount: 0,
        message: "No document records found to clear.",
      });
    }

    const documentIds: string[] = targetDocs.map((d: any) => d.id).filter(Boolean);
    if (documentIds.length === 0) {
      return NextResponse.json({
        success: true,
        clearedCount: 0,
        message: "No valid document IDs found to clear.",
      });
    }

    // 2. Pre-delete dependent child records referencing documents.id
    for (const table of CHILD_TABLES_BY_DOC_ID) {
      try {
        const { error: childErr } = await db
          .from(table)
          .delete()
          .in("document_id", documentIds);

        if (childErr && !isIgnorableChildTableError(childErr)) {
          console.warn(`[DELETE /api/documents] Note deleting child records from ${table}:`, childErr.message);
        }
      } catch {
        // safely ignore non-existent child tables
      }
    }

    // Dependent tables with alternate foreign-key column names
    try {
      await db.from("cross_document_validations").delete().in("source_doc1_id", documentIds);
    } catch {}
    try {
      await db.from("cross_document_validations").delete().in("source_doc2_id", documentIds);
    } catch {}
    try {
      await db.from("student_enrollments").delete().in("source_document_id", documentIds);
    } catch {}

    // 3. Best-effort remove stored files from Supabase Storage
    // Resolve storage file paths defensively from whichever column exists (storage_path, file_url, image_url, original_file_url)
    const storagePathsToDelete: string[] = [];
    for (const doc of targetDocs) {
      const rawPath = doc.storage_path || doc.file_url || doc.image_url || doc.original_file_url;
      if (rawPath && typeof rawPath === "string") {
        if (rawPath.startsWith("data:") || rawPath.startsWith("blob:")) continue;
        if (rawPath.includes("/documents/")) {
          const parts = rawPath.split("/documents/")[1];
          if (parts) {
            const clean = decodeURIComponent(parts.split("?")[0]);
            if (clean && !storagePathsToDelete.includes(clean)) storagePathsToDelete.push(clean);
          }
        } else if (!rawPath.startsWith("http://") && !rawPath.startsWith("https://")) {
          const clean = decodeURIComponent(rawPath.split("?")[0]);
          if (clean && !storagePathsToDelete.includes(clean)) storagePathsToDelete.push(clean);
        }
      }
    }

    if (storagePathsToDelete.length > 0) {
      try {
        await db.storage.from("documents").remove(storagePathsToDelete);
      } catch (storageErr) {
        console.warn("[DELETE /api/documents] Storage cleanup notice:", storageErr);
      }
    }

    // 4. Delete the target rows from documents using an explicit .in('id', documentIds) filter
    let hardDeleteSuccess = false;
    const { error: hardDeleteErr } = await db
      .from("documents")
      .delete()
      .in("id", documentIds);

    if (!hardDeleteErr) {
      hardDeleteSuccess = true;
    } else {
      console.warn(
        "[DELETE /api/documents] Hard delete prevented by database policy or trigger. Performing clean soft-archive fallback:",
        hardDeleteErr.message
      );

      // 4a. Attempt RPC archive_review_document per document ID if available
      let rpcSuccessCount = 0;
      for (const docId of documentIds) {
        try {
          const { error: rpcErr } = await (userClient as any).rpc("archive_review_document", {
            p_document_id: docId,
            p_confirmation_phrase: "ARCHIVE",
          });
          if (!rpcErr) {
            rpcSuccessCount++;
          }
        } catch {
          // RPC might not exist, proceed to direct update fallback
        }
      }

      // 4b. Clean soft-archive update fallback using verified existing columns (status, archived_at)
      // so GET /api/documents excludes them and resets registry to BATCH-001
      const now = new Date().toISOString();
      const { error: archiveErr } = await db
        .from("documents")
        .update({
          status: "archived",
          archived_at: now,
        })
        .in("id", documentIds);

      if (archiveErr && rpcSuccessCount === 0) {
        console.error("[DELETE /api/documents] Failed to archive documents fallback:", archiveErr);
        return NextResponse.json({
          error: `Failed to delete or archive documents: ${archiveErr.message}`,
          details: {
            hardDeleteError: { code: hardDeleteErr.code, message: hardDeleteErr.message },
            archiveError: { code: archiveErr.code, message: archiveErr.message },
          },
        }, { status: 500 });
      }
    }

    // 5. Log audit event
    await logAuditEvent({
      category: "DOCUMENT",
      action: hardDeleteSuccess ? "DOCUMENT_DELETED" : "DOCUMENT_ARCHIVED",
      outcome: "SUCCESS",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: roleRow?.role || "teacher",
      actorSchoolId: schoolId,
      targetType: "documents_batch",
      targetId: schoolId || user.id,
      targetLabel: `Purged ${documentIds.length} document records`,
      reason: "User requested registry reset and file cleanup",
      details: {
        clearedCount: documentIds.length,
        hardDeleteSuccess,
      },
    });

    return NextResponse.json({
      success: true,
      clearedCount: documentIds.length,
      hardDelete: hardDeleteSuccess,
      message: `All ${documentIds.length} document records and batches cleared successfully. Next batch starts at BATCH-001.`,
    });
  } catch (error: any) {
    console.error("[DELETE /api/documents] Failed:", error);
    return NextResponse.json({
      error: error.message || "Internal Server Error",
      details: {
        code: error.code || "UNKNOWN_ERROR",
        message: error.message || String(error),
      },
    }, { status: 500 });
  }
}
