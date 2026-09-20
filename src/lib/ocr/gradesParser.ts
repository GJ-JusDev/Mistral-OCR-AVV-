import { ExtractedFields } from "@/types/documents";
import { parseElementaryGradesText } from "./elementaryParser";
import { parseHighSchoolGradesText } from "./highSchoolParser";
import { parseSeniorHighGradesText } from "./seniorHighParser";

export function parseGradesText(text: string, gradeLevel: string = "Senior High School"): ExtractedFields {
  switch (gradeLevel) {
    case "Elementary":
      return parseElementaryGradesText(text);
    case "High School":
      return parseHighSchoolGradesText(text);
    case "Senior High School":
    default:
      return parseSeniorHighGradesText(text);
  }
}
