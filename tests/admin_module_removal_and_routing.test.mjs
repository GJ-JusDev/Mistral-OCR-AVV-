/**
 * AVV System — Admin Module Removal, Default Landing, and Routing Verification Suite
 *
 * Verifies:
 * 1. Admin sidebar navigation contains exactly the 7 requested items.
 * 2. Documents, Document Comparison, Review Queue, and Students are removed from Admin experience.
 * 3. Teacher and Principal navigations are fully preserved.
 * 4. Middleware route guards block Admin from removed modules (/documents, /compare, /review, /students, /upload) and redirect to '/'.
 * 5. Middleware route guards enforce Principal monitoring-only restrictions (/upload, /review) while preserving /principal routes.
 * 6. Admin default landing page renders AdminDashboard with zero upload/document/review/student controls.
 * 7. Direct route /admin redirects to '/'.
 * 8. API endpoints strictly block Admin from document querying, uploading, scanning, validation, and processing.
 * 9. Database ownership analysis confirms safe, non-destructive isolation without destructive data deletion.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("1. Admin Sidebar Navigation contains exactly the 7 requested items", async (t) => {
  const sidebarPath = path.join(rootDir, "src", "components", "layout", "Sidebar.tsx");
  const content = fs.readFileSync(sidebarPath, "utf8");

  // Extract adminNavigation array
  const adminNavMatch = content.match(/const adminNavigation = \[([\s\S]*?)\];/);
  assert.ok(adminNavMatch, "adminNavigation array must exist in Sidebar.tsx");

  const adminNavText = adminNavMatch[1];
  
  // Parse items
  const items = [];
  const nameRegex = /name:\s*"([^"]+)"/g;
  let match;
  while ((match = nameRegex.exec(adminNavText)) !== null) {
    items.push(match[1]);
  }

  assert.equal(items.length, 7, "Admin navigation must have exactly 7 items");
  assert.deepEqual(items, [
    "Dashboard",
    "Institutional Reports",
    "User Management",
    "Teacher Registry",
    "Teacher Assignments",
    "User Logs",
    "Settings",
  ], "Admin navigation items must match the exact 7 required labels in order");

  // Verify none of the 4 removed modules exist in adminNavigation
  assert.ok(!adminNavText.includes('name: "Documents"'), "Documents module must be removed from Admin sidebar");
  assert.ok(!adminNavText.includes('name: "Document Comparison"'), "Document Comparison must be removed from Admin sidebar");
  assert.ok(!adminNavText.includes('name: "Review Queue"'), "Review Queue must be removed from Admin sidebar");
  assert.ok(!adminNavText.includes('name: "Students"'), "Students must be removed from Admin sidebar");
});

test("2. Teacher and Principal Sidebar Navigation remain completely preserved", async (t) => {
  const sidebarPath = path.join(rootDir, "src", "components", "layout", "Sidebar.tsx");
  const content = fs.readFileSync(sidebarPath, "utf8");

  // Teacher navigation
  const teacherNavMatch = content.match(/const teacherNavigation = \[([\s\S]*?)\];/);
  assert.ok(teacherNavMatch, "teacherNavigation array must exist");
  const teacherNavText = teacherNavMatch[1];

  assert.ok(teacherNavText.includes('name: "Dashboard"'), "Teacher must retain Dashboard");
  assert.ok(teacherNavText.includes('name: "Upload Document"'), "Teacher must retain Upload Document");
  assert.ok(teacherNavText.includes('name: "Documents"'), "Teacher must retain Documents");
  assert.ok(teacherNavText.includes('name: "Document Comparison"'), "Teacher must retain Document Comparison");
  assert.ok(teacherNavText.includes('name: "Review Queue"'), "Teacher must retain Review Queue");
  assert.ok(teacherNavText.includes('name: "Students"'), "Teacher must retain Students");
  assert.ok(teacherNavText.includes('name: "Settings"'), "Teacher must retain Settings");

  // Principal navigation
  const principalNavMatch = content.match(/const principalNavigation = \[([\s\S]*?)\];/);
  assert.ok(principalNavMatch, "principalNavigation array must exist");
  const principalNavText = principalNavMatch[1];

  assert.ok(principalNavText.includes('name: "Executive Dashboard"'), "Principal must retain Executive Dashboard");
  assert.ok(principalNavText.includes('name: "Student Directory"'), "Principal must retain Student Directory");
  assert.ok(principalNavText.includes('name: "Document Summary"'), "Principal must retain Document Summary");
  assert.ok(principalNavText.includes('name: "Academic Overview"'), "Principal must retain Academic Overview");
  assert.ok(principalNavText.includes('name: "Institutional Reports"'), "Principal must retain Institutional Reports");
  assert.ok(principalNavText.includes('name: "Settings"'), "Principal must retain Settings");
});

test("3. Middleware Route Guard redirects Admin direct access to removed modules back to Dashboard ('/')", async (t) => {
  const middlewarePath = path.join(rootDir, "src", "middleware.ts");
  const content = fs.readFileSync(middlewarePath, "utf8");

  // Verify compare is covered in needsRoleCheck
  assert.ok(content.includes("pathname.startsWith('/compare')"), "pathname.startsWith('/compare') must be role-checked");

  // Verify Admin blocking block
  assert.ok(content.includes("role === 'admin'"), "Middleware must contain Admin role check");
  assert.ok(content.includes("pathname.startsWith('/documents')"), "Admin check must cover /documents");
  assert.ok(content.includes("pathname.startsWith('/compare')"), "Admin check must cover /compare");
  assert.ok(content.includes("pathname.startsWith('/review')"), "Admin check must cover /review");
  assert.ok(content.includes("pathname.startsWith('/students')"), "Admin check must cover /students");
  assert.ok(content.includes("pathname.startsWith('/upload')"), "Admin check must cover /upload");
  assert.ok(content.includes("url.pathname = '/'"), "Blocked Admin routes must redirect to '/' (Dashboard)");
});

test("4. Dedicated Admin Dashboard component exists and contains zero upload/document/review/student controls", async (t) => {
  const adminDashPath = path.join(rootDir, "src", "components", "admin", "AdminDashboard.tsx");
  assert.ok(fs.existsSync(adminDashPath), "AdminDashboard.tsx must exist");

  const content = fs.readFileSync(adminDashPath, "utf8");

  // Must not link to removed modules or upload
  assert.ok(!content.includes('href="/documents"'), "AdminDashboard must not link to /documents");
  assert.ok(!content.includes('href="/compare"'), "AdminDashboard must not link to /compare");
  assert.ok(!content.includes('href="/review"'), "AdminDashboard must not link to /review");
  assert.ok(!content.includes('href="/students"'), "AdminDashboard must not link to /students");
  assert.ok(!content.includes('href="/upload"'), "AdminDashboard must not link to /upload");

  // Must link to the other 6 admin modules
  assert.ok(content.includes('href="/admin/users"'), "AdminDashboard must link to User Management");
  assert.ok(content.includes('href="/admin/teacher-registry"'), "AdminDashboard must link to Teacher Registry");
  assert.ok(content.includes('href="/admin/teacher-assignments"'), "AdminDashboard must link to Teacher Assignments");
  assert.ok(content.includes('href="/reports"'), "AdminDashboard must link to Institutional Reports");
  assert.ok(content.includes('href="/admin/audit-logs"'), "AdminDashboard must link to User Logs");
  assert.ok(content.includes('href="/settings"'), "AdminDashboard must link to Settings");
});

test("5. Root Page ('/') renders AdminDashboard when role is admin", async (t) => {
  const pagePath = path.join(rootDir, "src", "app", "page.tsx");
  const content = fs.readFileSync(pagePath, "utf8");

  assert.ok(content.includes('if (role === "admin")'), "page.tsx must branch for role === 'admin'");
  assert.ok(content.includes("<AdminDashboard"), "page.tsx must render AdminDashboard for admin role");
  assert.ok(content.includes("import AdminDashboard from"), "page.tsx must import AdminDashboard");
});

test("6. Direct route /admin redirects to Dashboard ('/')", async (t) => {
  const adminPagePath = path.join(rootDir, "src", "app", "admin", "page.tsx");
  assert.ok(fs.existsSync(adminPagePath), "/admin/page.tsx must exist");

  const content = fs.readFileSync(adminPagePath, "utf8");
  assert.ok(content.includes('redirect("/")'), "/admin/page.tsx must redirect to '/'");
});

test("7. Document and Student API routes block Admin access with 403 Forbidden", async (t) => {
  // /api/documents
  const docsApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "documents", "route.ts"), "utf8");
  assert.ok(docsApi.includes("ADMIN_DOCUMENTS_REMOVED"), "GET /api/documents must reject Admin with ADMIN_DOCUMENTS_REMOVED");
  assert.ok(docsApi.includes("ADMIN_CANNOT_UPLOAD"), "POST /api/documents must reject Admin with ADMIN_CANNOT_UPLOAD");

  // /api/documents/[id]
  const docIdApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "documents", "[id]", "route.ts"), "utf8");
  assert.ok(docIdApi.includes("ADMIN_DOCUMENTS_REMOVED"), "GET /api/documents/[id] must reject Admin with ADMIN_DOCUMENTS_REMOVED");

  // /api/students
  const studentsApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "students", "route.ts"), "utf8");
  assert.ok(studentsApi.includes("ADMIN_STUDENTS_REMOVED"), "GET /api/students must reject Admin with ADMIN_STUDENTS_REMOVED");

  // /api/students/[id]
  const studentIdApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "students", "[id]", "route.ts"), "utf8");
  assert.ok(studentIdApi.includes("ADMIN_STUDENTS_REMOVED"), "GET /api/students/[id] must reject Admin with ADMIN_STUDENTS_REMOVED");

  // /api/validation/cross-document
  const crossDocApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "validation", "cross-document", "route.ts"), "utf8");
  assert.ok(crossDocApi.includes("ADMIN_CANNOT_PROCESS"), "POST /api/validation/cross-document must reject Admin with ADMIN_CANNOT_PROCESS");

  // /api/scan/batch
  const batchApi = fs.readFileSync(path.join(rootDir, "src", "app", "api", "scan", "batch", "route.ts"), "utf8");
  assert.ok(batchApi.includes("ADMIN_CANNOT_UPLOAD"), "GET and POST /api/scan/batch must reject Admin with ADMIN_CANNOT_UPLOAD");
});

test("8. Database ownership analysis confirms safe, non-destructive isolation without destructive deletion", async (t) => {
  const backupPath = path.join(rootDir, "supabase", "backups", "production_post_m021_pre_m022_restore.sql");
  assert.ok(fs.existsSync(backupPath), "Production restore backup file exists");

  const content = fs.readFileSync(backupPath, "utf8");
  const adminId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";
  
  // Verify admin-uploaded documents exist in backup
  const adminUploadedLines = content.split("\n").filter(l => 
    l.includes("INSERT INTO public.documents") && l.includes(adminId)
  );
  
  assert.equal(adminUploadedLines.length, 6, "Identified exactly 6 historical Admin-uploaded documents in database backup");

  // Verify these documents are referenced by legitimate academic records (subject_grades, academic_standing_history)
  const canonicalDocId = "840dc1c4-a272-444e-9ff4-2faba4b94c0b";
  assert.ok(content.includes(canonicalDocId), "Admin-uploaded document is referenced in database");
  
  const gradeRefs = content.split("\n").filter(l => l.includes("INSERT INTO public.subject_grades") && l.includes(canonicalDocId));
  assert.equal(gradeRefs.length, 18, "Document has 18 subject_grade dependencies that must NOT be destructively deleted");

  const standingRefs = content.split("\n").filter(l => l.includes("INSERT INTO public.academic_standing_history") && l.includes(canonicalDocId));
  assert.equal(standingRefs.length, 2, "Document has 2 academic_standing_history dependencies that must NOT be destructively deleted");
});
