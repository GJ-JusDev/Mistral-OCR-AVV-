import { ExtractedFields, GradeRecord } from "@/types/documents";
import { parseOcrText } from "./parser";

export function parseGradesText(text: string): ExtractedFields {
  // First, use the regular parser in case there's a name at the top
  const fields = parseOcrText(text); 
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const grades: GradeRecord[] = [];
  const attendance: { label: string; values: string[] }[] = [];

  let currentCategory = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if it's a markdown table row
    if (line.startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter((c, index, arr) => {
        // Filter out empty outer boundaries from split("|")
        return !(index === 0 && c === "") && !(index === arr.length - 1 && c === "");
      });
      
      // Skip headers and separator rows like |---|---|
      if (cells.length < 2 || cells[0].includes("---") || cells[0].toLowerCase().includes("subject") || cells[0].toLowerCase().includes("core value") || cells[0].toLowerCase().includes("semester")) {
        continue;
      }

      // Check if this row is the month header for attendance
      const monthKeywords = ["jun", "jul", "aug", "sept", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may"];
      const hasMonths = cells.some(c => {
        const lower = c.toLowerCase();
        return monthKeywords.some(kw => lower === kw || lower.includes(kw));
      });
      if (hasMonths && cells.length >= 5) {
        // Capture the month headers
        fields.attendance_months = cells.filter(c => c.length > 0 && c !== "-");
        continue;
      }

      // First cell is usually the subject name or category
      const subject = cells[0];
      const subjectLower = subject.toLowerCase();
      
      // If the subject is very short skip it
      if (subject.length < 3) {
        continue;
      }

      // Check if it's an attendance row
      const isAttendance = [
        "no. of school days",
        "no. of days",
        "days present",
        "days absent",
        "attendance"
      ].some(kw => subjectLower.includes(kw));

      if (isAttendance) {
        // Grab the row values without filtering out empty ones to maintain column alignment
        const values = cells.slice(1).map(c => c.replace(/[^\d]/g, ''));
        if (values.some(v => v !== "")) {
          attendance.push({
            label: subject,
            values: values
          });
        }
        continue;
      }

      // Skip grading scale / legend table rows
      const skipKeywords = [
        "descriptors",
        "outstanding",
        "very satisfactory",
        "fairly satisfactory",
        "did not meet expectation",
        "did not meet expectations",
        "grading scale",
        "remarks",
        "jun", "jul", "aug", "sept", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "total"
      ];
      if (skipKeywords.some(kw => subjectLower === kw || subjectLower.includes(kw)) || subjectLower === "satisfactory") {
        continue;
      }

      // Try to parse grades from subsequent cells
      let q1, q2, q3, q4, final;
      const numericCells = cells.slice(1).map(c => {
        // Strip out non-numeric characters except decimal points
        const numMatch = c.match(/(\d+(\.\d+)?)/);
        return numMatch ? parseFloat(numMatch[1]) : undefined;
      });

      // Filter to only actual numbers
      const validNumbers = numericCells.filter(n => n !== undefined) as number[];
      
      if (validNumbers.length === 0) {
        // If there are no numbers at all, it's highly likely a category header (e.g., "Core Subjects")
        // or a subject with completely blank grades. We'll treat it as a category if it has "subject" 
        // in the name or if it's placed where a category usually is.
        if (subject.toLowerCase().includes("subject") || subject.toLowerCase().includes("core") || subject.toLowerCase().includes("applied")) {
          currentCategory = subject;
        } else {
          grades.push({ category: currentCategory, subject, status: "Missing" });
        }
        continue;
      }

      // Map to quarters/semesters based on how many numbers we found
      // DepEd SF9 usually has Q1, Q2, Final for Senior High (Semester-based)
      // Or Q1, Q2, Q3, Q4, Final for Junior High (Year-based)
      if (validNumbers.length === 3) {
        [q1, q2, final] = validNumbers;
      } else if (validNumbers.length >= 4) {
        [q1, q2, q3, q4, final] = validNumbers;
      } else if (validNumbers.length === 2) {
        [q1, q2] = validNumbers;
        final = Math.round((q1 + q2) / 2);
      } else if (validNumbers.length === 1) {
        [final] = validNumbers;
      }

      // Evaluate status based on final (or lowest available if final missing)
      const gradeToCheck = final || validNumbers[validNumbers.length - 1];
      let status: "Passed" | "Failed" | "Missing" = "Missing";
      let needsVerification = false;
      
      if (gradeToCheck !== undefined) {
        // Requirements: 74-0 is failing, 75+ is passed
        status = gradeToCheck < 75 ? "Failed" : "Passed";
        
        // Flag borderline grades for manual verification
        if (gradeToCheck >= 72 && gradeToCheck <= 77) {
          needsVerification = true;
        }
      }

      grades.push({
        category: currentCategory || undefined,
        subject,
        q1,
        q2,
        q3,
        q4,
        final,
        status,
        needsVerification
      });
    }
  }

  if (grades.length > 0) {
    fields.grades = grades;
  }
  if (attendance.length > 0) {
    fields.attendance = attendance;
  }
  return fields;
}
