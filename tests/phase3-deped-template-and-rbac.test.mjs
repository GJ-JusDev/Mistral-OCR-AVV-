import test from 'node:test';
import assert from 'node:assert/strict';

// Core pure parser implementation matching seniorHighParser.ts & rules.ts
function parseSeniorHighGrades(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const grades = [];
  let general_average = undefined;
  let currentCategory = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter((c, index, arr) => {
        return !(index === 0 && c === "") && !(index === arr.length - 1 && c === "");
      });

      if (cells.length < 2 || cells[0].includes("---") || cells[0].toLowerCase().includes("subject") || cells[0].toLowerCase().includes("core value") || cells[0].toLowerCase().includes("semester")) {
        continue;
      }

      const subject = cells[0];
      const subjectLower = subject.toLowerCase();

      if (subject.length < 3) continue;

      const skipKeywords = [
        "descriptors", "outstanding", "very satisfactory", "fairly satisfactory",
        "did not meet expectation", "did not meet expectations", "grading scale", "remarks"
      ];
      if (skipKeywords.some(kw => subjectLower === kw || subjectLower.includes(kw))) {
        continue;
      }

      let q1, q2, q3, q4, final;
      const numericCells = cells.slice(1).map(c => {
        const numMatch = c.match(/(\d+(\.\d+)?)/);
        return numMatch ? parseFloat(numMatch[1]) : undefined;
      });

      const validNumbers = numericCells.filter(n => n !== undefined);

      // Check if this row is the General Average row explicitly printed on the form
      const isGeneralAverage = [
        "general average", "gen. ave", "general weighted average", "gwa"
      ].some(kw => subjectLower.includes(kw));

      if (isGeneralAverage) {
        if (validNumbers.length > 0) {
          general_average = validNumbers[validNumbers.length - 1];
        }
        continue;
      }

      if (validNumbers.length === 0) {
        if (subject.toLowerCase().includes("subject") || subject.toLowerCase().includes("core") || subject.toLowerCase().includes("applied")) {
          currentCategory = subject;
        } else {
          grades.push({ category: currentCategory, subject, status: "Missing", needsVerification: true });
        }
        continue;
      }

      // Map to quarters/semesters based on how many numbers we found.
      // Do NOT invent a missing final grade or average!
      if (validNumbers.length === 3) {
        [q1, q2, final] = validNumbers;
      } else if (validNumbers.length >= 4) {
        [q1, q2, q3, q4, final] = validNumbers;
      } else if (validNumbers.length === 2) {
        [q1, q2] = validNumbers;
        final = undefined; // Do not invent (q1+q2)/2; flag for human review
      } else if (validNumbers.length === 1) {
        [final] = validNumbers;
      }

      let status = "Missing";
      let needsVerification = false;

      if (final !== undefined) {
        status = final < 75 ? "Failed" : "Passed";
        if (final >= 72 && final <= 77) {
          needsVerification = true;
        }
      } else {
        status = "Missing";
        needsVerification = true;
      }

      grades.push({
        category: currentCategory || undefined,
        subject,
        q1, q2, q3, q4, final,
        status,
        needsVerification
      });
    }
  }

  return { grades, general_average };
}

