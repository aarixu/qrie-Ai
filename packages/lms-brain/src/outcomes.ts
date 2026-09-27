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
  // ids() keeps the maps' own order: chapters, and topics within them, as
  // the syllabus teaches them. That order is `position`.
  const rows = index.ids().map((id, position) => {
    const n = index.node(id)! as unknown as { klass: number; subject: string; chapter?: string; title?: string };
    return { id, grade: n.klass, subject: n.subject, chapter: n.chapter ?? id, title: n.title ?? id, position };
  });
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(
      `insert into lms.outcome (id, grade, subject, chapter, title, position)
       select x.id, x.grade, x.subject, x.chapter, x.title, x.position
         from jsonb_to_recordset($1::jsonb)
           as x(id text, grade smallint, subject text, chapter text, title text, position integer)
       on conflict (id) do update
         set grade = excluded.grade, subject = excluded.subject, chapter = excluded.chapter,
             title = excluded.title, position = excluded.position`,
      [JSON.stringify(rows.slice(i, i + 1000))],
    );
  }
  return rows.length;
}
