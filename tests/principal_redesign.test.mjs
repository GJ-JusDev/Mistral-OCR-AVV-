import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("AVV System — Principal Interface Redesign & Monitoring", () => {
  const rootDir = path.resolve(process.cwd());

  test("Phase 6: Sidebar navigation provides strict Principal isolation", () => {
    const sidebarPath = path.join(rootDir, "src/components/layout/Sidebar.tsx");
    assert.ok(fs.existsSync(sidebarPath), "Sidebar.tsx must exist");
    const content = fs.readFileSync(sidebarPath, "utf-8");

    // Check principalNavigation definition
    assert.ok(content.includes("principalNavigation = ["), "Sidebar must define principalNavigation");
    
    // Check all required 6 navigation items
    assert.ok(content.includes('href: "/"'), "Principal nav must include Dashboard");
    assert.ok(content.includes('href: "/principal/students"'), "Principal nav must include Student Records");
    assert.ok(content.includes('href: "/principal/documents"'), "Principal nav must include Document Summary");
    assert.ok(content.includes('href: "/principal/academic"'), "Principal nav must include Academic Overview");
    assert.ok(content.includes('href: "/reports"'), "Principal nav must include Reports");
    assert.ok(content.includes('href: "/settings"'), "Principal nav must include Settings");

    // Principal nav array must NOT contain teacher/admin actions
    const principalNavBlock = content.slice(
      content.indexOf("const principalNavigation = ["),
      content.indexOf("];", content.indexOf("const principalNavigation = [") + 1)
    );

    assert.ok(!principalNavBlock.includes("/upload"), "Principal nav must NOT contain /upload");
    assert.ok(!principalNavBlock.includes("/review"), "Principal nav must NOT contain /review");
    assert.ok(!principalNavBlock.includes("/admin/users"), "Principal nav must NOT contain /admin/users");

    // Role-based selection
    assert.ok(content.includes('isPrincipal = normalizedRole === "principal"'), "Sidebar must check for principal role");
    assert.ok(content.includes("navigation = principalNavigation"), "Sidebar must assign principalNavigation for Principal");
  });

  test("Phase 6: Middleware route protection blocks Principal from upload/review and protects /principal", () => {
    const middlewarePath = path.join(rootDir, "src/middleware.ts");
    assert.ok(fs.existsSync(middlewarePath), "middleware.ts must exist");
    const content = fs.readFileSync(middlewarePath, "utf-8");

    // Checks /principal protection
    assert.ok(content.includes("pathname.startsWith('/principal')"), "Middleware must check /principal path");
    assert.ok(content.includes("role !== 'principal' && role !== 'admin'"), "Only principal or admin can access /principal");

    // Checks monitoring restriction
    assert.ok(
      content.includes("pathname.startsWith('/upload') || pathname.startsWith('/review')") &&
      content.includes("role === 'principal'"),
      "Middleware must prevent principal from accessing /upload or /review"
    );
  });

  test("Phase 6: Server-side API and Action enforcement for Principal monitoring-only restriction", () => {
    // 1. Upload route restriction
    const uploadRoutePath = path.join(rootDir, "src/app/api/upload/route.ts");
    assert.ok(fs.existsSync(uploadRoutePath), "Upload route.ts must exist");
    const uploadContent = fs.readFileSync(uploadRoutePath, "utf-8");
    assert.ok(
      uploadContent.includes('roleRow?.role?.toLowerCase() === "principal"') &&
      uploadContent.includes("403"),
      "Upload route must reject principal with 403 Forbidden"
    );

    // 2. Validation route restriction
    const validationRoutePath = path.join(rootDir, "src/app/api/validation/route.ts");
    assert.ok(fs.existsSync(validationRoutePath), "Validation route.ts must exist");
    const validationContent = fs.readFileSync(validationRoutePath, "utf-8");
    assert.ok(
      validationContent.includes('roleRow?.role?.toLowerCase() === "principal"') &&
      validationContent.includes("403"),
      "Validation route must reject principal with 403 Forbidden"
    );

    // 3. Review decision restriction
    const reviewActionPath = path.join(rootDir, "src/actions/review.ts");
    assert.ok(fs.existsSync(reviewActionPath), "review.ts action must exist");
    const reviewContent = fs.readFileSync(reviewActionPath, "utf-8");
    assert.ok(
      reviewContent.includes('role === "principal"') &&
      reviewContent.includes("monitoring-only"),
      "submitDocumentReview must reject principal with monitoring-only error"
    );
  });

  test("Phase 2: Principal Dashboard components and statistics actions", () => {
    const principalActionPath = path.join(rootDir, "src/actions/principal.ts");
    const principalDashboardPath = path.join(rootDir, "src/components/principal/PrincipalDashboard.tsx");
    
    assert.ok(fs.existsSync(principalActionPath), "principal.ts action file must exist");
    assert.ok(fs.existsSync(principalDashboardPath), "PrincipalDashboard.tsx must exist");

    const actionContent = fs.readFileSync(principalActionPath, "utf-8");
    const dashboardContent = fs.readFileSync(principalDashboardPath, "utf-8");

    // Verify TRIS institution constants
    assert.ok(actionContent.includes("500169"), "Must use TRIS DepEd School ID 500169");
    assert.ok(actionContent.includes("a0000000-0000-0000-0000-000000000001"), "Must use TRIS institution UUID");

    // Verify Phase 2 metrics
    assert.ok(actionContent.includes("totalStudents"), "Must query total students");
    assert.ok(actionContent.includes("totalDocuments"), "Must query total documents");
    assert.ok(actionContent.includes("grade11Count"), "Must calculate Grade 11 count");
    assert.ok(actionContent.includes("grade12Count"), "Must calculate Grade 12 count");
    assert.ok(actionContent.includes("awaitingReviewCount"), "Must query awaiting review count");
    assert.ok(actionContent.includes("approvedDocumentCount"), "Must query approved document count");
    assert.ok(actionContent.includes("rejectedDocumentCount"), "Must query rejected document count");

    // Verify duplicate scan handling
    assert.ok(actionContent.includes("duplicateScanCount"), "Must track duplicate document scans");

    // Verify dashboard visual elements
    assert.ok(dashboardContent.includes("Total Registered Students"), "Dashboard must display Total Registered Students");
    assert.ok(dashboardContent.includes("Total Scanned Documents"), "Dashboard must display Total Scanned Documents");
    assert.ok(dashboardContent.includes("Duplicate Prevention"), "Dashboard must display Duplicate Prevention card");
    assert.ok(dashboardContent.includes("Old SHS SF9"), "Dashboard must display SF9 count");
    assert.ok(dashboardContent.includes("Old SHS SF10"), "Dashboard must display SF10 count");
    assert.strictEqual(dashboardContent.includes("PSA Birth Cert"), false, "Dashboard must not display PSA count");
  });

  test("Phase 3: Student records directory with details modal and LRN privacy", () => {
    const studentsViewPath = path.join(rootDir, "src/components/principal/PrincipalStudentsView.tsx");
    const studentsPagePath = path.join(rootDir, "src/app/principal/students/page.tsx");

    assert.ok(fs.existsSync(studentsViewPath), "PrincipalStudentsView.tsx must exist");
    assert.ok(fs.existsSync(studentsPagePath), "students/page.tsx must exist");

    const viewContent = fs.readFileSync(studentsViewPath, "utf-8");

    // LRN privacy masking
    assert.ok(viewContent.includes("maskLrn"), "Must implement LRN privacy masking");
    assert.ok(viewContent.includes("showFullLrn"), "Must provide toggle for LRN masking");

    // Document badges
    assert.ok(viewContent.includes("SF9"), "Must display SF9 document availability");
    assert.ok(viewContent.includes("SF10"), "Must display SF10 document availability");
    assert.strictEqual(viewContent.includes("PSA"), false, "Must not display PSA document availability");

    // Details modal
    assert.ok(viewContent.includes("handleOpenDetails"), "Must implement student details modal handler");
    assert.ok(viewContent.includes("Official Student Academic Profile"), "Details modal must render academic profile");
  });

  test("Phase 4: Document monitoring view without OCR upload interfaces", () => {
    const docsViewPath = path.join(rootDir, "src/components/principal/PrincipalDocumentsView.tsx");
    const docsPagePath = path.join(rootDir, "src/app/principal/documents/page.tsx");

    assert.ok(fs.existsSync(docsViewPath), "PrincipalDocumentsView.tsx must exist");
    assert.ok(fs.existsSync(docsPagePath), "documents/page.tsx must exist");

    const viewContent = fs.readFileSync(docsViewPath, "utf-8");

    // Verify no upload dropzone or upload triggers
    assert.ok(!viewContent.includes("<Dropzone"), "Document monitoring must NOT contain upload dropzone");
    assert.ok(!viewContent.includes("input type=\"file\""), "Document monitoring must NOT contain file upload inputs");
    assert.ok(!viewContent.includes("startUpload"), "Document monitoring must NOT contain upload triggers");

    // Verify monitoring filters
    assert.ok(viewContent.includes("docType"), "Must support document type filtering");
    assert.ok(viewContent.includes("missingFlags"), "Must identify incomplete or flagged records");
    assert.ok(viewContent.includes("View Scans"), "Must allow viewing scanned documents");
  });

  test("Phase 5: Academic overview strictly preserves verified grades with zero fabrication", () => {
    const academicViewPath = path.join(rootDir, "src/components/principal/PrincipalAcademicView.tsx");
    const academicPagePath = path.join(rootDir, "src/app/principal/academic/page.tsx");

    assert.ok(fs.existsSync(academicViewPath), "PrincipalAcademicView.tsx must exist");
    assert.ok(fs.existsSync(academicPagePath), "academic/page.tsx must exist");

    const viewContent = fs.readFileSync(academicViewPath, "utf-8");

    // Verify zero grade fabrication policy banner
    assert.ok(viewContent.includes("DepEd Policy Compliance"), "Must include policy compliance notice");
    assert.ok(viewContent.includes("no grades are computed, predicted, or fabricated"), "Must explicitly state no grades are computed or fabricated");

    // Verify metrics and sections
    assert.ok(viewContent.includes("Performance Summary by Section"), "Must display section performance summary");
    assert.ok(viewContent.includes("passingRate"), "Must display passing rates");
    assert.ok(viewContent.includes("Verified Subject Grades"), "Must display verified subject grades");
  });

  test("Phase 6: Reports page provides TRIS-branded CSV exports", () => {
    const reportsPagePath = path.join(rootDir, "src/app/reports/page.tsx");
    const reportsViewPath = path.join(rootDir, "src/components/reports/ReportsView.tsx");

    assert.ok(fs.existsSync(reportsPagePath), "reports/page.tsx must exist");
    assert.ok(fs.existsSync(reportsViewPath), "ReportsView.tsx must exist");

    const viewContent = fs.readFileSync(reportsViewPath, "utf-8");

    // Check CSV exports
    assert.ok(viewContent.includes("handleExportStudents"), "Must support Student Directory CSV export");
    assert.ok(viewContent.includes("handleExportDocuments"), "Must support Document Monitoring CSV export");
    assert.ok(viewContent.includes("handleExportAcademic"), "Must support Academic Standing CSV export");
    assert.ok(viewContent.includes("TAYSAN RESETTLEMENT INTEGRATED SCHOOL"), "Must include TRIS institutional header in CSV");
  });

  test("Root page role dispatch routes Principal to PrincipalDashboard", () => {
    const rootPagePath = path.join(rootDir, "src/app/page.tsx");
    assert.ok(fs.existsSync(rootPagePath), "src/app/page.tsx must exist");

    const content = fs.readFileSync(rootPagePath, "utf-8");
    assert.ok(content.includes('role === "principal"'), "src/app/page.tsx must check for principal role");
    assert.ok(content.includes("<PrincipalDashboard"), "src/app/page.tsx must render PrincipalDashboard for principal role");
    assert.ok(content.includes("StatsGrid"), "src/app/page.tsx must preserve teacher/admin dashboard elements");
  });
});
