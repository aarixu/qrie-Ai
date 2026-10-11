import { openDemoDatabase } from '../../lms-demo/src/database.ts';
import { seedDemoSchool } from '../../lms-demo/src/seed.ts';
import { demoAuth } from './auth.ts';
import { demoFunctions } from './functions.ts';
import { seedAdminDemo, type DemoSeedSummary } from './seed.ts';
import type { DemoWorld } from './server.ts';

export interface BuiltDemo extends DemoWorld {
  seed: DemoSeedSummary;
}

/**
 * The whole local demo, in memory: PGlite with the harness's Supabase stand-in
 * and every migration (tools/lms-demo openDemoDatabase, exactly as the tests
 * build it), then the demo school (tools/lms-demo seedDemoSchool), then the
 * demo's auth, its in-process edge functions and ./seed.ts. Nothing is kept on
 * disk: every start builds it afresh.
 *
 * The database runs in UTC, as the hosted one does (PGlite otherwise takes a
 * zone from this computer).
 */
export async function buildAdminDemo(
  url: string,
  opts: { libraryPerClass?: number; log?: (line: string) => void } = {},
): Promise<BuiltDemo> {
  const log = opts.log ?? (() => undefined);
  log('Applying every migration to an in-memory database...');
  const db = await openDemoDatabase();
  await db.exec(`set timezone to 'UTC'`);
  log('Building the demo school: people, the question library, a month of homework...');
  const school = await seedDemoSchool(db, opts.libraryPerClass === undefined ? {} : { libraryPerClass: opts.libraryPerClass });
  const auth = await demoAuth(db, { issuer: `${url}/auth/v1` });
  const functions = demoFunctions(db, auth, url);
  log('Adding staff, a second school, billing, safety reports and the charts...');
  const seed = await seedAdminDemo(db, auth, functions, school);
  return { db, auth, functions, seed };
}
