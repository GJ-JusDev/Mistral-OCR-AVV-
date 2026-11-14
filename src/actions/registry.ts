"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { 
  normalizeNamePart, 
  normalizeEmail, 
  deriveMiddleInitial,
  evaluateRegistryMatch 
} from "@/lib/registry/nameMatcher";
import * as XLSX from "xlsx";

const TRIS_SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type AdminAuthResult = 
  | { success: true; user: any; schoolId: string }
  | { success: false; error: string };

async function verifyAdminAuth(): Promise<AdminAuthResult> {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized: Please log in." };

  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status, school_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { success: false, error: "Forbidden: Administrator privileges required." };
  }

  return { success: true, user, schoolId: roleRow.school_id || TRIS_SCHOOL_ID };
}

/**
 * Sanitize strings to prevent CSV/Excel Formula Injection (CSV Injection / CWE-1236)
 */
function sanitizeFormulaInjection(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return "'" + trimmed;
  }
  return trimmed;
}

/**
 * Fetch all teacher registry records with optional filters
 */
export async function getRegistryTeachers(filters?: {
  status?: "all" | "unverified" | "verified" | "inactive";
  search?: string;
}) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }

  const adminClient = getAdminClient();
  let query = adminClient
    .from("school_teacher_registry")
    .select(`
      id,
      school_id,
      first_name,
      middle_initial,
      last_name,
      full_name_original,
      verified_email,
      verification_status,
      is_active,
      linked_user_id,
      verified_by,
      verified_at,
      created_at,
      updated_at
    `)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (filters?.status && filters.status !== "all") {
    if (filters.status === "inactive") {
      query = query.eq("is_active", false);
    } else {
      query = query.eq("is_active", true).eq("verification_status", filters.status);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching teacher registry:", error);
    return { error: error.message };
  }

  let results = data || [];

  if (filters?.search) {
    const q = filters.search.toLowerCase().trim();
    results = results.filter((t) => {
      const full = `${t.first_name} ${t.middle_initial || ""} ${t.last_name}`.toLowerCase();
      const email = (t.verified_email || "").toLowerCase();
      return full.includes(q) || email.includes(q);
    });
  }

  // Also fetch details of linked users if any
  const linkedIds = results.map((r) => r.linked_user_id).filter(Boolean) as string[];
  let linkedUsersMap: Record<string, { email?: string; status?: string }> = {};

  if (linkedIds.length > 0) {
    const { data: usersData } = await adminClient
      .from("user_roles")
      .select("user_id, account_status")
      .in("user_id", linkedIds);

    if (usersData) {
      usersData.forEach((u) => {
        linkedUsersMap[u.user_id] = { status: u.account_status };
      });
    }
  }

  const enriched = results.map((r) => ({
    ...r,
    linkedUserStatus: r.linked_user_id ? linkedUsersMap[r.linked_user_id]?.status : null,
  }));

  return { teachers: enriched };
}

/**
 * Manually add a new teacher to the registry
 */
