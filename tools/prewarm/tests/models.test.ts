import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (rel: string) => path.resolve(HERE, '../../..', rel);

/**
 * THE RUNNER MUST WARM THE PRODUCT THE APP WOULD HAVE MADE.
 *
 * lib/main.mjs restates liveClass.ts's model ids rather than importing them
 * (liveClass.ts pulls in the app's stores, which have no business in a CLI).
 * Restated constants drift silently, and the day they drift this runner warms
 * 274 topics of a class the app never makes. Both files are read as TEXT
 * here, which is a read and not an edit — apps/ is not this phase's to touch.
 */
describe('the runner and the app agree on models', () => {
  const runner = fs.readFileSync(repoPath('tools/prewarm/lib/main.mjs'), 'utf8');
  const app = fs.readFileSync(repoPath('apps/classroom/src/lib/liveClass.ts'), 'utf8');

  const declared = [...runner.matchAll(/^const ([A-Z_]+_MODEL) = '([^']+)';$/gm)].map(
    ([, name, id]) => ({ name, id }),
  );

  it('finds the runner is actually declaring models (the regex still matches)', () => {
    expect(declared.map((d) => d.name)).toEqual(
      expect.arrayContaining(['PLANNER_MODEL', 'ARTIST_MODEL', 'PICKER_MODEL', 'IMAGE_MODEL', 'VISION_MODEL']),
    );
  });

  for (const { name, id } of declared) {
    // Every id, REVIEWER_MODEL included since C10 put a reviewer in the app,
    // must appear verbatim in liveClass.ts.
    it(`${name} is the id liveClass.ts uses`, () => {
      expect(app).toContain(`const ${name} = '${id}';`);
    });
  }
});
