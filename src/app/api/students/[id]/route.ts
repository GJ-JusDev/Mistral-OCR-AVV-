import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await props.params;

    // Fetch primary student profile
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("*, schools(id, name, school_id)")
      .eq("id", id)
      .maybeSingle();

    if (studentError || !student) {
      return NextResponse.json({ error: studentError?.message || "Student not found" }, { status: 404 });
    }

    const { data: enrollments, error: enrollmentError } = await (supabase as any)
      .from("student_enrollments")
      .select("school_year, grade_level, section, strand_or_track, is_current, enrollment_status, updated_at")
      .eq("student_id", id)
      .eq("school_id", student.school_id)
      .order("is_current", { ascending: false })
      .order("updated_at", { ascending: false });
    if (enrollmentError) {
      throw new Error(`Failed to load learner enrollment contexts: ${enrollmentError.message}`);
    }

    // Direct attached documents (SF9, SF10, PSA)
    const { data: directDocs } = await supabase
      .from("documents")
      .select("*")
      .eq("student_id", id)
      .order("created_at", { ascending: false });

    // Multi-learner roster linkages
    const { data: sf1Entries } = await (supabase as any)
      .from("sf1_roster_entries")
      .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
      .or(`student_id.eq.${id},lrn.eq.${student.lrn}`);

    const { data: sf2Entries } = await (supabase as any)
      .from("sf2_attendance_entries")
      .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
      .or(`student_id.eq.${id},lrn.eq.${student.lrn}`);

    const { data: sf5Entries } = await (supabase as any)
      .from("sf5_promotion_entries")
      .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
      .or(`student_id.eq.${id},lrn.eq.${student.lrn}`);

    const { data: psaRecords } = await (supabase as any)
      .from("psa_identity_records")
      .select("*, documents(id, original_filename, document_type)")
      .eq("student_id", id);

    // Subject grades & attendance
    const { data: grades } = await supabase
      .from("subject_grades")
      .select("*")
      .eq("student_id", id)
      .order("subject", { ascending: true });

    const { data: attendance } = await (supabase as any)
      .from("attendance_summaries")
      .select("*")
      .eq("student_id", id);

    // Cross-document validation history
    const { data: crossValidations } = await (supabase as any)
      .from("cross_document_validations")
      .select("*")
      .eq("student_id", id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      student,
      enrollments: enrollments || [],
      documents: directDocs || [],
      rosters: {
        sf1: sf1Entries || [],
        sf2: sf2Entries || [],
        sf5: sf5Entries || [],
        psa: psaRecords || [],
      },
      grades: grades || [],
      attendance: attendance || [],
      cross_document_validations: crossValidations || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load student" }, { status: 500 });
  }
}
