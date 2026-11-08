import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  deriveStudentDirectoryItem,
  filterStudentDirectoryItems,
  extractDistinctSections,
  extractDistinctSchoolYears,
  StudentDirectoryFilters,
} from '@/lib/students/studentDirectory';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryParam = searchParams.get('query') || undefined;
    const schoolLevelParam = searchParams.get('school_level') || undefined;
    const gradeLevelParam = searchParams.get('grade_level') || undefined;
    const sectionParam = searchParams.get('section') || undefined;
    const reviewStatusParam = searchParams.get('review_status') || undefined;
    const validationStatusParam = searchParams.get('validation_status') || undefined;
    const schoolYearParam = searchParams.get('school_year') || undefined;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to view student records." }, { status: 401 });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account is pending administrator approval." }, { status: 403 });
    }

    // Query students with joined school name and attached documents for authoritative verification status
    const { data, error } = await supabase
      .from('students')
      .select(`
        *,
        schools (id, name),
        documents (
          id,
          status,
          grade_level,
          school_year,
          source_form_version,
          shs_track,
          extracted_fields,
          created_at
        )
      `)
      .order('last_name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform raw rows into normalized directory items
    const allItems = (data || []).map(deriveStudentDirectoryItem);

    // Extract dynamic distinct filter options from actual records
    const availableSections = extractDistinctSections(allItems, schoolLevelParam, gradeLevelParam);
    const availableSchoolYears = extractDistinctSchoolYears(allItems);

    // Apply active filters
    const filters: StudentDirectoryFilters = {
      query: queryParam,
      school_level: schoolLevelParam,
      grade_level: gradeLevelParam,
      section: sectionParam,
      review_status: reviewStatusParam,
      validation_status: validationStatusParam,
      school_year: schoolYearParam,
    };

    const filteredItems = filterStudentDirectoryItems(allItems, filters);

    return NextResponse.json({
      students: filteredItems,
      total: allItems.length,
      filtered_count: filteredItems.length,
      available_sections: availableSections,
      available_school_years: availableSchoolYears,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to modify student records." }, { status: 401 });
    }

    if (body.grade_level) {
      const gStr = String(body.grade_level).trim();
      const isShs = /^(?:grade\s*)?(?:11|12|xi{1,2})$/i.test(gStr);
      if (!isShs) {
        return NextResponse.json({
          error: `Unsupported grade level: '${gStr}'. The active AVV scope supports only Senior High School (Grade 11 and Grade 12).`,
        }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from('students')
      .upsert(body, { onConflict: 'lrn' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
