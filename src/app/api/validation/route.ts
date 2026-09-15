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
    const report = validateFields(fields, knownSchools);

    // Delete old validation results for this document
    const { error: deleteError } = await supabase
      .from('validation_results')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new validation results based on the report
    if (report.errors && report.errors.length > 0) {
      const resultsToInsert = report.errors.map((err: any) => ({
        document_id: documentId,
        field_name: err.field,
        issue_type: err.type,
        message: err.message,
      }));

      const { error: insertError } = await supabase
        .from('validation_results')
        .insert(resultsToInsert);

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    // Update document status
    let newStatus = 'valid';
    if (!report.isValid) {
      newStatus = report.needsReview ? 'needs_review' : 'invalid';
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
