import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { validateFields } from '@/lib/validation/engine';
import { 
  evaluateStudentIdentity, 
  verifyStudentCollision, 
  matchStudentIdentityMatrix 
} from '@/lib/validation/studentMatcher';
import { normalizeGradeRecords, updateExtractedFieldsAverages } from '@/lib/validation/gradeUtils';
import { mergeAcademicGrades } from '@/lib/validation/gradeMerger';
import { normalizeLrn } from '@/lib/validation/patterns';
import { matchSchool } from '@/lib/validation/schoolMatcher';
import { logAuditEvent } from '@/lib/audit/auditLogger';

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

    let query = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: order === 'asc' })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    } else {
      query = query.neq('status', 'archived');
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ documents: data || [] });
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

    // 2. Enforce active document_type: strictly 'sf9' | 'sf10'
    let documentType = String(body.document_type || "sf9").toLowerCase().trim();
    if (documentType === "birth_cert" || documentType === "psa") {
      return NextResponse.json({
        error: "PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document.",
        code: "DOCUMENT_TYPE_NOT_SUPPORTED",
      }, { status: 400 });
    }
    const validDocTypes = ['sf9', 'sf10'];
    if (!validDocTypes.includes(documentType)) {
      return NextResponse.json({
        error: `Unsupported document type: '${documentType}'. The active AVV scope supports only SF9 and SF10.`,
      }, { status: 400 });
    }

    // 3. Normalize status to valid enum. Disallow unverified documents from being uploaded directly as 'approved'.
    let status = String(body.status || "submitted").toLowerCase().trim();
    const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected'];
    if (!validStatuses.includes(status)) {
      status = 'submitted';
    }

    // 4. Staging / Verification-safe student identity handling
    let studentId = body.student_id || null;
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

    // 4a. Evaluate student identity & full name + LRN matching matrix
    const identityEval = evaluateStudentIdentity(extractedFields);
    let identityMatchResult: any = null;

    if (identityEval.isValidLrn && identityEval.normalizedLrn) {
      // Find existing student by valid 12-digit LRN within authorized scope
      const { data: existingStudent } = await supabase
        .from('students')
        .select('id, lrn, first_name, middle_name, last_name, suffix, school_id')
        .eq('lrn', identityEval.normalizedLrn)
        .maybeSingle();

      // Check if another student has the exact same name with a different LRN
      let studentByNameDiffLrn: any = null;
      if (!existingStudent && identityEval.isValidName && identityEval.lastName && identityEval.firstName) {
        const { data: foundByName } = await supabase
          .from('students')
          .select('id, lrn, first_name, last_name')
          .ilike('last_name', identityEval.lastName.trim())
          .ilike('first_name', identityEval.firstName.trim())
          .limit(1)
          .maybeSingle();
        if (foundByName && foundByName.lrn !== identityEval.normalizedLrn) {
          studentByNameDiffLrn = foundByName;
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
        // Hard collision: block linking to protect original student!
        studentId = null;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
      } else if (identityMatchResult.matchType === "SAME_LRN_MINOR_DIFF") {
        studentId = identityMatchResult.studentId;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
      } else if (identityMatchResult.matchType === "DIFF_LRN_SAME_NAME") {
        studentId = null;
        extractedFields.flags = [...(extractedFields.flags || []), identityMatchResult.reason];
        status = 'needs_review';
      } else if (identityMatchResult.matchType === "NEW_LRN_NEW_NAME") {
        // Stage candidate info for student registry
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
      // Missing, unreadable, or invalid LRN: Flag for human review.
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

    // 5. Server-enforced institutional identity resolution (TRIS)
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

    const rawSy = String(extractedFields.school_year || body.school_year || "").trim();
    const sy = rawSy.length > 0 ? rawSy : null;
    if (!sy && documentType === "sf9") {
      extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
      if (!extractedFields.flags.includes("missing_school_year")) {
        extractedFields.flags.push("missing_school_year");
      }
      status = "needs_review";
    }

    const rawGl = String(extractedFields.grade_level || body.grade_level || extractedFields.selected_grade_level || "").trim();
    const gl = rawGl.length > 0 ? rawGl : null;
    if (!gl && documentType === "sf9") {
      extractedFields.flags = Array.isArray(extractedFields.flags) ? extractedFields.flags : [];
      if (!extractedFields.flags.includes("missing_grade_level")) {
        extractedFields.flags.push("missing_grade_level");
      }
      status = "needs_review";
    }

    const hasRequiredCanonicalPeriod = documentType === "sf10" || Boolean(sy && gl);
    const incomingFileHash = body.file_hash || (body.image_url ? crypto.createHash("sha256").update(body.image_url).digest("hex") : null);
    if (incomingFileHash) {
      extractedFields.file_hash = incomingFileHash;
    }

    const hasIdentityConflict =
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

    // Enforce non-null canonical identity fields before linking or creating an active student_id:
    // For SF9, school_year and grade_level MUST be non-null for the record to be an active canonical record.
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
      const { data: existingStu } = await supabase
        .from("students")
        .select("id")
        .eq("lrn", identityEval.normalizedLrn)
        .maybeSingle();

      if (existingStu?.id) {
        studentId = existingStu.id;
        extractedFields.existing_student_id = existingStu.id;
      } else {
        const { data: newStu } = await supabase
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
        if (newStu?.id) {
          studentId = newStu.id;
          extractedFields.existing_student_id = newStu.id;
        }
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
      code: "ACADEMIC_RECORD_CREATED",
      message: "Academic record created. Pending verification.",
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
