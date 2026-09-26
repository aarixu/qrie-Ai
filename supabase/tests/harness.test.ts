// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { freshDatabase, migrationFiles } from './harness';

/**
 * THE MIGRATIONS, RUN — NOT READ.
 *
 * Until now every migration test in this repo read the .sql file and matched
 * it with a regex (apps/classroom/tests/migrations.test.ts says so at its top).
 * That stops a policy being deleted; it cannot tell you what the policy does.
 * This harness applies every file in supabase/migrations, in order, to a real
 * Postgres running in-process (PGlite), so a test can act as a student and see
 * what a student would actually see.
 */
describe('the migration harness', () => {
  it('finds every migration in order', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files[0]).toBe('0001_student_state.sql');
    expect([...files].sort()).toEqual(files);
  });

  it('applies all of them to a fresh Postgres without error', async () => {
    const db = await freshDatabase();
    const { rows } = await db.sql<{ n: number }>`select count(*)::int as n from public.organization`;
    expect(rows[0].n).toBe(0);
    await db.close();
  });
});
