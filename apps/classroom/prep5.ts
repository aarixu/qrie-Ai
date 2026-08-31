/* Re-prepare five best lessons through the REAL pipeline, headless. */
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) =>
  realFetch(typeof u === 'string' && u.startsWith('/') ? `http://127.0.0.1:5173${u}` : u, i)) as typeof fetch;

import fs from 'node:fs';
import path from 'node:path';
import { saveable } from '@ai-tutor/class-prep';
import { prepareLiveClass } from './src/lib/liveClass';

interface Job {
  old: string[]; // folders to delete first (old ids)
  topic: string;
  klass: number;
  subject: string;
  subtitle: string;
  topicRef: string;
}

const CONTENT = 'C:/Users/HP/Ai Tutor/content';

const JOBS: Job[] = [
  {
    old: ['class9-science-matter-in-our-surroundings-evaporation'],
    topic: 'Evaporation',
    klass: 9, subject: 'Science', subtitle: 'Class 9 · Matter in Our Surroundings',
    topicRef: 'class9-science/matter-in-our-surroundings/evaporation',
  },
  {
    old: ['class9-science-is-matter-around-us-pure-what-is-a-mixture'],
    topic: 'What is a Mixture?',
    klass: 9, subject: 'Science', subtitle: 'Class 9 · Is Matter Around Us Pure',
    topicRef: 'class9-science/is-matter-around-us-pure/what-is-a-mixture',
  },
  {
    old: ['class9-science-tissues-animal-tissues'],
    topic: 'Animal Tissues',
    klass: 9, subject: 'Science', subtitle: 'Class 9 · Tissues',
    topicRef: 'class9-science/tissues/animal-tissues',
  },
  {
    old: ['class10-nutrition'],
    topic: 'Autotrophic Nutrition — Photosynthesis',
    klass: 10, subject: 'Science', subtitle: 'Class 10 · Life Processes',
    topicRef: 'class10-science/life-processes/autotrophic-nutrition',
  },
  {
    old: ['class10-heart-mini'],
    topic: 'The Human Heart and Circulation',
    klass: 10, subject: 'Science', subtitle: 'Class 10 · Life Processes',
    topicRef: 'class10-science/life-processes/transportation-in-human-beings',
  },
];

function pruneIndex(ids: string[]): void {
  const p = path.join(CONTENT, 'index.json');
  const index = JSON.parse(fs.readFileSync(p, 'utf8')) as { lessons: { id: string }[] };
  index.lessons = index.lessons.filter((l) => !ids.includes(l.id));
  fs.writeFileSync(p, `${JSON.stringify(index, null, 2)}\n`);
}

/** What the tutor SPEAKS vs what lands on the BOARD, per lesson. */
function digest(lesson: any, report: any) {
  const beats = lesson.beats as any[];
  const says = beats.reduce((n, b) => n + (b.narration ? 1 : 0), 0);
  const asks = beats.filter((b) => b.ask).length;
  const openAsks = beats.filter((b) => b.ask && !(b.ask.options?.length)).length;
  const withExpect = beats.filter((b) => b.ask && b.ask.expect).length;
  const els = lesson.elements as any[];
  const kinds: Record<string, number> = {};
  for (const el of els) kinds[el.kind] = (kinds[el.kind] ?? 0) + 1;
  const words = beats.reduce((n, b) => n + String(b.narration ?? '').split(/\s+/).length, 0);
  return {
    title: lesson.title,
    beats: beats.length,
    spokenLines: says,
    minutes: +(words / 150).toFixed(1),
    asks, openAsks, withExpect,
    board: kinds,
    issues: report?.issues ?? [],
  };
}

async function run(): Promise<void> {
  const out: any[] = [];
  for (const job of JOBS) {
    // CREDITS MODE (Aarav: "jitna ho ske credits bachao"): one attempt per
    // lesson - a second run doubles the image bill for marginal gain. The
    // retry below fires only on a hard crash, and nothing old is deleted
    // until the new class actually exists.
    let best: { made: any; d: any } | null = null;
    for (let attempt = 1; attempt <= 2 && !best; attempt += 1) {
      console.log(`\n=== ${job.topic} (attempt ${attempt}) ===`);
      try {
        const made = await prepareLiveClass(
          { topic: job.topic, klass: job.klass, minutes: 4, subject: job.subject },
          (p) => console.log(`  [${p.phase}] ${p.message}`),
        );
        const d = digest(made.lesson, made.report);
        console.log('  digest:', JSON.stringify(d));
        best = { made, d };
      } catch (e) {
        console.log('  FAILED:', String(e).slice(0, 300));
      }
    }
    if (!best) { out.push({ topic: job.topic, error: 'both attempts failed' }); continue; }
    for (const id of job.old) {
      const dir = path.join(CONTENT, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    pruneIndex(job.old);

    const saved = saveable(best.made, {
      topicRef: job.topicRef, klass: job.klass, subject: job.subject, subtitle: job.subtitle,
    });
    if (!saved) { out.push({ topic: job.topic, error: 'not saveable' }); continue; }
    // also clear any folder with the NEW id (same slug as an old one usually)
    const dir = path.join(CONTENT, (saved as any).id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    pruneIndex([(saved as any).id]);
    const res = await fetch('/api/class', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saved),
    });
    out.push({ topic: job.topic, savedAs: (saved as any).id, write: res.status, ...best.d });
  }
  console.log('\n===== FINAL =====');
  console.log(JSON.stringify(out, null, 2));
}

void run();
