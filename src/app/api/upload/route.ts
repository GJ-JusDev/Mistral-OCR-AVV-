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

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify session
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to upload documents." },
        { status: 401 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let fileBuffer: Buffer;
    let mimeType: string;
    let originalName: string;
    let documentType: string = "sf9";

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
      // JSON with base64 dataUrl
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

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${mimeType}. Allowed formats are JPEG, PNG, WebP, and PDF.`,
        },
        { status: 400 }
      );
    }

    // Validate size limit
    if (fileBuffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size (${(fileBuffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB.`,
        },
        { status: 400 }
      );
    }

    // Generate safe, collision-resistant storage path: {userId}/{docType}/{timestamp}_{uuid}_{filename}
    const safeName = sanitizeFilename(originalName);
    const docFolder = documentType.toLowerCase().replace(/[^a-z0-9]/g, "");
    const storagePath = `${user.id}/${docFolder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;

    // Upload to Supabase Storage bucket 'documents'
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

    // Generate accessible URL for display (signed URL for private bucket, public URL as fallback)
    let displayUrl = "";
    try {
      const { data: signedData } = await supabase.storage
        .from("documents")
        .createSignedUrl(uploadData.path, 86400); // 24 hours
      if (signedData?.signedUrl) {
        displayUrl = signedData.signedUrl;
      }
    } catch {
      // Fallback if signing is not supported
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
