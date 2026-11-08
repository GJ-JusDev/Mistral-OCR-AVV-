import type { ExtractedFields } from "@/types/documents";
import { parseElementaryGradesText } from "./elementaryParser";
import { parseHighSchoolGradesText } from "./highSchoolParser";
import { parseSeniorHighGradesText } from "./seniorHighParser";
import { parsePsaText } from "./psaParser";

export function parseGradesText(
  text: string,
  gradeLevel: string = "Senior High School",
  rawLayout?: any,
  docType?: string
): ExtractedFields {
  if (
    docType === "birth_cert" ||
    gradeLevel === "PSA" ||
    gradeLevel === "birth_cert" ||
    /\b(?:CERTIFICATE OF LIVE BIRTH|PHILIPPINE STATISTICS AUTHORITY|OFFICE OF THE CIVIL REGISTRAR)\b/i.test(text)
  ) {
    return parsePsaText(text, rawLayout);
  }

  let parsed: ExtractedFields;
  let normalizedLevel: "Elementary" | "High School" | "Senior High School";

  switch (gradeLevel) {
    case "Elementary":
      normalizedLevel = "Elementary";
      parsed = parseElementaryGradesText(text, rawLayout);
      break;
    case "High School":
      normalizedLevel = "High School";
      parsed = parseHighSchoolGradesText(text, rawLayout);
      break;
    case "Grade 11":
    case "Grade 12":
    case "Senior High School":
    default:
      normalizedLevel = "Senior High School";
      parsed = parseSeniorHighGradesText(text, rawLayout);
      break;
  }

  const normalizedDocType = docType?.toLowerCase().trim();
  if (normalizedDocType === "sf10" || normalizedDocType === "sf9") {
    parsed.document_type = normalizedDocType;
  }

  parsed.academic_level = normalizedLevel;
  parsed.selected_grade_level =
    gradeLevel === "Grade 11" || gradeLevel === "Grade 12"
      ? gradeLevel
      : normalizedLevel;
  if (!parsed.grade_level && (gradeLevel === "Grade 11" || gradeLevel === "Grade 12")) {
    parsed.grade_level = gradeLevel;
  }
  if (!parsed.grading_period_scheme) {
    parsed.grading_period_scheme =
      normalizedLevel === "Senior High School" ? "quarterly_semestral" : "quarterly";
  }

  return parsed;
}

