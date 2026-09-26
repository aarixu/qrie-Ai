import type { Sql } from './think.ts';
import { libraryIndex } from './graph.ts';

/**
 * Fills lms.outcome (0027) from the knowledge-graph maps: every outcome's
 * class, subject, chapter and title, so a teacher's view can group a
 * student's standing by chapter. Idempotent: an outcome already there is
 * brought up to date, never duplicated. Writes as the owner or service role.
 */
export async function loadOutcomes(db: Sql): Promise<number> {
  const index = libraryIndex();
  const rows = index.ids().map((id) => {
    const n = index.node(id)! as unknown as { klass: number; subject: string; chapter?: string; title?: string };
    return { id, grade: n.klass, subject: n.subject, chapter: n.chapter ?? id, title: n.title ?? id };
  });
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(
      `insert into lms.outcome (id, grade, subject, chapter, title)
       select x.id, x.grade, x.subject, x.chapter, x.title
         from jsonb_to_recordset($1::jsonb) as x(id text, grade smallint, subject text, chapter text, title text)
       on conflict (id) do update
         set grade = excluded.grade, subject = excluded.subject, chapter = excluded.chapter, title = excluded.title`,
      [JSON.stringify(rows.slice(i, i + 1000))],
    );
  }
  return rows.length;
}
