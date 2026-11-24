/**
 * SHS MULTI-LEARNER ROSTER INGESTION PIPELINE
 *
 * Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
 * Scope: Exclusively Senior High School (Grades 11 & 12)
 *
 * Processes multi-learner official DepEd SHS rosters:
 *   - SHS SF1 (School Register) -> public.sf1_roster_entries
 *   - SHS SF2 (Daily Attendance Report) -> public.sf2_attendance_entries
 *   - SHS SF5 (SF5A/SF5B Promotion & Proficiency) -> public.sf5_promotion_entries
 *
 * Features:
 *   - Matches learners against existing students by 12-digit LRN + Name
 *   - Identifies Case C LRN Collisions and quarantines them into public.student_identity_conflicts (M022)
 *   - Stages unverified learners as candidates for registrar verification
 *   - Records fine-grained bounding-box coordinate traces into public.field_extraction_traces (M024)
 *   - Universal support for both Supabase PostgREST client and raw SQL / PGlite runner
 */

import { parseShsSf1 } from "@/lib/ocr/shsSf1Parser";
import { parseShsSf2 } from "@/lib/ocr/shsSf2Parser";
import { parseShsSf5 } from "@/lib/ocr/shsSf5Parser";
import { verifyStudentCollision } from "@/lib/validation/studentMatcher";
import { isValidLrn, normalizeSex } from "@/lib/validation/patterns";
import { normalizeGradeLevelKey } from "@/lib/teacher/assignments";

export interface IngestRosterParams {
  db: any; // SupabaseClient or PGlite instance
  documentId: string;
  schoolId: string;
  documentType: "sf1" | "sf2" | "sf5";
  extractedText: string;
  extractedFields?: any;
  azureTables?: any[];
  ocrProvider?: "azure" | "mistral" | "manual";
  ocrConfidence?: number;
  isStaging?: boolean;
  verifiedContext?: {
    schoolYear?: string;
    gradeLevel?: string;
    section?: string;
  };
}

export interface IngestRosterResult {
  success: boolean;
  documentId: string;
  documentType: "sf1" | "sf2" | "sf5";
  totalLearners: number;
  matchedCount: number;
  newCandidatesCount: number;
  conflictCount: number;
  flaggedCount: number;
  warnings: string[];
  error?: string;
}

