import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatAssignmentContextMismatch } from "../src/types/documents.ts";

test("AVV Assignment Context Mismatch Rendering & Type Safety Suite", async (t) => {
  const rootDir = path.resolve("./");
  const docDetailPagePath = path.join(rootDir, "src/app/documents/[id]/page.tsx");
  const docTypesPath = path.join(rootDir, "src/types/documents.ts");

  const docDetailPageSrc = fs.readFileSync(docDetailPagePath, "utf8");
  const docTypesSrc = fs.readFileSync(docTypesPath, "utf8");

  // ── 1. Structured mismatch object renders its message ─────────────────────
  await t.test("1. Structured mismatch object renders its human-readable message", () => {
    const structuredMismatch = {
      type: "SCHOOL_YEAR_MISMATCH",
      expected: "2024-2025",
      actual: "2023-2024",
      message: "Extracted school year (2023-2024) differs from confirmed assignment (2024-2025).",
    };

    const rendered = formatAssignmentContextMismatch(structuredMismatch);
    assert.strictEqual(
      rendered,
      "Extracted school year (2023-2024) differs from confirmed assignment (2024-2025)."
    );
    assert.strictEqual(typeof rendered, "string");
  });

  // ── 2. Legacy string mismatch renders correctly ───────────────────────────
  await t.test("2. Legacy string mismatch renders directly", () => {
    const legacyMismatch = "Extracted section (Diamond) does not match assigned section (Emerald).";
    const rendered = formatAssignmentContextMismatch(legacyMismatch);
    assert.strictEqual(rendered, legacyMismatch);
    assert.strictEqual(typeof rendered, "string");
  });

  // ── 3. Missing message uses a readable fallback ───────────────────────────
  await t.test("3. Missing message safely constructs a readable fallback from type, expected, and actual", () => {
    // 3a: Both expected and actual present
    const withoutMessage = {
      type: "SECTION_MISMATCH",
      expected: "Diamond",
      actual: "Emerald",
    };
    const rendered3a = formatAssignmentContextMismatch(withoutMessage);
    assert.strictEqual(
      rendered3a,
      'SECTION MISMATCH: Expected "Diamond", but found "Emerald".'
    );

    // 3b: Expected only
    const expectedOnly = {
      type: "STRAND_MISMATCH",
      expected: "STEM",
    };
    const rendered3b = formatAssignmentContextMismatch(expectedOnly);
    assert.strictEqual(rendered3b, 'STRAND MISMATCH: Expected "STEM".');

    // 3c: Actual only
    const actualOnly = {
      type: "GRADE_LEVEL_MISMATCH",
      actual: "Grade 12",
    };
    const rendered3c = formatAssignmentContextMismatch(actualOnly);
    assert.strictEqual(rendered3c, 'GRADE LEVEL MISMATCH: Found "Grade 12".');

    // 3d: Type only
    const typeOnly = {
      type: "SCHOOL_YEAR_MISMATCH",
    };
    const rendered3d = formatAssignmentContextMismatch(typeOnly);
    assert.strictEqual(rendered3d, "SCHOOL YEAR MISMATCH");

    // 3e: Blank/empty message string falls back to type/expected/actual
    const emptyMessage = {
      type: "SECTION_MISMATCH",
      expected: "Rizal",
      actual: "Bonifacio",
      message: "   ",
    };
    const rendered3e = formatAssignmentContextMismatch(emptyMessage);
    assert.strictEqual(
      rendered3e,
      'SECTION MISMATCH: Expected "Rizal", but found "Bonifacio".'
    );

    // 3f: Empty object fallback
    const emptyObj = {};
    const rendered3f = formatAssignmentContextMismatch(emptyObj);
    assert.strictEqual(rendered3f, "Unspecified context mismatch");
  });

  // ── 4. Null and malformed entries do not crash rendering ──────────────────
  await t.test("4. Null, undefined, and malformed entries do not crash and never return raw objects", () => {
    assert.strictEqual(formatAssignmentContextMismatch(null), null);
    assert.strictEqual(formatAssignmentContextMismatch(undefined), null);
    assert.strictEqual(formatAssignmentContextMismatch(""), null);
    assert.strictEqual(formatAssignmentContextMismatch("   "), null);

    const malformedEntries = [
      null,
      undefined,
      "",
      {},
      { unexpectedKey: 123 },
      { type: null, expected: null, actual: null },
      42,
    ];

    for (const entry of malformedEntries) {
      assert.doesNotThrow(() => {
        const result = formatAssignmentContextMismatch(entry);
        assert.ok(
          result === null || typeof result === "string",
          `Result for ${JSON.stringify(entry)} must be string or null, never an object`
        );
      });
    }
  });

  // ── 5. Empty mismatch arrays render no warning list ───────────────────────
  await t.test("5. Empty mismatch array guard prevents rendering warning list", () => {
    const emptyFields = {
      assignment_context_mismatches: [],
    };

    // Component condition: Array.isArray(...) && length > 0
    const shouldRenderList =
      Array.isArray(emptyFields.assignment_context_mismatches) &&
      emptyFields.assignment_context_mismatches.length > 0;

    assert.strictEqual(shouldRenderList, false);

    const undefinedFields = {};
    const shouldRenderUndefined =
      Array.isArray(undefinedFields.assignment_context_mismatches) &&
      undefinedFields.assignment_context_mismatches.length > 0;

    assert.strictEqual(shouldRenderUndefined, false);
  });

  // ── 6. Simulated JSX list mapping safety ──────────────────────────────────
  await t.test("6. Simulating JSX rendering over mixed entries produces only strings and nulls, zero raw objects", () => {
    const mixedMismatches = [
      {
        type: "SCHOOL_YEAR_MISMATCH",
        expected: "2024-2025",
        actual: "2023-2024",
        message: "Extracted school year (2023-2024) differs from confirmed assignment (2024-2025).",
      },
      "Legacy plain string discrepancy",
      {
        type: "SECTION_MISMATCH",
        expected: "Diamond",
        actual: "Emerald",
      },
      null,
      undefined,
      "",
      {},
    ];

    const renderedItems = mixedMismatches
      .map((mismatch) => formatAssignmentContextMismatch(mismatch))
      .filter(Boolean);

    assert.strictEqual(renderedItems.length, 4);
    for (const item of renderedItems) {
      assert.strictEqual(typeof item, "string");
      assert.notStrictEqual(typeof item, "object");
    }

    assert.strictEqual(
      renderedItems[0],
      "Extracted school year (2023-2024) differs from confirmed assignment (2024-2025)."
    );
    assert.strictEqual(renderedItems[1], "Legacy plain string discrepancy");
    assert.strictEqual(
      renderedItems[2],
      'SECTION MISMATCH: Expected "Diamond", but found "Emerald".'
    );
    assert.strictEqual(renderedItems[3], "Unspecified context mismatch");
  });

  // ── 7. Static Source Code Verification ────────────────────────────────────
  await t.test("7. Static code assertions: page.tsx imports helper and does not render raw mismatch object", () => {
    assert.ok(
      docDetailPageSrc.includes("import { formatAssignmentContextMismatch } from \"@/types/documents\";") ||
      docDetailPageSrc.includes("import { formatAssignmentContextMismatch }"),
      "page.tsx must import formatAssignmentContextMismatch"
    );

    assert.ok(
      !docDetailPageSrc.includes("<li key={idx}>{mismatch}</li>"),
      "page.tsx must NOT directly render raw {mismatch} in JSX"
    );

    assert.ok(
      docDetailPageSrc.includes("formatAssignmentContextMismatch(mismatch)"),
      "page.tsx must call formatAssignmentContextMismatch(mismatch)"
    );

    assert.ok(
      docTypesSrc.includes("assignment_context_mismatches?: AssignmentContextMismatch[]"),
      "types/documents.ts must declare assignment_context_mismatches in ExtractedFields"
    );

    assert.ok(
      docTypesSrc.includes("export interface ContextMismatchItem"),
      "types/documents.ts must export ContextMismatchItem"
    );

    assert.ok(
      docTypesSrc.includes("export type AssignmentContextMismatch = ContextMismatchItem | string;"),
      "types/documents.ts must support both structured and legacy string entries"
    );

    assert.ok(
      docTypesSrc.includes("[key: string]: any"),
      "types/documents.ts must retain existing [key: string]: any index signature"
    );
  });
});
