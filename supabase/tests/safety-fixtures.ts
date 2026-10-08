import type { PGlite } from '@electric-sql/pglite';
import { asService } from './harness.ts';

/**
 * Plan 5's fixtures: distress flags, reports, classes and a child's records,
 * written the way the relay and the LMS write them.
 */

/** Keeps one distress flag through public.keep_safety_event as the service role, as the relay does. */
export async function keepFlag(
  db: PGlite,
  user: string,
  over: Partial<{ id: string; direction: 'from-student' | 'to-student'; at: string }> = {},
): Promise<boolean | null> {
  return asService(db, async (tx) => {
    const { rows } = await tx.query<{ kept: boolean | null }>(
      `select public.keep_safety_event($1, $2, 'distress', $3, 'web', 'test-build', coalesce($4::timestamptz, now())) as kept`,
      [user, over.id ?? crypto.randomUUID(), over.direction ?? 'from-student', over.at ?? null],
    );
    return rows[0].kept;
  });
}
