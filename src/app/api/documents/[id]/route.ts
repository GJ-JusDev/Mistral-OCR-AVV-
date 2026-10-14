import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (data?.image_url && !data.image_url.startsWith("data:") && !data.image_url.startsWith("uploaded-")) {
      try {
        let storagePath = "";
        if (data.image_url.includes("/documents/")) {
          storagePath = data.image_url.split("/documents/")[1].split("?")[0];
        } else if (!data.image_url.startsWith("http")) {
          storagePath = data.image_url;
        }

        if (storagePath) {
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 3600); // 1 hour
          if (signed?.signedUrl) {
            data.image_url = signed.signedUrl;
          }
        }
      } catch {
        // Retain original image_url if signing cannot be completed
      }
    }

    return NextResponse.json({ document: data, ...data });
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
