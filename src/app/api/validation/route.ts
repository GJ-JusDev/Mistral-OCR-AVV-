import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateFields } from '@/lib/validation/engine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentId, fields } = body;

    if (!documentId || !fields) {
      return NextResponse.json({ error: 'documentId and fields are required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch known schools from DB
    const { data: schoolsData, error: schoolsError } = await supabase
      .from('schools')
      .select('name');

    if (schoolsError) {
      return NextResponse.json({ error: schoolsError.message }, { status: 500 });
    }

    const knownSchools = schoolsData.map((s: { name: string }) => s.name);

    // Run validation engine
    const report = validateFields(fields, { knownSchools });

    // Delete old validation results for this document
    const { error: deleteError } = await supabase
      .from('validation_results')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new validation results based on the report
    if (report.results && report.results.length > 0) {
      const resultsToInsert = report.results.map((res) => ({
        document_id: documentId,
        rule_name: res.ruleName,
        field_name: res.fieldName,
        passed: res.passed,
        expected_value: res.expectedValue || null,
        actual_value: typeof res.actualValue === 'string' ? res.actualValue : JSON.stringify(res.actualValue) || null,
        message: res.message,
      }));

      const { error: insertError } = await supabase
        .from('validation_results')
        .insert(resultsToInsert);

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    let newStatus: string = 'validated';
    if (report.status === 'invalid') {
      newStatus = 'rejected';
    } else if (report.status === 'needs_review') {
      newStatus = 'needs_review';
    }

    const { error: updateError } = await supabase
      .from('documents')
      .update({ status: newStatus })
      .eq('id', documentId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(report, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