export async function addRegistryTeacher(payload: {
  firstName: string;
  middleInitial?: string;
  lastName: string;
  verifiedEmail?: string;
  schoolId?: string;
}) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }
  const { user } = authCheck;

  const firstName = sanitizeFormulaInjection(payload.firstName?.trim() || "");
  const lastName = sanitizeFormulaInjection(payload.lastName?.trim() || "");
  const middleInitial = payload.middleInitial?.trim() ? payload.middleInitial.trim().charAt(0).toUpperCase() : null;
  const verifiedEmail = payload.verifiedEmail?.trim() ? payload.verifiedEmail.trim().toLowerCase() : null;
  const schoolId = payload.schoolId || TRIS_SCHOOL_ID;

  if (!firstName || !lastName) {
    return { error: "First Name and Last Name are required." };
  }

  if (verifiedEmail && !/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(verifiedEmail)) {
    return { error: "Email must be a valid personal Gmail address (@gmail.com)." };
  }

  const adminClient = getAdminClient();

  // Check for duplicate in registry for the same school
  const { data: existing } = await adminClient
    .from("school_teacher_registry")
    .select("id, first_name, last_name, middle_initial, verified_email, is_active")
    .eq("school_id", schoolId);

  const normFirst = normalizeNamePart(firstName);
  const normLast = normalizeNamePart(lastName);
  const normMi = middleInitial ? middleInitial.toUpperCase() : null;

  const duplicate = (existing || []).find((e) => {
    const ef = normalizeNamePart(e.first_name);
    const el = normalizeNamePart(e.last_name);
    const emi = e.middle_initial ? e.middle_initial.toUpperCase() : null;
    const sameName = ef === normFirst && el === normLast && emi === normMi;
    const sameEmail = verifiedEmail && e.verified_email && normalizeEmail(e.verified_email) === normalizeEmail(verifiedEmail);
    return sameName || sameEmail;
  });

  if (duplicate) {
    return { 
      error: `A teacher matching this identity already exists in the registry (${duplicate.first_name} ${duplicate.middle_initial || ""} ${duplicate.last_name}${duplicate.is_active ? "" : " [Inactive]"}).` 
    };
  }

  const fullNameOriginal = `${firstName} ${middleInitial ? `${middleInitial}. ` : ""}${lastName}`.trim();

  const insertData = {
    school_id: schoolId,
    first_name: firstName,
    middle_initial: middleInitial,
    last_name: lastName,
    full_name_original: fullNameOriginal,
    verified_email: verifiedEmail,
    verification_status: "unverified",
    is_active: true,
  };

  const { data: inserted, error: insertError } = await adminClient
    .from("school_teacher_registry")
    .insert(insertData)
    .select()
    .single();

  if (insertError) {
    console.error("Failed to add teacher to registry:", insertError);
    return { error: insertError.message };
  }

  // Audit event
  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: "TEACHER_REGISTRY_CREATED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: schoolId,
    targetType: "teacher_registry",
    targetId: inserted.id,
    targetLabel: fullNameOriginal,
    reason: "Administrator added teacher record to official institutional registry",
    details: {
      first_name: firstName,
      middle_initial: middleInitial,
      last_name: lastName,
      verified_email: verifiedEmail,
      verification_status: "unverified",
      is_active: true,
    },
  });

  revalidatePath("/admin/teacher-registry");
  return { success: true, teacher: inserted };
}

/**
 * Edit an existing registry record
 */
export async function updateRegistryTeacher(
  id: string,
  payload: {
    firstName: string;
    middleInitial?: string;
    lastName: string;
    verifiedEmail?: string;
    verificationStatus?: "unverified" | "verified";
  }
) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }
  const { user } = authCheck;

  const adminClient = getAdminClient();

  // Get current record
  const { data: current, error: getErr } = await adminClient
    .from("school_teacher_registry")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (getErr || !current) {
    return { error: "Teacher registry record not found." };
  }

  const firstName = sanitizeFormulaInjection(payload.firstName?.trim() || "");
  const lastName = sanitizeFormulaInjection(payload.lastName?.trim() || "");
  const middleInitial = payload.middleInitial?.trim() ? payload.middleInitial.trim().charAt(0).toUpperCase() : null;
  const verifiedEmail = payload.verifiedEmail?.trim() ? payload.verifiedEmail.trim().toLowerCase() : null;

  if (!firstName || !lastName) {
    return { error: "First Name and Last Name are required." };
  }

  if (verifiedEmail && !/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(verifiedEmail)) {
    return { error: "Email must be a valid personal Gmail address (@gmail.com)." };
  }

  const fullNameOriginal = `${firstName} ${middleInitial ? `${middleInitial}. ` : ""}${lastName}`.trim();

  // Check if identity changed
  const identityChanged = 
    normalizeNamePart(current.first_name) !== normalizeNamePart(firstName) ||
    normalizeNamePart(current.last_name) !== normalizeNamePart(lastName) ||
    (current.middle_initial || null) !== (middleInitial || null);

  // If identity materially changed, reset verification status to unverified unless explicitly verified by admin
  let newVerificationStatus = payload.verificationStatus || current.verification_status;
  let verifiedBy = current.verified_by;
  let verifiedAt = current.verified_at;

  if (identityChanged && !payload.verificationStatus) {
    newVerificationStatus = "unverified";
    verifiedBy = null;
    verifiedAt = null;
  } else if (newVerificationStatus === "verified" && current.verification_status !== "verified") {
    verifiedBy = user.id;
    verifiedAt = new Date().toISOString();
  }

  const updateData: any = {
    first_name: firstName,
    middle_initial: middleInitial,
    last_name: lastName,
    full_name_original: fullNameOriginal,
    verified_email: verifiedEmail,
    verification_status: newVerificationStatus,
    verified_by: verifiedBy,
    verified_at: verifiedAt,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await adminClient
    .from("school_teacher_registry")
    .update(updateData)
    .eq("id", id);

  if (updateError) {
    console.error("Failed to update registry teacher:", updateError);
    return { error: updateError.message };
  }

  // Audit event
  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: "TEACHER_REGISTRY_UPDATED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: current.school_id,
    targetType: "teacher_registry",
    targetId: id,
    targetLabel: fullNameOriginal,
    reason: identityChanged 
      ? "Administrator updated teacher identity fields; verification status reset"
      : "Administrator updated teacher registry details",
    details: {
      previous: {
        first_name: current.first_name,
        middle_initial: current.middle_initial,
        last_name: current.last_name,
        verified_email: current.verified_email,
        verification_status: current.verification_status,
      },
      updated: {
        first_name: firstName,
        middle_initial: middleInitial,
        last_name: lastName,
        verified_email: verifiedEmail,
        verification_status: newVerificationStatus,
      },
      identity_changed: identityChanged,
    },
  });

  revalidatePath("/admin/teacher-registry");
  return { success: true };
}

