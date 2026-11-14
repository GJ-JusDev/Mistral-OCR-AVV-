import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupabaseCliOutput } from '../scripts/deploy_m016_m021_phased.mjs';

test('Deploy Runner CLI Output Parser — Verified CLI Formats & Edge Cases', async (t) => {
  await t.test('1. Parses agent-mode JSON object output with JSONB, booleans, and NULLs', () => {
    const rawAgentJson = [
      'Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production',
      '{',
      '  "boundary": "6eb5943546eaca7517b3d891d788b98b",',
      '  "rows": [',
      '    {',
      '      "a": 1,',
      '      "b": true,',
      '      "c": null,',
      '      "j": {',
      '        "grades_preserved": 18,',
      '        "status": "SUCCESS"',
      '      }',
      '    }',
      '  ],',
      '  "warning": "untrusted"',
      '}'
    ].join('\n');

    const parsed = parseSupabaseCliOutput(rawAgentJson);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].a, 1);
    assert.equal(parsed.rows[0].b, true);
    assert.equal(parsed.rows[0].c, null);
    assert.deepEqual(parsed.rows[0].j, { grades_preserved: 18, status: 'SUCCESS' });
  });

  await t.test('2. Parses human-terminal --agent=no -o json array output (including empty array)', () => {
    const rawHumanJson = [
      'Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production',
      '[',
      '  {',
      '    "b": true,',
      '    "f": false,',
      '    "j": {',
      '      "grades_preserved": 18,',
      '      "status": "SUCCESS"',
      '    },',
      '    "n": null,',
      '    "role_name": "postgres"',
      '  }',
      ']'
    ].join('\n');

    const parsed = parseSupabaseCliOutput(rawHumanJson);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].b, true);
    assert.equal(parsed.rows[0].f, false);
    assert.equal(parsed.rows[0].n, null);
    assert.equal(parsed.rows[0].role_name, 'postgres');
    assert.deepEqual(parsed.rows[0].j, { grades_preserved: 18, status: 'SUCCESS' });

    const emptyParsed = parseSupabaseCliOutput('Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production\n[]\n');
    assert.deepEqual(emptyParsed, { rows: [] });
  });

  await t.test('3. Safely parses exact captured CLI Unicode box-table output with JSONB map, NULL, booleans, and slices', () => {
    const rawTable = [
      'Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production',
      '┌───┬──────┬───────┬──────┬─────────────────────────────────────────┬──────────────────────────────────────────────────────┐',
      '│ a │ b    │ f     │ c    │ j                                       │ summary                                              │',
      '├───┼──────┼───────┼──────┼─────────────────────────────────────────┼──────────────────────────────────────────────────────┤',
      '│ 1 │ true │ false │ NULL │ map[grades_preserved:18 status:SUCCESS] │ map[indexes_created:[idx_a idx_b] status:SUCCESS]    │',
      '└───┴──────┴───────┴──────┴─────────────────────────────────────────┴──────────────────────────────────────────────────────┘'
    ].join('\n');

    const parsed = parseSupabaseCliOutput(rawTable);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].a, '1');
    assert.equal(parsed.rows[0].b, true);
    assert.equal(parsed.rows[0].f, false);
    assert.equal(parsed.rows[0].c, null);
    assert.deepEqual(parsed.rows[0].j, { grades_preserved: 18, status: 'SUCCESS' });
    assert.deepEqual(parsed.rows[0].summary, { indexes_created: ['idx_a', 'idx_b'], status: 'SUCCESS' });
  });

  await t.test('4. Handles empty DDL output and rejects CLI or PostgreSQL error payloads', () => {
    const ddlEmpty = parseSupabaseCliOutput('Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production\n');
    assert.deepEqual(ddlEmpty, { rows: [] });

    assert.throws(
      () =>
        parseSupabaseCliOutput(
          'Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production\n{"_tag":"Error","error":{"code":"HostedMutationConsentRequiredError"}}'
        ),
      /CLI returned error payload/
    );

    assert.throws(
      () =>
        parseSupabaseCliOutput(
          'Target: project AAV3.0 (yhsmawyntabwghncqbqy) · production\nunexpected status 400: {"message":"Failed to run sql query: ERROR:  22012: division by zero"}'
        ),
      /Unrecognized Supabase CLI output format/
    );
  });
});
