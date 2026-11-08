import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateFields } from '@/lib/validation/engine';
import { evaluateStudentIdentity, verifyStudentCollision } from '@/lib/validation/studentMatcher';
import { normalizeGradeRecords } from '@/lib/validation/gradeUtils';
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

    // 2. Enforce active document_type: strictly 'sf9' | 'sf10' | 'birth_cert'
    let documentType = String(body.document_type || "sf9").toLowerCase().trim();
    const validDocTypes = ['sf9', 'sf10', 'birth_cert'];
    if (!validDocTypes.includes(documentType)) {
      return NextResponse.json({
        error: `Unsupported document type: '${documentType}'. The active AVV scope supports only SF9, SF10, and PSA Certificate of Live Birth (birth_cert).`,
      }, { status: 400 });
    }

    // 3. Normalize status to valid enum. Disallow unverified documents from being uploaded directly as 'approved'.
    let status = String(body.status || "submitted").toLowerCase().trim();
    const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected'];
    if (!validStatuses.includes(status)) {
      status = 'submitted';
    }

    // 4. Staging / Verification-safe student identity handling:
    // Authoritative student record creation is strictly deferred to authorized human review in submitDocumentReview().
    // Documents uploaded via OCR staging do NOT create records in the 'students' table.
    let studentId = body.student_id || null;
    const extractedFields = body.extracted_fields ? { ...body.extracted_fields } : {};
    if (documentType === 'birth_cert') {
      delete extractedFields.academic_level;
      delete extractedFields.selected_grade_level;
      delete extractedFields.grading_period_scheme;
    } else if (documentType === 'sf9' || documentType === 'sf10') {
      const candidateGrade = String(
        body.selected_grade_level ||
        body.grade_level ||
        extractedFields.selected_grade_level ||
        extractedFields.grade_level ||
        extractedFields.academic_level ||
        ""
      ).trim();

      // Enforce Senior High School (Grade 11 & Grade 12) scope.
      // Reject any explicitly unsupported elementary, junior high school, or grades 1-10 submissions.
      const isExplicitlyUnsupported = /^(?:elementary|kinder|kindergarten|junior\s+high|jhs|high\s+school|grade\s*([1-9]|10)\b|[1-9]\b|10\b)/i.test(candidateGrade);
      if (isExplicitlyUnsupported) {
        return NextResponse.json({
          error: `Unsupported grade level: '${candidateGrade}'. The active AVV scope supports only Senior High School (Grade 11 and Grade 12).`,
        }, { status: 400 });
      }

      // Normalize to SHS semestral structure
      extractedFields.academic_level = "Senior High School";
      if (/12|xii\b/i.test(candidateGrade)) {
        extractedFields.selected_grade_level = "Grade 12";
        extractedFields.grade_level = extractedFields.grade_level || "Grade 12";
      } else {
        extractedFields.selected_grade_level = "Grade 11";
        extractedFields.grade_level = extractedFields.grade_level || "Grade 11";
      }
      extractedFields.grading_period_scheme = "quarterly_semestral";
    }
    const identityEval = evaluateStudentIdentity(extractedFields);

    if (!studentId && identityEval.isValidLrn && identityEval.normalizedLrn) {
      // Find existing student by valid 12-digit LRN
      const { data: existingStudent } = await supabase
        .from('students')
        .select('id, first_name, last_name')
        .eq('lrn', identityEval.normalizedLrn)
        .maybeSingle();

      if (existingStudent?.id) {
        const collisionCheck = verifyStudentCollision(identityEval.lastName, existingStudent);
        if (!collisionCheck.hasConflict) {
          studentId = existingStudent.id;
        } else {
          // Do not link across conflicting names; flag for reviewer
          extractedFields.flags = [...(extractedFields.flags || []), collisionCheck.reason!];
        }
      } else {
        // If no existing student, stage candidate info in extracted_fields for human review.
        // DO NOT insert into students table during document upload.
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
        // Mark for human review
        if (status === 'submitted' || status === 'validated') {
          status = 'needs_review';
        }
      }
    }

    // 5. Server-enforced institutional identity resolution (TRIS)
    // 5a. Retrieve user's assigned school from user_roles
    let trustedSchoolUuid: string | null = roleRow?.school_id || null;

    // 5b. Authoritative institutional record lookup for TRIS (Taysan Resettlement Integrated School)
    // Single institution in scope: DepEd School ID '300792', UUID 'a0000000-0000-0000-0000-000000000001'
    const { data: authoritativeSchool } = await supabase
      .from('schools')
      .select('id, school_id, name')
      .eq('school_id', '300792')
      .maybeSingle();

    // Fall back to verified TRIS record when user role school_id is null
    if (!trustedSchoolUuid && authoritativeSchool?.id) {
      trustedSchoolUuid = authoritativeSchool.id;
    }

    // 5c. Security check: Never trust client-submitted school_id as authoritative.
    // Reject conflicting or unauthorized school associations.
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
      if (!extractedFields.school_id || extractedFields.school_id.trim() === "") {
        extractedFields.school_id = authoritativeSchool.school_id;
        extractedFields.school_id_source = "school_configuration";
        extractedFields.trusted_school_verified = true;
      } else if (extractedFields.school_id === authoritativeSchool.school_id) {
        extractedFields.school_id_source = extractedFields.school_id_source || "school_configuration";
        extractedFields.trusted_school_verified = true;
      } else {
        // Document has a conflicting OCR-extracted School ID
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
    }

    // Normalize grades using semester-aware rules to avoid stale status
    if (Array.isArray(extractedFields.grades) && extractedFields.grades.length > 0) {
      extractedFields.grades = normalizeGradeRecords(extractedFields.grades);
    }

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
    };

    let docData: any;
    let docError: any;

    // Idempotent retry: if document_id is provided, update existing document instead of duplicating
    if (body.document_id) {
      const updateRes = await supabase
        .from('documents')
        .update(documentPayload)
        .eq('id', body.document_id)
        .select()
        .single();
      docData = updateRes.data;
      docError = updateRes.error;
    } else {
      const insertRes = await supabase
        .from('documents')
        .insert(documentPayload)
        .select()
        .single();
      docData = insertRes.data;
      docError = insertRes.error;
    }

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 400 });
    }

    // 6. Connect and run validation engine if fields exist
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

        // Determine updated status from validation report
        let newStatus = 'validated';
        if (report.status === 'invalid') {
          newStatus = 'rejected';
        } else if (report.status === 'needs_review') {
          newStatus = 'needs_review';
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

    // Administrative audit logging for document submission
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
      reason: "User staged document for validation and review",
      details: {
        document_type: documentType,
        grade_level: extractedFields.grade_level,
        final_status: docData.status,
        student_id: studentId,
      },
    });

    return NextResponse.json(docData, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