export async function ingestRosterDocument(params: IngestRosterParams): Promise<IngestRosterResult> {
  const {
    db,
    documentId,
    schoolId,
    documentType,
    extractedText,
    azureTables,
    ocrProvider = "azure",
    ocrConfidence = 0.95,
    isStaging = false,
    verifiedContext,
  } = params;

  const warnings: string[] = [];
  let matchedCount = 0;
  let newCandidatesCount = 0;
  let conflictCount = 0;
  let flaggedCount = 0;
  let totalLearners = 0;

  const isPostgrest = typeof db?.from === "function" && typeof db?.query !== "function";

  const updateDoc = async (id: string, updates: Record<string, any>) => {
    if (isPostgrest) {
      // Inspect existing document routing fields so verified assignment fields are NEVER overwritten
      const { data: currentDoc, error: readErr } = await db
        .from("documents")
        .select("school_year, grade_level, section, status, extracted_fields")
        .eq("id", id)
        .maybeSingle();
      if (readErr) {
        throw new Error(`Failed to read document ${id} before metadata update: ${readErr.message}`);
      }

      const isStagingDoc =
        isStaging ||
        Boolean(currentDoc?.extracted_fields && (currentDoc.extracted_fields as any).is_retry_staging === true);

      const safeUpdates: Record<string, any> = {};
      if (updates.track !== undefined) safeUpdates.track = updates.track;
      if (updates.strand !== undefined) safeUpdates.strand = updates.strand;
      if (updates.semester !== undefined) safeUpdates.semester = updates.semester;
      if (updates.reporting_month !== undefined) safeUpdates.reporting_month = updates.reporting_month;

      // Preserve verified assignment routing fields if already set on the document
      if (!currentDoc?.school_year && updates.school_year) safeUpdates.school_year = updates.school_year;
      if (!currentDoc?.grade_level && updates.grade_level) safeUpdates.grade_level = updates.grade_level;
      if (!currentDoc?.section && updates.section) safeUpdates.section = updates.section;

      if (!isStagingDoc) {
        safeUpdates.status = "needs_review";
      }
      safeUpdates.student_id = null;

      const { error: updErr } = await db.from("documents").update(safeUpdates).eq("id", id);
      if (updErr) {
        throw new Error(`Failed to update document metadata for ${id}: ${updErr.message}`);
      }
    } else {
      await db.query(`
        UPDATE public.documents
        SET school_year = COALESCE(NULLIF(BTRIM(school_year), ''), $1),
            grade_level = COALESCE(NULLIF(BTRIM(grade_level), ''), $2),
            section = COALESCE(NULLIF(BTRIM(section), ''), $3),
            track = COALESCE($4, track),
            strand = COALESCE($5, strand),
            semester = COALESCE($6, semester),
            reporting_month = COALESCE($7, reporting_month),
            status = CASE
              WHEN $9::boolean = true OR COALESCE((extracted_fields->>'is_retry_staging')::boolean, false) = true THEN status
              ELSE 'needs_review'
            END,
            student_id = NULL
        WHERE id = $8;
      `, [
        updates.school_year || null,
        updates.grade_level || null,
        updates.section || null,
        updates.track || null,
        updates.strand || null,
        updates.semester || null,
        updates.reporting_month || null,
        id,
        Boolean(isStaging),
      ]);
    }
  };

  const lookupStudent = async (lrn: string, sId: string): Promise<any[]> => {
    if (isPostgrest) {
      const { data, error } = await db
        .from("students")
        .select("id, first_name, last_name, lrn")
        .eq("lrn", lrn)
        .eq("school_id", sId)
        .limit(1);
      if (error) {
        throw new Error(`Failed to lookup student LRN ${lrn}: ${error.message}`);
      }
      return data || [];
    } else {
      const res = await db.query(`
        SELECT id, first_name, last_name, lrn
        FROM public.students
        WHERE lrn = $1 AND school_id = $2
        LIMIT 1;
      `, [lrn, sId]);
      return res.rows;
    }
  };

  const insertConflict = async (conflict: Record<string, any>) => {
    if (isPostgrest) {
      const { error } = await db.from("student_identity_conflicts").insert(conflict);
      if (error) {
        throw new Error(`Failed to insert student identity conflict: ${error.message}`);
      }
    } else {
      await db.query(`
        INSERT INTO public.student_identity_conflicts (
          school_id, existing_student_id, document_id,
          conflict_type, extracted_lrn, extracted_name,
          extracted_context, expected_context, status
        ) VALUES ($1, $2, $3, 'SAME_LRN_CONFLICT_NAME', $4, $5, $6::jsonb, $7::jsonb, 'pending');
      `, [
        conflict.school_id,
        conflict.existing_student_id,
        conflict.document_id,
        conflict.extracted_lrn,
        conflict.extracted_name,
        JSON.stringify(conflict.extracted_context),
        JSON.stringify(conflict.expected_context),
      ]);
    }
  };

  const insertSf1 = async (entry: Record<string, any>): Promise<string | null> => {
    if (isPostgrest) {
      const { data, error } = await db.from("sf1_roster_entries").insert(entry).select("id").single();
      if (error) {
        throw new Error(`Failed to insert SF1 roster entry: ${error.message}`);
      }
      return data?.id || null;
    } else {
      const res = await db.query(`
        INSERT INTO public.sf1_roster_entries (
          document_id, student_id, school_id, school_year, grade_level, section,
          track, strand, semester, lrn, last_name, first_name, middle_name, suffix,
          sex, birth_date, age, religion, remarks_indicator, row_index, page_number,
          ocr_confidence, review_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        ) RETURNING id;
      `, [
        entry.document_id,
        entry.student_id,
        entry.school_id,
        entry.school_year,
        entry.grade_level,
        entry.section,
        entry.track,
        entry.strand,
        entry.semester,
        entry.lrn,
        entry.last_name,
        entry.first_name,
        entry.middle_name,
        entry.suffix,
        entry.sex,
        entry.birth_date,
        entry.age,
        entry.religion,
        entry.remarks_indicator,
        entry.row_index,
        entry.page_number,
        entry.ocr_confidence,
        entry.review_status,
      ]);
      return res.rows[0]?.id || null;
    }
  };

  const insertSf2 = async (entry: Record<string, any>): Promise<string | null> => {
    if (isPostgrest) {
      const { data, error } = await db.from("sf2_attendance_entries").insert(entry).select("id").single();
      if (error) {
        throw new Error(`Failed to insert SF2 attendance entry: ${error.message}`);
      }
      return data?.id || null;
    } else {
      const res = await db.query(`
        INSERT INTO public.sf2_attendance_entries (
          document_id, student_id, school_id, school_year, grade_level, section,
          month, lrn, learner_name, total_school_days, days_present, days_absent,
          days_tardy, daily_grid, row_index, page_number, ocr_confidence, review_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING id;
      `, [
        entry.document_id,
        entry.student_id,
        entry.school_id,
        entry.school_year,
        entry.grade_level,
        entry.section,
        entry.month,
        entry.lrn,
        entry.learner_name,
        entry.total_school_days,
        entry.days_present,
        entry.days_absent,
        entry.days_tardy,
        JSON.stringify(entry.daily_grid || []),
        entry.row_index,
        entry.page_number,
        entry.ocr_confidence,
        entry.review_status,
      ]);
      return res.rows[0]?.id || null;
    }
  };

  const insertSf5 = async (entry: Record<string, any>): Promise<string | null> => {
    if (isPostgrest) {
      const { data, error } = await db.from("sf5_promotion_entries").insert(entry).select("id").single();
      if (error) {
        throw new Error(`Failed to insert SF5 promotion entry: ${error.message}`);
      }
      return data?.id || null;
    } else {
      const res = await db.query(`
        INSERT INTO public.sf5_promotion_entries (
          document_id, student_id, school_id, school_year, grade_level, section,
          track, strand, semester, form_variant, lrn, learner_name, general_average,
          action_taken, proficiency_level, incomplete_subjects, row_index, page_number, ocr_confidence, review_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) RETURNING id;
      `, [
        entry.document_id,
        entry.student_id,
        entry.school_id,
        entry.school_year,
        entry.grade_level,
        entry.section,
        entry.track,
        entry.strand,
        entry.semester,
        entry.form_variant,
        entry.lrn,
        entry.learner_name,
        entry.general_average,
        entry.action_taken,
        entry.proficiency_level || null,
        JSON.stringify(entry.incomplete_subjects || []),
        entry.row_index,
        entry.page_number,
        entry.ocr_confidence,
        entry.review_status,
      ]);
      return res.rows[0]?.id || null;
    }
  };

  const insertTrace = async (trace: Record<string, any>) => {
    if (isPostgrest) {
      const { error } = await db.from("field_extraction_traces").insert(trace);
      if (error) {
        throw new Error(`Failed to insert field extraction trace: ${error.message}`);
      }
    } else {
      await db.query(`
        INSERT INTO public.field_extraction_traces (
          document_id, source_table, record_id, field_name,
          extracted_value, ocr_provider, ocr_confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        trace.document_id,
        trace.source_table,
        trace.record_id,
        trace.field_name,
        trace.extracted_value,
        trace.ocr_provider,
        trace.ocr_confidence,
      ]);
    }
  };

  try {

  // 1. Process by document type
  if (documentType === "sf1") {
    const parsed = parseShsSf1(extractedText, azureTables, ocrConfidence);
    warnings.push(...parsed.warnings);

    let learnersList = parsed.learners;
    let headerInfo = { ...parsed.header };
    if (learnersList.length === 0 && Array.isArray(params.extractedFields?.learners) && params.extractedFields.learners.length > 0) {
      learnersList = params.extractedFields.learners;
      headerInfo = {
        school_id: params.extractedFields.school_id || headerInfo.school_id,
        school_name: params.extractedFields.school_name || headerInfo.school_name,
        school_year: params.extractedFields.school_year || headerInfo.school_year,
        grade_level: params.extractedFields.grade_level || headerInfo.grade_level,
        section: params.extractedFields.section || headerInfo.section,
        track: params.extractedFields.shs_track || params.extractedFields.track || headerInfo.track,
        strand: params.extractedFields.track_strand || params.extractedFields.strand || headerInfo.strand,
        semester: params.extractedFields.semester || headerInfo.semester,
      };
    }

    totalLearners = learnersList.length;

    // Update parent document metadata
    await updateDoc(documentId, {
      school_year: headerInfo.school_year,
      grade_level: headerInfo.grade_level,
      section: headerInfo.section,
      track: headerInfo.track,
      strand: headerInfo.strand,
      semester: headerInfo.semester,
      status: "needs_review",
      student_id: null,
    });

    // Insert learner rows
    for (const l of learnersList) {
      let matchedStudentId: string | null = null;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = l.review_status || "NEEDS_REVIEW";

      let lastName = l.last_name;
      let firstName = l.first_name;
      const anyL = l as any;
      if (!lastName && anyL.name) {
        const parts = String(anyL.name).split(",");
        if (parts.length >= 2) {
          lastName = parts[0].trim();
          firstName = parts.slice(1).join(",").trim();
        } else {
          lastName = String(anyL.name).trim();
        }
      }

      // Look up student by LRN
      if (isValidLrn(l.lrn)) {
        const studentRows = await lookupStudent(l.lrn, schoolId);

        if (studentRows.length > 0) {
          const existing = studentRows[0];
          const collision = verifyStudentCollision(lastName, existing);
          if (collision.hasConflict) {
            // Case C: LRN Collision
            conflictCount++;
            reviewStatus = "FLAGGED";
            matchedStudentId = null;
            warnings.push(`LRN Collision for ${l.lrn}: Document extracted "${lastName}", but registry has "${existing.last_name}".`);

            // Quarantine conflict into official student_identity_conflicts table (M022)
            await insertConflict({
              school_id: schoolId,
              existing_student_id: existing.id,
              document_id: documentId,
              conflict_type: "SAME_LRN_CONFLICT_NAME",
              extracted_lrn: l.lrn,
              extracted_name: [lastName, firstName].filter(Boolean).join(", "),
              extracted_context: { first_name: firstName, last_name: lastName, reason: collision.reason },
              expected_context: { existing_first_name: existing.first_name, existing_last_name: existing.last_name },
              status: "pending",
            });
          } else {
            // Case A or B: Matched!
            matchedStudentId = existing.id;
            matchedCount++;
          }
        } else {
          // Case E: New candidate learner
          newCandidatesCount++;
        }
      } else {
        reviewStatus = "FLAGGED";
        flaggedCount++;
      }

      let track = l.track || headerInfo.track || "";
      let strand = l.strand || headerInfo.strand || "";
      let semester = l.semester || headerInfo.semester || "";
      let sex = normalizeSex(l.sex);
      let remarksIndicator = l.remarks_indicator || anyL.remarks || null;

      if (!track) {
        track = "UNSPECIFIED";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        warnings.push(`Learner ${l.lrn || "unknown"}: Track is not specified in document header or row; flagged as UNSPECIFIED.`);
      }
      if (!strand) {
        strand = "UNSPECIFIED";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        warnings.push(`Learner ${l.lrn || "unknown"}: Strand is not specified in document header or row; flagged as UNSPECIFIED.`);
      }
      if (!semester) {
        // DB constraint requires '1st Semester' or '2nd Semester'
        semester = "1st Semester";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        remarksIndicator = remarksIndicator ? `${remarksIndicator} [UNSPECIFIED_SEMESTER]` : "[UNSPECIFIED_SEMESTER]";
        warnings.push(`Learner ${l.lrn || "unknown"}: Semester not specified in document header or row; recorded as 1st Semester for schema compliance and FLAGGED for verification.`);
      }
      if (!sex) {
        // DB constraint requires 'M' or 'F'
        sex = "M";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        remarksIndicator = remarksIndicator ? `${remarksIndicator} [UNVERIFIED_SEX]` : "[UNVERIFIED_SEX]";
        warnings.push(`Learner ${l.lrn || "unknown"}: Sex could not be verified from document; recorded as M for schema compliance and FLAGGED for verification.`);
      }

      let gradeLevel = normalizeGradeLevelKey(verifiedContext?.gradeLevel || l.grade_level || headerInfo.grade_level);
      if (gradeLevel !== "Grade 11" && gradeLevel !== "Grade 12") {
        gradeLevel = "Grade 11";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        warnings.push(`Learner ${l.lrn || "unknown"}: Grade level could not be verified as SHS Grade 11 or Grade 12; FLAGGED for verification.`);
      }

      let schoolYear = verifiedContext?.schoolYear || l.school_year || headerInfo.school_year || "";
      if (!schoolYear) {
        schoolYear = "UNSPECIFIED";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        warnings.push(`Learner ${l.lrn || "unknown"}: School year not specified; FLAGGED for verification.`);
      }

      let section = verifiedContext?.section || l.section || headerInfo.section || "";
      if (!section) {
        section = "UNSPECIFIED";
        if (reviewStatus !== "FLAGGED") {
          reviewStatus = "FLAGGED";
          flaggedCount++;
        }
        warnings.push(`Learner ${l.lrn || "unknown"}: Section not specified; FLAGGED for verification.`);
      }

      const recordId = await insertSf1({
        document_id: documentId,
        student_id: matchedStudentId,
        school_id: schoolId,
        school_year: schoolYear,
        grade_level: gradeLevel,
        section: section,
        track: track,
        strand: strand,
        semester: semester,
        lrn: l.lrn,
        last_name: lastName || "Unknown",
        first_name: firstName || "Unknown",
        middle_name: l.middle_name || null,
        suffix: l.suffix || null,
        sex: sex,
        birth_date: l.birth_date || null,
        age: l.age ? Number(l.age) : null,
        religion: l.religion || null,
        remarks_indicator: remarksIndicator,
        row_index: l.row_index || 0,
        page_number: l.page_number || 1,
        ocr_confidence: ocrConfidence,
        review_status: reviewStatus,
      });

      // Record field extraction traces for provenance
      if (recordId) {
        await insertTrace({
          document_id: documentId,
          source_table: "sf1_roster_entries",
          record_id: recordId,
          field_name: "lrn",
          extracted_value: l.lrn,
          ocr_provider: ocrProvider,
          ocr_confidence: ocrConfidence,
        });
      }
    }
  } else if (documentType === "sf2") {
    const parsed = parseShsSf2(extractedText, azureTables, ocrConfidence);
    warnings.push(...parsed.warnings);

    let attendanceList = parsed.attendance;
    let headerInfo = { ...parsed.header };
    if (
      attendanceList.length === 0 &&
      Array.isArray(params.extractedFields?.attendance_records) &&
      params.extractedFields.attendance_records.length > 0
    ) {
      attendanceList = params.extractedFields.attendance_records;
      headerInfo = {
        school_id: params.extractedFields.school_id || headerInfo.school_id,
        school_name: params.extractedFields.school_name || headerInfo.school_name,
        school_year: params.extractedFields.school_year || headerInfo.school_year || "Unknown",
        grade_level: params.extractedFields.grade_level || headerInfo.grade_level || "Grade 11",
        section: params.extractedFields.section || headerInfo.section || "Unknown",
        month: params.extractedFields.reporting_month || params.extractedFields.attendance_month || params.extractedFields.month || headerInfo.month || "Unknown",
      };
    }

    totalLearners = attendanceList.length;

    await updateDoc(documentId, {
      school_year: verifiedContext?.schoolYear || headerInfo.school_year,
      grade_level: verifiedContext?.gradeLevel || headerInfo.grade_level,
      section: verifiedContext?.section || headerInfo.section,
      reporting_month: headerInfo.month,
      status: "needs_review",
      student_id: null,
    });

    for (const a of attendanceList) {
      let matchedStudentId: string | null = null;
      if (a.lrn && isValidLrn(a.lrn)) {
        const studentRows = await lookupStudent(a.lrn, schoolId);
        if (studentRows.length > 0) {
          matchedStudentId = studentRows[0].id;
          matchedCount++;
        }
      }

      let sf2Grade = normalizeGradeLevelKey(verifiedContext?.gradeLevel || a.grade_level || headerInfo.grade_level);
      let sf2ReviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = a.review_status || "NEEDS_REVIEW";
      if (sf2Grade !== "Grade 11" && sf2Grade !== "Grade 12") {
        sf2Grade = "Grade 11";
        sf2ReviewStatus = "FLAGGED";
        warnings.push(`Learner "${a.learner_name}": Grade level could not be verified as SHS Grade 11 or Grade 12; FLAGGED for verification.`);
      }

      await insertSf2({
        document_id: documentId,
        student_id: matchedStudentId,
        school_id: schoolId,
        school_year: verifiedContext?.schoolYear || a.school_year || headerInfo.school_year || "UNSPECIFIED",
        grade_level: sf2Grade,
        section: verifiedContext?.section || a.section || headerInfo.section || "UNSPECIFIED",
        month: a.month || headerInfo.month || "UNSPECIFIED",
        lrn: a.lrn,
        learner_name: a.learner_name,
        total_school_days: a.total_school_days !== undefined ? Number(a.total_school_days) : 0,
        days_present: a.days_present !== undefined ? Number(a.days_present) : 0,
        days_absent: a.days_absent !== undefined ? Number(a.days_absent) : 0,
        days_tardy: a.days_tardy !== undefined ? Number(a.days_tardy) : 0,
        daily_grid: a.daily_grid || [],
        row_index: a.row_index || 0,
        page_number: a.page_number || 1,
        ocr_confidence: ocrConfidence,
        review_status: sf2ReviewStatus,
      });
    }
  } else if (documentType === "sf5") {
    const explicitVariant = params.extractedFields?.form_variant || params.extractedFields?.document_type;
    const parsed = parseShsSf5(extractedText, azureTables, ocrConfidence, explicitVariant);
    warnings.push(...parsed.warnings);

    let learnersList = parsed.learners;
    let headerInfo = { ...parsed.header };
    if (learnersList.length === 0 && Array.isArray(params.extractedFields?.learners) && params.extractedFields.learners.length > 0) {
      learnersList = params.extractedFields.learners;
      headerInfo = {
        ...headerInfo,
        school_year: params.extractedFields.school_year || headerInfo.school_year,
        grade_level: params.extractedFields.grade_level || headerInfo.grade_level,
        section: params.extractedFields.section || headerInfo.section,
        track: params.extractedFields.shs_track || params.extractedFields.track || headerInfo.track,
        strand: params.extractedFields.track_strand || params.extractedFields.strand || headerInfo.strand,
        semester: params.extractedFields.semester || headerInfo.semester,
        form_variant: params.extractedFields.form_variant || headerInfo.form_variant,
      };
    }

    totalLearners = learnersList.length;

    await updateDoc(documentId, {
      school_year: verifiedContext?.schoolYear || headerInfo.school_year,
      grade_level: verifiedContext?.gradeLevel || headerInfo.grade_level,
      section: verifiedContext?.section || headerInfo.section,
      track: headerInfo.track,
      strand: headerInfo.strand,
      semester: headerInfo.semester,
      status: "needs_review",
      student_id: null,
    });

    for (const l of learnersList) {
      let matchedStudentId: string | null = null;
      let sf5ReviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = l.review_status || "NEEDS_REVIEW";

      if (isValidLrn(l.lrn)) {
        const studentRows = await lookupStudent(l.lrn, schoolId);
        if (studentRows.length > 0) {
          const existing = studentRows[0];
          const learnerLastName = String(l.learner_name || "").split(",")[0].trim();
          const collision = learnerLastName ? verifyStudentCollision(learnerLastName, existing) : { hasConflict: false };
          if (collision.hasConflict) {
            conflictCount++;
            sf5ReviewStatus = "FLAGGED";
            matchedStudentId = null;
            warnings.push(`LRN Collision in SF5 for ${l.lrn}: Document extracted "${learnerLastName}", but registry has "${existing.last_name}".`);
            await insertConflict({
              school_id: schoolId,
              existing_student_id: existing.id,
              document_id: documentId,
              conflict_type: "SAME_LRN_CONFLICT_NAME",
              extracted_lrn: l.lrn,
              extracted_name: l.learner_name,
              extracted_context: { learner_name: l.learner_name, reason: collision.reason },
              expected_context: { existing_first_name: existing.first_name, existing_last_name: existing.last_name },
              status: "pending",
            });
          } else {
            matchedStudentId = existing.id;
            matchedCount++;
          }
        } else {
          newCandidatesCount++;
        }
      } else {
        sf5ReviewStatus = "FLAGGED";
        flaggedCount++;
      }

      const sf5Grade = normalizeGradeLevelKey(verifiedContext?.gradeLevel || l.grade_level || headerInfo.grade_level) || "Grade 11";

      await insertSf5({
        document_id: documentId,
        student_id: matchedStudentId,
        school_id: schoolId,
        school_year: verifiedContext?.schoolYear || l.school_year || headerInfo.school_year,
        grade_level: sf5Grade === "Grade 12" ? "Grade 12" : "Grade 11",
        section: verifiedContext?.section || l.section || headerInfo.section,
        track: l.track || headerInfo.track,
        strand: l.strand || headerInfo.strand,
        semester: l.semester || headerInfo.semester,
        form_variant: (l as any).form_variant || headerInfo.form_variant || "SF5A-SHS",
        lrn: l.lrn,
        learner_name: l.learner_name,
        general_average: l.general_average,
        action_taken: l.action_taken,
        proficiency_level: l.proficiency_level || null,
        incomplete_subjects: l.incomplete_subjects || [],
        row_index: l.row_index,
        page_number: l.page_number,
        ocr_confidence: ocrConfidence,
        review_status: sf5ReviewStatus,
      });
    }
  }

  return {
    success: true,
    documentId,
    documentType,
    totalLearners,
    matchedCount,
    newCandidatesCount,
    conflictCount,
    flaggedCount,
    warnings,
  };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    warnings.push(errMsg);
    return {
      success: false,
      documentId,
      documentType,
      totalLearners,
      matchedCount,
      newCandidatesCount,
      conflictCount,
      flaggedCount,
      warnings,
      error: errMsg,
    };
  }
}
