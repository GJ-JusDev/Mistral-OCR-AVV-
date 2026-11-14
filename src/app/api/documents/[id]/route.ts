import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeLrn, isValidLrn } from '@/lib/validation/patterns';
import { compareScannedGradesWithExisting } from '@/lib/validation/gradeComparator';
import {
  normalizeGradeRecords,
  recalculateSubjectGradeStatus,
  updateExtractedFieldsAverages,
} from '@/lib/validation/gradeUtils';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to view documents." }, { status: 401 });
    }

    const { id } = await props.params;

    const { data, error } = await supabase
      .from('documents')
      .select('*, validation_results(*), review_logs(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Document not found" }, { status: 404 });
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

    if (data?.image_url) {
      data.image_url = (await refreshSignedUrl(data.image_url)) || data.image_url;
    }

    if (data?.extracted_fields && typeof data.extracted_fields === "object") {
      const ef = data.extracted_fields as Record<string, any>;
      for (const key of ["back_image_url", "original_image_url", "full_corrected_image_url", "identity_crop_image_url"]) {
        if (typeof ef[key] === "string" && ef[key]) {
          ef[key] = await refreshSignedUrl(ef[key]);
        }
      }
      if (Array.isArray(ef.grades) && ef.grades.length > 0) {
        ef.grades = normalizeGradeRecords(ef.grades, ef.semester || data.semester);
        Object.assign(ef, updateExtractedFieldsAverages(ef));
      }
    }

    // Resolve student identity and active academic grades for controlled deduplication and review
    let matchedStudent: any = null;
    let existingGrades: any[] = [];
    let gradeChangeHistory: any[] = [];
    let gradeComparison: any = null;

    let targetStudentId = data?.student_id;
    const efData = (data?.extracted_fields || {}) as any;
    const rawLrn = efData.lrn || efData.learner_reference_number;
    const cleanLrn = normalizeLrn(rawLrn ? String(rawLrn) : "");

    if (!targetStudentId && isValidLrn(cleanLrn)) {
      const { data: stRow } = await supabase
        .from('students')
        .select('*')
        .eq('lrn', cleanLrn)
        .maybeSingle();
      if (stRow?.id) {
        targetStudentId = stRow.id;
        matchedStudent = stRow;
      }
    } else if (targetStudentId) {
      const { data: stRow } = await supabase
        .from('students')
        .select('*')
        .eq('id', targetStudentId)
        .maybeSingle();
      if (stRow) {
        matchedStudent = stRow;
      }
    }

    if (targetStudentId) {
      const { data: sgRows } = await supabase
        .from('subject_grades')
        .select('*')
        .eq('student_id', targetStudentId);
      existingGrades = (sgRows || []).map((g: any) => {
        const rec = {
          subject: g.subject,
          semester: g.semester,
          q1: g.q1,
          q2: g.q2,
          q3: g.q3,
          q4: g.q4,
          final: g.final_grade,
          sem1_final_grade: g.semester?.includes("1st") ? g.final_grade : undefined,
          sem2_final_grade: g.semester?.includes("2nd") ? g.final_grade : undefined,
          status: g.status,
        };
        const norm = recalculateSubjectGradeStatus(rec as any, g.semester);
        return {
          ...g,
          final_grade: norm.final ?? g.final_grade,
          status: norm.status ?? g.status,
          raw_calculated_final: norm.raw_calculated_final,
          computed_final_grade: norm.computed_final_grade,
        };
      });

      try {
        const { data: gchRows } = await (supabase as any)
          .from('grade_change_history')
          .select('*')
          .eq('student_id', targetStudentId)
          .order('created_at', { ascending: false });
        gradeChangeHistory = gchRows || [];
      } catch {
        // Migration 015 table might not yet be applied
      }

      if (Array.isArray(efData.grades)) {
        gradeComparison = compareScannedGradesWithExisting({
          existingGrades,
          scannedGrades: efData.grades,
          schoolYear: data?.school_year || efData.school_year,
          semester: data?.semester || efData.semester,
          studentId: targetStudentId,
        });
      }
    }

    const responsePayload = {
      ...data,
      matched_student: matchedStudent,
      existing_grades: existingGrades,
      grade_change_history: gradeChangeHistory,
      grade_comparison: gradeComparison,
    };

    return NextResponse.json({
      document: responsePayload,
      ...responsePayload,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const body: import('@/lib/supabase/types').Database['public']['Tables']['documents']['Update'] = await request.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to update documents." }, { status: 401 });
    }

    if (body.status === "approved" || body.status === "rejected") {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role, account_status")
        .eq("user_id", user.id)
        .maybeSingle();

      if (
        !roleData ||
        roleData.account_status !== "Approved" ||
        (roleData.role !== "admin" && roleData.role !== "principal")
      ) {
        return NextResponse.json(
          { error: "Forbidden: Only an approved Principal or Admin can approve or reject documents." },
          { status: 403 }
        );
      }
    }

    // Prevent unauthorized modification of school foreign key
    if ('school_id' in body) {
      delete (body as any).school_id;
    }

    const { id } = await props.params;

    const { data, error } = await supabase
      .from('documents')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