/**
 * Toggle active status of a registry record (Soft deactivation/activation)
 */
export async function toggleRegistryTeacherActive(id: string, newActiveState: boolean) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }
  const { user } = authCheck;

  const adminClient = getAdminClient();
  const { data: current, error: getErr } = await adminClient
    .from("school_teacher_registry")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (getErr || !current) {
    return { error: "Teacher registry record not found." };
  }

  const { error: updateErr } = await adminClient
    .from("school_teacher_registry")
    .update({ 
      is_active: newActiveState,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (updateErr) {
    return { error: updateErr.message };
  }

  const action = newActiveState ? "TEACHER_REGISTRY_ACTIVATED" : "TEACHER_REGISTRY_DEACTIVATED";

  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: action as any,
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: current.school_id,
    targetType: "teacher_registry",
    targetId: id,
    targetLabel: current.full_name_original,
    reason: newActiveState 
      ? "Administrator reactivated teacher registry record" 
      : "Administrator deactivated teacher registry record (deactivated records cannot match new registrations)",
    details: {
      previous_is_active: current.is_active,
      new_is_active: newActiveState,
    },
  });

  revalidatePath("/admin/teacher-registry");
  return { success: true };
}

/**
 * Verify a teacher registry record (Marks status as 'verified')
 */
export async function verifyRegistryTeacher(id: string) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }
  const { user } = authCheck;

  const adminClient = getAdminClient();
  const { data: current, error: getErr } = await adminClient
    .from("school_teacher_registry")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (getErr || !current) {
    return { error: "Teacher registry record not found." };
  }

  const verifiedAt = new Date().toISOString();

  const { error: updateErr } = await adminClient
    .from("school_teacher_registry")
    .update({
      verification_status: "verified",
      verified_by: user.id,
      verified_at: verifiedAt,
      updated_at: verifiedAt,
    })
    .eq("id", id);

  if (updateErr) {
    return { error: updateErr.message };
  }

  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: "TEACHER_REGISTRY_VERIFIED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: current.school_id,
    targetType: "teacher_registry",
    targetId: id,
    targetLabel: current.full_name_original,
    reason: "Administrator verified teacher registry record",
    details: {
      verified_by: user.id,
      verified_at: verifiedAt,
      previous_status: current.verification_status,
      new_status: "verified",
    },
  });

  revalidatePath("/admin/teacher-registry");
  return { success: true };
}

export interface ImportRowParsed {
  rowNumber: number;
  firstName: string;
  middleInitial: string | null;
  lastName: string;
  verifiedEmail: string | null;
  status: "VALID" | "DUPLICATE_FILE" | "DUPLICATE_DB" | "ERROR";
  reason?: string;
}

export interface ImportPreviewResult {
  filename: string;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: ImportRowParsed[];
}

/**
 * Parse and validate an uploaded Excel or CSV file
 * Supports dry-run preview and actual commit
 */
