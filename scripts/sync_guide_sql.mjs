import fs from "node:fs";

const file015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8").trim();
const guidePath = "C:/Users/windows-11/.gemini/antigravity/brain/3bd93d8b-599d-47ba-9020-42d155f09897/MIGRATION_015_SAFETY_REVIEW_AND_EXECUTION_GUIDE.md";
let guide = fs.readFileSync(guidePath, "utf-8");

const replacement = "```sql\nBEGIN;\n\n" + file015 + "\n\nCOMMIT;\n```";
guide = guide.replace(/```sql\r?\nBEGIN;[\s\S]*?COMMIT;\r?\n```/, () => replacement);

fs.writeFileSync(guidePath, guide, "utf-8");
console.log("Guide successfully synced with exact 015 SQL file!");
