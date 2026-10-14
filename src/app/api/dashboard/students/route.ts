import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    let students: any[] = [];
    // Fetch all students with their subject grades if available
    const { data: studentWithGrades, error: joinError } = await (supabase as any)
      .from("students")
      .select(`
        *,
        subject_grades (*)
      `)
      .order("last_name", { ascending: true });

    if (joinError) {
      // Fallback: If migration 005 has not been applied yet, query students without subject_grades join
      const { data: simpleStudents, error: simpleError } = await (supabase as any)
        .from("students")
        .select("*")
        .order("last_name", { ascending: true });

      if (simpleError) {
        console.error("[dashboard/students] Error fetching students:", simpleError);
        return NextResponse.json({ error: simpleError.message }, { status: 500 });
      }
      students = simpleStudents || [];
    } else {
      students = studentWithGrades || [];
    }

    const flagged: any[] = [];
    const nonFlagged: any[] = [];

    students.forEach((student: any) => {
      // Determine if they are flagged
      if (student.overall_status === "Failed" || student.overall_status === "Needs Verification") {
        // Find which subjects caused the flag
        const triggeringSubjects = (student.subject_grades || []).filter(
          (grade: any) => grade.status === "Failed" || grade.needs_verification === true
        );
        flagged.push({
          ...student,
          triggeringSubjects
        });
      } else if (student.overall_status === "Passed") {
        nonFlagged.push(student);
      }
    });

    return NextResponse.json({
      flagged,
      nonFlagged
    });
  } catch (error: any) {
    console.error("[dashboard/students] Internal error:", error);
    return NextResponse.json(
      { error: "Unable to fetch students." },
      { status: 500 }
    );
  }
}