export async function importTeacherRegistry(
  fileBufferBase64: string,
  filename: string,
  dryRun: boolean = true
) {
  const authCheck = await verifyAdminAuth();
  if (!authCheck.success) {
    return { error: authCheck.error };
  }
  const { user, schoolId } = authCheck;

  // Max size check: 5MB
  const buffer = Buffer.from(fileBufferBase64, "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    return { error: "File exceeds maximum permitted size of 5MB." };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellFormula: false, // Security: Do not evaluate formulas
      cellHTML: false,
    });
  } catch (err: any) {
    return { error: `Failed to read file: ${err.message}` };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { error: "The uploaded file does not contain any sheets." };
  }

  const worksheet = workbook.Sheets[sheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });

  if (rawRows.length < 2) {
    return { error: "File contains no data rows. Expected header row and at least one data row." };
  }

  // Parse header row
  const header = rawRows[0].map((h: any) => String(h || "").trim().toLowerCase());
  const firstNameIdx = header.findIndex((h: string) => h.includes("first") && h.includes("name"));
  const middleInitialIdx = header.findIndex((h: string) => h.includes("middle") || h === "mi" || h === "m.i.");
  const lastNameIdx = header.findIndex((h: string) => h.includes("last") && h.includes("name"));
  const emailIdx = header.findIndex((h: string) => h.includes("email") || h.includes("gmail"));

  if (firstNameIdx === -1 || lastNameIdx === -1) {
    return { 
      error: "Missing required columns. Header must include 'First Name' and 'Last Name'. Optional: 'Middle Initial', 'Gmail'." 
    };
  }

  // Fetch current database records to check DB duplicates
  const adminClient = getAdminClient();
  const { data: dbRecords } = await adminClient
    .from("school_teacher_registry")
    .select("first_name, middle_initial, last_name, verified_email, is_active")
    .eq("school_id", schoolId);

  const seenInFile = new Set<string>();
  const parsedRows: ImportRowParsed[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rowNumber = i + 1;

    // Check if row is completely empty
    if (!row || row.length === 0 || row.every((c: any) => c === null || c === undefined || String(c).trim() === "")) {
      continue;
    }

    const rawFirst = String(row[firstNameIdx] || "").trim();
    const rawMi = middleInitialIdx !== -1 ? String(row[middleInitialIdx] || "").trim() : "";
    const rawLast = String(row[lastNameIdx] || "").trim();
    const rawEmail = emailIdx !== -1 ? String(row[emailIdx] || "").trim() : "";

    const cleanFirst = sanitizeFormulaInjection(rawFirst);
    const cleanLast = sanitizeFormulaInjection(rawLast);
    const cleanMi = rawMi ? sanitizeFormulaInjection(rawMi.replace(/[^a-zA-Z]/g, "")).charAt(0).toUpperCase() : null;
    const cleanEmail = rawEmail ? sanitizeFormulaInjection(rawEmail.toLowerCase()) : null;

    if (!cleanFirst || !cleanLast) {
      parsedRows.push({
        rowNumber,
        firstName: cleanFirst,
        middleInitial: cleanMi,
        lastName: cleanLast,
        verifiedEmail: cleanEmail,
        status: "ERROR",
        reason: "First Name and Last Name are required.",
      });
      continue;
    }

    if (cleanEmail && !/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(cleanEmail)) {
      parsedRows.push({
        rowNumber,
        firstName: cleanFirst,
        middleInitial: cleanMi,
        lastName: cleanLast,
        verifiedEmail: cleanEmail,
        status: "ERROR",
        reason: "Invalid email format. Must be a personal @gmail.com address.",
      });
      continue;
    }

    // Check file duplicate
    const fileKey = `${normalizeNamePart(cleanFirst)}|${cleanMi || ""}|${normalizeNamePart(cleanLast)}`;
    if (seenInFile.has(fileKey)) {
      parsedRows.push({
        rowNumber,
        firstName: cleanFirst,
        middleInitial: cleanMi,
        lastName: cleanLast,
        verifiedEmail: cleanEmail,
        status: "DUPLICATE_FILE",
        reason: "Duplicate entry within the uploaded file.",
      });
      continue;
    }
    seenInFile.add(fileKey);

    // Check DB duplicate
    const isDbDup = (dbRecords || []).some((db) => {
      const dbF = normalizeNamePart(db.first_name);
      const dbL = normalizeNamePart(db.last_name);
      const dbMi = db.middle_initial ? db.middle_initial.toUpperCase() : null;
      const sameName = dbF === normalizeNamePart(cleanFirst) && dbL === normalizeNamePart(cleanLast) && dbMi === cleanMi;
      const sameEmail = cleanEmail && db.verified_email && normalizeEmail(db.verified_email) === normalizeEmail(cleanEmail);
      return sameName || sameEmail;
    });

    if (isDbDup) {
      parsedRows.push({
        rowNumber,
        firstName: cleanFirst,
        middleInitial: cleanMi,
        lastName: cleanLast,
        verifiedEmail: cleanEmail,
        status: "DUPLICATE_DB",
        reason: "A teacher with this name or email already exists in the institutional registry.",
      });
      continue;
    }

    parsedRows.push({
      rowNumber,
      firstName: cleanFirst,
      middleInitial: cleanMi,
      lastName: cleanLast,
      verifiedEmail: cleanEmail,
      status: "VALID",
    });
  }

  const validRows = parsedRows.filter((r) => r.status === "VALID");
  const duplicateRows = parsedRows.filter((r) => r.status === "DUPLICATE_FILE" || r.status === "DUPLICATE_DB");
  const errorRows = parsedRows.filter((r) => r.status === "ERROR");

  const previewResult: ImportPreviewResult = {
    filename,
    totalRows: parsedRows.length,
    validCount: validRows.length,
    duplicateCount: duplicateRows.length,
    errorCount: errorRows.length,
    rows: parsedRows,
  };

  // If dry run, return preview immediately without database mutation
  if (dryRun) {
    return { preview: previewResult };
  }

  // If commit mode, insert valid rows into database
  if (validRows.length === 0) {
    return { error: "No valid rows available to import.", preview: previewResult };
  }

  const insertPayload = validRows.map((r) => ({
    school_id: schoolId,
    first_name: r.firstName,
    middle_initial: r.middleInitial,
    last_name: r.lastName,
    full_name_original: `${r.firstName} ${r.middleInitial ? `${r.middleInitial}. ` : ""}${r.lastName}`.trim(),
    verified_email: r.verifiedEmail,
    verification_status: "unverified",
    is_active: true,
  }));

  const { data: inserted, error: insertError } = await adminClient
    .from("school_teacher_registry")
    .insert(insertPayload)
    .select();

  if (insertError) {
    console.error("Bulk insert failed:", insertError);
    return { error: `Database insertion error: ${insertError.message}` };
  }

  // Audit event
  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: "TEACHER_REGISTRY_IMPORTED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: schoolId,
    targetType: "teacher_registry",
    reason: `Administrator imported ${validRows.length} teacher records via ${filename}`,
    details: {
      filename,
      total_rows: parsedRows.length,
      imported_count: validRows.length,
      duplicates_skipped: duplicateRows.length,
      errors_skipped: errorRows.length,
    },
  });

  revalidatePath("/admin/teacher-registry");
  return { 
    success: true, 
    importedCount: validRows.length, 
    preview: previewResult 
  };
}

