import * as fs from 'fs';
import { PGlite } from '@electric-sql/pglite';

async function testSqlRestore() {
  const db = new PGlite();
  const backup = JSON.parse(fs.readFileSync('supabase/backups/production_pre_m016_m021_backup.json', 'utf8'));

  // Build schema matching exact live columns from backup metadata
  for (const [table, def] of Object.entries(backup.schemaDefinitions)) {
    if (def.status !== 'OK' || !def.columns || def.columns.length === 0) continue;
    const colDefs = def.columns.map(col => {
      if (col === 'id') return 'id UUID PRIMARY KEY';
      if (col === 'school_id') return '"school_id" TEXT';
      if (col.endsWith('_id') || col.endsWith('Id')) return `"${col}" UUID`;
      if (col.includes('fields') || col.includes('details') || col.includes('metadata') || col.includes('grades') || col.includes('history')) return `"${col}" JSONB`;
      if (col.startsWith('is_') || col.startsWith('has_') || col === 'needs_verification') return `"${col}" BOOLEAN`;
      if (col.startsWith('q1') || col.startsWith('q2') || col.startsWith('q3') || col.startsWith('q4') || col.includes('grade') || col.includes('average')) return `"${col}" NUMERIC`;
      if (col.endsWith('_at') || col === 'created_at' || col === 'updated_at') return `"${col}" TIMESTAMPTZ`;
      if (col === 'birth_date') return `"${col}" DATE`;
      return `"${col}" TEXT`;
    }).join(', ');

    await db.exec(`CREATE TABLE IF NOT EXISTS public."${table}" (${colDefs});`);
  }

  const sql = fs.readFileSync('supabase/backups/production_pre_m016_m021_restore.sql', 'utf8');
  await db.exec(sql);

  const grades = await db.query('SELECT COUNT(*) as count FROM public.subject_grades');
  const docs = await db.query('SELECT COUNT(*) as count FROM public.documents');
  const students = await db.query('SELECT COUNT(*) as count FROM public.students');

  console.log('=== PURE SQL RESTORE VERIFIED ===');
  console.log('Restored Subject Grades:', grades.rows[0].count, '(Expected 18)');
  console.log('Restored Documents:', docs.rows[0].count, '(Expected 6)');
  console.log('Restored Students:', students.rows[0].count, '(Expected 2)');

  if (parseInt(grades.rows[0].count) !== 18 || parseInt(docs.rows[0].count) !== 6 || parseInt(students.rows[0].count) !== 2) {
    throw new Error('Mismatch in restored row counts!');
  }
}

testSqlRestore().catch(console.error);
