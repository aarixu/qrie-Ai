import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('composed classes are asked for, never assumed (board composer)', () => {
  it('prewarm prepares composed classes only with --composed', async () => {
    const { parseArgs } = await import('../lib/main.mjs');
    expect(parseArgs(['--syllabus', 'class10-science', '--composed']).composed).toBe(true);
    expect(parseArgs(['--syllabus', 'class10-science']).composed).toBe(false);
  });

  it('the live classroom asks for them through one switch, off until real classes are measured', () => {
    const live = fs.readFileSync(path.resolve(__dirname, '../../../apps/classroom/src/lib/liveClass.ts'), 'utf8');
    expect(live).toMatch(/export const COMPOSE_LIVE_CLASSES = false;/);
    expect(live).toMatch(/composed: COMPOSE_LIVE_CLASSES,/);
  });
});
