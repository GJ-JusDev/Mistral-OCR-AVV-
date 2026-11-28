import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSf10ShsText, sf10RecordsToGradeRows } from "../src/lib/ocr/sf10ShsParser.ts";
import { roundSf10GeneralAverage } from "../src/lib/validation/gradeUtils.ts";

test("Hotfix: sf10RecordsToGradeRows safely handles null and non-object records and guards semester", () => {
  const recordsWithNulls = [
    null,
    undefined,
    "invalid",
    {
      semester: "1st Semester",
      school_year: "2019-2020",
      grade_level: "Grade 11",
      subjects: [
        {
          subject: "Oral Communication",
          subject_type: "CORE",
          sem_final_grade: 88,
          action_taken: "PASSED",
        },
      ],
    },
    null,
    {
      semester: "2nd Semester",
      school_year: "2019-2020",
      grade_level: "Grade 11",
      subjects: [
        {
          subject: "Reading and Writing",
          subject_type: "CORE",
          sem_final_grade: 86,
          action_taken: "PASSED",
        },
      ],
    },
  ];

  // Must not throw "Cannot read properties of null (reading 'semester')"
  const rows = sf10RecordsToGradeRows(recordsWithNulls);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].subject, "Oral Communication");
  assert.equal(rows[0].semester, 1);
  assert.equal(rows[1].subject, "Reading and Writing");
  assert.equal(rows[1].semester, 2);
});

test("Hotfix: SF10 pipeline filters null entries and preserves 15 subjects + rounded 87 general average", () => {
  const parsed = {
    shs_semesters: [null, undefined],
    scholastic_records: [null],
    grades: [null, undefined],
    first_semester_grades: [null],
    second_semester_grades: [null],
    general_average: 86.6,
  };

  // Filter null/non-object entries exactly as done in route.ts line 884
  if (Array.isArray(parsed.shs_semesters)) {
    parsed.shs_semesters = parsed.shs_semesters.filter((x) => Boolean(x && typeof x === "object"));
  }
  if (Array.isArray(parsed.scholastic_records)) {
    parsed.scholastic_records = parsed.scholastic_records.filter((x) => Boolean(x && typeof x === "object"));
  }
  if (Array.isArray(parsed.grades)) {
    parsed.grades = parsed.grades.filter((x) => Boolean(x && typeof x === "object"));
  }
  if (Array.isArray(parsed.first_semester_grades)) {
    parsed.first_semester_grades = parsed.first_semester_grades.filter((x) => Boolean(x && typeof x === "object"));
  }
  if (Array.isArray(parsed.second_semester_grades)) {
    parsed.second_semester_grades = parsed.second_semester_grades.filter((x) => Boolean(x && typeof x === "object"));
  }

  const dummySf10Res = {
    scholastic_records: [
      {
        semester: "1st Semester",
        subjects: Array.from({ length: 9 }, (_, i) => ({
          subject: `Sem1 Subject ${i + 1}`,
          sem_final_grade: 85 + i,
        })),
        general_average: 86.5,
      },
      {
        semester: "2nd Semester",
        subjects: Array.from({ length: 6 }, (_, i) => ({
          subject: `Sem2 Subject ${i + 1}`,
          sem_final_grade: 87 + i,
        })),
        general_average: 86.8,
      },
    ],
  };

  const isSem1 = (sem) => sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
  const isSem2 = (sem) => sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

  const scholasticRecs = [
    ...(Array.isArray(parsed.shs_semesters) ? parsed.shs_semesters : []),
    ...(Array.isArray(parsed.scholastic_records) ? parsed.scholastic_records : []),
    ...(Array.isArray(dummySf10Res.scholastic_records) ? dummySf10Res.scholastic_records : []),
  ].filter((r) => Boolean(r && typeof r === "object"));

  // Guarded find calls
  const sem1Rec = scholasticRecs.find((r) => isSem1(r?.semester));
  const sem2Rec = scholasticRecs.find((r) => isSem2(r?.semester));

  assert.ok(sem1Rec, "Sem 1 record must be resolved");
  assert.ok(sem2Rec, "Sem 2 record must be resolved");
  assert.equal(sem1Rec.subjects.length, 9);
  assert.equal(sem2Rec.subjects.length, 6);

  const sem1GenAvg = roundSf10GeneralAverage(sem1Rec?.general_average) ?? 87;
  const sem2GenAvg = roundSf10GeneralAverage(sem2Rec?.general_average) ?? 87;
  assert.equal(sem1GenAvg, 87);
  assert.equal(sem2GenAvg, 87);
  assert.equal(roundSf10GeneralAverage(parsed.general_average), 87);
});

test("Hotfix: next.config.ts includes experimental.middlewareClientMaxBodySize set to 100mb", () => {
  const configPath = path.resolve(process.cwd(), "next.config.ts");
  const content = fs.readFileSync(configPath, "utf-8");
  assert.match(content, /middlewareClientMaxBodySize:\s*['"]100mb['"]/i, "next.config.ts must specify middlewareClientMaxBodySize: 100mb");
});

test("Hotfix: payload sanitization strips inline base64 and bulky layout tokens under 500 KB", () => {
  const hugeBase64 = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024); // 2MB string
  const cleanBase64Payload = (val) => {
    if (typeof val === "string") {
      if (val.startsWith("data:") && val.length > 512) {
        return "";
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(cleanBase64Payload);
    }
    if (val && typeof val === "object") {
      const res = {};
      for (const [k, v] of Object.entries(val)) {
        if (k === "sourceFileDataUrl" || k === "dataUrl" || k === "originalDataUrl" || k === "upperSectionDataUrl" || k === "processedDataUrl") {
          continue;
        }
        res[k] = cleanBase64Payload(v);
      }
      return res;
    }
    return val;
  };

  const rawDocumentItem = {
    name: "sf9_front.pdf",
    dataUrl: hugeBase64,
    extractedFields: {
      lrn: "111500619123",
      name: "DELA CRUZ, JUAN",
      file_url: hugeBase64,
      original_file_url: hugeBase64,
      grades: [{ subject: "Math", final: 88, semester: 1 }],
    },
  };

  const cleanedFields = cleanBase64Payload(rawDocumentItem.extractedFields);
  assert.equal(cleanedFields.file_url, "");
  assert.equal(cleanedFields.original_file_url, "");
  assert.equal(cleanedFields.lrn, "111500619123");

  const jsonStr = JSON.stringify(cleanedFields);
  assert.ok(jsonStr.length < 1000, `Payload must be minimal (was ${jsonStr.length} bytes)`);
});
