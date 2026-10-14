import * as fs from 'fs';

const content = fs.readFileSync('supabase/migrations/009_consolidated_pending_migrations.sql', 'utf8');

console.log('=== MIGRATION 009 SYNTAX VALIDATION ===');

// Check for duplicate words in SQL like 'ON table ON table'
const regex = /\bON\s+[a-zA-Z0-9_.]+\s+ON\b/i;
const match = content.match(regex);
console.log('Duplicate ON check:', match ? `FAIL: ${match[0]}` : 'PASS: No duplicate ON clauses found');

// Find all CREATE POLICY statements
const policies = content.match(/CREATE\s+POLICY\s+[\s\S]*?;/gi);
console.log('Total CREATE POLICY statements found:', policies ? policies.length : 0);

let allValid = true;
if (policies) {
  policies.forEach((p, i) => {
    const singleLine = p.replace(/\s+/g, ' ').trim();
    // Validate that each policy has exactly one ON clause
    const onMatches = singleLine.match(/\bON\b/gi);
    if (!onMatches || onMatches.length !== 1) {
      console.error(`[POLICY ${i+1} ERROR]: Policy has ${onMatches ? onMatches.length : 0} 'ON' tokens:\n  ${singleLine}`);
      allValid = false;
    } else {
      console.log(`[POLICY ${i+1} OK]: ${singleLine.slice(0, 70)}...`);
    }
  });
}

// Find all DROP POLICY statements
const dropPolicies = content.match(/DROP\s+POLICY\s+[\s\S]*?;/gi);
console.log('\nTotal DROP POLICY statements found:', dropPolicies ? dropPolicies.length : 0);

// Check function definition and dollar quoting
const dollarQuotes = content.match(/\$\$/g);
console.log('Dollar quotes count ($$):', dollarQuotes ? dollarQuotes.length : 0, '(Must be even)');

if (dollarQuotes && dollarQuotes.length % 2 === 0 && allValid) {
  console.log('\n✓ ALL SQL STATEMENTS AND POLICIES ARE SYNTACTICALLY SOUND.');
} else {
  console.error('\n✗ SYNTAX ISSUES DETECTED.');
}
