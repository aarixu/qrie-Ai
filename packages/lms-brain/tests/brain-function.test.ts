// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE BRAIN FUNCTION CAN BE BUNDLED (lam-one-brain Task 9; review MF12, SF3).
 *
 * There is no Deno here, so the function is checked the way its bundler
 * reads it: every module reachable from supabase/functions/brain/index.ts,
 * resolving relative paths against the importing file and bare names through
 * the function's own deno.json. Each must exist, none may be a `node:`
 * module, every JSON import must say `with { type: 'json' }` (Deno refuses
 * one that does not), and every bare name must be mapped.
 */

const ROOT = process.cwd();
const FN = path.join(ROOT, 'supabase/functions/brain');
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]([^;\n]*)/g;

const read = (file: string) => fs.readFileSync(file, 'utf8');
const importMap = (): Record<string, string> =>
  (JSON.parse(read(path.join(FN, 'deno.json'))) as { imports: Record<string, string> }).imports;

interface Walk {
  files: string[];
  external: string[];
  problems: string[];
}

function walk(): Walk {
  const map = importMap();
  const seen = new Set<string>();
  const external = new Set<string>();
  const problems: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.json')) return;
    for (const [, spec, rest] of read(file).matchAll(IMPORT)) {
      const where = `${path.relative(ROOT, file)} -> ${spec}`;
      if (spec.startsWith('node:')) {
        problems.push(`${where}: a node: module`);
        continue;
      }
      if (spec.endsWith('.json') && !/with\s*\{\s*type:\s*['"]json['"]\s*\}/.test(rest)) {
        problems.push(`${where}: a JSON import without with { type: 'json' }`);
      }
      let target: string;
      if (spec.startsWith('.')) target = path.resolve(path.dirname(file), spec);
      else if (map[spec] === undefined) {
        problems.push(`${where}: not in deno.json`);
        continue;
      } else if (/^(npm|jsr|https?):/.test(map[spec])) {
        external.add(map[spec]);
        continue;
      } else target = path.resolve(FN, map[spec]);
      if (!fs.existsSync(target)) problems.push(`${where}: no such file ${path.relative(ROOT, target)}`);
      else visit(target);
    }
  };
  visit(path.join(FN, 'index.ts'));
  return { files: [...seen].map((f) => path.relative(ROOT, f).split(path.sep).join('/')), external: [...external], problems };
}

describe('supabase/functions/brain', () => {
  it('reaches every module it needs, none of them from node:, every bare name mapped by its deno.json', () => {
    const w = walk();
    expect(w.problems).toEqual([]);
    expect(w.files).toContain('packages/lms-brain/src/run.ts');
    expect(w.files).toContain('packages/lms-brain/src/think.ts');
    expect(w.files).toContain('packages/knowledge-graph/data/class8-mathematics.json');
    expect(w.files.filter((f) => f.endsWith('.probes.json'))).toEqual([]);
  });

  it('pins its one outside module, postgres.js, to an exact version', () => {
    expect(walk().external).toEqual([expect.stringMatching(/^npm:postgres@\d+\.\d+\.\d+$/)]);
  });

  it('runs the brain only through handleBrain, with the x-brain-secret header and BRAIN_SECRET', () => {
    const text = read(path.join(FN, 'index.ts'));
    expect(text).toMatch(/handleBrain\(/);
    expect(text).toMatch(/headers\.get\('x-brain-secret'\)/);
    expect(text).toMatch(/Deno\.env\.get\(name\)|Deno\.env\.get\('BRAIN_SECRET'\)/);
    expect(text).toMatch(/'BRAIN_SECRET'/);
    expect(text).toMatch(/'SUPABASE_DB_URL'/);
    expect(text).not.toMatch(/drainBrainQueue|thinkLearner|queueSettleDue/);
  });

  it('talks to Postgres without prepared statements, a transaction per learner through sql.begin', () => {
    const text = read(path.join(FN, 'index.ts'));
    expect(text).toMatch(/prepare:\s*false/);
    expect(text).toMatch(/\.begin\(/);
  });
});
