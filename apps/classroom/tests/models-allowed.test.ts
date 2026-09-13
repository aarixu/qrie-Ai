import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_MODELS, bareModel } from '@ai-tutor/relay';

/**
 * EVERY MODEL THE APP NAMES IS ONE THE RELAY WILL SERVE.
 *
 * The relay refuses any model outside its allow-list with a 400, before the
 * model is called — that is the cost guard on a Vertex balance. The app names
 * its models as string constants in a handful of files. Nothing joined the
 * two: lib/judge.ts and lib/geminiAgent.ts named 'google/gemini-3-flash-preview'
 * for weeks, an OpenRouter-era name Vertex does not serve, so in production
 * every spoken answer's judge call and the doubt tutor's relay path were 400s
 * the app swallowed on purpose. A test even asserted the broken name.
 *
 * This reads the source as text, the way migrations.test.ts reads SQL, because
 * the constants are module-private and that is the right shape for them. Any
 * new model literal in the app is checked here the day it is written.
 */

const LIB = path.resolve(process.cwd(), 'apps/classroom/src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** 'google/gemini-…' literals, with the file each came from. */
function namedModels(): { model: string; file: string; line: number }[] {
  const out: { model: string; file: string; line: number }[] = [];
  for (const file of sourceFiles(LIB)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      // Comments may mention old names; only code that could be SENT counts.
      const code = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      for (const m of code.matchAll(/['"](google\/gemini[a-z0-9.\-]+)['"]/g)) {
        out.push({ model: m[1], file: path.relative(LIB, file), line: i + 1 });
      }
    });
  }
  return out;
}

describe('the models the app sends to the relay', () => {
  const found = namedModels();

  it('finds the ones it is supposed to be guarding', () => {
    // If this ever drops to zero the scan is broken, not the app clean.
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found.some((f) => f.file.endsWith('judge.ts'))).toBe(true);
    expect(found.some((f) => f.file.endsWith('liveClass.ts'))).toBe(true);
  });

  it('are all on the relay allow-list', () => {
    const refused = found.filter((f) => !ALLOWED_MODELS.has(bareModel(f.model)));
    expect(
      refused,
      refused.map((f) => `${f.file}:${f.line} names ${f.model}, which the relay refuses`).join('\n'),
    ).toEqual([]);
  });
});
