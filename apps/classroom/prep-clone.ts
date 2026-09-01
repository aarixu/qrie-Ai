/**
 * PREPARE ONE CLASS AS A CLONED TEACHER.
 *
 *   node prep-clone.cjs <card.json> "<topic>" <klass> <subject>
 *
 * The same pipeline the room uses, with one thing added: the teacher's style
 * brief reaches the planner, so the lesson is PLANNED in their manner rather
 * than merely spoken in their voice. Nothing is saved to content/ — a cloned
 * class belongs to the client's demo, not to Curie's catalogue.
 *
 * Run headless against the dev server's relays, like prep5.
 */
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) =>
  realFetch(typeof u === 'string' && u.startsWith('/') ? `http://127.0.0.1:5173${u}` : u, i)) as typeof fetch;

import fs from 'node:fs';
import path from 'node:path';
import { parseStyleCard, styleBrief } from '../../packages/teacher-clone/src/style.ts';
import { prepareLiveClass } from './src/lib/liveClass';

const OUT = 'C:/Users/HP/Ai Tutor/clone-source/derived/classes';

async function main(): Promise<void> {
  const [cardPath, topic, klassRaw, subject] = process.argv.slice(2);
  if (!cardPath || !topic) throw new Error('Usage: <card.json> "<topic>" <klass> <subject>');
  const klass = Number(klassRaw ?? 9);

  const card = parseStyleCard(fs.readFileSync(path.resolve(cardPath), 'utf8'));
  const brief = styleBrief(card);
  console.log(`Planning "${topic}" as ${card.teacher}…`);

  const made = await prepareLiveClass(
    { topic, klass, minutes: 4, subject: subject ?? 'Science', teacherStyle: brief },
    (p) => console.log(`  [${p.phase}] ${p.message}`),
  );

  fs.mkdirSync(OUT, { recursive: true });
  const slug = `${path.basename(cardPath).replace('.card.json', '')}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(made.lesson, null, 2));

  // What Aarav actually reads to judge the clone: every spoken line in order,
  // and what the board gained under it.
  const script = made.lesson.beats
    .map((b, i) => {
      const ink = (b.show ?? []).length;
      const ask = b.ask ? `\n      ↳ ASKS: ${b.ask.question}` : '';
      return `${String(i + 1).padStart(2, '0')}. ${b.narration}${ask}\n      [board: ${ink} elements]`;
    })
    .join('\n');
  fs.writeFileSync(path.join(OUT, `${slug}.script.txt`), `${card.teacher} — ${topic}\n\n${script}\n`);

  console.log(`\n${script}\n`);
  console.log(`beats: ${made.lesson.beats.length} | issues: ${made.report.issues.length}`);
  for (const issue of made.report.issues) console.log(`  ! ${issue}`);
  console.log(`\nWritten to ${OUT}/${slug}.*`);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
