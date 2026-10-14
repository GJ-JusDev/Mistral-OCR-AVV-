import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateFields } from '@/lib/validation/engine';
import { evaluateStudentIdentity, verifyStudentCollision } from '@/lib/validation/studentMatcher';

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
    const uploadedBy = user.id;

    // 2. Normalize document_type to lowercase valid DepEd enum values: 'sf9' | 'sf10' | 'school_id' | 'birth_cert' | 'other'
    let documentType = String(body.document_type || "sf9").toLowerCase().trim();
    const validDocTypes = ['sf9', 'sf10', 'school_id', 'birth_cert', 'other'];
    if (!validDocTypes.includes(documentType)) {
      documentType = 'sf9';
    }

    // 3. Normalize status to valid enum: 'submitted' | 'extracted' | 'validated' | 'needs_review' | 'corrected' | 'approved' | 'rejected'
    let status = String(body.status || "submitted").toLowerCase().trim();
    const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      status = 'submitted';
    }

    // 4. Safely resolve or create student using DepEd identity evaluation
    let studentId = body.student_id || null;
    const extractedFields = body.extracted_fields || {};
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
      } else if (identityEval.canAutoCreate) {
        // Create verified student record only when both first and last names are present
        const gradeLevel = extractedFields.grade_level || null;
        const sex = extractedFields.sex === 'M' || extractedFields.sex === 'F' ? extractedFields.sex : null;

        const { data: newStudent } = await supabase
          .from('students')
          .insert({
            lrn: identityEval.normalizedLrn,
            first_name: identityEval.firstName!,
            middle_name: identityEval.middleName,
            last_name: identityEval.lastName!,
            suffix: identityEval.suffix,
            grade_level: gradeLevel,
            sex: sex,
            status: 'active'
          })
          .select('id')
          .single();

        if (newStudent?.id) {
          studentId = newStudent.id;
        }
      }
    }

    // 5. Resolve school_id from user role or payload
    let userSchoolId: string | null = body.school_id || null;
    if (!userSchoolId) {
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('school_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (roleRow?.school_id) {
        userSchoolId = roleRow.school_id;
      }
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
      ocr_confidence: body.ocr_confidence ?? 1.0,
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
          ocrConfidence: docData.ocr_confidence || 1.0,
        });

        if (report.results && report.results.length > 0) {
          const resultsToInsert = report.results.map((res) => ({
            document_id: docData.id,
            rule_name: res.ruleName,
            field_name: res.fieldName,
            passed: res.passed,
            expected_value: res.expectedValue || null,
            actual_value: typeof res.actualValue === 'string' ? res.actualValue : JSON.stringify(res.actualValue) || null,
            message: res.message,
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

    return NextResponse.json(docData, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