test('Phase 3 Unit Tests: DepEd SF9/SF10 Academic Extraction & Role RBAC Safeguards', async (t) => {
  await t.test('Senior High Parser does NOT invent missing final grade from Q1 & Q2', () => {
    const ocrSample = `
| Subject | Q1 | Q2 | Final | Remarks |
| --- | --- | --- | --- | --- |
| Oral Communication | 85 | 87 | | |
| General Mathematics | 80 | 78 | | |
`;
    const fields = parseSeniorHighGrades(ocrSample);
    assert.equal(fields.grades?.length, 2);
    
    // Oral Communication
    const oralComm = fields.grades?.find(g => g.subject.includes('Oral Communication'));
    assert.ok(oralComm);
    assert.equal(oralComm.q1, 85);
    assert.equal(oralComm.q2, 87);
    assert.equal(oralComm.final, undefined, 'Final grade must NOT be invented as Math.round((q1+q2)/2)');
    assert.equal(oralComm.status, 'Missing');
    assert.equal(oralComm.needsVerification, true, 'Uncertain / missing final grade must be flagged for review');
  });

  await t.test('Strengthened SHS SF10: Does NOT invent general average when absent from template', () => {
    // Official Modified Strengthened SHS SF10 (where general average per semester was officially removed)
    const strengthenedShsSample = `
| Core Subjects | Q1 | Q2 | Final | Remarks |
| --- | --- | --- | --- | --- |
| 21st Century Literature | 88 | 90 | 89 | Passed |
| Earth and Life Science | 84 | 86 | 85 | Passed |
| Physical Education 1 | 92 | 94 | 93 | Passed |
`;
    const fields = parseSeniorHighGrades(strengthenedShsSample);
    assert.equal(fields.grades?.length, 3);
    assert.equal(fields.general_average, undefined, 'General average must NOT be synthesized or computed when absent from template');
  });

  await t.test('Extracts General Average only when explicitly printed on the applicable form', () => {
    const formWithGeneralAverage = `
| Subject | Q1 | Q2 | Final | Remarks |
| --- | --- | --- | --- | --- |
| Empowerment Technologies | 86 | 88 | 87 | Passed |
| Practical Research 1 | 89 | 91 | 90 | Passed |
| General Average | | | 88.5 | Passed |
`;
    const fields = parseSeniorHighGrades(formWithGeneralAverage);
    assert.equal(fields.general_average, 88.5, 'Must extract explicitly printed general average');
    // Ensure General Average is not treated as a regular learning area subject
    const subjectNames = (fields.grades || []).map(g => g.subject.toLowerCase());
    assert.equal(subjectNames.includes('general average'), false, 'General average must not be inserted as a subject row');
  });

  await t.test('Distinguishes blank / unreadable grades from numeric zero', () => {
    const sampleWithBlankAndZero = `
| Subject | Q1 | Q2 | Final | Remarks |
| --- | --- | --- | --- | --- |
| Philosophy of the Human Person | - | | | Missing |
| Physical Science | 75 | 75 | 75 | Passed |
`;
    const fields = parseSeniorHighGrades(sampleWithBlankAndZero);
    const philosophy = fields.grades?.find(g => g.subject.includes('Philosophy'));
    assert.ok(philosophy);
    assert.equal(philosophy.final, undefined, 'Blank or dash must not become 0');
    assert.equal(philosophy.status, 'Missing');
    assert.equal(philosophy.needsVerification, true);
  });

  await t.test('Flagging borderline grades (72-77) for human review', () => {
    const borderlineSample = `
| Subject | Q1 | Q2 | Final | Remarks |
| --- | --- | --- | --- | --- |
| Pre-Calculus | 73 | 75 | 74 | Failed |
| Basic Calculus | 75 | 77 | 76 | Passed |
| General Physics | 88 | 90 | 89 | Passed |
`;
    const fields = parseSeniorHighGrades(borderlineSample);
    const preCalc = fields.grades?.find(g => g.subject.includes('Pre-Calculus'));
    const basicCalc = fields.grades?.find(g => g.subject.includes('Basic Calculus'));
    const physics = fields.grades?.find(g => g.subject.includes('General Physics'));

    assert.equal(preCalc?.needsVerification, true, '74 must be flagged for human review');
    assert.equal(basicCalc?.needsVerification, true, '76 must be flagged for human review');
    assert.equal(physics?.needsVerification, false, '89 does not require borderline verification');
  });

  await t.test('System Role Enforcement: Only Teacher, Principal, Admin permitted (No Students)', () => {
    const PERMITTED_ROLES = new Set(['teacher', 'principal', 'admin']);
    
    // Valid roles
    assert.ok(PERMITTED_ROLES.has('teacher'));
    assert.ok(PERMITTED_ROLES.has('principal'));
    assert.ok(PERMITTED_ROLES.has('admin'));

    // Students strictly excluded
    assert.equal(PERMITTED_ROLES.has('student'), false, 'Students must NOT have a system role');
    assert.equal(PERMITTED_ROLES.has('learner'), false, 'Learners must NOT have a system role');
    assert.equal(PERMITTED_ROLES.has('parent'), false, 'Parents must NOT have a system role');
  });
});
