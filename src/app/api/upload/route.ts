import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * DOCUMENT UPLOAD API ROUTE
 *
 * Dito dumadaan ang lahat ng uploaded scanned documents (SF9, SF10, PSA Birth Certificate).
 *
 * Bakit may mga security at storage checks dito:
 * 1. Authentication Check - Sinisigurong naka-log in ang nag-a-upload.
 * 2. Role-Based Access Control (RBAC) - Ang Teachers lamang ang may upload privilege.
 *    Ang Principal account ay "monitoring-only" para sa executive review at hindi pwedeng mag-upload.
 * 3. File Validation - Limitado sa safe images/PDF at maximum 10MB para maiwasan ang server overload.
 * 4. Private Storage & Signed URLs - Sine-save ang complete original file sa private Supabase Storage
 *    para protektado ang privacy ng estudyante, at nagbibigay ng pansamantalang signed URL para matingnan.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 1. Verify user session: anonymous requests are strictly rejected
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to upload documents." },
        { status: 401 }
      );
    }

    // 2. RBAC check: School Head / Principal accounts are restricted to monitoring only
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is pending administrator approval." },
        { status: 403 }
      );
    }

    // Hindi pinapayagang mag-upload ang Principal para maiwasan ang conflict of interest sa pag-apruba
    if (roleRow?.role?.toLowerCase() === "principal") {
      return NextResponse.json(
        { error: "Forbidden: Principal role is monitoring-only and cannot upload documents." },
        { status: 403 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let fileBuffer: Buffer;
    let mimeType: string;
    let originalName: string;
    let documentType: string = "sf9";

    // 3. Tanggapin ang file galing sa standard FormData (drag-and-drop o camera upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      documentType = (formData.get("documentType") as string) || "sf9";

      if (!file) {
        return NextResponse.json(
          { error: "No file provided in form data." },
          { status: 400 }
        );
      }

      mimeType = file.type || "image/jpeg";
      originalName = file.name || "document.jpg";
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } else {
      // O kaya'y base64 JSON payload mula sa client-side canvas capture
      const body = await request.json();
      const { dataUrl, filename, docType } = body;

      if (!dataUrl || typeof dataUrl !== "string") {
        return NextResponse.json(
          { error: "A valid base64 dataUrl is required." },
          { status: 400 }
        );
      }

      const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        return NextResponse.json(
          { error: "Invalid data URL format." },
          { status: 400 }
        );
      }

      mimeType = match[1];
      originalName = filename || "document.jpg";
      if (docType) documentType = docType;
      fileBuffer = Buffer.from(match[2], "base64");
    }

    // 4. Validate MIME type: tanging valid images at PDF lang ang tinatanggap
    if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${mimeType}. Allowed formats are JPEG, PNG, WebP, and PDF.`,
        },
        { status: 400 }
      );
    }

    // 5. Validate file size: maximum 10MB para maprotektahan ang server memory
    if (fileBuffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size (${(fileBuffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB.`,
        },
        { status: 400 }
      );
    }

    // 6. Collision-Resistant Storage Path
    // Format: {userId}/{docType}/{timestamp}_{uuid}_{filename}
    // Bakit ganito: Kahit mag-upload ang dalawang guro ng file na may parehong pangalan (hal. "scan.jpg"),
    // hindi kailanman mag-o-overwrite ang mga file dahil unique ang bawat path.
    const safeName = sanitizeFilename(originalName);
    const docFolder = documentType.toLowerCase().replace(/[^a-z0-9]/g, "");
    const storagePath = `${user.id}/${docFolder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;

    // 7. I-upload ang kumpletong original file sa private Supabase Storage bucket 'documents'
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload] Supabase Storage upload failed:", uploadError);
      return NextResponse.json(
        {
          error: `Failed to store file in Supabase Storage: ${uploadError.message}`,
          storagePath,
        },
        { status: 502 }
      );
    }

    // 8. Generate accessible Signed URL para sa preview
    // Dahil private ang bucket para sa data privacy ng estudyante,
    // gumagawa tayo ng pansamantalang 24-hour signed URL para ma-display ito sa review screen.
    let displayUrl = "";
    try {
      const { data: signedData } = await supabase.storage
        .from("documents")
        .createSignedUrl(uploadData.path, 86400); // 24 hours
      if (signedData?.signedUrl) {
        displayUrl = signedData.signedUrl;
      }
    } catch {
      // Fallback kung sakaling hindi available ang URL signing
    }

    if (!displayUrl) {
      const { data: publicUrlData } = supabase.storage
        .from("documents")
        .getPublicUrl(uploadData.path);
      displayUrl = publicUrlData.publicUrl;
    }

    return NextResponse.json({
      success: true,
      storagePath: uploadData.path,
      url: displayUrl,
      originalFilename: originalName,
      fileSize: fileBuffer.length,
      mimeType,
    });
  } catch (error: any) {
    console.error("[upload] Unexpected error during file upload:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error during upload." },
      { status: 500 }
    );
  }
}
