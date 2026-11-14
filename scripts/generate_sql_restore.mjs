import * as fs from 'fs';
import * as path from 'path';

const backup = JSON.parse(fs.readFileSync('supabase/backups/production_pre_m016_m021_backup.json', 'utf8'));

let sql = '-- ==============================================================================\n';
sql += '-- COMPLETE RESTORATION SQL SCRIPT: LIVE SUPABASE PRE-M016-021 SNAPSHOT\n';
sql += '-- Institution: Taysan Resettlement Integrated School (TRIS) - School ID: 500169\n';
sql += '-- Timestamp: ' + backup.metadata.timestamp + '\n';
sql += '-- ==============================================================================\n\n';

sql += 'BEGIN;\n\n';

function sqlVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val.toString();
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') return "'" + JSON.stringify(val).replace(/'/g, "''") + "'::jsonb";
  return "'" + val.toString().replace(/'/g, "''") + "'";
}

// 1. Schools
sql += '-- 1. Restore public.schools\n';
for (const s of backup.tables.schools.rows) {
  const cols = Object.keys(s);
  const vals = cols.map(c => sqlVal(s[c]));
  sql += `INSERT INTO public.schools (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO UPDATE SET school_id = EXCLUDED.school_id, name = EXCLUDED.name;\n`;
}
sql += '\n';

// 2. Students
sql += '-- 2. Restore public.students\n';
for (const st of backup.tables.students.rows) {
  const cols = Object.keys(st);
  const vals = cols.map(c => sqlVal(st[c]));
  sql += `INSERT INTO public.students (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
}
sql += '\n';

// 3. Documents
sql += '-- 3. Restore public.documents\n';
for (const d of backup.tables.documents.rows) {
  const cols = Object.keys(d);
  const vals = cols.map(c => sqlVal(d[c]));
  sql += `INSERT INTO public.documents (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
}
sql += '\n';

// 4. Subject Grades
sql += '-- 4. Restore public.subject_grades\n';
for (const g of backup.tables.subject_grades.rows) {
  const cols = Object.keys(g);
  const vals = cols.map(c => sqlVal(g[c]));
  sql += `INSERT INTO public.subject_grades (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
}
sql += '\n';

// 5. Review Logs
sql += '-- 5. Restore public.review_logs\n';
for (const rl of backup.tables.review_logs.rows) {
  const cols = Object.keys(rl);
  const vals = cols.map(c => sqlVal(rl[c]));
  sql += `INSERT INTO public.review_logs (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
}
sql += '\n';

// 6. User Roles
sql += '-- 6. Restore public.user_roles\n';
for (const ur of backup.tables.user_roles.rows) {
  const cols = Object.keys(ur);
  const vals = cols.map(c => sqlVal(ur[c]));
  sql += `INSERT INTO public.user_roles (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
}
sql += '\n';

sql += 'COMMIT;\n';

fs.writeFileSync('supabase/backups/production_pre_m016_m021_restore.sql', sql, 'utf8');
console.log('Generated SQL file: supabase/backups/production_pre_m016_m021_restore.sql');
console.log('Size:', fs.statSync('supabase/backups/production_pre_m016_m021_restore.sql').size, 'bytes');
