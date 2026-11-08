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
