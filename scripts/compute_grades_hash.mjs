import * as fs from 'fs';
import { PGlite } from '@electric-sql/pglite';

async function testSqlHash() {
  const db = new PGlite();
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY, student_id UUID, document_id UUID, school_year TEXT, grade_level TEXT, semester TEXT,
      subject TEXT NOT NULL, q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC, final_grade NUMERIC, status TEXT,
      needs_verification BOOLEAN
    );
  `);

  const backup = JSON.parse(fs.readFileSync('supabase/backups/production_pre_m016_m021_backup.json', 'utf8'));
  for (const g of backup.tables.subject_grades.rows) {
    await db.query(
      'INSERT INTO public.subject_grades (id, student_id, document_id, school_year, grade_level, semester, subject, q1, q2, q3, q4, final_grade, status, needs_verification) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [g.id, g.student_id, g.document_id, g.school_year, g.grade_level, g.semester, g.subject, g.q1, g.q2, g.q3, g.q4, g.final_grade, g.status, g.needs_verification]
    );
  }

  const res = await db.query(`
    SELECT md5(string_agg(
      id::text || '|' || 
      subject || '|' || 
      COALESCE(school_year, '') || '|' || 
      COALESCE(grade_level, '') || '|' || 
      COALESCE(semester, '') || '|' || 
      COALESCE(q1::text, '') || '|' || 
      COALESCE(q2::text, '') || '|' || 
      COALESCE(q3::text, '') || '|' || 
      COALESCE(q4::text, '') || '|' || 
      COALESCE(final_grade::text, '') || '|' || 
      COALESCE(status, '') || '|' || 
      COALESCE(needs_verification::text, ''),
      E'\n' ORDER BY id
    )) as grades_checksum
    FROM public.subject_grades
    WHERE document_id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b';
  `);

  console.log('SQL Deterministic Checksum:', res.rows[0].grades_checksum);
}

testSqlHash().catch(console.error);
