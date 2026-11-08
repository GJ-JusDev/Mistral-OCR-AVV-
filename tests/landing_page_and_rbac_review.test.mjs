import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

test("AVV Landing Page & Multi-Role Access Control Verification Suite", async (t) => {
  const middlewarePath = path.join(rootDir, "src/middleware.ts");
  const middlewareSrc = fs.readFileSync(middlewarePath, "utf-8");

  await t.test("1. Unauthenticated visitors can access public pages ('/', '/landing', '/terms', '/login', '/register')", () => {
    assert.ok(middlewareSrc.includes("isPublicRoute"), "Middleware must define isPublicRoute");
    assert.ok(middlewareSrc.includes("pathname === '/'"), "Root path must be public");
    assert.ok(middlewareSrc.includes("pathname.startsWith('/landing')"), "Landing path must be public");
    assert.ok(middlewareSrc.includes("pathname.startsWith('/terms')"), "Terms path must be public");
    assert.ok(middlewareSrc.includes("isAuthRoute"), "Auth routes must be recognized");
  });

  await t.test("2. Unauthenticated visitors are redirected to /login when attempting protected paths", () => {
    assert.ok(
      middlewareSrc.includes("if (!user && !isPublicRoute)"),
      "Unauthenticated users on non-public routes must be redirected"
    );
    assert.ok(
      middlewareSrc.includes("url.pathname = '/login'"),
      "Redirect destination must be /login"
    );
  });

  await t.test("3. Pending and Declined accounts are blocked from protected operations", () => {
    assert.ok(
      middlewareSrc.includes("if (!isApproved)"),
      "Middleware must enforce account_status === 'Approved' on role-checked routes"
    );
    assert.ok(
      middlewareSrc.includes("pathname.startsWith('/upload')"),
      "Upload route must require approval check"
    );
    assert.ok(
      middlewareSrc.includes("pathname.startsWith('/review')"),
      "Review queue must require approval check"
    );
  });

  await t.test("4. Principal accounts are monitoring-only and strictly isolated from upload/review", () => {
    assert.ok(
      middlewareSrc.includes("role === 'principal'") &&
      middlewareSrc.includes("pathname.startsWith('/upload') || pathname.startsWith('/review')"),
      "Principal must be blocked from upload and review"
    );
  });

  await t.test("5. Root Page checks authoritative approval status before granting dashboard access", () => {
    const pageSrc = fs.readFileSync(path.join(rootDir, "src/app/page.tsx"), "utf-8");
    assert.ok(
      pageSrc.includes('!user || forceLanding'),
      "Root page must render LandingPage when not authenticated or forced"
    );
    assert.ok(
      pageSrc.includes('accountStatus === "Approved"') || pageSrc.includes('isApproved'),
      "Root page must check approval status before displaying Teacher/Principal dashboards"
    );
    assert.ok(
      pageSrc.includes("Account Pending Approval"),
      "Root page must notify unapproved pending users"
    );
    assert.ok(
      pageSrc.includes("Account Declined"),
      "Root page must notify declined users"
    );
  });

  await t.test("6. Official TRIS Logo is imported and rendered with object-contain", () => {
    const navbarSrc = fs.readFileSync(path.join(rootDir, "src/components/landing/LandingNavbar.tsx"), "utf-8");
    const aboutSrc = fs.readFileSync(path.join(rootDir, "src/components/landing/AboutSection.tsx"), "utf-8");
    const footerSrc = fs.readFileSync(path.join(rootDir, "src/components/landing/Footer.tsx"), "utf-8");

    assert.ok(navbarSrc.includes("/images/tris-logo.png"), "Navbar must load exact tris-logo.png");
    assert.ok(navbarSrc.includes("object-contain"), "Navbar logo must use object-contain");

    assert.ok(aboutSrc.includes("/images/tris-logo.png"), "About section must load exact tris-logo.png");
    assert.ok(aboutSrc.includes("object-contain"), "About section logo must use object-contain");

    assert.ok(footerSrc.includes("/images/tris-logo.png"), "Footer must load exact tris-logo.png");
    assert.ok(footerSrc.includes("object-contain"), "Footer logo must use object-contain");
  });

  await t.test("7. Hero Section uses authentic Mayon Volcano landscape with dark gradient overlay", () => {
    const heroSrc = fs.readFileSync(path.join(rootDir, "src/components/landing/HeroSection.tsx"), "utf-8");
    assert.ok(heroSrc.includes("/images/mayon-hero.jpg"), "Hero must load mayon-hero.jpg");
    assert.ok(heroSrc.includes("bg-gradient-to-b"), "Hero must apply dark navy gradient overlay");
    assert.ok(heroSrc.includes("Taysan, Legazpi City, Albay"), "Hero must present exact school location");
    assert.ok(
      heroSrc.includes("Smarter School Form Validation"),
      "Hero must feature recommended heading"
    );
  });

  await t.test("8. How It Works Section implements 4-step DepEd verification pipeline", () => {
    const howSrc = fs.readFileSync(path.join(rootDir, "src/components/landing/HowItWorksSection.tsx"), "utf-8");
    assert.ok(howSrc.includes("Step 1 — Upload School Forms"), "Step 1 present");
    assert.ok(howSrc.includes("Step 2 — AI-Assisted Extraction"), "Step 2 present");
    assert.ok(howSrc.includes("Step 3 — Review & Validate"), "Step 3 present");
    assert.ok(howSrc.includes("Step 4 — School-Level Review"), "Step 4 present");
  });
});