/**
 * Generate a downloadable template for teacher bulk import
 * Pre-filled with the 8 initial teacher records as reference examples
 */
export async function generateRegistryTemplate(format: "xlsx" | "csv" = "xlsx") {
  const headers = ["First Name", "Middle Initial", "Last Name", "Gmail"];
  const sampleData = [
    ["Arnold", "A", "Reodique", "arnold.reodique@gmail.com"],
    ["Estrella", "S", "Babael", "estrella.babael@gmail.com"],
    ["Rachel", "C", "Nale", "rachel.nale@gmail.com"],
    ["Wilson", "D", "Rosales", "wilson.rosales@gmail.com"],
    ["Deirek", "", "Alzaga", "deirek.alzaga@gmail.com"],
    ["Charlie", "N", "Rivero", "charlie.rivero@gmail.com"],
    ["Margie", "", "Ajero", "margie.ajero@gmail.com"],
    ["Blessila Theresa", "M", "M", "blessila.theresa@gmail.com"],
  ];

  const sheetData = [headers, ...sampleData];

  if (format === "csv") {
    const csvContent = sheetData
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell || "");
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      )
      .join("\r\n");

    return {
      filename: "TRIS_Teacher_Registry_Template.csv",
      contentType: "text/csv",
      base64: Buffer.from(csvContent, "utf-8").toString("base64"),
    };
  }

  // Excel (.xlsx)
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  // Set column widths
  worksheet["!cols"] = [
    { wch: 20 }, // First Name
    { wch: 15 }, // Middle Initial
    { wch: 20 }, // Last Name
    { wch: 35 }, // Gmail
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Teacher Registry");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

  return {
    filename: "TRIS_Teacher_Registry_Template.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: Buffer.from(buffer).toString("base64"),
  };
}
